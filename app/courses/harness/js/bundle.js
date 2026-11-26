export function transpileFiles(ts, files) {
  const output = {};
  for (const [path, source] of Object.entries(files)) {
    const result = ts.transpileModule(source, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
        isolatedModules: true,
      },
    });
    const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      const first = errors[0];
      const where = first.file && first.start !== undefined ? first.file.getLineAndCharacterOfPosition(first.start) : null;
      const line = where ? ` line ${where.line + 1}` : "";
      throw new SyntaxError(`${path}${line}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
    }
    output[path] = result.outputText;
  }
  return output;
}

export function buildWorkerSource(modules, entry) {
  const factories = Object.entries(modules)
    .map(([path, code]) => `${JSON.stringify(path)}: function (exports, require, module) {\n${code}\n}`)
    .join(",\n");
  return `"use strict";
const __modules = {
${factories}
};
const __entry = ${JSON.stringify(entry)};
const __cache = {};
function __resolve(from, spec) {
  if (!spec.startsWith(".")) throw new Error("Only relative imports of the harness files work here, not " + spec + ".");
  const parts = from.split("/").slice(0, -1);
  for (const part of spec.split("/")) {
    if (part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function __load(path) {
  if (__cache[path]) return __cache[path].exports;
  const factory = __modules[path];
  if (!factory) throw new Error("Cannot find the file " + path + ".");
  const module = { exports: {} };
  __cache[path] = module;
  factory(module.exports, (spec) => __load(__resolve(path, spec)), module);
  return module.exports;
}
let __seq = 0;
const __waiting = new Map();
self.fetch = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const id = ++__seq;
    __waiting.set(id, { resolve, reject });
    postMessage({
      type: "fetch",
      id,
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      body: typeof init.body === "string" ? init.body : null,
    });
  });
let __turn = 0;
const __step = (step) => postMessage({ type: "step", turn: __turn, step });
const __xray = {
  request: (body, why) => __step({ kind: "request", why: String(why), body: structuredClone(body) }),
  response: (body, elapsedMs, why) => __step({ kind: "response", why: String(why), body: structuredClone(body), elapsedMs }),
  tool: (step, why) => __step({ kind: "tool", why: String(why), step: { ...structuredClone(step), elapsedMs: Math.round(step.elapsedMs * 10) / 10 } }),
  note: (why) => __step({ kind: "note", why: String(why) }),
};
let __harness = null;
self.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "fetch-reply") {
    const waiter = __waiting.get(message.id);
    __waiting.delete(message.id);
    if (!waiter) return;
    if (message.error) waiter.reject(new TypeError(message.error));
    else waiter.resolve(new Response(message.body, { status: message.status, headers: { "content-type": "application/json" } }));
  } else if (message.type === "send") {
    __turn = message.turn;
    try {
      const text = await __harness.send(message.text, __xray);
      postMessage({ type: "reply", turn: message.turn, text: typeof text === "string" ? text : String(text ?? "") });
    } catch (error) {
      postMessage({ type: "error", turn: message.turn, message: error instanceof Error ? error.message : String(error) });
    }
  }
};
try {
  const entry = __load(__entry);
  if (typeof entry.createHarness !== "function") throw new Error(__entry + " must export a createHarness() function.");
  __harness = entry.createHarness();
  postMessage({ type: "ready" });
} catch (error) {
  postMessage({ type: "load-error", message: error instanceof Error ? error.message : String(error) });
}
`;
}

export function sourceSignature(files) {
  let hash = 2166136261;
  for (const [path, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    for (const char of `${path}\0${source}\0`) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(36);
}
