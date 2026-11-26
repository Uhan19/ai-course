# A chat loop

In lesson 1 the model forgot your name straight away.
That was not a bug.
The model is **stateless**: each request starts from nothing.

So how does every chat app remember the conversation?
The harness keeps the history, and sends all of it again with every request.

## The idea

The harness holds one list called `messages`.
Each time you send something:

1. Add your message to the list.
2. Send the **whole** list to the model.
3. Add the model's reply to the list.

```flow
You -[new message]-> Harness -[the whole history]-> Model
Model -[reply]-> Harness -[reply]-> You
```

The model sees the earlier messages and answers as if it remembered them.
It never did.
It re-reads the full conversation every time.

## The code

`harness/02-chat-loop.ts` is lesson 1 plus a list that lives across messages:

```ts
const messages: Message[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

async send(userText, xray) {
  messages.push({ role: "user", content: userText });
  const body = { model: MODEL, messages, stream: false };
  const reply = await callModel(body, xray, "...");
  messages.push(reply.message);
  return reply.message.content;
}
```

The list starts with a **system prompt**: the harness's standing instructions to the model, sent first in every request.

## Try it

Send *"My name is Sam. Please remember it."*, then *"What is my name?"*, then *"What was the first thing I said?"*

Now it remembers.
In the x-ray, look at the blue request steps.
The message count goes 2, 4, 6: the system prompt, then each of your messages and each reply.
Look at "tokens in" on the green steps too.
It grows with every message, because the model re-reads everything each time.

> Every request carries the entire conversation.
> Long chats cost more time and more tokens, and one day they will not fit.
> Handling that is called **context management**, and it gets its own lesson later.

## Exercises

### 1. Make it forget its own replies

In `harness/02-chat-loop.ts`, comment out the line `messages.push(reply.message);` in the **Code** tab.
Send *"Pick a random animal and tell me only its name."*
Then send *"Which animal did you pick?"*

<details>
<summary>Show answer</summary>

The model sees your two messages but none of its own replies, so it cannot know what it picked.
It will usually guess a new animal, or admit it doesn't know.
The x-ray shows the request with your messages back to back and no `assistant` message between them.
Put the line back when you are done.

</details>

### 2. Give it a short memory

Send only the system prompt and the last two messages, instead of everything.
Change the `messages` in the `callModel` call to `[messages[0], ...messages.slice(-2)]`.
Tell it your name, chat about something else for two more messages, then ask for your name.

<details>
<summary>Show answer</summary>

```ts
const reply = await callModel(
  {
    model: MODEL,
    messages: [messages[0], ...messages.slice(-2)],
    stream: false,
    think: THINK,
  },
  xray,
  "Sending the system prompt and the last two messages.",
);
```

Your name has fallen out of the window, so the model cannot know it.
The harness still stores everything.
It just chooses not to send it.
Real agents make exactly this kind of choice when a conversation gets too long, usually more cleverly, for example by summarizing old messages.

</details>

### 3. Put words in its mouth

The model trusts whatever history it is sent.
Start the list with a fake earlier exchange:

```ts
const messages: Message[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "My favourite colour is green." },
  { role: "assistant", content: "Noted: it is green." },
];
```

Click **New conversation**, then ask *"What is my favourite colour?"*

<details>
<summary>Show answer</summary>

It answers "green", though you never said it in this chat.
The model cannot tell real history from history the harness made up.
Harnesses use this on purpose, for example to add a project's notes or earlier examples to the conversation.

</details>
