import { STEP_LABELS, errorCopy, prettyJson } from "./core/xray.js";
import { scoreQuiz, quizVerdict } from "./core/quiz.js";
import { recordQuiz } from "./core/progress.js";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function trusted(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

export function prose(html) {
  return h("div", { class: "prose" }, trusted(html));
}

export function sourceLink(url, label, read = "2026-11-25") {
  return h(
    "span",
    { class: "source" },
    h("a", { href: url, target: "_blank", rel: "noopener" }, label),
    ` (read ${read})`,
  );
}

let idCounter = 0;
export function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export class XRay {
  constructor({ title = "X-ray", hint = "Every request this example sends and every reply it gets, exactly as they travel." } = {}) {
    this.count = 0;
    this.list = h("ol", { class: "xray-list" });
    this.empty = h("p", { class: "xray-empty" }, "Nothing sent yet. Run the example and each step shows up here.");
    this.clearButton = h("button", { class: "btn btn-quiet btn-small", type: "button", onclick: () => this.clear() }, "Clear");
    this.clearButton.hidden = true;
    this.el = h(
      "section",
      { class: "xray", "aria-label": title },
      h(
        "header",
        { class: "xray-head" },
        h("div", {}, h("h3", { class: "xray-title" }, title), h("p", { class: "xray-hint" }, hint)),
        this.clearButton,
      ),
      this.empty,
      this.list,
    );
  }

  add({ kind, summary, data }) {
    this.count += 1;
    this.empty.hidden = true;
    this.clearButton.hidden = false;
    const label = STEP_LABELS[kind] ?? kind;
    const json = data === undefined ? null : prettyJson(data);
    const item = h(
      "li",
      { class: `xray-step xray-${kind}` },
      h(
        "div",
        { class: "xray-line" },
        h("span", { class: "xray-n" }, String(this.count).padStart(2, "0")),
        h("span", { class: "xray-chip" }, label),
        h("p", { class: "xray-summary" }, summary),
      ),
      json === null
        ? null
        : h(
            "details",
            { class: "xray-raw" },
            h("summary", {}, kind === "request" ? "Raw request" : kind === "response" ? "Raw reply" : "Raw data"),
            h("pre", { class: "xray-json", tabindex: "0" }, h("code", {}, json)),
          ),
    );
    this.list.append(item);
    return item;
  }

  note(summary, data) {
    return this.add({ kind: "note", summary, data });
  }

  clear() {
    this.count = 0;
    this.list.replaceChildren();
    this.empty.hidden = false;
    this.clearButton.hidden = true;
  }
}

const LIVE_COPY = {
  checking: "Connecting to Claude…",
  ready: "Runs on your own Claude account. The first run asks for your permission.",
  "off:no-runtime":
    "Live examples run when this course is opened inside Claude while you're signed in. You can still read everything here and see the exact request each example would send.",
  "off:not_granted":
    "Live examples are off because Claude access wasn't allowed for this course. Every lesson still reads fine.",
  "off:other": "Claude isn't available in this view, so live examples are off. Every lesson still reads fine.",
  "cooling:rate_limited": "Too many requests in a short time. Live examples pause for a minute.",
  "cooling:usage_limit": "You've reached your Claude usage limit. Live examples will work again when it resets.",
};

export function liveCopy(runtime) {
  if (runtime.live === "off") {
    return LIVE_COPY[`off:${runtime.reason}`] ?? LIVE_COPY["off:other"];
  }
  if (runtime.live === "cooling") return LIVE_COPY[`cooling:${runtime.reason}`] ?? LIVE_COPY["cooling:rate_limited"];
  return LIVE_COPY[runtime.live] ?? "";
}

export function liveNote(ctx) {
  const text = h("span", {});
  const manage = h(
    "button",
    {
      class: "btn btn-quiet btn-small",
      type: "button",
      onclick: async () => {
        const opened = await ctx.runtime.managePermissions();
        if (!opened) text.textContent = "Open the artifact's Permissions menu to turn Claude access back on.";
      },
    },
    "Change permissions",
  );
  const el = h("p", { class: "live-note", role: "status" }, h("span", { class: "live-dot", "aria-hidden": "true" }), text, manage);
  const update = (rt) => {
    el.dataset.state = rt.live;
    text.textContent = liveCopy(rt);
    manage.hidden = !(rt.live === "off" && rt.reason === "not_granted" && rt.canManagePermissions);
  };
  ctx.watch(update);
  return el;
}

export function playground(ctx, { title = "Try it", intro, children = [] }) {
  return h(
    "section",
    { class: "playground", "aria-label": title },
    h("header", { class: "pg-head" }, h("h2", { class: "pg-title" }, title), intro ? h("p", { class: "pg-intro" }, intro) : null),
    liveNote(ctx),
    h("div", { class: "pg-body" }, children),
  );
}

export function runner(ctx, { label, busyLabel = "Running…", run, onError, stoppable = true }) {
  let controller = null;
  let busy = false;
  const go = h("button", { class: "btn btn-primary", type: "button" }, label);
  const stop = h("button", { class: "btn btn-quiet", type: "button" }, "Stop");
  stop.hidden = true;
  const status = h("span", { class: "run-status", role: "status" });
  const sync = () => {
    go.disabled = busy || ctx.runtime.live !== "ready";
    go.textContent = busy ? busyLabel : label;
    stop.hidden = !(busy && stoppable);
  };
  go.addEventListener("click", async () => {
    if (busy || ctx.runtime.live !== "ready") return;
    controller = new AbortController();
    busy = true;
    status.textContent = "";
    sync();
    try {
      await run(controller.signal, (text) => (status.textContent = text));
    } catch (error) {
      if (error?.code !== "cancelled") {
        status.textContent = error?.code === "not_ready" ? "" : errorCopy(error);
        onError?.(error);
      } else status.textContent = "Stopped.";
    } finally {
      busy = false;
      controller = null;
      sync();
    }
  });
  stop.addEventListener("click", () => controller?.abort());
  ctx.watch(sync);
  ctx.onDispose(() => controller?.abort());
  return h("div", { class: "run-row" }, go, stop, status);
}

export function field({ label, id, value = "", rows = 3, hint, mono = false, oninput }) {
  const area = h("textarea", { id, rows: String(rows), class: mono ? "input mono" : "input", spellcheck: mono ? "false" : "true", oninput });
  area.value = value;
  return {
    el: h("div", { class: "field" }, h("label", { for: id, class: "field-label" }, label), hint ? h("p", { class: "field-hint" }, hint) : null, area),
    input: area,
  };
}

export function answerBox(placeholder = "The answer appears here.") {
  const el = h("div", { class: "answer", "aria-live": "polite" });
  const api = {
    el,
    reset(text = placeholder) {
      el.classList.add("is-empty");
      el.replaceChildren(h("p", {}, text));
    },
    thinking() {
      el.classList.add("is-empty");
      el.replaceChildren(h("p", { class: "thinking" }, "Thinking…"));
    },
    show(text) {
      el.classList.remove("is-empty");
      el.replaceChildren(renderAnswer(text));
    },
    error(text) {
      el.classList.add("is-empty");
      el.replaceChildren(h("p", { class: "answer-error" }, text));
    },
  };
  api.reset();
  return api;
}

export function renderAnswer(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  let list = null;
  let para = [];
  const flushPara = () => {
    if (para.length) frag.append(h("p", {}, inline(para.join(" "))));
    para = [];
  };
  const flushList = () => {
    if (list) frag.append(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tagName.toLowerCase() !== tag) {
        flushList();
        list = h(tag, {});
      }
      list.append(h("li", {}, inline(bullet ? bullet[1] : numbered[2])));
    } else if (/^#{1,6}\s+/.test(line)) {
      flushPara();
      flushList();
      frag.append(h("p", { class: "answer-heading" }, inline(line.replace(/^#{1,6}\s+/, ""))));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return frag;
}

function inline(text) {
  const frag = document.createDocumentFragment();
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) frag.append(text.slice(last, match.index));
    const token = match[0];
    frag.append(token.startsWith("**") ? h("strong", {}, token.slice(2, -2)) : h("code", {}, token.slice(1, -1)));
    last = match.index + token.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function engineers(title, ...children) {
  return h(
    "details",
    { class: "eng" },
    h("summary", {}, h("span", { class: "eng-tag" }, "For engineers"), h("span", { class: "eng-title" }, title)),
    h("div", { class: "eng-body" }, children),
  );
}

export function codeBlock(code, label) {
  return h(
    "figure",
    { class: "code" },
    label ? h("figcaption", {}, label) : null,
    h("pre", { tabindex: "0" }, h("code", {}, code)),
  );
}

export function diagram(svg, caption) {
  return h("figure", { class: "diagram" }, h("div", { class: "diagram-art" }, trusted(svg)), caption ? h("figcaption", {}, caption) : null);
}

export function quizSection(lesson, ctx) {
  const questions = lesson.quiz;
  const saved = ctx.runtime.progress.value.lessons[lesson.id]?.quiz;
  const answers = saved?.answers ? [...saved.answers] : questions.map(() => null);
  const result = h("div", { class: "quiz-result", role: "status" });
  const items = questions.map((q, qi) => {
    const name = uid(`q${lesson.n}-${qi}`);
    const why = h("p", { class: "quiz-why" });
    why.hidden = true;
    const options = q.options.map((option, oi) => {
      const input = h("input", { type: "radio", name, value: String(oi), id: `${name}-${oi}` });
      if (answers[qi] === oi) input.checked = true;
      input.addEventListener("change", () => {
        answers[qi] = oi;
        check.disabled = answers.some((a) => a === null);
      });
      return h("label", { class: "quiz-option", for: `${name}-${oi}` }, input, h("span", {}, option));
    });
    return { el: h("fieldset", { class: "quiz-q" }, h("legend", {}, `${qi + 1}. ${q.q}`), options, why), why, fieldset: null };
  });
  const check = h("button", { class: "btn btn-primary", type: "button" }, "Check answers");
  check.disabled = answers.some((a) => a === null);
  const reveal = (scored) => {
    scored.results.forEach((r, i) => {
      const item = items[i];
      item.el.dataset.correct = String(r.correct);
      item.why.hidden = false;
      item.why.textContent = `${r.correct ? "Correct." : `Not quite. The answer is “${questions[i].options[r.answer]}”.`} ${questions[i].why}`;
    });
    result.replaceChildren(
      h("strong", {}, `${scored.score} of ${scored.total} correct.`),
      " ",
      quizVerdict(scored),
    );
  };
  check.addEventListener("click", () => {
    const scored = scoreQuiz(questions, answers);
    if (!scored.complete) return;
    reveal(scored);
    ctx.runtime.progress.update((p) => recordQuiz(p, lesson.id, { score: scored.score, total: scored.total, answers }));
    check.textContent = "Check again";
  });
  if (saved?.answers) reveal(scoreQuiz(questions, answers));
  return h(
    "section",
    { class: "quiz", id: "quiz", "aria-label": "Quiz" },
    h("h2", {}, "Check yourself"),
    h("p", { class: "quiz-intro" }, `${questions.length} quick questions. Finishing the quiz marks this lesson as done.`),
    items.map((i) => i.el),
    h("div", { class: "quiz-actions" }, check, result),
  );
}
