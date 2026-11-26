import { createRuntime } from "./runtime.js";
import { LESSONS } from "./lessons/index.js";
import { h, quizSection } from "./ui.js";
import { lessonStatus, markVisited, nextLessonId, progressSummary } from "./core/progress.js";
import { drawAppIcon } from "./icon.js";

const LESSON_IDS = LESSONS.map((l) => l.id);
const SAVE_COPY = {
  connecting: "Loading your progress…",
  saved: "Progress saved to your account",
  saving: "Saving…",
  unsaved: "Progress isn't saved in this view",
  readonly: "Progress can't be saved in this view",
  unreachable: "Saved progress can't be reached yet",
  error: "Progress couldn't be saved",
};

const runtime = createRuntime(window.claude);
const view = document.getElementById("view");
let current = null;
let iconSet = false;

function makeCtx() {
  const disposers = [];
  return {
    runtime,
    watch(fn) {
      fn(runtime);
      disposers.push(runtime.subscribe(fn));
    },
    onDispose(fn) {
      disposers.push(fn);
    },
    dispose() {
      for (const fn of disposers.splice(0)) fn();
    },
  };
}

function lessonFromHash() {
  const match = location.hash.match(/^#lesson-(\d+)$/);
  return match ? LESSONS.find((l) => l.n === Number(match[1])) ?? null : null;
}

function render() {
  current?.dispose();
  current = makeCtx();
  const lesson = lessonFromHash();
  view.replaceChildren(lesson ? lessonView(lesson, current) : homeView(current));
  window.scrollTo(0, 0);
  if (lesson) {
    runtime.progress.update((p) => markVisited(p, lesson.id));
    view.querySelector("h1")?.focus({ preventScroll: true });
  }
}

function statusChip(progress, lesson) {
  const status = lessonStatus(progress, lesson.id);
  const quiz = progress.lessons[lesson.id]?.quiz;
  const text = status === "done" ? (quiz ? `Done · ${quiz.score}/${quiz.total}` : "Done") : status === "started" ? "Started" : "Not started";
  return h("span", { class: `chip chip-${status}` }, text);
}

function homeView(ctx) {
  const list = h("ol", { class: "lesson-list" });
  const progressText = h("p", { class: "home-progress-text" });
  const bar = h("span", { class: "bar-fill" });
  const resume = h("a", { class: "btn btn-primary", href: "#lesson-1" }, "Start lesson 1");
  ctx.watch((rt) => {
    const p = rt.progress.value;
    const summary = progressSummary(p, LESSON_IDS);
    progressText.textContent = `${summary.done} of ${summary.total} lessons done`;
    bar.style.width = `${summary.percent}%`;
    const nextId = nextLessonId(p, LESSON_IDS);
    const next = LESSONS.find((l) => l.id === nextId);
    if (next) {
      resume.hidden = false;
      resume.href = `#lesson-${next.n}`;
      resume.textContent = summary.done === 0 && lessonStatus(p, next.id) === "new" ? "Start lesson 1" : `Continue with lesson ${next.n}`;
    } else resume.hidden = true;
    list.replaceChildren(
      ...LESSONS.map((lesson) =>
        h(
          "li",
          { class: "lesson-row" },
          h(
            "a",
            { href: `#lesson-${lesson.n}`, class: "lesson-link" },
            h("span", { class: "lesson-num", "aria-hidden": "true" }, String(lesson.n)),
            h(
              "span",
              { class: "lesson-text" },
              h("span", { class: "lesson-name" }, h("span", { class: "visually-hidden" }, `Lesson ${lesson.n}: `), lesson.title),
              h("span", { class: "lesson-blurb" }, lesson.blurb),
            ),
            h("span", { class: "lesson-meta" }, h("span", { class: "lesson-min" }, `${lesson.minutes} min`), statusChip(p, lesson)),
          ),
        ),
      ),
    );
  });

  return h(
    "div",
    { class: "home" },
    h(
      "section",
      { class: "intro" },
      h("p", { class: "eyebrow" }, "A hands-on course in nine short lessons"),
      h("h1", { tabindex: "-1" }, "AI, Under the Hood"),
      h(
        "p",
        { class: "lede" },
        "See what really happens when you use an AI assistant at work. Each lesson is a few minutes of reading, a live example you can change, and an x-ray that shows exactly what goes to the model and what comes back.",
      ),
      h(
        "dl",
        { class: "how" },
        h("div", {}, h("dt", {}, "Read"), h("dd", {}, "Plain words, short sentences. Each new term is explained once.")),
        h("div", {}, h("dt", {}, "Try it"), h("dd", {}, "Live examples run on your own Claude account. Nothing to set up.")),
        h("div", {}, h("dt", {}, "X-ray"), h("dd", {}, "See the exact request and reply behind every step.")),
      ),
      h(
        "div",
        { class: "home-progress" },
        h("div", { class: "bar", role: "presentation" }, bar),
        progressText,
        resume,
      ),
    ),
    h("section", { class: "lessons", "aria-label": "Lessons" }, h("h2", { class: "section-title" }, "Lessons"), list),
    h(
      "section",
      { class: "home-notes" },
      h("h2", { class: "section-title" }, "Good to know"),
      h(
        "ul",
        {},
        h("li", {}, "Live examples use your own Claude account and count toward your usage, like a normal chat. The first one asks your permission."),
        h("li", {}, "Your progress and quiz results are private to your account. Nobody else can see them, including whoever shared this course with you."),
        h("li", {}, "Sections marked “For engineers” go deeper into code and API details. Skip them freely."),
      ),
    ),
  );
}

function sideNav(ctx, active) {
  const list = h("ol", { class: "side-list" });
  ctx.watch((rt) => {
    list.replaceChildren(
      ...LESSONS.map((lesson) =>
        h(
          "li",
          {},
          h(
            "a",
            {
              href: `#lesson-${lesson.n}`,
              class: `side-link status-${lessonStatus(rt.progress.value, lesson.id)}`,
              "aria-current": lesson === active ? "page" : null,
            },
            h("span", { class: "side-n" }, String(lesson.n)),
            h("span", {}, lesson.title),
          ),
        ),
      ),
    );
  });
  return h("nav", { class: "side", "aria-label": "All lessons" }, h("a", { href: "#", class: "side-home" }, "All lessons"), list);
}

function lessonView(lesson, ctx) {
  const index = LESSONS.indexOf(lesson);
  const prev = LESSONS[index - 1];
  const next = LESSONS[index + 1];
  const body = h("div", { class: "lesson-body" });
  lesson.render(body, ctx);
  return h(
    "div",
    { class: "lesson-layout" },
    sideNav(ctx, lesson),
    h(
      "article",
      { class: "lesson" },
      h(
        "header",
        { class: "lesson-head" },
        h("a", { href: "#", class: "lesson-back" }, "← All lessons"),
        h("p", { class: "eyebrow" }, `Lesson ${lesson.n} of ${LESSONS.length}`),
        h("h1", { tabindex: "-1" }, lesson.title),
        h("p", { class: "lesson-sub" }, lesson.blurb),
        h("p", { class: "lesson-facts" }, `${lesson.minutes} min read · live example · ${lesson.quiz.length}-question quiz`),
      ),
      body,
      quizSection(lesson, ctx),
      h(
        "nav",
        { class: "pager", "aria-label": "Lesson navigation" },
        prev ? h("a", { href: `#lesson-${prev.n}`, class: "pager-link" }, h("span", {}, "Previous"), prev.title) : h("span", {}),
        next
          ? h("a", { href: `#lesson-${next.n}`, class: "pager-link pager-next" }, h("span", {}, "Next"), next.title)
          : h("a", { href: "#", class: "pager-link pager-next" }, h("span", {}, "Finished"), "Back to all lessons"),
      ),
    ),
  );
}

function wireTopBar() {
  const progressPill = document.getElementById("top-progress");
  const saveState = document.getElementById("save-state");
  const install = document.getElementById("install");
  install.addEventListener("click", async () => {
    install.disabled = true;
    const outcome = await runtime.install();
    install.disabled = false;
    if (outcome === "installed") install.hidden = true;
  });
  const update = (rt) => {
    const summary = progressSummary(rt.progress.value, LESSON_IDS);
    progressPill.textContent = `${summary.done}/${summary.total} done`;
    saveState.textContent = SAVE_COPY[rt.progress.mode] ?? "";
    saveState.dataset.mode = rt.progress.mode;
    install.hidden = rt.installState !== "available";
    if (!iconSet && rt.desktop?.app?.dock) {
      iconSet = true;
      rt.desktop.app.dock.setIcon(drawAppIcon()).catch(() => {});
    }
  };
  update(runtime);
  runtime.subscribe(update);
}

window.addEventListener("hashchange", render);
wireTopBar();
render();
runtime.boot();
