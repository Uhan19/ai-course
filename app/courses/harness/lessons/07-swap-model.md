# Swap the model

Lesson 0 said the model's name is just a string the harness puts in each request.
This lesson takes that literally.
The harness from lesson 6, with its sandbox, permissions and context handling, runs unchanged on two different models, and you compare them side by side.

## The whole change

`harness/07-swap-model.ts` is the entire lesson:

```ts
export function createHarness(
  { model = MODELS[0] }: HarnessOptions = {},
): Harness {
  if (!MODELS.includes(model)) {
    throw new Error(`Unknown model ${model}. ...`);
  }
  return createLesson6Harness({ model });
}
```

The lesson 6 harness puts that name in every request, including the summary request.
Nothing else knows or cares which model is answering.
That is true of real harnesses too: most can switch models in the middle of a session.

## The two models

Both are from the same family, so the only real difference is size.
A model's size is its number of **parameters**, the numbers it learned in training.
More parameters usually means better reasoning and tool use, but also more memory, a bigger download and slower replies.

| Model | Parameters | Download | Tool calling |
| --- | --- | --- | --- |
| `qwen3.5:4b` | 4.5 billion | 4.0 GB | yes |
| `qwen3.5:9b` | 9.7 billion | 7.6 GB | yes |

Tool calling matters most.
A model **supports tool calling** if it was trained to answer with structured `tool_calls` when a request carries a `tools` list.
Ollama lists it as a "tools" capability on the model's page, and in `/api/show`.
A model without it can still chat, but it cannot drive this harness.

Both fit in memory together on a Mac with 24 GB: loaded, they take about 13 GB.
If one is missing, the page shows the `ollama pull` command for it.

## What to compare

Choose **All, one after the other** under **Send to**, above the chat.
Comparing needs the local models in the installed app; with Claude as the model, every message goes to Claude.
Your message goes to `qwen3.5:4b` with its own conversation, then to `qwen3.5:9b` with its own conversation.
At the end the x-ray adds a table:

- **Model calls and tool calls**: how many steps the model needed. Fewer is usually a better plan.
- **Failed tool calls**: calls that came back as `Error: ...`, such as a wrong file name. This is tool-call accuracy.
- **Tokens in and out**, summed over every call: how much the model had to read and write.
- **Time**, and how much of it was Ollama loading the model into memory. Loading happens only when a model was not loaded yet, so leave it out when you compare speed. Time also leaves out any seconds the turn waited for you to approve a command, so a slow click does not count against a model.

The table cannot tell you if an answer was *right*.
Read the answers in the chat for that.

## Three runs on one Mac

Here is the same message sent three times with **All, one after the other**, each time in a new conversation and approving each command: *"Count exactly how many times the word coffee appears in rfc2324-coffee-pot.txt, in any case."*

| Run | Model | Model calls | Tool calls | Tokens in | Time | Of which loading | Answer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `qwen3.5:4b` | 2 | 1 | 3,410 | 12.0&nbsp;s | 2.0&nbsp;s | 22 |
| 1 | `qwen3.5:9b` | 3 | 2 | 6,196 | 16.9&nbsp;s | 5.3&nbsp;s | 79 |
| 2 | `qwen3.5:4b` | 3 | 2 | 6,168 | 16.4&nbsp;s | 1.7&nbsp;s | 79 |
| 2 | `qwen3.5:9b` | 3 | 2 | 6,188 | 22.2&nbsp;s | 5.9&nbsp;s | 79 |
| 3 | `qwen3.5:4b` | 3 | 2 | 6,168 | 10.0&nbsp;s | 1.6&nbsp;s | 79 |
| 3 | `qwen3.5:9b` | 3 | 2 | 6,234 | 18.7&nbsp;s | 4.1&nbsp;s | 79 |

None of the six answers is exactly right.
The question asks for the word coffee, and the file has it 76 times: 62 as `coffee` and 14 as `Coffee`.
It also has 3 `coffeepot`s, and a plain search finds `coffee` inside them too, which makes 79.
You can check both numbers in a terminal, in the `~/harness-course-workspace` folder: `grep -o` prints each match on its own line, and `wc -l` counts the lines.

```sh
grep -io coffee rfc2324-coffee-pot.txt | wc -l
grep -iow coffee rfc2324-coffee-pot.txt | wc -l
```

The first prints 79, `coffeepot` included.
The second adds `-w` for whole words only and prints 76.
Inside the sandbox the second prints 77: the container's smaller `grep`, from BusyBox, has a bug that adds a stray match on the line with `"message/coffeepot"`.
Tools can be wrong too, so check a surprising number another way.

Five times, the model read the file and then ran a command such as `grep` to count.
All five answered 79: they counted the `coffee` inside each `coffeepot` too, and none of them noticed.
In run 1 the small model skipped the command and counted by itself.
But `read_file` had cut the file at 8,000 characters, so the model never saw most of it.
Its answer of 22 was wrong even for the part it saw, which holds 31.
That turn also used the fewest steps and tokens, which is why the table alone cannot tell you which answer was right.

In these runs Ollama kept only one model in memory at a time, so it loaded each model again on every turn.
That is the loading column.
Take it out and the small model was still faster every time, by 1.6 to 6.2 seconds.
At other times on the same Mac Ollama kept both models loaded, about 13 GB together, and loading stayed at 0.0 s.
Run `ollama ps` in a terminal to see which models are in memory right now.

Three lessons hide in this table.
First, the plan matters as much as the model: the answer furthest off came from skipping the command, and the same small model came within 3 in runs 2 and 3 when it ran one.
Second, a tool is only as exact as the command the model writes: the commands counted the `coffee` inside `coffeepot`, and both models reported 79 with confidence.
Checking the answer is still your job.
Third, one run proves little: models pick each next token with some randomness, so the same message can take a different path each time.
Compare models over several tries before you trust a difference.

## Try it

Send each suggestion with **All, one after the other** selected, and read the table after each one.

- *"Which method does RFC 2324 add for saying when to stop pouring milk?"* is one read and one answer. Do both quote the right section? (It is 2.1.4, the WHEN method.)
- *"Count exactly how many times the word coffee appears…"* rewards a good plan. The right answer is 76; 79 means the model counted `coffeepot` too, and 77 means it hit the BusyBox bug.
- *"What is 2 to the power of 100? Work it out with Python."* needs a command, so you approve it once per model. It needs the real sandbox, because the simulated one can't run Python.

## Exercises

### 1. Swap in another model

Pick a third model from [Ollama's tools list](https://ollama.com/search?c=tools) that fits your computer, for example `qwen3.5:2b` (about 3 GB).
Pull it with `ollama pull qwen3.5:2b`, then add it to `MODELS` in `harness/config.ts` in the **Code** tab.

<details>
<summary>Show answer</summary>

A third choice appears in the picker.
**All, one after the other** now runs all three in turn, and the table gets a third row.
Ask the coffee question a few times and compare the plans, the failed tool calls and the answers across the three sizes.
You changed one list in one file, and nothing in the harness.

</details>

### 2. Try a model without tool calling

What happens if the model does not support tools?
Add a model whose Ollama page has no "tools" badge, such as `gemma3:1b`, pull it, and send it a message.

<details>
<summary>Show answer</summary>

Ollama refuses the request: `registry.ollama.ai/library/gemma3:1b does not support tools`.
The chat shows it as a harness error.
The harness sends a `tools` list in every request, so this model cannot be used with it at all.
That is why "supports tool calling" is the first thing to check when you choose a model for an agent.
Remove it from `MODELS` when you are done.

</details>
