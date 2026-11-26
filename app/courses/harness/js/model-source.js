export const OLLAMA_HOST = "http://127.0.0.1:11434";
export const CURL_TIMEOUT_S = 600;
const EXEC_GRACE_MS = 5_000;
const PROBE_TIMEOUT_S = 3;
const EXTRA_PATH = "/usr/local/bin:/opt/homebrew/bin";
const STATUS_MARK = "__PRIMER_HTTP_STATUS__";
const ALLOWED_ENDPOINTS = { "/api/chat": "POST", "/api/tags": "GET", "/api/version": "GET" };
const LOCAL_HOSTS = new Set(["127.0.0.1:11434", "localhost:11434"]);
export const MODEL_DOWNLOAD_SIZES = { "qwen3.5:9b": "about 7.6 GB" };
export const FALLBACK_MODEL_LABEL = "claude (fallback through your Claude account)";

export function ollamaEndpoint(url, method = "GET") {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new TypeError(`Not a valid URL: ${url}`);
  }
  const expected = ALLOWED_ENDPOINTS[parsed.pathname];
  if (parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.host) || !expected || parsed.search) {
    throw new TypeError(
      `This course only lets harness code reach Ollama at ${OLLAMA_HOST} (${Object.keys(ALLOWED_ENDPOINTS).join(", ")}). Got ${method} ${url}.`,
    );
  }
  if (String(method).toUpperCase() !== expected) {
    throw new TypeError(`${parsed.pathname} expects ${expected}, not ${method}.`);
  }
  return { path: parsed.pathname, method: expected };
}

export function curlCommand({ path, method }, timeoutSeconds = CURL_TIMEOUT_S) {
  if (ALLOWED_ENDPOINTS[path] !== method) throw new TypeError(`Unsupported endpoint ${method} ${path}`);
  const send = method === "POST" ? "-H 'content-type: application/json' --data-binary @- " : "";
  return `PATH="$PATH:${EXTRA_PATH}" curl -sS --max-time ${Number(timeoutSeconds)} -X ${method} ${send}-w '\\n${STATUS_MARK}%{http_code}' '${OLLAMA_HOST}${path}'`;
}

export const OLLAMA_CLI_COMMAND = `PATH="$PATH:${EXTRA_PATH}" command -v ollama || test -d /Applications/Ollama.app`;

export function parseCurlResult({ stdout = "", stderr = "", code }) {
  if (code !== 0) {
    return { ok: false, message: stderr.trim() || `curl exited with code ${code}` };
  }
  const at = stdout.lastIndexOf(`\n${STATUS_MARK}`);
  if (at < 0) return { ok: false, message: "Ollama's reply was incomplete." };
  const status = Number(stdout.slice(at + STATUS_MARK.length + 1).trim());
  if (!Number.isInteger(status) || status < 100) return { ok: false, message: "Ollama's reply had no HTTP status." };
  return { ok: true, status, body: stdout.slice(0, at) };
}

export async function ollamaRequest(desktop, { path, method, body = "" }, timeoutSeconds = CURL_TIMEOUT_S) {
  const result = await desktop.childProcess.exec(curlCommand({ path, method }, timeoutSeconds), {
    input: body ?? "",
    timeout: timeoutSeconds * 1000 + EXEC_GRACE_MS,
  });
  const parsed = parseCurlResult(result);
  if (!parsed.ok) throw new TypeError(`fetch failed: could not reach Ollama at ${OLLAMA_HOST} (${parsed.message})`);
  return { status: parsed.status, body: parsed.body };
}

export async function probeLocal(desktop, model) {
  const probe = { ollama: { running: false, installed: false, version: "" }, model: { name: model, pulled: false } };
  try {
    const version = await ollamaRequest(desktop, { path: "/api/version", method: "GET" }, PROBE_TIMEOUT_S);
    probe.ollama.running = version.status === 200;
    probe.ollama.installed = probe.ollama.running;
    probe.ollama.version = JSON.parse(version.body).version ?? "";
  } catch {
    probe.ollama.running = false;
  }
  if (probe.ollama.running) {
    try {
      const tags = await ollamaRequest(desktop, { path: "/api/tags", method: "GET" }, PROBE_TIMEOUT_S);
      probe.model.pulled = hasModel(JSON.parse(tags.body), model);
    } catch {
      probe.model.pulled = false;
    }
  } else {
    const cli = await desktop.childProcess.exec(OLLAMA_CLI_COMMAND, { timeout: 5_000 }).catch(() => ({ code: 1 }));
    probe.ollama.installed = cli.code === 0;
  }
  return probe;
}

function withTag(name) {
  return String(name).split("/").pop().includes(":") ? String(name) : `${name}:latest`;
}

export function hasModel(tags, model) {
  const wanted = withTag(model);
  const listed = (Array.isArray(tags?.models) ? tags.models : []).flatMap((entry) => [entry?.name, entry?.model]).filter(Boolean);
  return listed.some((name) => withTag(name) === wanted);
}

export function localReady(probe) {
  return Boolean(probe?.ollama.running && probe.model.pulled);
}

export function setupSteps(probe, platform = "darwin") {
  const steps = [];
  const mac = platform === "darwin";
  if (!probe.ollama.running) {
    if (!probe.ollama.installed) {
      steps.push({
        problem: "Ollama isn't installed. It's the free program that runs the course's model on your computer.",
        command: mac ? "brew install ollama" : undefined,
        hint: mac ? "No Homebrew? Download Ollama from ollama.com/download instead." : "Download it from ollama.com/download.",
      });
    }
    steps.push({
      problem: probe.ollama.installed ? "Ollama is installed but not running." : "Then start Ollama.",
      command: mac ? "brew services start ollama" : "ollama serve",
      hint: mac ? "Or open the Ollama app." : undefined,
    });
  }
  if (!probe.model.pulled) {
    steps.push({
      problem: `The model ${probe.model.name} isn't downloaded yet${MODEL_DOWNLOAD_SIZES[probe.model.name] ? ` (${MODEL_DOWNLOAD_SIZES[probe.model.name]})` : ""}.`,
      command: `ollama pull ${probe.model.name}`,
    });
  }
  return steps;
}

export function decideSource({ preference = "auto", localIsReady = false, claudeAvailable = false }) {
  if (preference === "claude" && claudeAvailable) return "claude";
  if (localIsReady) return "local";
  if (claudeAvailable) return "claude";
  return "none";
}

export function readConfigValue(source, name) {
  const match = String(source ?? "").match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
  return match ? match[1] : null;
}

const JSON_PROTOCOL = `Reply with only one JSON object and nothing else:
{"content": "<your message to the user, or empty while you call tools>", "tool_calls": [{"name": "<tool name>", "arguments": {}}]}
Use tool_calls when a tool would help. Leave tool_calls empty ([]) when you give your final answer. Never invent a tool's result: results arrive in later messages.`;

export function toClaudeRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  const system = messages.filter((m) => m.role === "system").map((m) => String(m.content ?? ""));
  const preamble = ["You are the language model inside a small teaching harness. The harness sends you a conversation and you write the next assistant message."];
  if (system.length) preamble.push(`The harness's system message${system.length > 1 ? "s" : ""}:\n${system.join("\n\n")}`);
  if (tools.length) {
    const described = tools.map((t) => ({ name: t.function?.name, description: t.function?.description, parameters: t.function?.parameters }));
    preamble.push(`The harness can run these tools for you:\n${JSON.stringify(described, null, 2)}`, JSON_PROTOCOL);
  }
  const turns = [{ role: "user", content: preamble.join("\n\n") }];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      const calls = (message.tool_calls ?? []).map((c) => `${c.function?.name}(${JSON.stringify(c.function?.arguments ?? {})})`);
      const text = [String(message.content ?? "").trim(), calls.length ? `(asked the harness to run: ${calls.join(", ")})` : ""].filter(Boolean).join("\n");
      turns.push({ role: "assistant", content: text || "(empty reply)" });
    } else if (message.role === "tool") {
      const id = message.tool_call_id ? `, call ${message.tool_call_id}` : "";
      turns.push({ role: "user", content: `Result of the tool ${message.tool_name ?? "?"}${id}: ${String(message.content ?? "")}` });
    } else {
      turns.push({ role: "user", content: String(message.content ?? "") || "(empty message)" });
    }
  }
  if (turns.at(-1).role !== "user") turns.push({ role: "user", content: "(continue)" });
  return { input: turns, json: tools.length > 0 };
}

export function fromClaudeReply(reply, { json, idPrefix = "call" }) {
  const message = { role: "assistant", content: "" };
  if (!json) {
    message.content = String(reply ?? "");
  } else {
    const value = reply && typeof reply === "object" && !Array.isArray(reply) ? reply : { content: String(reply ?? "") };
    message.content = typeof value.content === "string" ? value.content : "";
    const calls = Array.isArray(value.tool_calls) ? value.tool_calls : [];
    const toolCalls = calls
      .filter((call) => call && typeof call.name === "string" && call.name)
      .map((call, index) => ({
        id: `${idPrefix}_${index}`,
        function: { name: call.name, arguments: call.arguments && typeof call.arguments === "object" ? call.arguments : {} },
      }));
    if (toolCalls.length) message.tool_calls = toolCalls;
  }
  return { model: FALLBACK_MODEL_LABEL, message, done: true, done_reason: "stop" };
}
