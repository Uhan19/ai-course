import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CURL_TIMEOUT_S,
  FALLBACK_MODEL_LABEL,
  curlCommand,
  decideSource,
  fromClaudeReply,
  hasModel,
  localReady,
  ollamaEndpoint,
  ollamaRequest,
  parseCurlResult,
  probeLocal,
  readConfigValue,
  setupSteps,
  toClaudeRequest,
} from "../app/courses/harness/js/model-source.js";

describe("which model answers", () => {
  it("prefers the local model, falls back to Claude, and honours an explicit choice", () => {
    assert.equal(decideSource({ localIsReady: true, claudeAvailable: true }), "local");
    assert.equal(decideSource({ localIsReady: false, claudeAvailable: true }), "claude");
    assert.equal(decideSource({ preference: "claude", localIsReady: true, claudeAvailable: true }), "claude");
    assert.equal(decideSource({ preference: "claude", localIsReady: true, claudeAvailable: false }), "local");
    assert.equal(decideSource({ localIsReady: false, claudeAvailable: false }), "none");
  });
});

describe("reaching Ollama through the desktop app", () => {
  it("allows only Ollama's chat, tags and version endpoints on localhost", () => {
    assert.deepEqual(ollamaEndpoint("http://127.0.0.1:11434/api/chat", "post"), { path: "/api/chat", method: "POST" });
    assert.deepEqual(ollamaEndpoint("http://localhost:11434/api/tags"), { path: "/api/tags", method: "GET" });
    assert.throws(() => ollamaEndpoint("http://127.0.0.1:11434/api/pull", "POST"), /only lets harness code reach Ollama/);
    assert.throws(() => ollamaEndpoint("http://evil.example:11434/api/chat", "POST"), /only lets harness code reach Ollama/);
    assert.throws(() => ollamaEndpoint("https://127.0.0.1:11434/api/chat", "POST"), /only lets harness code reach Ollama/);
    assert.throws(() => ollamaEndpoint("http://127.0.0.1:11434/api/chat?x=1", "POST"), /only lets harness code reach Ollama/);
    assert.throws(() => ollamaEndpoint("http://127.0.0.1:11434/api/chat", "GET"), /expects POST/);
    assert.throws(() => ollamaEndpoint("not a url"), /Not a valid URL/);
  });

  it("builds a fixed curl command and sends the body on stdin", () => {
    const command = curlCommand({ path: "/api/chat", method: "POST" });
    assert.equal(
      command,
      `PATH="$PATH:/usr/local/bin:/opt/homebrew/bin" curl -sS --max-time ${CURL_TIMEOUT_S} -X POST -H 'content-type: application/json' --data-binary @- -w '\\n__PRIMER_HTTP_STATUS__%{http_code}' 'http://127.0.0.1:11434/api/chat'`,
    );
    assert.doesNotMatch(curlCommand({ path: "/api/tags", method: "GET" }, 3), /data-binary/);
    assert.throws(() => curlCommand({ path: "/api/delete", method: "DELETE" }), /Unsupported/);
  });

  it("parses curl output into status and body", () => {
    assert.deepEqual(parseCurlResult({ stdout: '{"a":1}\n__PRIMER_HTTP_STATUS__200', code: 0 }), { ok: true, status: 200, body: '{"a":1}' });
    assert.deepEqual(parseCurlResult({ stdout: "{}\n__PRIMER_HTTP_STATUS__404\n", code: 0 }), { ok: true, status: 404, body: "{}" });
    assert.deepEqual(parseCurlResult({ stdout: "", stderr: "curl: (7) Failed to connect", code: 7 }), { ok: false, message: "curl: (7) Failed to connect" });
    assert.equal(parseCurlResult({ stdout: "partial", code: 0 }).ok, false);
  });

  it("runs the request through childProcess.exec", async () => {
    const calls = [];
    const desktop = {
      childProcess: {
        exec: async (command, options) => {
          calls.push({ command, options });
          return { stdout: '{"ok":true}\n__PRIMER_HTTP_STATUS__200', stderr: "", code: 0 };
        },
      },
    };
    const reply = await ollamaRequest(desktop, { path: "/api/chat", method: "POST", body: '{"model":"m"}' });
    assert.deepEqual(reply, { status: 200, body: '{"ok":true}' });
    assert.equal(calls[0].options.input, '{"model":"m"}');
    assert.ok(calls[0].options.timeout > CURL_TIMEOUT_S * 1000);
    const down = { childProcess: { exec: async () => ({ stdout: "", stderr: "curl: (7) refused", code: 7 }) } };
    await assert.rejects(ollamaRequest(down, { path: "/api/version", method: "GET" }), /fetch failed: could not reach Ollama/);
  });

  it("probes Ollama, the model and Docker", async () => {
    const fakeDesktop = (answers) => ({
      childProcess: {
        exec: async (command) => {
          for (const [pattern, reply] of answers) if (command.includes(pattern)) return reply;
          return { stdout: "", stderr: "", code: 1 };
        },
      },
    });
    const ready = await probeLocal(
      fakeDesktop([
        ["/api/version", { stdout: '{"version":"0.40.16"}\n__PRIMER_HTTP_STATUS__200', code: 0 }],
        ["/api/tags", { stdout: '{"models":[{"name":"qwen3.5:9b"}]}\n__PRIMER_HTTP_STATUS__200', code: 0 }],
        ["docker info", { stdout: "29.9.3\n", code: 0 }],
      ]),
      "qwen3.5:9b",
    );
    assert.deepEqual(ready, {
      ollama: { running: true, installed: true, version: "0.40.16" },
      model: { name: "qwen3.5:9b", pulled: true },
      docker: { state: "running", version: "29.9.3" },
    });
    assert.equal(localReady(ready), true);
    assert.deepEqual(setupSteps(ready), []);

    const bare = await probeLocal(fakeDesktop([["command -v ollama", { stdout: "/opt/homebrew/bin/ollama", code: 0 }]]), "qwen3.5:9b");
    assert.deepEqual(bare.ollama, { running: false, installed: true, version: "" });
    assert.equal(bare.docker.state, "missing");
    assert.equal(localReady(bare), false);
    const steps = setupSteps(bare);
    assert.deepEqual(
      steps.map((s) => s.command ?? null),
      ["brew services start ollama", "ollama pull qwen3.5:9b", null],
    );
    assert.equal(steps.at(-1).optional, true);
  });

  it("explains a missing Ollama install, per platform", () => {
    const probe = { ollama: { running: false, installed: false }, model: { name: "m", pulled: false }, docker: { state: "running" } };
    assert.deepEqual(
      setupSteps(probe, "darwin").map((s) => s.command),
      ["brew install ollama", "brew services start ollama", "ollama pull m"],
    );
    assert.equal(setupSteps(probe, "linux")[0].command, undefined);
    assert.match(setupSteps(probe, "linux")[0].hint, /ollama\.com\/download/);
  });

  it("checks the model list and reads config values", () => {
    assert.equal(hasModel({ models: [{ name: "a" }, { model: "b" }] }, "b"), true);
    assert.equal(hasModel({}, "a"), false);
    const config = 'export const OLLAMA_URL = "http://127.0.0.1:11434";\nexport const MODEL = "qwen3.5:9b";\nexport const THINK = false;';
    assert.equal(readConfigValue(config, "MODEL"), "qwen3.5:9b");
    assert.equal(readConfigValue(config, "MISSING"), null);
  });
});

describe("Claude as the fallback model", () => {
  const tools = [
    {
      type: "function",
      function: { name: "calculator", description: "Do maths.", parameters: { type: "object", properties: { expression: { type: "string", description: "e" } }, required: ["expression"] } },
    },
  ];

  it("turns a plain chat request into turns that start and end with the user", () => {
    const { input, json } = toClaudeRequest({
      model: "qwen3.5:9b",
      messages: [
        { role: "system", content: "Keep answers short." },
        { role: "user", content: "My name is Sam." },
        { role: "assistant", content: "Hi Sam." },
        { role: "user", content: "What is my name?" },
      ],
    });
    assert.equal(json, false);
    assert.deepEqual(input.map((t) => t.role), ["user", "user", "assistant", "user"]);
    assert.match(input[0].content, /system message:\nKeep answers short\./);
    assert.equal(input.at(-1).content, "What is my name?");
  });

  it("describes tools, replays tool calls and results, and asks for JSON", () => {
    const { input, json } = toClaudeRequest({
      messages: [
        { role: "user", content: "What is 17 * 23?" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_0", function: { name: "calculator", arguments: { expression: "17 * 23" } } }] },
        { role: "tool", tool_name: "calculator", tool_call_id: "call_0", content: "391" },
      ],
      tools,
    });
    assert.equal(json, true);
    assert.match(input[0].content, /"name": "calculator"/);
    assert.match(input[0].content, /Reply with only one JSON object/);
    assert.equal(input[2].content, '(asked the harness to run: calculator({"expression":"17 * 23"}))');
    assert.equal(input[3].content, "Result of the tool calculator, call call_0: 391");
  });

  it("ends on a user turn even when the history ends with the assistant", () => {
    const { input } = toClaudeRequest({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
    assert.equal(input.at(-1).role, "user");
  });

  it("builds an Ollama-shaped reply from Claude's answer", () => {
    assert.deepEqual(fromClaudeReply("Hello!", { json: false }), {
      model: FALLBACK_MODEL_LABEL,
      message: { role: "assistant", content: "Hello!" },
      done: true,
      done_reason: "stop",
    });
    const asked = fromClaudeReply(
      { content: "", tool_calls: [{ name: "calculator", arguments: { expression: "1+1" } }, { name: "" }, { name: "clock", arguments: "x" }] },
      { json: true, idPrefix: "t" },
    );
    assert.deepEqual(asked.message.tool_calls, [
      { id: "t_0", function: { name: "calculator", arguments: { expression: "1+1" } } },
      { id: "t_1", function: { name: "clock", arguments: {} } },
    ]);
    assert.deepEqual(fromClaudeReply({ content: "Done.", tool_calls: [] }, { json: true }).message, { role: "assistant", content: "Done." });
    assert.equal(fromClaudeReply(["odd"], { json: true }).message.content, "odd");
  });
});
