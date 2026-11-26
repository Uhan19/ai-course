import { createRuntime } from "./runtime.js";
import { COURSES } from "../courses/index.js";
import { h } from "./ui.js";
import { lessonFlashcards, progressKey, reviewPage } from "./flashcards.js";
import { createLessonMarkdown, createReplyMarkdown, escapeHtml } from "./core/markdown.js";
import { lessonStatus, markVisited, nextLessonId, progressSummary } from "./core/progress.js";
import { drawAppIcon } from "./icon.js";

const APP_NAME = document.title;
const SAVE_COPY = {
  connecting: "Loading your progress…",
  saved: "Progress saved to your account",
  saving: "Saving…",
  unsaved: "Progress isn't saved in this view",
  readonly: "Progress can't be saved in this view",
  unreachable: "Saved progress can't be reached yet",
  error: "Progress couldn't be saved",
};

class PlainMarked {
  parse(text) {
    return `<pre class="plain-text">${escapeHtml(text)}</pre>`;
  }
  parseInline(text) {
    return escapeHtml(text);
  }
}

const Marked = globalThis.marked?.Marked ?? PlainMarked;
const markdown = createLessonMarkdown(Marked);
const replyMarkdown = createReplyMarkdown(Marked);
const runtime = createRuntime(window.claude);
const view = document.getElementById("view");
let current = null;
let iconSet = false;

const keysFor = (course) => course.lessons.map((lesson) => progressKey(course, lesson));

function makeCtx(course) {
  const disposers = [];
  return {
    runtime,
    markdown,
    replyMarkdown,
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
    flashcards(lesson) {
      return lessonFlashcards({ course, lesson, ctx: this, markdown });
    },
    pager(lesson) {
      return pager(course, lesson);
    },
  };
}

function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  for (const course of COURSES) {
    if (hash === `${course.id}-cards`) return { course, page: "cards" };
    if (hash.startsWith(`${course.id}-`)) {
      const lesson = course.lessons.find((l) => `${course.id}-${l.id}` === hash);
      if (lesson) return { course, lesson, page: "lesson" };
    }
  }
  return { page: "home" };
}

function render() {
  current?.dispose();
  const target = route();
  current = makeCtx(target.course);
  document.body.dataset.page = target.page;
  if (target.page === "lesson") {
    view.replaceChildren(lessonView(target.course, target.lesson, current));
    runtime.progress.update((p) => markVisited(p, progressKey(target.course, target.lesson)));
  } else if (target.page === "cards") {
    view.replaceChildren(reviewPage({ course: target.course, ctx: current, markdown }));
  } else {
    view.replaceChildren(homeView(current));
  }
  window.scrollTo(0, 0);
  requestAnimationFrame(() => view.querySelector("h1")?.focus({ preventScroll: true }));
}

function statusChip(progress, key) {
  const status = lessonStatus(progress, key);
  const quiz = progress.lessons[key]?.quiz;
  const text = status === "done" ? (quiz ? `Done · ${quiz.score}/${quiz.total} cards` : "Done") : status === "started" ? "Started" : "Not started";
  return h("span", { class: `chip chip-${status}` }, text);
}

function courseSection(course, ctx) {
  const list = h("ol", { class: "lesson-list" });
  const progressText = h("p", { class: "course-progress-text" });
  const bar = h("span", { class: "bar-fill" });
  const resume = h("a", { class: "btn btn-primary" });
  ctx.watch((rt) => {
    const p = rt.progress.value;
    const keys = keysFor(course);
    const summary = progressSummary(p, keys);
    progressText.textContent = `${summary.done} of ${summary.total} lessons done`;
    bar.style.width = `${summary.percent}%`;
    const nextKey = nextLessonId(p, keys);
    const next = course.lessons.find((lesson) => progressKey(course, lesson) === nextKey);
    resume.hidden = !next;
    if (next) {
      resume.href = `#${course.id}-${next.id}`;
      resume.textContent = lessonStatus(p, nextKey) === "new" && summary.done === 0 ? `Start with lesson ${next.id}` : `Continue with lesson ${next.id}`;
    }
    list.replaceChildren(
      ...course.lessons.map((lesson) => {
        const key = progressKey(course, lesson);
        return h(
          "li",
          { class: "lesson-row" },
          h(
            "a",
            { href: `#${course.id}-${lesson.id}`, class: "lesson-link" },
            h("span", { class: "lesson-num", "aria-hidden": "true" }, String(lesson.id)),
            h(
              "span",
              { class: "lesson-text" },
              h("span", { class: "lesson-name" }, h("span", { class: "visually-hidden" }, `Lesson ${lesson.id}: `), lesson.title),
              h("span", { class: "lesson-blurb" }, lesson.summary),
            ),
            statusChip(p, key),
          ),
        );
      }),
    );
  });
  return h(
    "section",
    { class: "course", "aria-labelledby": `course-${course.id}` },
    h(
      "header",
      { class: "course-head" },
      h("p", { class: "eyebrow" }, `Course · ${course.lessons.length} lessons so far`),
      h("h2", { id: `course-${course.id}`, class: "course-title" }, course.title),
      h("p", { class: "course-summary" }, course.summary),
      h("div", { class: "course-progress" }, h("div", { class: "bar", role: "presentation" }, bar), progressText, resume),
    ),
    list,
    h(
      "div",
      { class: "course-foot" },
      h("a", { href: `#${course.id}-cards`, class: "btn btn-quiet" }, "Review the flashcards"),
      course.comingNext?.length
        ? h(
            "div",
            { class: "coming" },
            h("h3", {}, "Coming next"),
            h("ol", { start: String(course.firstComingNumber ?? 1) }, course.comingNext.map((item) => h("li", {}, item))),
          )
        : null,
    ),
  );
}

function homeView(ctx) {
  return h(
    "div",
    { class: "home" },
    h(
      "section",
      { class: "intro" },
      h("h1", { tabindex: "-1" }, APP_NAME),
      h(
        "p",
        { class: "lede" },
        "Short, hands-on courses you take at your own pace. Read a little, try it for real, and check yourself with flashcards. Your progress is saved privately to your account.",
      ),
    ),
    COURSES.map((course) => courseSection(course, ctx)),
  );
}

function pager(course, lesson) {
  const index = course.lessons.indexOf(lesson);
  const previous = course.lessons[index - 1];
  const next = course.lessons[index + 1];
  return h(
    "nav",
    { class: "pager", "aria-label": "Lesson navigation" },
    previous ? h("a", { href: `#${course.id}-${previous.id}` }, `← ${previous.id}. ${previous.title}`) : h("span", {}),
    next ? h("a", { href: `#${course.id}-${next.id}` }, `${next.id}. ${next.title} →`) : h("a", { href: "#" }, "Back to all courses →"),
  );
}

function lessonView(course, lesson, ctx) {
  return h(
    "div",
    { class: "lesson-page" },
    h(
      "nav",
      { class: "crumbs", "aria-label": "Breadcrumb" },
      h("a", { href: "#" }, APP_NAME),
      h("span", { "aria-hidden": "true" }, "›"),
      h("span", {}, course.title),
      h("span", { "aria-hidden": "true" }, "›"),
      h(
        "select",
        {
          class: "lesson-jump",
          "aria-label": "Go to lesson",
          onchange: (event) => (location.hash = `${course.id}-${event.target.value}`),
        },
        course.lessons.map((l) => h("option", { value: String(l.id), selected: l === lesson }, `Lesson ${l.id}: ${l.title}`)),
      ),
    ),
    course.renderLesson(lesson, ctx),
  );
}

function wireTopBar() {
  document.getElementById("brand-name").textContent = APP_NAME;
  document.getElementById("brand-mark").textContent = APP_NAME.charAt(0).toUpperCase();
  const saveState = document.getElementById("save-state");
  const install = document.getElementById("install");
  install.addEventListener("click", async () => {
    install.disabled = true;
    const outcome = await runtime.install();
    install.disabled = false;
    if (outcome === "installed") install.hidden = true;
  });
  const update = (rt) => {
    saveState.textContent = SAVE_COPY[rt.progress.mode] ?? "";
    saveState.dataset.mode = rt.progress.mode;
    install.hidden = rt.installState !== "available";
    if (!iconSet && rt.desktop?.app?.dock) {
      iconSet = true;
      rt.desktop.app.dock.setIcon(drawAppIcon(APP_NAME)).catch(() => {});
    }
  };
  update(runtime);
  runtime.subscribe(update);
}

window.addEventListener("hashchange", render);
wireTopBar();
render();
runtime.boot();
