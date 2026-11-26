import { callModel } from "./01-talk-to-model.ts";
import { toSchema } from "./03-tools.ts";
import { MAX_MODEL_CALLS, SYSTEM_PROMPT } from "./04-agent.ts";
import { ensureSandboxReady } from "./04-sandbox.ts";
import { SANDBOX_TOOLS } from "./04-tools.ts";
import { checkThenRun } from "./05-agent.ts";
import { buildSystemPrompt, contextSize, count, summarizeIfNeeded } from "./06-context.ts";
import { MODEL, THINK } from "./config.ts";
import type { Harness, HarnessOptions, Message } from "./types.ts";

// Lesson 6: the lesson 5 loop, plus project notes in the system prompt and a summary when the conversation gets too long.
export function createHarness({ model = MODEL }: HarnessOptions = {}): Harness {
  let messages: Message[] = [];
  let tokens = 0;
  const toolSchemas = SANDBOX_TOOLS.map(toSchema);

  return {
    async send(userText, xray, askUser) {
      await ensureSandboxReady();
      if (messages.length === 0) {
        messages = [{ role: "system", content: await buildSystemPrompt(SYSTEM_PROMPT, xray) }];
      }

      const tokensBeforeSummary = tokens;
      const compacted = tokens > 0 ? await summarizeIfNeeded(messages, tokens, model, xray) : messages;
      const justSummarized = compacted !== messages;
      messages = [...compacted, { role: "user", content: userText }];

      for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
        const reply = await callModel(
          { model, messages, tools: toolSchemas, stream: false, think: THINK },
          xray,
          call === 1
            ? `Sending the conversation (${messages.length} messages) plus the ${toolSchemas.length} sandbox tools.`
            : `Model call ${call} of at most ${MAX_MODEL_CALLS}: sending the tool results back so the model can continue.`,
        );
        tokens = contextSize(reply);
        if (call === 1 && justSummarized) {
          xray.note(`After summarizing, the conversation is ${count(tokens)} tokens, down from ${count(tokensBeforeSummary)}.`);
        }
        messages.push(reply.message);

        const toolCalls = reply.message.tool_calls ?? [];
        if (toolCalls.length === 0) return reply.message.content;

        for (const toolCall of toolCalls) {
          messages.push(await checkThenRun(toolCall, xray, askUser));
        }
      }

      xray.note(`Stopped: hit the limit (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}) before the model gave a final answer.`);
      return `I stopped before finishing, because the harness hit its limit of model calls (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}).`;
    },
  };
}
