import { createHarness as createLesson6Harness } from "./06-agent.ts";
import { MODELS } from "./config.ts";
import type { Harness, HarnessOptions } from "./types.ts";

// Lesson 7: the lesson 6 harness, unchanged. The model is only a name in each request, so swapping it is one argument.
export function createHarness({ model = MODELS[0] }: HarnessOptions = {}): Harness {
  if (!MODELS.includes(model)) throw new Error(`Unknown model ${model}. Pick one of: ${MODELS.join(", ")}.`);
  return createLesson6Harness({ model });
}
