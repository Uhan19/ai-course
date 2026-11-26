import { callModel } from "./01-talk-to-model.ts";
import { MODEL, THINK } from "./config.ts";
import type { Harness, Message } from "./types.ts";

export const SYSTEM_PROMPT = "You are a friendly assistant inside a course about agent harnesses. Keep answers short.";

// Lesson 2: the model remembers nothing, so the harness keeps the history and resends all of it every time.
export function createHarness(): Harness {
  const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

  return {
    async send(userText, xray) {
      messages.push({ role: "user", content: userText });

      const reply = await callModel(
        { model: MODEL, messages, stream: false, think: THINK },
        xray,
        `Sending the whole conversation (${messages.length} messages), because the model keeps no memory between calls.`,
      );

      messages.push(reply.message);
      xray.note(`The history now holds ${messages.length} messages. Your next message will make it ${messages.length + 1}.`);
      return reply.message.content;
    },
  };
}
