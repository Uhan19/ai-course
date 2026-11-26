# Talk to a model with no harness

Before building anything around the model, let's talk to it directly.
It is just an HTTP server.
You send it JSON, and it sends JSON back.

## One request

To chat with the model, the harness sends a `POST` to `http://127.0.0.1:11434/api/chat` with a body like this:

```json
{
  "model": "qwen3.5:9b",
  "messages": [
    {
      "role": "user",
      "content": "My name is Sam. Please remember it."
    }
  ],
  "stream": false,
  "think": false
}
```

- `model` says which model should answer.
- `messages` is the conversation so far. Each message has a **role**: `user` is you, `assistant` is the model, and you will meet `system` and `tool` soon.
- `stream: false` asks for the whole reply at once instead of word by word.
- `think: false` turns off this model's habit of writing out its reasoning first. It keeps replies fast. Exercise 2 turns it back on.

## One reply

The model answers with the next message, plus some numbers about the work it did:

```json
{
  "model": "qwen3.5:9b",
  "message": {
    "role": "assistant",
    "content": "Hello, Sam! I've noted your name."
  },
  "done": true,
  "prompt_eval_count": 21,
  "eval_count": 16,
  "total_duration": 1863683834
}
```

Models read and write text in **tokens**, chunks of a few characters each.
`prompt_eval_count` is how many tokens the model read, and `eval_count` is how many it wrote.
`total_duration` is in nanoseconds.
The x-ray shows these as "tokens in", "tokens out" and seconds.

## The code

All of this is in `harness/01-talk-to-model.ts`, using plain `fetch`.
There is no SDK hiding anything.
The heart of it is:

```ts
const response = await fetch(`${OLLAMA_URL}/api/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const reply = await response.json();
```

`callModel` wraps that call and tells the x-ray about the request and the reply.
Every later lesson reuses it.

## Try it

Send *"My name is Sam. Please remember it."*
The model will happily say it has noted your name.
Now send *"What is my name?"*

It has no idea.
Open the request JSON for your second message in the x-ray: the `messages` list holds one message, your question, and nothing else.
The model only ever sees what is in the request.
Its promise to remember was just likely-sounding text.

> A model is **stateless**: it keeps nothing between requests.
> Any memory an agent has is something the harness built.

## Exercises

### 1. Give it a personality

Add a **system message** to the request.
A system message is an instruction from the harness that the user never typed.
In `createHarness`, put this before the user message in `messages`:

```ts
{ role: "system", content: "Talk like a pirate." },
```

Send a message, and find the new message in the request JSON.

<details>
<summary>Show answer</summary>

```ts
messages: [
  { role: "system", content: "Talk like a pirate." },
  { role: "user", content: userText },
],
```

Every reply now sounds like a pirate, though you never asked it to.
This is how every agent harness steers its model.
Claude Code, for example, sends a long system prompt explaining its tools and rules before your first word.

</details>

### 2. Watch it think

In `harness/config.ts`, set `THINK = true` in the **Code** tab.
Ask *"Is 1001 a prime number?"* and open the response JSON.

<details>
<summary>Show answer</summary>

The reply now has a `thinking` field next to `content`, holding the model's step-by-step reasoning.
The reply takes longer and `eval_count` (tokens out) is much higher, because the thinking is text the model had to write.
The harness decides what to do with it.
This course hides it from the chat, but you can see it in the x-ray.
Set `THINK` back to `false` when you are done.

</details>

### Bonus: skip the course entirely

The request is plain HTTP, so you can send it from a terminal:

```sh
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "qwen3.5:9b", "stream": false, "think": false,
  "messages": [{ "role": "user", "content": "hello" }]
}'
```
