export const LESSONS = [
  {
    id: 0,
    title: "What a harness is",
    summary: "The model only turns text into text. The harness is everything around it.",
    entry: "harness/03-agent.ts",
    codeFiles: ["harness/03-agent.ts"],
    suggestions: [
      "What time is it in Tokyo, and what is 15% of 80?",
      "How many words are in: the quick brown fox jumps over the lazy dog",
    ],
    chatHint: "This is the finished agent from lesson 3. Ask it something and watch the x-ray.",
    flashcards: [
      {
        front: "What can a language model do on its own?",
        back: "Read text and write more text. On its own it cannot read your files, check the clock, or remember what you said a minute ago.",
        keyConcept: true,
      },
      {
        front: "What is a harness?",
        back: "The ordinary code wrapped around the model that makes it an agent. It decides which messages to send, stores the conversation and runs tools.",
        keyConcept: true,
      },
      {
        front: "Model or harness: which one actually runs a tool?",
        back: "The harness. The model can only ask for a tool to be run.",
      },
      {
        front: "What is the agent loop?",
        back: "Call the model, run any tools it asked for, send the results back, and repeat until it gives a final answer.",
        keyConcept: true,
      },
      {
        front: "What is a request?",
        back: "One HTTP call from the harness to the model, carrying a list of messages.",
      },
      {
        front: "What is a tool?",
        back: "A function in the harness that the model may ask to run, such as \"get the time\".",
      },
      {
        front: "What is Ollama?",
        back: "A program that downloads open models and serves them through a small HTTP API at `http://127.0.0.1:11434`.",
      },
      {
        front: "How do you point the harness at a different model?",
        back: "Change the model name the harness puts in each request: `MODEL` in `harness/config.ts`. Choosing the model is the harness's job.",
      },
    ],
  },
  {
    id: 1,
    title: "Talk to a model with no harness",
    summary: "One raw HTTP request, one JSON reply. Nothing is remembered.",
    entry: "harness/01-talk-to-model.ts",
    codeFiles: ["harness/01-talk-to-model.ts", "harness/config.ts", "harness/types.ts"],
    suggestions: ["My name is Sam. Please remember it.", "What is my name?", "Write a haiku about HTTP."],
    chatHint: "Each message goes to the model alone. Tell it your name, then ask for it.",
    flashcards: [
      {
        front: "Where does the harness send a chat request?",
        back: "A `POST` to Ollama's `/api/chat`, here `http://127.0.0.1:11434/api/chat`, with a JSON body.",
        keyConcept: true,
      },
      {
        front: "What do `model`, `messages`, `stream` and `think` mean in the request body?",
        back: "`model` picks the model. `messages` is the conversation so far. `stream: false` asks for the whole reply at once. `think: false` turns off written-out reasoning.",
      },
      {
        front: "Name the four message roles.",
        back: "`user` is you, `assistant` is the model, `system` is an instruction from the harness, and `tool` carries a tool's result.",
        keyConcept: true,
      },
      {
        front: "What is a token?",
        back: "A chunk of a few characters. Models read and write text in tokens.",
      },
      {
        front: "What do `prompt_eval_count` and `eval_count` count?",
        back: "`prompt_eval_count` is the tokens the model read (tokens in). `eval_count` is the tokens it wrote (tokens out).",
      },
      {
        front: "What does it mean that a model is stateless?",
        back: "It keeps nothing between requests. Any memory an agent has is something the harness built.",
        keyConcept: true,
      },
      {
        front: "Why did the model forget your name in lesson 1?",
        back: "The second request's `messages` held only your question. The model only ever sees what is in the request.",
      },
      {
        front: "What is a system message?",
        back: "An instruction from the harness that the user never typed, such as \"Talk like a pirate.\" It is how every agent harness steers its model.",
        keyConcept: true,
      },
      {
        front: "What changes when `THINK` is `true`?",
        back: "The reply gets a `thinking` field with the model's step-by-step reasoning. It takes longer and `eval_count` is much higher.",
      },
    ],
  },
  {
    id: 2,
    title: "A chat loop",
    summary: "The model is stateless. The harness keeps the history and resends all of it.",
    entry: "harness/02-chat-loop.ts",
    codeFiles: ["harness/02-chat-loop.ts"],
    suggestions: ["My name is Sam. Please remember it.", "What is my name?", "What was the first thing I said?"],
    chatHint: "Now the harness keeps a history. Watch the request grow with every message.",
    flashcards: [
      {
        front: "How does a chat harness give a stateless model a memory?",
        back: "It keeps the history in one `messages` list and sends the whole list with every request.",
        keyConcept: true,
      },
      {
        front: "What are the three steps of `send` in the chat loop?",
        back: "Add your message to the list, send the whole list to the model, then add the model's reply to the list.",
      },
      {
        front: "What is a system prompt?",
        back: "The harness's standing instructions to the model, sent first in every request.",
        keyConcept: true,
      },
      {
        front: "Why do \"tokens in\" grow with every message?",
        back: "Every request carries the entire conversation, so the model re-reads everything each time.",
      },
      {
        front: "What is context management?",
        back: "Handling the cost of resending the whole conversation: long chats take more time and tokens, and one day they will not fit. For example, sending only recent messages or summarizing old ones.",
        keyConcept: true,
      },
      {
        front: "What happens if the harness stops saving the model's replies?",
        back: "The model sees your messages but none of its own replies, so it cannot know what it said before.",
      },
      {
        front: "Can the model tell real history from history the harness made up?",
        back: "No. It trusts whatever history it is sent. Harnesses use this on purpose, for example to add a project's notes.",
      },
    ],
  },
  {
    id: 3,
    title: "Tools and the agent loop",
    summary: "The model asks for a tool, the harness runs it, the result goes back. Repeat.",
    entry: "harness/03-agent.ts",
    codeFiles: ["harness/03-agent.ts", "harness/03-tools.ts"],
    suggestions: [
      "What time is it?",
      "What time is it in Tokyo and in Paris?",
      "What is (17 * 23) / 4?",
      "What time is it in the time zone Mars/Olympus_Mons?",
      "Use the calculator to work out sqrt(2).",
    ],
    chatHint: "The agent can check the time, do arithmetic and count words.",
    flashcards: [
      {
        front: "How does the harness tell the model which tools exist?",
        back: "Each request carries a `tools` list next to `messages`. Each entry is a description (name, description, parameters), never code.",
        keyConcept: true,
      },
      {
        front: "What describes a tool's `parameters`?",
        back: "JSON Schema, a standard way to describe the shape of some JSON. The model reads it to know what arguments to pass.",
      },
      {
        front: "How does the model decide when a tool helps?",
        back: "It reads the tool's name and description. No harness code tells it when to use a tool.",
      },
      {
        front: "How does the model ask for a tool?",
        back: "It replies with `tool_calls` instead of an answer. Each call names a tool and gives its arguments.",
        keyConcept: true,
      },
      {
        front: "How does the harness send a tool's result back?",
        back: "It adds a message with the role `tool` (with `tool_name`, `tool_call_id` and the result as `content`), then calls the model again.",
        keyConcept: true,
      },
      {
        front: "When does the agent loop end normally?",
        back: "When the model replies without asking for any tool. That reply is the final answer.",
      },
      {
        front: "One reply asks for several tools. What does the harness do?",
        back: "Runs each one in order, then sends all the results back together.",
      },
      {
        front: "What does the harness do when a tool throws an error?",
        back: "Catches it and sends `Error: ...` back as the tool result, so the model can recover. An error is just more text for the model to read.",
        keyConcept: true,
      },
      {
        front: "What happens when the model names a tool that does not exist?",
        back: "The harness sends back an error listing the real tools. The loop does not crash.",
      },
      {
        front: "What is the turn limit?",
        back: "A cap on how many times the harness calls the model for one message (`MAX_MODEL_CALLS`, 6 here). It stops a model that keeps asking for tools forever.",
        keyConcept: true,
      },
    ],
  },
];

export const COMING_NEXT = [
  "Real file and command tools inside a locked Docker sandbox",
  "Permissions: approve or deny risky actions",
  "Context: system prompt, a project notes file, running out of room, summarizing",
  "Swap the model: a small versus a larger local model, same harness",
  "How Claude Code, Codex and Hermes each handle lessons 3 to 7",
];

