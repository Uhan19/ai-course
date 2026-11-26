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
  sandbox(run: SandboxRun, why: string): void;
  permission(step: PermissionStep, why: string): void;
  context(step: ContextStep, why: string): void;
  note(why: string): void;
}

export interface ToolStep {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  elapsedMs: number;
}

// One docker run: the exact command, what it printed and how it ended. Lesson 4.
// simulated is true when the page ran it in its in-page stand-in instead of Docker.
export interface SandboxRun {
  argv: string[];
  stdin?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  elapsedMs: number;
  simulated?: boolean;
}

// What the harness asks the page to run in the sandbox. Lesson 4.
export interface SandboxRequest {
  command: string[];
  stdin?: string;
  timeoutMs: number;
  maxOutputChars: number;
}

export type Decision = "allow" | "ask" | "deny";

// One permission check: what the policy said and who made the final call. Lesson 5.
export interface PermissionStep {
  tool: string;
  arguments: Record<string, unknown>;
  decision: Decision;
  decidedBy: "policy" | "you";
  rule: string;
}

// One context check before a request: how full the context is and what was summarized. Lesson 6.
export interface ContextStep {
  limit: number;
  tokensBefore: number;
  summarized?: { role: Role; content: string }[];
  summary?: string;
}

// What the harness shows you when it needs your approval. Lesson 5.
export interface ApprovalRequest {
  tool: string;
  arguments: Record<string, unknown>;
  action: string;
  rule: string;
}

export type AskUser = (request: ApprovalRequest) => Promise<boolean>;

export interface HarnessOptions {
  model?: string;
}

// Every lesson's harness has this shape, so the try-it panel can talk to it.
export interface Harness {
  send(userText: string, xray: XRay, askUser: AskUser): Promise<string>;
}
