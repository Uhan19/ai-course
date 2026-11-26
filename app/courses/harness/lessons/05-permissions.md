# Permissions

The sandbox from lesson 4 limits *where* the agent can do damage: only the workspace.
It does not limit *what* it does there.
The model can still overwrite a file you care about, or run a command you would never have typed.

So harnesses add a second guard: **permissions**.
Before the harness runs a tool, it checks the call against a policy.
Some calls just run, some need your yes, and some never run at all.

## Where the check sits

The check goes between the model asking for a tool and the harness running it:

```flow
Model -[tool_calls]-> Harness -[check]-> Policy
Policy -[allow, or ask you, or deny]-> Harness -[only if allowed]-> Sandbox
```

The model is not involved in the decision.
It only finds out the answer when the result comes back.

## The policy

The policy is one small file, `harness/05-policy.ts`.
Each **rule** names a tool, a **decision** and a reason.
The first rule that matches wins.

```ts
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
```

| Decision | What the harness does |
| --- | --- |
| `allow` | Runs the tool straight away. |
| `ask` | Pauses the loop and shows you the exact action, with **Approve** and **Deny**. |
| `deny` | Does not run the tool. |

A `when` function lets a rule look at the arguments, not just the tool name.
That is how `rm -r` is denied while other commands are only asked about.
The order matters: the deny rule comes first, so it wins over the general "ask" rule for `run_command`.

A tool that no rule mentions falls through to `DEFAULT_RULE`, which denies it.
Denying by default is the safe choice: a new tool cannot run until someone decides how it should be treated.

## A denial is just another tool result

The model asked for a tool, so it is waiting for a tool result.
When a call is denied, the harness does not crash or stop the turn.
It sends back a tool message explaining the denial:

```json
{
  "role": "tool",
  "tool_name": "write_file",
  "tool_call_id": "call_8x2kq1fd",
  "content": "Denied: the user did not allow this. Do not try it again. Tell the user what you wanted to do, or ask what they would like instead."
}
```

The model reads that and carries on: it usually explains what it wanted to do, or tries a different way.
This is the same trick as lesson 3's tool errors.
To the model, a denial is just more text.

## The code

`harness/05-agent.ts` is the lesson 4 loop with one change.
Instead of calling `runTool` directly, it calls `checkThenRun`:

```ts
const rule = decide(name, args);

if (rule.decision === "allow") return runTool(toolCall, xray, SANDBOX_TOOLS);
if (rule.decision === "deny") return refusal(toolCall, `Denied by the harness policy: ${rule.reason}`);

const approved = await askUser({ tool: name, arguments: args, action, rule: rule.reason });
return approved ? runTool(toolCall, xray, SANDBOX_TOOLS) : refusal(toolCall, DENIED_BY_YOU);
```

`askUser` is how the harness reaches you.
In this course it shows a card in the chat and waits for your click.
In a terminal agent it would print a question and wait for you to type `y` or `n`.

## Try it

Each suggestion hits a different path.
Watch the purple **Permission** steps in the x-ray: each one says what the policy decided and who made the final call, the policy or you.

- *"What files are in the workspace?"* is allowed by the policy. No card appears.
- *"Create a file shopping.txt with three items on it."* asks you first. Approve it, then click **Open folder** above the chat and see the file. In the simulated sandbox, ask *"What files are in the workspace?"* instead.
- *"Run hello.py."* asks you too. This time click **Deny**, and watch how the model reacts to the denial.
- *"Delete everything in the workspace with rm -rf."* is denied by the policy without asking you. Some models then try another way, such as `rm` on each file. That one is only "ask", so you get the final say.

## Exercises

### 1. Allow writes without asking

Change the `write_file` rule's decision to `"allow"` in the **Code** tab.
Ask *"Create notes.txt that says hello."*

<details>
<summary>Show answer</summary>

No card appears.
The x-ray shows `Permission: allow`, decided by the policy, and the file is written straight away.
This is what "auto-accept edits" modes in real agents do: they trust file edits but still ask about commands.
Set it back to `"ask"` when you are done.

</details>

### 2. Deny a whole tool

Add a rule at the top of `RULES` that denies every `run_command`.
Then ask *"Run hello.py and tell me what it prints."*

<details>
<summary>Show answer</summary>

```ts
{ tool: "run_command", decision: "deny", reason: "This agent may not run commands." },
```

Every command is now refused by the policy.
The model gets `Denied by the harness policy: This agent may not run commands.`
Often it then reads `hello.py` with `read_file`, which is still allowed, and tells you what the script *would* print.
That is a model working around a limit, using only what it is allowed to do.
Remove the rule when you are done.

</details>

### 3. A tool with no rule

Lesson 4's exercise added a `count_lines` tool.
Add it to `SANDBOX_TOOLS` again (or keep yours), but add no rule for it.
Ask *"How many lines does rfc2324-coffee-pot.txt have? Use count_lines."*

<details>
<summary>Show answer</summary>

`decide` finds no rule for `count_lines`, so `DEFAULT_RULE` denies it.
The model is told `No rule mentions this tool, and anything not allowed is denied.`
Add `{ tool: "count_lines", decision: "allow", reason: "Counting only reads." }` to `RULES` and ask again: now it runs.
Default deny means forgetting a rule fails safe.

</details>
