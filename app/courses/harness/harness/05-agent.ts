import { callModel } from "./01-talk-to-model.ts";
import { runTool } from "./03-agent.ts";
import { toSchema } from "./03-tools.ts";
import { MAX_MODEL_CALLS, SYSTEM_PROMPT } from "./04-agent.ts";
import { ensureSandboxReady } from "./04-sandbox.ts";
import { SANDBOX_TOOLS } from "./04-tools.ts";
import { decide } from "./05-policy.ts";
import { MODEL, THINK } from "./config.ts";
import type { AskUser, Harness, Message, PermissionStep, ToolCall, XRay } from "./types.ts";

export const DENIED_BY_YOU =
  "Denied: the user did not allow this. Do not try it again. Tell the user what you wanted to do, or ask what they would like instead.";

// Lesson 5: the lesson 4 loop, with a permission check between the model asking for a tool and the harness running it.
export function createHarness(): Harness {
  const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const toolSchemas = SANDBOX_TOOLS.map(toSchema);

  return {
    async send(userText, xray, askUser) {
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
          messages.push(await checkThenRun(toolCall, xray, askUser));
        }
      }

      xray.note(`Stopped: hit the limit (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}) before the model gave a final answer.`);
      return `I stopped before finishing, because the harness hit its limit of model calls (MAX_MODEL_CALLS = ${MAX_MODEL_CALLS}).`;
    },
  };
}

// Ask the policy, and you if the policy says so. Only an allowed call runs. A denial goes back to the model as the tool result.
export async function checkThenRun(toolCall: ToolCall, xray: XRay, askUser: AskUser): Promise<Message> {
  const { name, arguments: args } = toolCall.function;
  const rule = decide(name, args);
  const check: Omit<PermissionStep, "decision" | "decidedBy"> = { tool: name, arguments: args, rule: rule.reason };

  if (rule.decision === "allow") {
    xray.permission({ ...check, decision: "allow", decidedBy: "policy" }, `The policy allows ${name}, so the harness runs it without asking.`);
    return runTool(toolCall, xray, SANDBOX_TOOLS);
  }

  if (rule.decision === "deny") {
    xray.permission({ ...check, decision: "deny", decidedBy: "policy" }, "The policy denies this call. The harness does not run it, and tells the model why.");
    return refusal(toolCall, `Denied by the harness policy: ${rule.reason}`);
  }

  xray.permission({ ...check, decision: "ask", decidedBy: "policy" }, `The policy says to ask about ${name}, so the harness pauses and asks you.`);
  const approved = await askUser({ tool: name, arguments: args, action: describeAction(name, args), rule: rule.reason });
  if (approved) {
    xray.permission({ ...check, decision: "allow", decidedBy: "you" }, "You approved, so the harness runs it.");
    return runTool(toolCall, xray, SANDBOX_TOOLS);
  }
  xray.permission({ ...check, decision: "deny", decidedBy: "you" }, "You denied. The harness does not run it, and sends the denial back to the model as the tool result.");
  return refusal(toolCall, DENIED_BY_YOU);
}

function refusal(toolCall: ToolCall, content: string): Message {
  return { role: "tool", tool_name: toolCall.function.name, tool_call_id: toolCall.id, content };
}

function describeAction(tool: string, args: Record<string, unknown>): string {
  if (tool === "write_file") return `write ${String(args.content ?? "").length} characters to ${String(args.path)}`;
  if (tool === "run_command") return `run: ${String(args.command)}`;
  if (tool === "read_file") return `read ${String(args.path)}`;
  if (tool === "list_files") return `list the files in ${String(args.path ?? ".")}`;
  return `use the tool ${tool}`;
}
