import { callModel } from "./01-talk-to-model.ts";
import { runTool } from "./03-agent.ts";
import { toSchema } from "./03-tools.ts";
import { ensureSandboxReady } from "./04-sandbox.ts";
import { SANDBOX_TOOLS } from "./04-tools.ts";
import { MODEL, THINK } from "./config.ts";
import type { Harness, Message } from "./types.ts";

export const SYSTEM_PROMPT =
  "You are a coding assistant working in a sandbox. Its workspace folder holds the user's files. Use the tools to look before you answer, and to run code instead of guessing its output. Keep answers short.";

export const MAX_MODEL_CALLS = 8;

// Lesson 4: the same agent loop as lesson 3. Only the tools changed: now they touch real files and run real commands, inside Docker.
export function createHarness(): Harness {
  const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const toolSchemas = SANDBOX_TOOLS.map(toSchema);

  return {
    async send(userText, xray) {
      await ensureSandboxReady();
      messages.push({ role: "user", content: userText });

      for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
        const reply = await callModel(
          { model: MODEL, messages, tools: toolSchemas, stream: false, think: THINK },
          xray,
          call === 1
            ? `Sending the conversation plus the ${toolSchemas.length} sandbox tools the model may ask for.`
            : `Model call ${call} of at most ${MAX_MODEL_CALLS}: sending the tool results back so the model can continue.`,
        );
        messages.push(reply.message);

        const toolCalls = reply.message.tool_calls ?? [];
        if (toolCalls.length === 0) return reply.message.content;

        for (const toolCall of toolCalls) {
          messages.push(await runTool(toolCall, xray, SANDBOX_TOOLS));
        }
      }

      xray.note(`Stopped: hit the limit (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}) before the model gave a final answer.`);
      return `I stopped before finishing, because the harness hit its limit of model calls (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}).`;
    },
  };
}
