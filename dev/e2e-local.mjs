import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { buildWorkerSource, transpileFiles } from "../app/courses/harness/js/bundle.js";
import { localReady, ollamaEndpoint, ollamaRequest, probeLocal, readConfigList, readConfigValue } from "../app/courses/harness/js/model-source.js";
import { createSandboxController } from "../app/courses/harness/js/sandbox-controller.js";
import { HARNESS_FILES } from "../app/courses/harness/files.js";
import { LESSONS } from "../app/courses/harness/lessons.js";
import { PREVIEW_HOME, allowFileFetch, createNodeDesktop } from "./node-desktop.mjs";

const lesson = LESSONS.find((candidate) => candidate.id === Number(process.argv[2] ?? 3));
const messages = process.argv.slice(3).length ? process.argv.slice(3) : ["What time is it in Tokyo, and what is 15% of 80?"];
if (!lesson?.entry) {
  console.error("Pick a lesson with a chat, from 0 to 7.");
  process.exit(1);
}

allowFileFetch();
const desktop = createNodeDesktop({ home: process.env.PRIMER_E2E_HOME ?? PREVIEW_HOME });
const root = new URL("../app/courses/harness/", import.meta.url);
const files = Object.fromEntries(await Promise.all(HARNESS_FILES.map(async (path) => [path, await readFile(new URL(path, root), "utf8")])));
const model = lesson.comparesModels ? readConfigList(files["harness/config.ts"], "MODELS")[0] : readConfigValue(files["harness/config.ts"], "MODEL");
const probe = await probeLocal(desktop, model);
console.log(`Probe: Ollama ${probe.ollama.running ? probe.ollama.version : "not running"}, ${model} ${probe.model.pulled ? "pulled" : "missing"}`);
if (!localReady(probe)) {
  console.error("The local model isn't ready, so there is nothing to drive.");
  process.exit(1);
}

const sources = { local: "checked", source: "local", platform: process.platform, desktop, subscribe: () => () => {} };
const sandbox = createSandboxController({ sources });
let mode = { mode: "simulated", reason: "this lesson has no sandbox" };
if (lesson.usesSandbox) {
  await sandbox.refresh();
  mode = sandbox.modeFor("local");
  console.log(mode.mode === "docker" ? `Sandbox: Docker ${sandbox.version}` : `Sandbox: simulated, because ${mode.reason}`);
}

const pageOps = {
  prepareSandbox: () => sandbox.prepare(mode.mode).then(() => null),
  runInSandbox: (request) => sandbox.run(mode.mode, request),
  readWorkspaceFile: (name) => sandbox.read(mode.mode, name),
};

const context = vm.createContext({ Response, performance, structuredClone, console, URL, Date, Intl });
context.self = context;
const waiters = new Map();
const answer = (data) => context.onmessage({ data });
context.postMessage = async (message) => {
  if (message.type === "step") {
    const { step } = message;
    const detail =
      step.kind === "tool"
        ? `${step.step.name}(${JSON.stringify(step.step.arguments)}) -> ${step.step.result ?? step.step.error}`
        : step.kind === "response"
          ? `${(step.elapsedMs / 1000).toFixed(1)} s, ${step.body.prompt_eval_count} tokens in, ${step.body.eval_count} out`
          : step.kind === "sandbox"
            ? `${step.run.argv.join(" ")} -> exit ${step.run.exitCode}${step.run.timedOut ? " (timed out)" : ""}`
            : "";
    console.log(`  [${step.kind}] ${step.why}${detail ? ` | ${detail}` : ""}`);
  } else if (message.type === "fetch") {
    const reply = await ollamaRequest(desktop, { ...ollamaEndpoint(message.url, message.method), body: message.body ?? "" }).then(
      (r) => ({ status: r.status, body: r.body }),
      (error) => ({ error: error.message }),
    );
    answer({ type: "fetch-reply", id: message.id, ...reply });
  } else if (message.type === "page") {
    const reply = await Promise.resolve(pageOps[message.op]?.(...message.args)).then(
      (value) => ({ value }),
      (error) => ({ error: error.message, code: error.code }),
    );
    answer({ type: "page-reply", id: message.id, ...reply });
  } else if (message.type === "ask") {
    console.log(`  [ask] approved: ${message.request.action}`);
    answer({ type: "answer", id: message.id, approved: true });
  } else {
    waiters.get(message.type)?.(message);
  }
};
const next = (type) => new Promise((resolve) => waiters.set(type, resolve));
const ready = next("ready");
vm.runInContext(buildWorkerSource(transpileFiles(ts, files), lesson.entry, lesson.comparesModels ? { model } : {}), context);
await ready;

let turn = 0;
for (const text of messages) {
  turn += 1;
  console.log(`\nYou: ${text}`);
  const done = Promise.race([next("reply"), next("error")]);
  answer({ type: "send", turn, text });
  const result = await done;
  console.log(result.type === "reply" ? `Harness: ${result.text}` : `Error: ${result.message}`);
  if (result.type !== "reply") process.exitCode = 1;
}
