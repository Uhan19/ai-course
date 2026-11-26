# What a harness is

A **language model** (or LLM) is a program that reads text and writes more text.
That is the whole job.
On its own it cannot read your files, check the clock, or remember what you said a minute ago.

Tools like Claude Code, Codex and Hermes feel like much more than that.
They read code, run commands and keep track of long tasks.
All of that extra behaviour comes from ordinary code wrapped around the model.
That code is the **harness**.

## Model versus harness

| The model | The harness |
| --- | --- |
| Reads a list of messages and writes the next one | Decides which messages to send |
| Forgets everything between requests | Stores the conversation |
| Can only *ask* for a tool to be run | Actually runs the tool |
| Knows nothing about your computer | Runs on your computer, with your permissions |

A useful way to hold it: the model is the brain in a jar, and the harness is its eyes and hands.
Most of what makes one agent better than another lives in the harness, not the model.

## The agent loop

Every agent harness runs some version of this loop.

```flow
You -[message]-> Harness -[request]-> Model
Model -[asks for a tool]-> Harness -[runs it]-> Tool
Tool -[result]-> Harness -[request + result]-> Model
Model -[final answer]-> Harness -[shows it]-> You
```

A few words we will use from now on:

- A **request** is one HTTP call from the harness to the model, carrying a list of messages.
- A **tool** is a function in the harness that the model may ask to run, such as "get the time".
- The **agent loop** is the cycle above: call the model, run any tools it asked for, send the results back, and repeat until it gives a final answer.

## The model in this course

The course runs a real model on your own Mac using **Ollama**.
Ollama is a program that downloads open models and serves them through a small HTTP API at `http://127.0.0.1:11434`.
The model is `qwen3.5:9b`, a 9-billion-parameter open model from Alibaba's Qwen team that is good at using tools.
With the local model, nothing you type leaves your machine.

## Try it

The **Try it** chat runs the finished agent you will build in lesson 3.
Send *"What time is it in Tokyo, and what is 15% of 80?"* and then read the x-ray from the top.

- A blue step means the harness sent a request to the model.
- A green step means the model replied.
- An amber step means the harness ran a tool.
- Open any "JSON" line to see exactly what went over the wire.

Notice that the model never knew the time.
It asked for the `get_current_time` tool, and the harness ran normal TypeScript that read the clock.

## What you will build

1. **Lesson 1:** send one raw request to the model, with no harness at all.
2. **Lesson 2:** a chat loop, so the conversation has a memory.
3. **Lesson 3:** tools and the full agent loop.
4. **Lesson 4:** real file and command tools, locked inside a Docker sandbox.
5. **Lesson 5:** permissions, so risky actions need your approval.
6. **Lesson 6:** context: the system prompt, a project notes file, and summarizing when the conversation gets too long.
7. **Lesson 7:** the same harness on a smaller and a larger model.
8. **Lesson 8:** how Claude Code, Codex and Hermes do each of these.

## Exercises

### 1. Find the three parts

Open the **Code** tab and find `harness/03-agent.ts`.
Find the line that calls the model, the line that runs a tool, and the loop that repeats them.

<details>
<summary>Show answer</summary>

- The model is called by `callModel(...)` inside `send`.
- Tools run in `runTool(...)`, which looks up the tool by name and calls its `run` function.
- The loop is `for (let call = 1; call <= MAX_MODEL_CALLS; call++)`. It ends early with `return reply.message.content` when the model replies without asking for tools.

</details>

### 2. Point the harness at a model that does not exist

The model's name is just a string the harness puts in each request.
In `harness/config.ts`, change `MODEL` to `"no-such-model"` in the **Code** tab.
Send a message and read what the chat and the x-ray say.
Then change it back.

<details>
<summary>Show answer</summary>

Ollama answers the request with an HTTP 404 error: `model 'no-such-model' not found`.
The harness throws, and the course shows that the model is not downloaded, with the `ollama pull` command to fix it.
The point: choosing the model is the harness's job.
Swapping models is a one-line change, which we will use in a later lesson.

</details>
