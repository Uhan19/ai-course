// The shapes of the JSON that goes to and comes back from Ollama's /api/chat.
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion

export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface Message {
  role: Role;
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
  tool_call_id?: string;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  stream: false;
  think?: boolean;
  options?: { temperature?: number };
}

export interface ChatResponse {
  model: string;
  message: Message;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

// The x-ray is how the course watches your harness work.
// Your harness calls these methods; the web page draws each call as one step.
export interface XRay {
  request(body: ChatRequest, why: string): void;
  response(body: ChatResponse, elapsedMs: number, why: string): void;
  tool(step: ToolStep, why: string): void;
  note(why: string): void;
}

export interface ToolStep {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  elapsedMs: number;
}

// Every lesson's harness has this shape, so the try-it panel can talk to it.
export interface Harness {
  send(userText: string, xray: XRay): Promise<string>;
}
