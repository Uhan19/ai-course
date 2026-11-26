import type { Decision } from "./types.ts";

export interface Rule {
  tool: string;
  decision: Decision;
  reason: string;
  when?: (args: Record<string, unknown>) => boolean;
}

const RECURSIVE_DELETE = /\brm\s+(?:-\S+\s+)*(?:-[a-zA-Z]*[rR]|--recursive\b)/;

// The permission policy. The first rule that matches the tool call wins.
export const RULES: Rule[] = [
  {
    tool: "run_command",
    decision: "deny",
    reason: "Deleting folders with rm -r is never allowed.",
    when: (args) => RECURSIVE_DELETE.test(String(args.command ?? "")),
  },
  { tool: "list_files", decision: "allow", reason: "Listing files only reads." },
  { tool: "read_file", decision: "allow", reason: "Reading a file changes nothing." },
  { tool: "write_file", decision: "ask", reason: "Writing a file changes your files." },
  { tool: "run_command", decision: "ask", reason: "A command can change anything in the workspace." },
];

// Used when no rule matches, for example a tool you add later.
export const DEFAULT_RULE: Rule = { tool: "*", decision: "deny", reason: "No rule mentions this tool, and anything not allowed is denied." };

export function decide(tool: string, args: Record<string, unknown>): Rule {
  return RULES.find((rule) => rule.tool === tool && (rule.when?.(args) ?? true)) ?? DEFAULT_RULE;
}
