import type { ToolSchema } from "./types.ts";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  required: string[];
  run(args: Record<string, unknown>): string | Promise<string>;
}

const ARITHMETIC_ONLY = /^[\d\s+\-*/().]+$/;

export const TOOLS: Tool[] = [
  {
    name: "get_current_time",
    description: "Get the current date and time. Optionally in a given IANA time zone such as Asia/Tokyo.",
    parameters: {
      timezone: { type: "string", description: "IANA time zone name, for example Europe/Paris. Leave out for local time." },
    },
    required: [],
    run(args) {
      const timeZone = typeof args.timezone === "string" && args.timezone !== "" ? args.timezone : undefined;
      return new Date().toLocaleString("en-US", { timeZone, dateStyle: "full", timeStyle: "long" });
    },
  },
  {
    name: "calculator",
    description: "Evaluate an arithmetic expression with numbers, + - * / and parentheses. Example: (17 * 23) / 4",
    parameters: {
      expression: { type: "string", description: "The arithmetic expression to evaluate." },
    },
    required: ["expression"],
    run(args) {
      const expression = String(args.expression ?? "");
      if (!ARITHMETIC_ONLY.test(expression)) {
        throw new Error(`Only numbers, + - * / and parentheses are allowed. Got: ${expression}`);
      }
      const value = Number(new Function(`return (${expression});`)());
      if (!Number.isFinite(value)) throw new Error(`The result is not a finite number: ${value}`);
      return String(value);
    },
  },
  {
    name: "word_count",
    description: "Count the words in a piece of text.",
    parameters: {
      text: { type: "string", description: "The text to count words in." },
    },
    required: ["text"],
    run(args) {
      const words = String(args.text ?? "").trim().split(/\s+/).filter(Boolean);
      return String(words.length);
    },
  },
];

// The model never sees the run() functions, only this description of each tool.
export function toSchema(tool: Tool): ToolSchema {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties: tool.parameters, required: tool.required },
    },
  };
}
