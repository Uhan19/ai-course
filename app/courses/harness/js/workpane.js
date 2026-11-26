import { errorCopy } from "../../../js/runtime.js";
import { commandLine, h, trusted } from "../../../js/ui.js";
import { fromClaudeReply, localReady, ollamaEndpoint, ollamaRequest, toClaudeRequest } from "./model-source.js";
import { sourceSignature } from "./bundle.js";
import { createSession } from "./session.js";
import { XRayLog } from "./xray-view.js";

const CLAUDE_TIER = "quick";
const RAW_NOTE = "This shows the page's request to Claude, not a raw wire request.";

function fallbackNote(sources) {
  const why = sources.preference === "claude" && sources.localIsReady ? "You chose Claude as the model" : "No local model is answering";
  return `${why}, so the page passed this request to Claude through your own Claude account. ${RAW_NOTE}`;
}

export function renderWorkPane({ lesson, ctx, course }) {
  const { sources, codeStore, replyMarkdown } = course;
  const chatLog = h("div", { class: "chat-log", "aria-live": "polite" });
  const xrayScroller = h("div", { class: "panel-body" });
  const xray = new XRayLog(xrayScroller);
  xrayScroller.append(xray.root);
  const modelPanel = h("div", { class: "model-panel" });

  const input = h("textarea", { rows: "1", placeholder: "Message the harness…", "aria-label": "Message", id: `harness-message-${lesson.id}` });
  const sendButton = h("button", { type: "submit", class: "btn btn-primary" }, "Send");
  const chips = lesson.suggestions.map((text) => h("button", { type: "button", class: "chip-btn", onclick: () => send(text) }, text));
  const suggestions = h("div", { class: "suggestions" }, chips);

  const showEmptyChat = () => chatLog.replaceChildren(h("p", { class: "chat-empty" }, lesson.chatHint, " Try one of these, or type your own."));
  showEmptyChat();

  let session = null;
  let signature = "";
  let busy = false;
  let controller = null;
  let disposed = false;
  let turnSource = null;

  const canSend = () => !busy && sources.source !== "none";
  const syncControls = () => {
    sendButton.disabled = !canSend();
    for (const chip of chips) chip.disabled = !canSend();
  };

  function closeSession() {
    session?.dispose();
    session = null;
    signature = "";
  }

  async function ensureSession() {
    await codeStore.load();
    const files = codeStore.all();
    const next = sourceSignature(files);
    if (session && next === signature) return session;
    const changed = Boolean(session);
    closeSession();
    session = await createSession({
      files,
      entry: lesson.entry,
      onStep: (step) => xray.add(step),
      onFetch: handleFetch,
    });
    signature = next;
    if (changed) xray.add({ kind: "note", why: "Your harness code changed, so the course loaded the new code and started a fresh conversation." });
    return session;
  }

  async function handleFetch(request) {
    const endpoint = ollamaEndpoint(request.url, request.method);
    if (turnSource === "local") {
      return ollamaRequest(sources.desktop, { ...endpoint, body: request.body ?? "" });
    }
    if (endpoint.path !== "/api/chat") {
      return { status: 501, body: JSON.stringify({ error: `${endpoint.path} only works with a local Ollama model, not the Claude fallback.` }) };
    }
    let body;
    try {
      body = JSON.parse(request.body ?? "");
    } catch {
      return { status: 400, body: JSON.stringify({ error: "The request body is not valid JSON." }) };
    }
    const { input, json } = toClaudeRequest(body);
    xray.note(fallbackNote(sources), { capability: "sample", input, options: { modelTier: CLAUDE_TIER, cache: false, json } }, "Request JSON the page sent to Claude");
    try {
      const value = await ctx.runtime.askClaude(input, { json, signal: controller?.signal, modelTier: CLAUDE_TIER });
      xray.note("Claude answered. The page turns the reply into the same JSON shape Ollama returns, so the harness code doesn't change.", json ? value : { text: value.text }, "Reply JSON from Claude, as the page received it");
      return { status: 200, body: JSON.stringify(fromClaudeReply(json ? value : value.text, { json, idPrefix: `call_${Date.now().toString(36)}` })) };
    } catch (error) {
      throw new TypeError(`Claude fallback failed: ${errorCopy(error)}`);
    }
  }

  async function explainFailure(detail) {
    if (!disposed && turnSource === "local") {
      await sources.refresh().catch(() => {});
      if (sources.local === "checked" && !localReady(sources.probe)) {
        const [step] = sources.steps;
        if (step) return { message: step.problem, command: step.command, detail };
      }
    }
    return { message: `The harness threw an error: ${detail}` };
  }

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || !canSend()) return;
    busy = true;
    turnSource = sources.source;
    controller = new AbortController();
    syncControls();
    input.value = "";
    chatLog.querySelector(".chat-empty")?.remove();
    appendBubble("user", trimmed);
    const pending = appendPending();
    let outcome = "failed";
    let failure = "";
    try {
      const active = await ensureSession().catch((error) => {
        throw Object.assign(new Error(error.message), { loadError: true });
      });
      xray.startTurn(trimmed, turnSource);
      const result = await active.send(trimmed);
      if (result.type === "reply") {
        appendBubble("assistant", result.text);
        outcome = "answered";
      } else {
        const explained = await explainFailure(result.message);
        failure = explained.message;
        appendError(explained.message, explained.command, explained.command ? explained.detail : undefined);
      }
    } catch (error) {
      failure = error.loadError ? `Your harness code didn't load: ${error.message}` : String(error.message ?? error);
      if (!xray.turn) xray.startTurn(trimmed, turnSource);
      appendError(failure);
    } finally {
      pending.stop();
      xray.endTurn(outcome, failure);
      busy = false;
      controller = null;
      if (!disposed) {
        syncControls();
        input.focus({ preventScroll: true });
      }
    }
  }

  function reset() {
    if (busy) return;
    closeSession();
    showEmptyChat();
    xray.clear();
  }

  function appendBubble(role, text) {
    const body = role === "assistant" ? trusted(replyMarkdown.parse(text || "(empty reply)", { async: false })) : text;
    chatLog.append(h("div", { class: `bubble bubble-${role}` }, body));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendError(message, command, detail) {
    chatLog.append(
      h(
        "div",
        { class: "bubble bubble-error" },
        h("p", {}, message),
        command ? h("p", {}, "Run this in a terminal, then send your message again:") : null,
        command ? commandLine(command) : null,
        detail ? h("p", { class: "error-detail" }, `Details: ${detail}`) : null,
      ),
    );
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendPending() {
    const label = h("span", {}, "Waiting for the harness… 0 s");
    const bubble = h("div", { class: "bubble bubble-pending" }, h("span", { class: "spinner", "aria-hidden": "true" }), label);
    chatLog.append(bubble);
    chatLog.scrollTop = chatLog.scrollHeight;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      label.textContent = `Waiting for the harness… ${Math.round((performance.now() - startedAt) / 1000)} s`;
    }, 1000);
    return {
      stop() {
        clearInterval(timer);
        bubble.remove();
      },
    };
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  let allOpen = false;
  const toggleJson = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Expand all JSON");
  toggleJson.addEventListener("click", () => {
    allOpen = !allOpen;
    xray.setAllOpen(allOpen);
    toggleJson.textContent = allOpen ? "Collapse all JSON" : "Expand all JSON";
  });

  const drawModelPanel = () => {
    modelPanel.replaceChildren(...renderModelPanel(sources, ctx.runtime));
    modelPanel.dataset.source = sources.source;
    syncControls();
  };
  ctx.onDispose(sources.subscribe(drawModelPanel));
  ctx.watch(drawModelPanel);
  ctx.onDispose(() => {
    disposed = true;
    controller?.abort();
    closeSession();
  });

  return h(
    "section",
    { class: "work-pane", id: "try-it", "aria-label": "Try it" },
    h(
      "div",
      { class: "panel panel-chat" },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title" }, h("h2", {}, "Try it"), h("span", { class: "panel-sub" }, `Runs ${lesson.entry}`)),
        h("button", { type: "button", class: "btn btn-quiet btn-small", onclick: reset }, "New conversation"),
      ),
      modelPanel,
      chatLog,
      suggestions,
      h(
        "form",
        {
          class: "composer",
          onsubmit: (event) => {
            event.preventDefault();
            send(input.value);
          },
        },
        input,
        sendButton,
      ),
    ),
    h(
      "div",
      { class: "panel panel-xray" },
      h(
        "div",
        { class: "panel-head" },
        h("div", { class: "panel-title" }, h("h2", {}, "X-ray"), h("span", { class: "panel-sub" }, "Every message to and from the model, in order")),
        toggleJson,
      ),
      xrayScroller,
    ),
  );
}

function renderModelPanel(sources, runtime) {
  const source = sources.source;
  const probe = sources.probe;
  const parts = [];
  const status = (tone, ...text) => h("p", { class: `model-status model-${tone}` }, h("span", { class: "model-dot", "aria-hidden": "true" }), h("span", {}, ...text));
  const button = (label, onclick, primary = false) => h("button", { type: "button", class: `btn btn-small ${primary ? "btn-primary" : "btn-quiet"}`, onclick }, label);

  if (sources.local === "waiting" || sources.local === "probing" || (sources.busy && source === "none")) {
    return [status("checking", "Checking for a model…")];
  }
  if (source === "local") {
    parts.push(status("ok", h("strong", {}, probe.model.name), ` on your computer, through Ollama ${probe.ollama.version}.`));
    const actions = h("div", { class: "model-actions" });
    if (sources.claudeAvailable) actions.append(button("Use Claude instead", () => sources.prefer("claude")));
    actions.append(button("Check again", () => sources.refresh()));
    parts.push(actions);
    return parts;
  }
  if (source === "claude") {
    parts.push(status("fallback", h("strong", {}, "Claude"), " is the model, through your own Claude account."));
    parts.push(
      h(
        "p",
        { class: "model-note" },
        "The lessons describe a local model. With Claude, the harness code, requests, tool calls and the loop work the same way, but the model name, thinking and token counts don't apply.",
      ),
    );
  } else {
    parts.push(status("none", "No model is available here, so the chat is off. You can still read every lesson and its code."));
    if (runtime.live === "off" && runtime.reason === "not_granted") {
      parts.push(h("p", { class: "model-note" }, "Claude access wasn't allowed for this page. Turn it on from the artifact's Permissions menu to use Claude as the model."));
    }
  }
  const actions = h("div", { class: "model-actions" });
  if (source === "claude" && sources.preference === "claude" && sources.localIsReady) {
    actions.append(button("Use my local model", () => sources.prefer("auto"), true));
  }
  const local = sources.local;
  if (local === "can-install") {
    parts.push(h("p", { class: "model-note" }, "To run the course's model on your own computer, install this page as an app from the Claude desktop app."));
    actions.append(button("Install app", () => runtime.install(), true));
  } else if (local === "no-desktop") {
    parts.push(h("p", { class: "model-note" }, "The local model works in the installed desktop app. Open this page in the Claude desktop app and choose Install as app."));
  } else if (local === "needs-permission") {
    parts.push(h("p", { class: "model-note" }, "To reach Ollama on your computer, the app needs permission to run local programs. It only runs fixed commands: requests to Ollama's local API, and a check that Ollama is installed."));
    actions.append(button("Allow local model", () => sources.refresh({ ask: true }), true));
  } else if (local === "denied") {
    parts.push(h("p", { class: "model-note" }, "Running local programs is turned off for this app, so it can't reach Ollama."));
    actions.append(button("Change permissions", () => sources.manageDesktopPermissions()));
  } else if (local === "unavailable") {
    parts.push(h("p", { class: "model-note" }, "The app can't run local programs right now. This needs the Claude desktop app signed in to the organization that published this course."));
    actions.append(button("Check again", () => sources.refresh()));
  } else if (local === "unsupported") {
    parts.push(h("p", { class: "model-note" }, "The local model setup supports macOS and Linux for now."));
  } else if (local === "checked" && !sources.localIsReady) {
    parts.push(
      h(
        "details",
        { class: "setup", open: source === "none" },
        h("summary", {}, "Set up the local model"),
        h(
          "ol",
          { class: "setup-steps" },
          sources.steps.map((s) => h("li", {}, h("p", {}, s.problem), s.command ? commandLine(s.command) : null, s.hint ? h("p", { class: "model-note" }, s.hint) : null)),
        ),
      ),
    );
    actions.append(button("Check again", () => sources.refresh()));
  }
  if (actions.childElementCount) parts.push(actions);
  return parts;
}
