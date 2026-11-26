import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { buildWorkerSource, sourceSignature, transpileFiles } from "../app/courses/harness/js/bundle.js";
import { HARNESS_FILES } from "../app/courses/harness/files.js";

const root = new URL("../app/courses/harness/", import.meta.url);
const files = Object.fromEntries(await Promise.all(HARNESS_FILES.map(async (path) => [path, await readFile(new URL(path, root), "utf8")])));

function startWorker(source) {
  const outbox = [];
  const context = vm.createContext({ Response, performance, structuredClone, console, URL, Date, Intl });
  context.self = context;
  context.postMessage = (message) => outbox.push(structuredClone(message));
  vm.runInContext(source, context);
  const deliver = (message) => context.onmessage({ data: message });
  const next = async (type) => {
    for (let i = 0; i < 200; i += 1) {
      const index = outbox.findIndex((m) => !type || m.type === type);
      if (index >= 0) return outbox.splice(index, 1)[0];
      await new Promise((r) => setImmediate(r));
    }
    throw new Error(`no ${type ?? "message"} from the worker`);
  };
  return { outbox, deliver, next };
}

const reply = (message) => JSON.stringify({ model: "fake", message, done: true, prompt_eval_count: 3, eval_count: 2 });

describe("running the harness files in a worker", () => {
  it("transpiles every harness file", () => {
    const modules = transpileFiles(ts, files);
    assert.deepEqual(Object.keys(modules), HARNESS_FILES);
  });

  it("reports a syntax error with the file and line", () => {
    const broken = { ...files, "harness/config.ts": 'export const MODEL = "x";\nexport const THINK = = false;\n' };
    assert.throws(() => transpileFiles(ts, broken), /harness\/config\.ts line 2: Expression expected/);
  });

  it("runs lesson 2 end to end: history, fetch through the page, x-ray steps", async () => {
    const worker = startWorker(buildWorkerSource(transpileFiles(ts, files), "harness/02-chat-loop.ts"));
    assert.deepEqual(await worker.next(), { type: "ready" });

    worker.deliver({ type: "send", turn: 1, text: "My name is Sam." });
    const step = await worker.next("step");
    assert.equal(step.step.kind, "request");
    assert.match(step.step.why, /Sending the whole conversation \(2 messages\)/);
    const fetch1 = await worker.next("fetch");
    assert.equal(fetch1.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(fetch1.method, "POST");
    assert.equal(JSON.parse(fetch1.body).model, "qwen3.5:9b");
    worker.deliver({ type: "fetch-reply", id: fetch1.id, status: 200, body: reply({ role: "assistant", content: "Hi Sam." }) });
    assert.deepEqual(await worker.next("reply"), { type: "reply", turn: 1, text: "Hi Sam." });
    const kinds = worker.outbox.filter((m) => m.type === "step").map((m) => m.step.kind);
    assert.deepEqual(kinds, ["response", "note"]);
    worker.outbox.length = 0;

    worker.deliver({ type: "send", turn: 2, text: "What is my name?" });
    const fetch2 = await worker.next("fetch");
    assert.deepEqual(
      JSON.parse(fetch2.body).messages.map((m) => m.role),
      ["system", "user", "assistant", "user"],
    );
    worker.deliver({ type: "fetch-reply", id: fetch2.id, status: 200, body: reply({ role: "assistant", content: "Sam." }) });
    assert.equal((await worker.next("reply")).text, "Sam.");
  });

  it("runs lesson 3's tools inside the worker", async () => {
    const worker = startWorker(buildWorkerSource(transpileFiles(ts, files), "harness/03-agent.ts"));
    await worker.next("ready");
    worker.deliver({ type: "send", turn: 1, text: "17 * 23?" });
    const first = await worker.next("fetch");
    assert.equal(JSON.parse(first.body).tools.length, 3);
    worker.deliver({
      type: "fetch-reply",
      id: first.id,
      status: 200,
      body: reply({ role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "calculator", arguments: { expression: "17 * 23" } } }] }),
    });
    const second = await worker.next("fetch");
    assert.deepEqual(JSON.parse(second.body).messages.at(-1), { role: "tool", tool_name: "calculator", tool_call_id: "c1", content: "391" });
    worker.deliver({ type: "fetch-reply", id: second.id, status: 200, body: reply({ role: "assistant", content: "391" }) });
    assert.equal((await worker.next("reply")).text, "391");
    const tool = worker.outbox.find((m) => m.type === "step" && m.step.kind === "tool");
    assert.equal(tool.step.step.result, "391");
  });

  it("turns a refused fetch into the harness's own error", async () => {
    const worker = startWorker(buildWorkerSource(transpileFiles(ts, files), "harness/01-talk-to-model.ts"));
    await worker.next("ready");
    worker.deliver({ type: "send", turn: 1, text: "hi" });
    const request = await worker.next("fetch");
    worker.deliver({ type: "fetch-reply", id: request.id, status: 404, body: '{"error":"model \'no-such-model\' not found"}' });
    const failed = await worker.next("error");
    assert.equal(failed.message, `Ollama answered 404: {"error":"model 'no-such-model' not found"}`);
    worker.deliver({ type: "send", turn: 2, text: "again" });
    const again = await worker.next("fetch");
    worker.deliver({ type: "fetch-reply", id: again.id, error: "fetch failed: could not reach Ollama" });
    assert.equal((await worker.next("error")).message, "fetch failed: could not reach Ollama");
  });

  it("reports a harness that doesn't export createHarness", async () => {
    const modules = transpileFiles(ts, { ...files, "harness/02-chat-loop.ts": "export const nothing = 1;\n" });
    const worker = startWorker(buildWorkerSource(modules, "harness/02-chat-loop.ts"));
    assert.deepEqual(await worker.next(), { type: "load-error", message: "harness/02-chat-loop.ts must export a createHarness() function." });
  });

  it("changes the signature when any file changes", () => {
    const before = sourceSignature(files);
    assert.equal(sourceSignature({ ...files }), before);
    assert.notEqual(sourceSignature({ ...files, "harness/config.ts": files["harness/config.ts"] + " " }), before);
  });
});
