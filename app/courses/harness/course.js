import { createCodeStore } from "./js/code-store.js";
import { renderHarnessLesson } from "./js/lesson-view.js";
import { readConfigValue } from "./js/model-source.js";
import { createSourceController } from "./js/source-controller.js";
import { LESSON_FILES } from "./files.js";
import { COMING_NEXT, LESSONS } from "./lessons.js";

const DEFAULT_MODEL = "qwen3.5:9b";
const CONFIG_FILE = "harness/config.ts";

let shared = null;

function sharedState(ctx) {
  if (shared) return shared;
  const codeStore = createCodeStore();
  codeStore.load().catch(() => {});
  const getModel = () => readConfigValue(codeStore.get(CONFIG_FILE), "MODEL") ?? DEFAULT_MODEL;
  const sources = createSourceController({ runtime: ctx.runtime, getModel });
  codeStore.subscribe((path) => {
    const missingModelChanged = sources.local === "checked" && !sources.localIsReady && sources.probe.model.name !== getModel();
    if (path === CONFIG_FILE && missingModelChanged) sources.refresh();
  });
  shared = { codeStore, sources };
  return shared;
}

export default {
  id: "harness",
  title: "Build an agent harness",
  summary:
    "A language model only turns text into more text. Everything that makes it an agent, like remembering the conversation and running tools, is ordinary code around it. That code is the harness. In this course you read and edit a small harness in TypeScript, run it against a model on your own computer, and watch every message it sends.",
  lessons: LESSONS.map((lesson, index) => ({ ...lesson, markdown: LESSON_FILES[index] })),
  comingNext: COMING_NEXT,
  firstComingNumber: LESSONS.length,
  renderLesson(lesson, ctx) {
    const { codeStore, sources } = sharedState(ctx);
    return renderHarnessLesson({ lesson, ctx, course: { codeStore, sources, replyMarkdown: ctx.replyMarkdown } });
  },
};
