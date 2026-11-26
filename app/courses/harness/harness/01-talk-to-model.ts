import { MODEL, OLLAMA_URL, THINK } from "./config.ts";
import type { ChatRequest, ChatResponse, Harness, XRay } from "./types.ts";

// One HTTP request in, one JSON reply out. Every later lesson reuses this.
export async function callModel(body: ChatRequest, xray: XRay, why: string): Promise<ChatResponse> {
  xray.request(body, why);
  const startedAt = performance.now();

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Ollama answered ${response.status}: ${await response.text()}`);
  }
  const reply = (await response.json()) as ChatResponse;

  xray.response(reply, performance.now() - startedAt, describeReply(reply));
  return reply;
}

function describeReply(reply: ChatResponse): string {
  const calls = reply.message.tool_calls ?? [];
  if (calls.length === 0) return "The model answered with text.";
  const names = calls.map((call) => call.function.name).join(", ");
  const count = calls.length === 1 ? "1 tool" : `${calls.length} tools`;
  return `The model did not answer yet. It asked the harness to run ${count}: ${names}.`;
}

// Lesson 1: no harness at all. Each message goes to the model alone, with nothing before it.
export function createHarness(): Harness {
  return {
    async send(userText, xray) {
      const body: ChatRequest = {
        model: MODEL,
        messages: [{ role: "user", content: userText }],
        stream: false,
        think: THINK,
      };
      const reply = await callModel(body, xray, "Sending your message, and only your message, to the model.");
      return reply.message.content;
    },
  };
}
