import { callModel } from "./01-talk-to-model.ts";
import { readWorkspaceFile } from "./04-sandbox.ts";
import { THINK } from "./config.ts";
import type { Message, XRay } from "./types.ts";

// The project notes file. Like AGENTS.md for Codex or CLAUDE.md for Claude Code.
export const NOTES_FILE = "AGENTS.md";

// The harness's own budget, far below the model's window. Lower it to watch summarizing happen.
export const CONTEXT_LIMIT = 2_500;

const SUMMARY_HEADING = "\n\nSummary of the conversation so far:\n";

export const SUMMARY_PROMPT =
  "You compress conversations. Summarize the conversation below so an assistant can continue it without the original. Keep the user's goals, facts and numbers learned, files read or changed, and anything still to do. Use at most 120 words.";

// System prompt = the harness's instructions + the project's notes, if the workspace has some.
export async function buildSystemPrompt(basePrompt: string, xray: XRay): Promise<string> {
  let notes: string;
  try {
    notes = (await readWorkspaceFile(NOTES_FILE)).trim();
  } catch (error) {
    const reason = (error as { code?: string }).code === "ENOENT" ? `No ${NOTES_FILE} in the workspace.` : (error as Error).message;
    xray.note(`${reason} The system prompt is just the harness's own instructions.`);
    return basePrompt;
  }
  xray.note(`Loaded ${NOTES_FILE} (${notes.length} characters) from the workspace into the system prompt, once for this conversation.`);
  return `${basePrompt}\n\nThe project's notes, from ${NOTES_FILE}. Follow them:\n\n${notes}`;
}

// The size of the conversation, as Ollama counted it: tokens read plus tokens written by the last call.
export function contextSize(reply: { prompt_eval_count?: number; eval_count?: number }): number {
  return (reply.prompt_eval_count ?? 0) + (reply.eval_count ?? 0);
}

// Over the limit? Replace everything after the system prompt with a summary written by the model.
export async function summarizeIfNeeded(messages: Message[], tokens: number, model: string, xray: XRay): Promise<Message[]> {
  if (tokens <= CONTEXT_LIMIT) {
    xray.context({ limit: CONTEXT_LIMIT, tokensBefore: tokens }, `The conversation is ${count(tokens)} tokens, under the ${count(CONTEXT_LIMIT)}-token limit. Nothing to do.`);
    return messages;
  }

  const [system, ...older] = messages;
  const { basePrompt, earlierSummary } = splitSummary(system!.content);
  const transcript = [earlierSummary && `summary of the earlier conversation: ${earlierSummary}`, ...older.map(asTranscriptLine)];
  const reply = await callModel(
    {
      model,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: transcript.filter(Boolean).join("\n\n") },
      ],
      stream: false,
      think: THINK,
    },
    xray,
    `The conversation is ${count(tokens)} tokens, over the ${count(CONTEXT_LIMIT)}-token limit. Asking the model to summarize the ${older.length} messages after the system prompt.`,
  );
  const summary = reply.message.content.trim();

  xray.context(
    {
      limit: CONTEXT_LIMIT,
      tokensBefore: tokens,
      summarized: older.map(({ role, content }) => ({ role, content })),
      summary,
    },
    `Replaced ${older.length} messages with the summary. They are gone from what the model sees. The next response shows the new size.`,
  );
  return [{ role: "system", content: `${basePrompt}${SUMMARY_HEADING}${summary}` }];
}

function splitSummary(systemPrompt: string): { basePrompt: string; earlierSummary?: string } {
  const at = systemPrompt.indexOf(SUMMARY_HEADING);
  if (at === -1) return { basePrompt: systemPrompt };
  return { basePrompt: systemPrompt.slice(0, at), earlierSummary: systemPrompt.slice(at + SUMMARY_HEADING.length) };
}

export function count(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

function asTranscriptLine(message: Message): string {
  const calls = (message.tool_calls ?? []).map((call) => `asked for ${call.function.name}(${JSON.stringify(call.function.arguments)})`);
  const speaker = message.role === "tool" ? `tool result from ${message.tool_name}` : message.role;
  return `${speaker}: ${[message.content, ...calls].filter(Boolean).join(" ")}`;
}
