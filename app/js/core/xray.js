import { estimateTokens } from "./tokens.js";

export const STEP_LABELS = {
  request: "Sent",
  response: "Received",
  tool: "Tool ran",
  error: "Error",
  note: "Page",
};

export const ERROR_COPY = {
  not_granted: "Live examples are off because this course isn't allowed to use Claude in this view.",
  sampling_disabled: "Claude isn't available for this account here, so live examples are off.",
  not_declared: "This version of the course can't call Claude.",
  capability_disabled: "Claude can't be reached from this view.",
  capability_removed: "This Claude app is too old for live examples.",
  rate_limited: "Too many requests right now. Wait a minute, then try again.",
  usage_limit: "You've reached your Claude usage limit. Live examples will work again when it resets.",
  session_expired: "Your Claude sign-in expired. Sign in again, then reload this page.",
  refused: "Claude declined this request. Try asking for something different.",
  empty_completion: "Claude sent back an empty answer. Try a simpler request.",
  invalid_json: "Claude's answer wasn't in the expected format. Try again.",
  prompt_too_large: "That request is too long. Try a shorter text.",
  invalid_request: "The request was malformed, so nothing was sent. The raw error below says what to fix.",
  cancelled: "Stopped.",
  upstream_error: "Claude couldn't be reached just now. Try again in a moment.",
};

export const HIDE_CODES = new Set([
  "not_granted",
  "sampling_disabled",
  "not_declared",
  "capability_disabled",
  "capability_removed",
]);

export function errorCopy(error) {
  if (!error) return ERROR_COPY.upstream_error;
  if (error.code === "rate_limited" && error.reason === "usage_limit") return ERROR_COPY.usage_limit;
  return ERROR_COPY[error.code] ?? ERROR_COPY.upstream_error;
}

export function normalizeInput(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  return Array.isArray(input) ? input : [];
}

export function inputStats(input) {
  const turns = normalizeInput(input);
  const chars = turns.reduce((sum, t) => sum + [...String(t.content ?? "")].length, 0);
  const text = turns.map((t) => t.content).join("");
  return { messages: turns.length, chars, tokens: estimateTokens(text) };
}

export function requestRecord(input, options = {}) {
  const record = { capability: "sample", input };
  const kept = {};
  for (const [key, value] of Object.entries(options)) {
    if (key === "onText" || key === "signal" || value === undefined) continue;
    kept[key] = key === "tools" ? value.map(toolShape) : value;
  }
  if (Object.keys(kept).length) record.options = kept;
  return record;
}

function toolShape(tool) {
  const shape = { name: tool.name, description: tool.description };
  if (tool.inputSchema) shape.inputSchema = tool.inputSchema;
  return shape;
}

export function responseRecord(result) {
  const record = { text: result.text, truncated: Boolean(result.truncated) };
  if (result.modelTierApplied) record.modelTierApplied = result.modelTierApplied;
  if (result.modelApplied) record.modelApplied = result.modelApplied;
  return record;
}

export function errorRecord(error) {
  const record = { code: error?.code ?? "upstream_error", message: error?.message ?? String(error) };
  if (error?.reason) record.reason = error.reason;
  if (typeof error?.text === "string" && error.text) record.partialText = error.text;
  return record;
}

export function plural(n, word, many = word + "s") {
  return `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
}

export function describeRequest(input, why = "") {
  const { messages, tokens } = inputStats(input);
  const head = `Sent ${plural(messages, "message")} (about ${plural(tokens, "token")}) to Claude.`;
  return why ? `${head} ${why}` : head;
}

export function wordCount(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length;
}

export function describeResponse(result, ms, why = "") {
  const words = wordCount(result.text);
  const seconds = (ms / 1000).toFixed(1);
  let head = `Claude replied with ${plural(words, "word")} in ${seconds} s.`;
  if (result.truncated) head += " The answer was cut off at the length limit.";
  return why ? `${head} ${why}` : head;
}

export function describeError(error) {
  return `${errorCopy(error)} (code: ${error?.code ?? "unknown"})`;
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}
