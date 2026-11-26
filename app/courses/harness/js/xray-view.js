import { escapeHtml } from "../../../js/core/markdown.js";
import { h, plural, trusted } from "../../../js/ui.js";

const PREVIEW_LENGTH = 160;
const SLOW_LOAD_NS = 1e9;

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

  startTurn(userText, source) {
    this.root.querySelector(".xray-empty")?.remove();
    this.turn = { startedAt: performance.now(), modelCalls: 0, toolCalls: 0, source };
    this.append(h("li", { class: "xray-turn" }, h("span", { class: "xray-turn-label" }, "You typed"), h("q", {}, userText)));
  }

  endTurn(outcome, failure = "") {
    if (!this.turn) return;
    const seconds = ((performance.now() - this.turn.startedAt) / 1000).toFixed(1);
    const { modelCalls, toolCalls } = this.turn;
    const summary =
      outcome === "answered"
        ? `Done. The harness showed you the final answer after ${[plural(modelCalls, "model call"), toolCalls ? plural(toolCalls, "tool call") : ""].filter(Boolean).join(" and ")} in ${seconds} s.`
        : `The turn failed after ${seconds} s. ${failure}`.trim();
    this.append(h("li", { class: `xray-end xray-end-${outcome}` }, summary));
    this.turn = undefined;
  }

  add(step) {
    this.stepNumber += 1;
    if (this.turn && step.kind === "request") this.turn.modelCalls += 1;
    if (this.turn && step.kind === "tool") this.turn.toolCalls += 1;
    this.append(renderStep(step, this.stepNumber, this.turn?.source ?? "local"));
  }

  note(why, json, jsonLabel) {
    this.add({ kind: "page", why, json, jsonLabel });
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
        meta: `${Number(tool.elapsedMs).toFixed(1)} ms`,
        preview: `${tool.name}(${JSON.stringify(tool.arguments)}) → ${truncate(String(outcome ?? ""))}`,
        json: tool,
        jsonLabel: "Tool call and result JSON",
      };
    }
    case "page":
      return { badge: "Page ↔ Claude", tone: "page", meta: "", preview: "", json: step.json, jsonLabel: step.jsonLabel };
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

function truncate(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}
