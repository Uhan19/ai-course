import { errorCopy } from "../../../js/runtime.js";
import { commandLine, h, trusted } from "../../../js/ui.js";
import { fromClaudeReply, isPulled, localReady, ollamaEndpoint, ollamaRequest, pullStep, toClaudeRequest } from "./model-source.js";
import { sourceSignature } from "./bundle.js";
import { SANDBOX_IMAGE, WORKSPACE_LABEL } from "./sandbox.js";
import { createSession } from "./session.js";
import { XRayLog } from "./xray-view.js";

const CLAUDE_TIER = "quick";
const ALL_MODELS = "all";
const RESET_LABEL_MS = 1500;
const RAW_NOTE = "This shows the page's request to Claude, not a raw wire request.";

function fallbackNote(sources) {
  const why = sources.preference === "claude" && sources.localIsReady ? "You chose Claude as the model" : "No local model is answering";
  return `${why}, so the page passed this request to Claude through your own Claude account. ${RAW_NOTE}`;
}

function sandboxNote(mode, sandbox) {
  if (mode.mode === "docker") {
    return `The page runs each sandbox command in a fresh Docker container (${SANDBOX_IMAGE}, Docker ${sandbox.version}) with the same locks every time. Only ${WORKSPACE_LABEL} on your computer is visible inside, as /workspace.`;
  }
  return `The sandbox is simulated in this page, because ${mode.reason}. Commands work on a copy of the workspace files kept in this page, so nothing runs on your computer, and only simple commands such as ls, cat, grep and wc work.`;
}

export function renderWorkPane({ lesson, ctx, course }) {
  const { sources, codeStore, replyMarkdown, sandbox, getModels } = course;
  if (lesson.usesSandbox) sandbox.activate();
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

  const sessions = new Map();
  const openAsks = new Set();
  let busy = false;
  let controller = null;
  let disposed = false;
  let turnSource = null;
  let turnNote = "";
  let turnSandbox = null;
  let notedSandbox = "";
  let pending = null;
  let chosenModel = ALL_MODELS;

  const canSend = () => !busy && sources.source !== "none";
  const syncControls = () => {
    sendButton.disabled = !canSend();
    for (const chip of chips) chip.disabled = !canSend();
    for (const button of modelPanel.querySelectorAll("[data-needs-idle]")) button.disabled = busy;
  };

  function closeSessions() {
    for (const { session } of sessions.values()) session.dispose();
    sessions.clear();
    for (const settle of openAsks) settle(false);
    openAsks.clear();
  }

  async function ensureSession(model) {
    await codeStore.load();
    const files = codeStore.all();
    const next = sourceSignature(files);
    const key = model ?? "";
    const existing = sessions.get(key);
    if (existing && existing.signature === next) return existing.session;
    existing?.session.dispose();
    sessions.delete(key);
    const created = await createSession({
      files,
      entry: lesson.entry,
      options: model ? { model } : {},
      onStep: (step) => xray.add(step),
      onFetch: handleFetch,
      onPage: handlePage,
      onAsk: askUser,
    });
    if (disposed) {
      created.dispose();
      return created;
    }
    sessions.set(key, { session: created, signature: next });
    if (existing) xray.add({ kind: "note", why: "Your harness code changed, so the course loaded the new code and started a fresh conversation." });
    return created;
  }

  function noteSandbox() {
    const mode = turnSandbox ?? sandbox.modeFor(sources.source);
    const key = `${mode.mode}:${mode.reason ?? ""}`;
    if (key === notedSandbox) return mode;
    notedSandbox = key;
    xray.note(sandboxNote(mode, sandbox), undefined, undefined, { badge: mode.mode === "docker" ? "Page runs Docker" : "Simulated sandbox", tone: mode.mode === "docker" ? "sandbox" : "simulated" });
    return mode;
  }

  async function handlePage(op, args = []) {
    if (op === "prepareSandbox") {
      await sandbox.prepare(noteSandbox().mode);
      return null;
    }
    if (op === "runInSandbox") return sandbox.run(noteSandbox().mode, args[0]);
    if (op === "readWorkspaceFile") return sandbox.read(noteSandbox().mode, args[0]);
    throw new Error(`The page has no ${String(op)} for harness code.`);
  }

  function askUser(request) {
    if (disposed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const settle = (approved) => {
        openAsks.delete(settle);
        resolve(approved);
      };
      openAsks.add(settle);
      pending?.setWaitingFor("you");
      xray.pauseClock();
      appendApproval(request, (approved) => {
        pending?.setWaitingFor("the harness");
        xray.resumeClock();
        settle(approved);
      });
    });
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
    xray.note(turnNote, { capability: "sample", input, options: { modelTier: CLAUDE_TIER, cache: false, json } }, "Request JSON the page sent to Claude");
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

  const comparing = () => lesson.comparesModels && sources.source === "local";
  const chosenModels = () => {
    if (!comparing()) return [undefined];
    const models = getModels();
    return chosenModel === ALL_MODELS || !models.includes(chosenModel) ? models : [chosenModel];
  };

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || !canSend()) return;
    busy = true;
    turnSource = sources.source;
    turnNote = fallbackNote(sources);
    turnSandbox = lesson.usesSandbox ? sandbox.modeFor(turnSource) : null;
    controller = new AbortController();
    syncControls();
    input.value = "";
    chatLog.querySelector(".chat-empty")?.remove();
    appendBubble("user", trimmed);
    const models = chosenModels();
    const rows = [];
    try {
      for (const model of models) {
        if (disposed) break;
        const row = await runTurn(trimmed, model, models.length > 1);
        if (model && row) rows.push({ model, ...row });
      }
      if (rows.length > 1) xray.addComparison(rows);
    } finally {
      busy = false;
      controller = null;
      turnSandbox = null;
      if (!disposed) {
        syncControls();
        input.focus({ preventScroll: true });
      }
    }
  }

  async function runTurn(text, model, labelReplies) {
    if (model && turnSource === "local" && !isPulled(sources.probe, model)) {
      const step = pullStep(model);
      appendError(step.problem, step.command);
      return null;
    }
    pending = appendPending();
    let outcome = "failed";
    let failure = "";
    let stats;
    try {
      const active = await ensureSession(model).catch((error) => {
        throw Object.assign(new Error(error.message), { loadError: true });
      });
      xray.startTurn(text, turnSource, labelReplies ? model : undefined);
      const result = await active.send(text);
      if (result.type === "reply") {
        appendBubble("assistant", result.text, labelReplies ? model : undefined);
        outcome = "answered";
      } else {
        const explained = await explainFailure(result.message);
        failure = explained.message;
        appendError(explained.message, explained.command, explained.command ? explained.detail : undefined);
      }
    } catch (error) {
      failure = error.loadError ? `Your harness code didn't load: ${error.message}` : String(error.message ?? error);
      if (!xray.turn) xray.startTurn(text, turnSource, labelReplies ? model : undefined);
      appendError(failure);
    } finally {
      pending.stop();
      pending = null;
      stats = xray.endTurn(outcome, failure);
    }
    return stats ? { outcome, stats } : null;
  }

  function reset() {
    if (busy) return;
    closeSessions();
    notedSandbox = "";
    showEmptyChat();
    xray.clear();
  }

  function appendBubble(role, text, model) {
    const body = role === "assistant" ? trusted(replyMarkdown.parse(text || "(empty reply)", { async: false })) : text;
    chatLog.append(h("div", { class: `bubble bubble-${role}` }, model ? h("span", { class: "bubble-model" }, model) : null, body));
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function appendApproval(request, onAnswer) {
    const status = h("p", { class: "approval-status", role: "status" }, "The harness is paused until you choose.");
    const approve = h("button", { type: "button", class: "btn btn-primary btn-small" }, "Approve");
    const deny = h("button", { type: "button", class: "btn btn-danger btn-small" }, "Deny");
    const card = h(
      "div",
      { class: "bubble bubble-approval", role: "group", "aria-label": "Permission request" },
      h("p", { class: "approval-title" }, "The model wants to ", h("strong", {}, String(request?.action ?? `use ${request?.tool}`))),
      h("div", { class: "approval-buttons" }, approve, deny, status),
      h("pre", { class: "approval-args" }, JSON.stringify(request?.arguments ?? {}, null, 2)),
      h("p", { class: "approval-rule" }, `Policy rule: ${String(request?.rule ?? "")}`),
    );
    const answer = (approved) => {
      approve.disabled = true;
      deny.disabled = true;
      card.classList.add(approved ? "approval-approved" : "approval-denied");
      status.textContent = approved ? "You approved. The harness runs it." : "You denied. The harness tells the model it may not do this.";
      onAnswer(approved);
    };
    approve.addEventListener("click", () => answer(true));
    deny.addEventListener("click", () => answer(false));
    if (pending?.bubble.isConnected) chatLog.insertBefore(card, pending.bubble);
    else chatLog.append(card);
    chatLog.scrollTop = card.offsetTop - chatLog.offsetTop - 8;
    approve.focus({ preventScroll: true });
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
    let waitingFor = "the harness";
    const update = () => {
      label.textContent = `Waiting for ${waitingFor}… ${Math.round((performance.now() - startedAt) / 1000)} s`;
    };
    const timer = setInterval(update, 1000);
    return {
      bubble,
      setWaitingFor(who) {
        waitingFor = who;
        update();
      },
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

  let resetting = false;
  let resetLabel = "Reset files";
  async function resetFiles() {
    if (busy || resetting) return;
    resetting = true;
    drawModelPanel();
    try {
      await sandbox.reset(sandbox.modeFor(sources.source).mode);
      resetLabel = "Files reset";
      setTimeout(() => {
        resetLabel = "Reset files";
        if (!disposed) drawModelPanel();
      }, RESET_LABEL_MS);
    } catch (error) {
      appendError("The workspace files couldn't be reset.", undefined, String(error?.message ?? error));
    } finally {
      resetting = false;
      if (!disposed) drawModelPanel();
    }
  }

  const drawModelPanel = () => {
    modelPanel.replaceChildren(
      ...renderModelPanel(sources, ctx.runtime),
      ...(lesson.usesSandbox ? renderSandboxPanel({ sandbox, sources, resetFiles, resetting, resetLabel, onError: appendError }) : []),
      ...(comparing() ? [renderModelPicker()] : []),
      ...(lesson.comparesModels && sources.source === "claude"
        ? [h("p", { class: "model-note" }, "Comparing models needs the local models in the installed app. With Claude as the model, every message goes to Claude.")]
        : []),
    );
    modelPanel.dataset.source = sources.source;
    syncControls();
  };

  function renderModelPicker() {
    const models = getModels();
    const name = `harness-model-${lesson.id}`;
    const options = [...models.map((model) => ({ value: model, label: model })), { value: ALL_MODELS, label: "All, one after the other" }];
    const selected = options.some((option) => option.value === chosenModel) ? chosenModel : ALL_MODELS;
    return h(
      "fieldset",
      { class: "model-picker" },
      h("legend", {}, "Send to"),
      options.map((option) =>
        h(
          "label",
          {},
          h("input", {
            type: "radio",
            name,
            value: option.value,
            checked: option.value === selected,
            onchange: () => (chosenModel = option.value),
          }),
          option.value === ALL_MODELS ? option.label : h("code", {}, option.label),
        ),
      ),
    );
  }

  ctx.onDispose(sources.subscribe(drawModelPanel));
  if (lesson.usesSandbox) ctx.onDispose(sandbox.subscribe(drawModelPanel));
  if (lesson.comparesModels) {
    ctx.onDispose(
      codeStore.subscribe((path) => {
        if (path === "harness/config.ts") drawModelPanel();
      }),
    );
    codeStore.load().then(() => !disposed && drawModelPanel(), () => {});
  }
  ctx.watch(drawModelPanel);
  ctx.onDispose(() => {
    disposed = true;
    controller?.abort();
    closeSessions();
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
    parts.push(status("ok", h("strong", {}, sources.model), ` on your computer, through Ollama ${probe.ollama.version}.`));
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

function renderSandboxPanel({ sandbox, sources, resetFiles, resetting, resetLabel, onError }) {
  if (sources.source === "none") return [];
  const mode = sandbox.modeFor(sources.source);
  const parts = [];
  const status = (tone, ...text) => h("p", { class: `model-status model-${tone}` }, h("span", { class: "model-dot", "aria-hidden": "true" }), h("span", {}, ...text));
  const actions = h("div", { class: "model-actions" });
  const reset = h(
    "button",
    {
      type: "button",
      class: "btn btn-small btn-quiet",
      "data-needs-idle": "",
      title: mode.mode === "docker" ? `Moves ${WORKSPACE_LABEL} to the Trash and puts back the starting files` : "Puts back the starting files",
      onclick: resetFiles,
    },
    resetting ? "Resetting…" : resetLabel,
  );
  if (sources.source === "local" && sandbox.canUseDocker && sandbox.docker === "checking") {
    parts.push(status("checking", "Checking Docker for the sandbox…"));
    return [h("div", { class: "sandbox-panel" }, parts)];
  }
  if (mode.mode === "docker") {
    parts.push(status("ok", "Sandbox: ", h("strong", {}, `Docker ${sandbox.version}`), " on your computer. The agent's files are in ", h("code", {}, WORKSPACE_LABEL), "."));
    actions.append(
      h(
        "button",
        {
          type: "button",
          class: "btn btn-small btn-quiet",
          onclick: () => sandbox.openFolder().catch((error) => onError("The workspace folder couldn't be opened.", undefined, String(error?.message ?? error))),
        },
        "Open folder",
      ),
      reset,
    );
    parts.push(actions);
    return [h("div", { class: "sandbox-panel" }, parts)];
  }
  parts.push(status("sim", "Sandbox: ", h("strong", {}, "simulated in this page"), `, because ${mode.reason}. Only simple commands such as ls, cat, grep and wc work, and nothing runs on your computer.`));
  const fixable = sources.source === "local" && sandbox.canUseDocker && ["missing", "stopped", "no-image"].includes(sandbox.docker);
  if (fixable) {
    parts.push(
      h(
        "details",
        { class: "setup" },
        h("summary", {}, "Set up Docker for the real sandbox"),
        h(
          "ol",
          { class: "setup-steps" },
          sandbox.steps.map((s) => h("li", {}, h("p", {}, s.problem), s.command ? commandLine(s.command) : null, s.hint ? h("p", { class: "model-note" }, s.hint) : null)),
        ),
      ),
    );
  } else if (sandbox.docker === "error") {
    parts.push(h("p", { class: "model-note" }, `Details: ${sandbox.error}`));
  }
  if (fixable || sandbox.docker === "error") actions.append(h("button", { type: "button", class: "btn btn-small btn-quiet", onclick: () => sandbox.refresh() }, "Check Docker again"));
  actions.append(reset);
  parts.push(actions);
  return [h("div", { class: "sandbox-panel" }, parts)];
}
