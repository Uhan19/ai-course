import { callModel } from "./01-talk-to-model.ts";
import { TOOLS, toSchema, type Tool } from "./03-tools.ts";
import { MODEL, THINK } from "./config.ts";
import type { Harness, Message, ToolCall, XRay } from "./types.ts";

export const SYSTEM_PROMPT =
  "You are a helpful assistant. Use the tools when they help: never guess the time or do arithmetic in your head. Keep answers short.";

// The most model calls one user message may cause. Stops a model that keeps asking for tools forever.
export const MAX_MODEL_CALLS = 6;

// Lesson 3: the agent loop. Call the model, run the tools it asks for, send the results back, repeat.
export function createHarness(): Harness {
  const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const toolSchemas = TOOLS.map(toSchema);

  return {
    async send(userText, xray) {
      messages.push({ role: "user", content: userText });

      for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
        const reply = await callModel(
          { model: MODEL, messages, tools: toolSchemas, stream: false, think: THINK },
          xray,
          call === 1
            ? `Sending the conversation plus the list of ${toolSchemas.length} tools the model may ask for.`
            : `Model call ${call} of at most ${MAX_MODEL_CALLS}: sending the tool results back so the model can continue.`,
        );
        messages.push(reply.message);

        const toolCalls = reply.message.tool_calls ?? [];
        if (toolCalls.length === 0) return reply.message.content;

        for (const toolCall of toolCalls) {
          messages.push(await runTool(toolCall, xray));
        }
      }

      xray.note(`Stopped: hit the limit (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}) before the model gave a final answer.`);
      return `I stopped before finishing, because the harness hit its limit of model calls (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}).`;
    },
  };
}

// Run one tool call. Errors become a tool message too, so the model can see what went wrong and try again.
export async function runTool(toolCall: ToolCall, xray: XRay, tools: Tool[] = TOOLS): Promise<Message> {
  const { name, arguments: args } = toolCall.function;
  const tool = tools.find((candidate) => candidate.name === name);
  const startedAt = performance.now();
  let content: string;

  if (!tool) {
    content = `Error: there is no tool named "${name}". Available tools: ${tools.map((t) => t.name).join(", ")}.`;
    xray.tool({ name, arguments: args, error: content, elapsedMs: 0 }, `The model asked for "${name}", which does not exist. Telling it so.`);
  } else {
    try {
      content = await tool.run(args, xray);
      xray.tool({ name, arguments: args, result: content, elapsedMs: performance.now() - startedAt }, `Ran ${name} because the model asked. The result goes back as a tool message.`);
    } catch (error) {
      content = `Error: ${error instanceof Error ? error.message : String(error)}`;
      xray.tool({ name, arguments: args, error: content, elapsedMs: performance.now() - startedAt }, `${name} threw an error. The harness catches it and sends the error text back instead of crashing.`);
    }
  }

  return { role: "tool", tool_name: name, tool_call_id: toolCall.id, content };
}
