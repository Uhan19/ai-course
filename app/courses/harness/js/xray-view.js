import { escapeHtml } from "../../../js/core/markdown.js";
import { h, plural, trusted } from "../../../js/ui.js";

const PREVIEW_LENGTH = 160;
const OUTPUT_PREVIEW_LENGTH = 600;
const SLOW_LOAD_NS = 1e9;
const COMPARE_HEADINGS = ["Model", "Model calls", "Tool calls", "Failed tool calls", "Tokens in", "Tokens out", "Time", "Of which loading"];

export class XRayLog {
  constructor(scroller) {
    this.scroller = scroller;
    this.stepNumber = 0;
    this.turn = undefined;
    this.root = h("ol", { class: "xray-log" });
    this.showEmpty();
  }

  clear() {
    this.stepNumber = 0;
    this.turn = undefined;
    this.root.replaceChildren();
    this.showEmpty();
  }

  startTurn(userText, source, model) {
    this.root.querySelector(".xray-empty")?.remove();
    this.turn = { startedAt: performance.now(), source, modelCalls: 0, toolCalls: 0, failedToolCalls: 0, tokensIn: 0, tokensOut: 0, loadSeconds: 0, seconds: 0 };
    this.waitingSince = undefined;
    this.waitedMs = 0;
    this.append(h("li", { class: "xray-turn" }, h("span", { class: "xray-turn-label" }, model ? `You typed, to ${model}` : "You typed"), h("q", {}, userText)));
  }

  pauseClock() {
    this.waitingSince ??= performance.now();
  }

  resumeClock() {
    if (this.waitingSince === undefined) return;
    this.waitedMs += performance.now() - this.waitingSince;
    this.waitingSince = undefined;
  }

  endTurn(outcome, failure = "") {
    if (!this.turn) return undefined;
    this.resumeClock();
    const stats = this.turn;
    stats.seconds = (performance.now() - stats.startedAt - this.waitedMs) / 1000;
    const waited = this.waitedMs > 0 ? `, not counting ${(this.waitedMs / 1000).toFixed(1)} s waiting for you` : "";
    const time = `${stats.seconds.toFixed(1)} s${waited}`;
    const summary =
      outcome === "answered"
        ? `Done. The harness showed you the final answer after ${[plural(stats.modelCalls, "model call"), stats.toolCalls ? plural(stats.toolCalls, "tool call") : ""].filter(Boolean).join(" and ")} in ${time}.`
        : `The turn failed after ${time}. ${failure}`.trim();
    this.append(h("li", { class: `xray-end xray-end-${outcome}` }, summary));
    this.turn = undefined;
    return stats;
  }

  add(step) {
    this.stepNumber += 1;
    if (this.turn) countStep(this.turn, step);
    this.append(renderStep(step, this.stepNumber, this.turn?.source ?? "local"));
  }

  addComparison(rows) {
    const cell = (text) => h("td", {}, text);
    this.append(
      h(
        "li",
        { class: "xray-compare" },
        h("p", { class: "xray-compare-title" }, "Same message, every model"),
        h(
          "div",
          { class: "xray-compare-scroll", tabindex: "0" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, COMPARE_HEADINGS.map((label) => h("th", { scope: "col" }, label)))),
            h(
              "tbody",
              {},
              rows.map(({ model, outcome, stats }) =>
                h(
                  "tr",
                  {},
                  h("th", { scope: "row" }, outcome === "answered" ? model : `${model} (failed)`),
                  cell(String(stats.modelCalls)),
                  cell(String(stats.toolCalls)),
                  cell(String(stats.failedToolCalls)),
                  cell(stats.tokensIn.toLocaleString("en-US")),
                  cell(stats.tokensOut.toLocaleString("en-US")),
                  cell(`${stats.seconds.toFixed(1)} s`),
                  cell(`${stats.loadSeconds.toFixed(1)} s`),
                ),
              ),
            ),
          ),
        ),
        h(
          "p",
          { class: "xray-compare-hint" },
          "Tokens are summed over every model call in the turn. Time leaves out any time the turn waited for you to approve. Loading is time Ollama spent getting the model into memory, which only happens when it was not loaded yet. Read every answer in the chat to judge which one was right.",
        ),
      ),
    );
  }

  note(why, json, jsonLabel, { badge, tone } = {}) {
    this.add({ kind: "page", why, json, jsonLabel, badge, tone });
  }

  setAllOpen(open) {
    for (const details of this.root.querySelectorAll("details")) details.open = open;
  }

  showEmpty() {
    this.root.append(h("li", { class: "xray-empty" }, "Nothing yet. Send a message and every step the harness takes will show up here, in order."));
  }

  append(node) {
    const atBottom = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 40;
    this.root.append(node);
    if (atBottom) this.scroller.scrollTop = this.scroller.scrollHeight;
  }
}

function countStep(turn, step) {
  if (step.kind === "request") turn.modelCalls += 1;
  if (step.kind === "response") {
    turn.tokensIn += step.body?.prompt_eval_count ?? 0;
    turn.tokensOut += step.body?.eval_count ?? 0;
    turn.loadSeconds += (step.body?.load_duration ?? 0) / 1e9;
  }
  if (step.kind === "tool") {
    turn.toolCalls += 1;
    if (step.step?.error !== undefined) turn.failedToolCalls += 1;
  }
}

function renderStep(step, number, source) {
  const { badge, tone, meta, preview, json, jsonLabel } = describe(step, source);
  return h(
    "li",
    { class: `xray-step tone-${tone}` },
    h(
      "div",
      { class: "step-head" },
      h("span", { class: "step-number" }, String(number)),
      h("span", { class: "step-badge" }, badge),
      meta ? h("span", { class: "step-meta" }, meta) : null,
    ),
    h("p", { class: "step-why" }, step.why),
    preview ? h("p", { class: "step-preview" }, preview) : null,
    json === undefined ? null : h("details", {}, h("summary", {}, jsonLabel), h("pre", { class: "json", tabindex: "0" }, trusted(highlightJson(json)))),
  );
}

export function describe(step, source = "local") {
  const viaClaude = source === "claude";
  switch (step.kind) {
    case "request": {
      const { messages = [], tools } = step.body ?? {};
      const meta = [plural(messages.length, "message"), tools ? plural(tools.length, "tool") : null].filter(Boolean).join(" · ");
      return {
        badge: "Harness → Model",
        tone: "request",
        meta,
        preview: "",
        json: step.body,
        jsonLabel: viaClaude ? "Request JSON the harness built (the page passes it to Claude, see the next step)" : "Request JSON sent to Ollama",
      };
    }
    case "response": {
      const body = step.body ?? { message: { content: "" } };
      const meta = [
        `${(step.elapsedMs / 1000).toFixed(1)} s`,
        body.prompt_eval_count === undefined ? null : `${body.prompt_eval_count} tokens in`,
        body.eval_count === undefined ? null : `${body.eval_count} tokens out`,
        (body.load_duration ?? 0) > SLOW_LOAD_NS ? `${(body.load_duration / 1e9).toFixed(1)} s loading the model` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const calls = body.message?.tool_calls ?? [];
      const answer = calls.length
        ? calls.map((call) => `${call.function.name}(${JSON.stringify(call.function.arguments)})`).join("\n")
        : truncate(body.message?.content ?? "");
      const preview = body.message?.thinking ? `Thinking: ${truncate(body.message.thinking)}\n\n${answer}` : answer;
      return {
        badge: "Model → Harness",
        tone: "response",
        meta,
        preview,
        json: body,
        jsonLabel: viaClaude ? "Response JSON the page built from Claude's reply" : "Response JSON from Ollama",
      };
    }
    case "tool": {
      const tool = step.step;
      const failed = tool.error !== undefined;
      const outcome = failed ? tool.error : tool.result;
      return {
        badge: failed ? "Tool failed" : "Harness runs tool",
        tone: failed ? "error" : "tool",
        meta: duration(Number(tool.elapsedMs)),
        preview: `${tool.name}(${JSON.stringify(tool.arguments)}) → ${truncate(String(outcome ?? ""))}`,
        json: tool,
        jsonLabel: "Tool call and result JSON",
      };
    }
    case "sandbox": {
      const run = step.run ?? {};
      const ending = run.timedOut ? "timed out" : `exit code ${run.exitCode}`;
      const output = [run.stdout, run.stderr].filter(Boolean).join("\n").trim();
      const failed = run.exitCode !== 0 || run.timedOut;
      return {
        badge: run.simulated ? "Simulated sandbox" : "Harness runs Docker",
        tone: failed ? "error" : run.simulated ? "simulated" : "sandbox",
        meta: `${run.simulated ? "in this page · " : ""}${ending} · ${(Number(run.elapsedMs) / 1000).toFixed(1)} s`,
        preview: `$ ${shellLine(run.argv ?? [])}${run.stdin === undefined ? "" : `  < ${truncate(JSON.stringify(run.stdin))}`}\n${output ? truncate(output, OUTPUT_PREVIEW_LENGTH, false) : "(no output)"}`,
        json: run,
        jsonLabel: run.simulated ? "Simulated command and its full output" : "Docker command and its full output",
      };
    }
    case "permission": {
      const check = step.step ?? {};
      return {
        badge: `Permission: ${check.decision}`,
        tone: check.decision === "deny" ? "error" : "permission",
        meta: check.decidedBy === "you" ? "decided by you" : "decided by the policy",
        preview: `${check.tool}(${JSON.stringify(check.arguments)})\nRule: ${check.rule}`,
        json: check,
        jsonLabel: "Permission check JSON",
      };
    }
    case "context": {
      const check = step.step ?? {};
      const summarized = check.summarized?.length ?? 0;
      return {
        badge: summarized ? "Context summarized" : "Context check",
        tone: "context",
        meta: `${Number(check.tokensBefore).toLocaleString("en-US")} of ${Number(check.limit).toLocaleString("en-US")} tokens`,
        preview: check.summary ? `Summary that replaces ${summarized} messages:\n${truncate(String(check.summary), OUTPUT_PREVIEW_LENGTH, false)}` : "",
        json: summarized ? check : undefined,
        jsonLabel: "What was summarized, and the summary",
      };
    }
    case "page":
      return { badge: step.badge ?? "Page ↔ Claude", tone: step.tone ?? "page", meta: "", preview: "", json: step.json, jsonLabel: step.jsonLabel };
    default:
      return { badge: "Harness", tone: "note", meta: "", preview: "", json: undefined, jsonLabel: "" };
  }
}

export function highlightJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2)).replace(
    /(&#34;(?:\\.|[^&\\]|&(?!#34;))*&#34;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/g,
    (match, string, colon, literal, number) => {
      if (string) return `<span class="${colon ? "json-key" : "json-string"}">${string}</span>${colon ?? ""}`;
      if (literal) return `<span class="json-literal">${literal}</span>`;
      if (number) return `<span class="json-number">${number}</span>`;
      return match;
    },
  );
}

function truncate(text, length = PREVIEW_LENGTH, flatten = true) {
  const shown = flatten ? String(text).replace(/\s+/g, " ").trim() : String(text);
  return shown.length > length ? `${shown.slice(0, length)}…` : shown;
}

export function shellLine(argv) {
  return argv.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, "'\\''")}'`)).join(" ");
}

function duration(ms) {
  return ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
