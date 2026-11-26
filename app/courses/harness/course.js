import { createCodeStore } from "./js/code-store.js";
import { renderHarnessLesson } from "./js/lesson-view.js";
import { readConfigList, readConfigValue } from "./js/model-source.js";
import { createSandboxController } from "./js/sandbox-controller.js";
import { createSourceController } from "./js/source-controller.js";
import { LESSON_FILES } from "./files.js";
import { LESSONS } from "./lessons.js";

const DEFAULT_MODEL = "qwen3.5:9b";
const DEFAULT_MODELS = ["qwen3.5:4b", "qwen3.5:9b"];
const CONFIG_FILE = "harness/config.ts";

let shared = null;

function sharedState(ctx) {
  if (shared) return shared;
  const codeStore = createCodeStore();
  codeStore.load().catch(() => {});
  const getModel = () => readConfigValue(codeStore.get(CONFIG_FILE), "MODEL") ?? DEFAULT_MODEL;
  const getModels = () => readConfigList(codeStore.get(CONFIG_FILE), "MODELS") ?? DEFAULT_MODELS;
  const sources = createSourceController({ runtime: ctx.runtime, getModel });
  const sandbox = createSandboxController({ sources });
  codeStore.subscribe((path) => {
    if (path === CONFIG_FILE) sources.modelChanged();
  });
  shared = { codeStore, sources, sandbox, getModels };
  return shared;
}

export default {
  id: "harness",
  title: "Build an agent harness",
  summary:
    "A language model only turns text into more text. Everything that makes it an agent, like remembering the conversation and running tools, is ordinary code around it. That code is the harness. In this course you read and edit a small harness in TypeScript, run it against a model on your own computer or against Claude through your own Claude account, and watch every message it sends.",
  lessons: LESSONS.map((lesson, index) => ({ ...lesson, markdown: LESSON_FILES[index] })),
  renderLesson(lesson, ctx) {
    return renderHarnessLesson({ lesson, ctx, course: { ...sharedState(ctx), replyMarkdown: ctx.replyMarkdown } });
  },
};
