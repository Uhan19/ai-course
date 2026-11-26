import { h, trusted } from "../../../js/ui.js";
import { HARNESS_FILES } from "../files.js";
import { fetchText } from "./code-store.js";
import { renderWorkPane } from "./workpane.js";
import { WORKSPACE_LABEL } from "./sandbox.js";

const EDIT_DEBOUNCE_MS = 300;

export function renderHarnessLesson({ lesson, ctx, course }) {
  const article = h("article", { class: "prose lesson-text" }, h("p", { class: "loading" }, "Loading the lesson…"));
  fetchText(lesson.markdown)
    .then((markdown) => {
      article.replaceChildren(trusted(ctx.markdown.parse(markdown, { async: false })));
      article.querySelector("h1")?.setAttribute("tabindex", "-1");
    })
    .catch((error) => article.replaceChildren(h("p", { class: "load-error" }, `${error.message} Reload the page to try again.`)));

  const readView = h("div", { class: "read-view" }, article, ctx.flashcards(lesson));
  const codeView = h("div", { class: "code-view", hidden: true });
  const readTab = h("button", { type: "button", class: "tab active", role: "tab", "aria-selected": "true", id: `tab-read-${lesson.id}` }, "Read");
  const codeTab = h("button", { type: "button", class: "tab", role: "tab", "aria-selected": "false", id: `tab-code-${lesson.id}`, hidden: lesson.codeFiles.length === 0 }, "Code");
  const hasChat = Boolean(lesson.entry);
  const scroller = h("div", { class: "lesson-scroll" }, readView, codeView, ctx.pager(lesson));
  let codeRendered = false;

  const showTab = (tab) => {
    readTab.classList.toggle("active", tab === "read");
    codeTab.classList.toggle("active", tab === "code");
    readTab.setAttribute("aria-selected", String(tab === "read"));
    codeTab.setAttribute("aria-selected", String(tab === "code"));
    readView.hidden = tab !== "read";
    codeView.hidden = tab !== "code";
    scroller.scrollTop = 0;
    if (tab === "code" && !codeRendered) {
      codeRendered = true;
      renderCode(lesson, course, codeView, ctx);
    }
  };
  readTab.addEventListener("click", () => showTab("read"));
  codeTab.addEventListener("click", () => showTab("code"));

  return h(
    "div",
    { class: hasChat ? "harness-layout" : "harness-layout reading-only" },
    h(
      "section",
      { class: "lesson-pane" },
      h(
        "div",
        { class: "tabs", role: "tablist", "aria-label": "Lesson views" },
        readTab,
        codeTab,
        hasChat ? h("a", { href: "#try-it", class: "jump-link", onclick: jumpToChat }, "Jump to the chat ↓") : null,
      ),
      scroller,
    ),
    hasChat ? renderWorkPane({ lesson, ctx, course }) : null,
  );
}

function jumpToChat(event) {
  event.preventDefault();
  document.getElementById("try-it")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function renderCode(lesson, course, target, ctx) {
  const { codeStore } = course;
  target.replaceChildren(h("p", { class: "loading" }, "Loading the harness files…"));
  try {
    await codeStore.load();
  } catch (error) {
    target.replaceChildren(h("p", { class: "load-error" }, error.message));
    return;
  }
  const others = HARNESS_FILES.filter((file) => !lesson.codeFiles.includes(file));
  target.replaceChildren(
    h(
      "p",
      { class: "code-hint" },
      "These are the real harness files. Edit them here, and your next message in the chat runs the new code. Your edits stay in this browser until you reset them.",
    ),
    ...lesson.codeFiles.map((file) => codeFile(file, codeStore, ctx)),
    ...(lesson.workspaceFiles ?? []).map((name) => workspaceFile(name, course, ctx)),
    others.length
      ? h("details", { class: "other-files" }, h("summary", {}, `The other harness files (${others.length})`), others.map((file) => codeFile(file, codeStore, ctx)))
      : null,
  );
}

function codeFile(path, codeStore, ctx) {
  const id = `code-${path.replace(/[^a-z0-9]/gi, "-")}`;
  const editor = h("textarea", { id, class: "code-editor", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": path });
  const edited = h("span", { class: "chip chip-edited" }, "Edited");
  const reset = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Reset to original");
  const fit = () => (editor.rows = Math.min(Math.max(editor.value.split("\n").length + 1, 6), 60));
  const sync = () => {
    if (document.activeElement !== editor) editor.value = codeStore.get(path);
    edited.hidden = !codeStore.isEdited(path);
    reset.disabled = !codeStore.isEdited(path);
    fit();
  };
  let timer = null;
  editor.addEventListener("input", () => {
    fit();
    clearTimeout(timer);
    timer = setTimeout(() => codeStore.set(path, editor.value), EDIT_DEBOUNCE_MS);
  });
  editor.addEventListener("blur", () => {
    clearTimeout(timer);
    codeStore.set(path, editor.value);
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
    editor.dispatchEvent(new Event("input"));
  });
  reset.addEventListener("click", () => {
    codeStore.reset(path);
    editor.value = codeStore.get(path);
    sync();
  });
  ctx.onDispose(
    codeStore.subscribe((changed) => {
      if (changed === path) sync();
    }),
  );
  ctx.onDispose(() => {
    clearTimeout(timer);
    if (editor.value !== codeStore.get(path)) codeStore.set(path, editor.value);
  });
  editor.value = codeStore.get(path);
  sync();
  return h(
    "section",
    { class: "code-file" },
    h("div", { class: "code-file-head" }, h("label", { for: id, class: "code-path" }, path), edited, reset),
    editor,
  );
}

function workspaceFile(name, course, ctx) {
  const { sandbox, sources } = course;
  const id = `workspace-${name.replace(/[^a-z0-9]/gi, "-")}`;
  const editor = h("textarea", { id, class: "code-editor", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": `workspace ${name}`, rows: "8" });
  const status = h("span", { class: "workspace-status", role: "status" });
  const save = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Save to workspace");
  const reload = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Reload");
  const where = h("p", { class: "code-hint" });
  let mode = null;
  let resets = 0;

  const fit = () => (editor.rows = Math.min(Math.max(editor.value.split("\n").length + 1, 6), 40));
  const describe = () => {
    mode = sandbox.modeFor(sources.source).mode;
    resets = sandbox.resets;
    where.textContent =
      mode === "docker"
        ? `The live copy in ${WORKSPACE_LABEL} that the sandbox and the harness read. Saving writes it straight to that folder.`
        : "The live copy in this page's simulated workspace. Saving changes it for the simulated sandbox only, until you reload the page or reset the files.";
  };
  async function load() {
    describe();
    status.textContent = "Loading…";
    try {
      editor.value = await sandbox.read(mode, name);
      status.textContent = "";
    } catch (error) {
      editor.value = "";
      status.textContent = error?.code === "ENOENT" ? `There is no ${name} in the workspace yet. Saving creates it.` : String(error?.message ?? error);
    }
    fit();
  }
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await sandbox.write(mode, name, editor.value);
      status.textContent = "Saved. A new conversation reads it.";
    } catch (error) {
      status.textContent = String(error?.message ?? error);
    } finally {
      save.disabled = false;
    }
  });
  reload.addEventListener("click", load);
  editor.addEventListener("input", fit);
  sandbox.activate();
  const reloadIfMoved = () => (mode !== sandbox.modeFor(sources.source).mode || resets !== sandbox.resets) && load();
  ctx.onDispose(sandbox.subscribe(reloadIfMoved));
  ctx.onDispose(sources.subscribe(reloadIfMoved));
  load();
  return h(
    "section",
    { class: "code-file" },
    h("div", { class: "code-file-head" }, h("label", { for: id, class: "code-path" }, `workspace/${name}`), status, reload, save),
    where,
    editor,
  );
}
