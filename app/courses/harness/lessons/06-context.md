# Context

Everything the model reads in one request is its **context**.
In this harness that is three things: the system prompt, the tool descriptions, and the whole conversation so far, tool results included.

The model knows nothing else.
So what goes into the context, and what is left out, decides how good the agent is.
This lesson covers the three things every harness manages here: the system prompt, a project notes file, and a context that grows until it no longer fits.

## The system prompt

You met the **system prompt** in lesson 2: the harness's standing instructions, sent first in every request.
A real agent's system prompt is long.
It explains the tools, the rules for editing code, how to talk to the user, and much more.

The model cannot tell where any of it came from.
That makes the system prompt the natural place to add things the model should always know.

## Project notes

Every project has its own rules: how to run the tests, which folders to leave alone, the house style.
You don't want to repeat them in every chat.
So agent harnesses read a **project notes file** from the project and put it into the context.
Codex and many others read `AGENTS.md`.
Claude Code reads `CLAUDE.md`.

This harness does the same with `AGENTS.md` in the workspace.
Here is the whole file, from `workspace-seed/AGENTS.md`:

```md
# Project notes

This folder is a small playground for the harness course.

- Python scripts go in the top folder and run with `python3 <file>`.
- Never delete `rfc2324-coffee-pot.txt`. It is the sample document for lesson 6.
- When you write a new file, end it with a newline.
- Answer in British English.
```

`buildSystemPrompt` in `harness/06-context.ts` reads it once, on the first message of a conversation, and adds it after the harness's own instructions:

```ts
const notes = await readWorkspaceFile(NOTES_FILE);
return `${basePrompt}\n\nThe project's notes, from ${NOTES_FILE}. Follow them:\n\n${notes}`;
```

The harness reads this file through the page, not in the sandbox.
It is the harness's own setup, not a tool the model asked for.
The page never follows a link when it reads it, because the agent could make `AGENTS.md` a link to any file on your computer.

## Counting tokens

The context is measured in tokens.
Ollama tells the harness how many it used in every response: `prompt_eval_count` is the tokens the model read, and `eval_count` the tokens it wrote.
Together they are the size of the conversation so far.
With Claude as the model there are no token counts, so this harness never summarizes.

Before you type anything, this harness already uses about 700 tokens: the system prompt, the project notes and the descriptions of the four tools.
Then every message adds more, and tool results add the most.
Reading `rfc2324-coffee-pot.txt` adds about 2,000 tokens in one go.

## Running out of room

Every model has a **context window**: the most tokens it can read in one request.
For `qwen3.5:9b` that is 262,144 tokens, which Ollama reports in `/api/show`.

That sounds like a lot, but two things bite long before the end:

- Every request re-reads the whole context. A bigger context means slower answers and more memory for every single call.
- At the window's edge the server has to refuse the request or cut text off. Neither is something the harness controls.

So harnesses keep their own budget well under the window and act before reaching it.
Here the budget is `CONTEXT_LIMIT`, 2,500 tokens, kept tiny so you can watch it happen.

## Summarizing

When the conversation passes the limit, the harness **summarizes**, which some harnesses call **compaction**.
It sends the old messages to the model with one instruction: summarize this so you can carry on without it.
Then it throws the old messages away and keeps only the summary, added to the system prompt.
If the system prompt already holds a summary, that one goes to the model too, and the new summary replaces it.

```flow
Harness -[2,825 tokens: too big]-> Model
Model -[a 120-word summary]-> Harness -[system prompt + summary]-> Summary
Summary -[about 900 tokens]-> Model
```

In `harness/06-agent.ts` this is one line before each new message:

```ts
const compacted = tokens > 0 ? await summarizeIfNeeded(messages, tokens, model, xray) : messages;
```

Summarizing trades detail for room.
The model now sees the summary, not the original messages.
Anything the summary left out is gone for good, such as the exact wording of the RFC.

## Try it

Send the three suggestions in order, and watch the x-ray.

1. *"What do the project notes ask you to do?"* The first step is a grey note: the harness loaded `AGENTS.md`. Open the request JSON and find the notes at the end of the system message. The model can answer without any tool.
2. *"Read rfc2324-coffee-pot.txt and tell me what the BREW method does."* Look at "tokens in" on the green steps. It jumps by about 2,000 once the file comes back.
3. *"What have we talked about so far?"* Now the conversation is over 2,500 tokens. The pink **Context summarized** step shows what was replaced and the summary that took its place. The blue request after it has just 2 messages, and a grey note gives the size before and after.

## Exercises

### 1. Watch it summarize sooner

In `harness/06-context.ts`, set `CONTEXT_LIMIT` to `1_000` in the **Code** tab.
Chat about anything for three or four short messages.

<details>
<summary>Show answer</summary>

The conversation starts at about 700 tokens, so it passes 1,000 after a message or two.
From then on the harness summarizes before almost every message.
You will see the summaries get vaguer: each one is a summary of a summary.
That is the real cost of a small budget.
Set it back to `2_500` when you are done.

</details>

### 2. Change the project's rules

In the **Code** tab, edit `workspace/AGENTS.md`, the live copy the sandbox uses, add a line `- Always end your answer with "Cheers!"`, and click **Save to workspace**.
Send a message, then click **New conversation** and send it again.

<details>
<summary>Show answer</summary>

The first time, nothing changes.
The harness read `AGENTS.md` on the first message of the conversation, and the old copy is still in its system prompt.
After **New conversation** it reads the file again, and the answers end with "Cheers!".
Real agents work the same way: notes are read when a session starts.
**Reset files** puts `AGENTS.md` back to the original.

</details>

### 3. Keep the latest exchange word for word

Right now the summary replaces everything.
Change `summarizeIfNeeded` so your last question and everything after it stay as they are, and only the older messages are summarized.

<details>
<summary>Show answer</summary>

```ts
const [system, ...rest] = messages;
const lastQuestion = rest.findLastIndex((message) => message.role === "user");
const older = rest.slice(0, lastQuestion);
const recent = rest.slice(lastQuestion);
// ... summarize `older` exactly as before ...
return [
  { role: "system", content: `${basePrompt}${SUMMARY_HEADING}${summary}` },
  ...recent,
];
```

Why cut at your last question, and not simply keep the last two messages?
If the last answer used a tool, the last two messages are a `tool` result and the answer, and the `assistant` message that asked for the tool would be summarized away.
The model would then see a result for a call it never made.
Cutting at a `user` message keeps each tool call next to its result.
Hermes Agent, one of the harnesses in lesson 8, also keeps the most recent messages and summarizes the ones before them.

</details>
