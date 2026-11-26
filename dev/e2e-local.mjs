import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { buildWorkerSource, transpileFiles } from "../app/courses/harness/js/bundle.js";
import { localReady, ollamaEndpoint, ollamaRequest, probeLocal, readConfigValue } from "../app/courses/harness/js/model-source.js";
import { HARNESS_FILES } from "../app/courses/harness/files.js";

const LESSON_ENTRIES = { 1: "harness/01-talk-to-model.ts", 2: "harness/02-chat-loop.ts", 3: "harness/03-agent.ts" };
const lesson = Number(process.argv[2] ?? 3);
const messages = process.argv.slice(3).length ? process.argv.slice(3) : ["What time is it in Tokyo, and what is 15% of 80?"];

const desktop = {
  childProcess: {
    exec: (command, { input = "", timeout = 10_000 } = {}) =>
      new Promise((resolve) => {
        const child = exec(command, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
          resolve({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0, signal: null, truncated: false }),
        );
        child.stdin.end(input);
      }),
  },
};

const root = new URL("../app/courses/harness/", import.meta.url);
const files = Object.fromEntries(await Promise.all(HARNESS_FILES.map(async (path) => [path, await readFile(new URL(path, root), "utf8")])));
const model = readConfigValue(files["harness/config.ts"], "MODEL");
const probe = await probeLocal(desktop, model);
console.log(`Probe: Ollama ${probe.ollama.running ? probe.ollama.version : "not running"}, ${model} ${probe.model.pulled ? "pulled" : "missing"}, Docker ${probe.docker.state}`);
if (!localReady(probe)) {
  console.error("The local model isn't ready, so there is nothing to drive.");
  process.exit(1);
}

const context = vm.createContext({ Response, performance, structuredClone, console, URL, Date, Intl });
context.self = context;
const waiters = new Map();
context.postMessage = async (message) => {
  if (message.type === "step") {
    const { step } = message;
    const detail =
      step.kind === "tool"
        ? `${step.step.name}(${JSON.stringify(step.step.arguments)}) -> ${step.step.result ?? step.step.error}`
        : step.kind === "response"
          ? `${(step.elapsedMs / 1000).toFixed(1)} s, ${step.body.prompt_eval_count} tokens in, ${step.body.eval_count} out`
          : "";
    console.log(`  [${step.kind}] ${step.why}${detail ? ` | ${detail}` : ""}`);
  } else if (message.type === "fetch") {
    const reply = await ollamaRequest(desktop, { ...ollamaEndpoint(message.url, message.method), body: message.body ?? "" }).then(
      (r) => ({ status: r.status, body: r.body }),
      (error) => ({ error: error.message }),
    );
    context.onmessage({ data: { type: "fetch-reply", id: message.id, ...reply } });
  } else {
    waiters.get(message.type)?.(message);
  }
};
const next = (type) => new Promise((resolve) => waiters.set(type, resolve));
const ready = next("ready");
vm.runInContext(buildWorkerSource(transpileFiles(ts, files), LESSON_ENTRIES[lesson]), context);
await ready;

let turn = 0;
for (const text of messages) {
  turn += 1;
  console.log(`\nYou: ${text}`);
  const done = Promise.race([next("reply"), next("error")]);
  context.onmessage({ data: { type: "send", turn, text } });
  const result = await done;
  console.log(result.type === "reply" ? `Harness: ${result.text}` : `Error: ${result.message}`);
  if (result.type !== "reply") process.exitCode = 1;
}
