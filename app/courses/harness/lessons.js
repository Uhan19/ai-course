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
  {
    id: 4,
    title: "Real tools in a locked sandbox",
    summary: "Read, write and run for real, but only inside a locked Docker container.",
    entry: "harness/04-agent.ts",
    codeFiles: ["harness/04-agent.ts", "harness/04-tools.ts", "harness/04-sandbox.ts"],
    usesSandbox: true,
    suggestions: [
      "What files are in the workspace?",
      { text: "Run hello.py and tell me what it printed.", needsRealSandbox: true },
      { text: "Write a Python script primes.py that prints the first 10 primes, then run it.", needsRealSandbox: true },
      { text: "Can you reach the internet from the sandbox? Try it with Python.", needsRealSandbox: true },
      "Run the command sleep 30 and tell me what happened.",
    ],
    chatHint: "The agent can list, read and write files and run commands, all inside a locked container.",
    flashcards: [
      {
        front: "Why should an agent's commands not run straight on your computer?",
        back: "The model chooses the commands and can be wrong or tricked, for example by a file that says \"delete everything\". A sandbox limits the damage.",
        keyConcept: true,
      },
      {
        front: "What is a sandbox?",
        back: "A locked place to run the agent's tools, which can only touch what the harness puts in it. Here it is a Docker container.",
        keyConcept: true,
      },
      {
        front: "What is a container, and what is an image?",
        back: "A container is a process on a small Linux system of its own, with its own files. An image is the read-only template it starts from, here `python:3.13-alpine`.",
      },
      {
        front: "What does `--network none` stop?",
        back: "All network access. A command cannot download a script or send your files anywhere.",
        keyConcept: true,
      },
      {
        front: "Why run as `--user 1000:1000` with `--read-only`?",
        back: "Commands run as an ordinary user, not `root`, and cannot change the container's system files. Only `/tmp` and the workspace are writable.",
      },
      {
        front: "Which of your computer's files can the sandbox see?",
        back: "Only the workspace folder, `~/harness-course-workspace`, mounted at `/workspace`. It is the one place the agent can change real files, so it is the one place it can do damage.",
        keyConcept: true,
      },
      {
        front: "What do `--cpus`, `--memory` and `--pids-limit` protect against?",
        back: "A runaway command, such as an endless loop or a fork bomb, using up your whole machine.",
      },
      {
        front: "How does the harness stop a command that never ends?",
        back: "A per-command timeout (`LIMITS.timeoutMs`, 10 seconds). When it runs out, the container is stopped with `docker kill` and the model is told the command timed out.",
        keyConcept: true,
      },
      {
        front: "What is an exit code?",
        back: "The number a program ends with. 0 means it worked; anything else means it failed. The harness sends it back so the model can react.",
      },
      {
        front: "Why does the harness cut long command output short?",
        back: "Every character sent back costs the model time and room in its context. Here anything past 8,000 characters is cut.",
      },
    ],
  },
  {
    id: 5,
    title: "Permissions",
    summary: "A policy decides which tool calls run, which ask you first, and which never run.",
    entry: "harness/05-agent.ts",
    codeFiles: ["harness/05-policy.ts", "harness/05-agent.ts"],
    usesSandbox: true,
    suggestions: [
      "What files are in the workspace?",
      "Create a file shopping.txt with three items on it.",
      "Run hello.py.",
      "Delete everything in the workspace with rm -rf.",
    ],
    chatHint: "Same sandbox tools, now behind a permission policy. Some calls will ask for your approval.",
    flashcards: [
      {
        front: "What does a permission layer add on top of a sandbox?",
        back: "The sandbox limits where the agent can do damage. Permissions decide which actions run at all, inside that space.",
        keyConcept: true,
      },
      {
        front: "Where does the permission check sit in the agent loop?",
        back: "Between the model asking for a tool and the harness running it. The model is not part of the decision.",
        keyConcept: true,
      },
      {
        front: "What are the three decisions a policy rule can make?",
        back: "`allow` runs the tool, `ask` pauses and asks you, `deny` never runs it.",
        keyConcept: true,
      },
      {
        front: "Two rules match the same tool call. Which one counts?",
        back: "In this harness, the first one in `RULES`. That is why the `rm -r` deny rule comes before the general `run_command` ask rule.",
      },
      {
        front: "How can a rule look at more than the tool name?",
        back: "With a `when` function that reads the arguments, such as a pattern that matches `rm -r` in a command.",
      },
      {
        front: "What happens to a tool call the model makes after you click Deny?",
        back: "The harness does not run it and sends a `tool` message saying it was denied. The model reads that and carries on.",
        keyConcept: true,
      },
      {
        front: "Why deny by default when no rule matches?",
        back: "So a new or unexpected tool cannot run until someone decides how to treat it. Forgetting a rule fails safe.",
      },
      {
        front: "How does the harness ask you, in code?",
        back: "It calls `askUser(...)` and waits for the answer. Here that shows a card with Approve and Deny; a terminal agent would print a question instead.",
      },
    ],
  },
  {
    id: 6,
    title: "Context",
    summary: "System prompt, a project notes file, counting tokens, and summarizing when the conversation gets too long.",
    entry: "harness/06-agent.ts",
    codeFiles: ["harness/06-context.ts", "harness/06-agent.ts"],
    workspaceFiles: ["AGENTS.md"],
    usesSandbox: true,
    suggestions: [
      "What do the project notes ask you to do?",
      "Read rfc2324-coffee-pot.txt and tell me what the BREW method does.",
      "What have we talked about so far?",
    ],
    chatHint: "The agent now loads AGENTS.md into its system prompt and summarizes the conversation when it gets past 2,500 tokens.",
    flashcards: [
      {
        front: "What is the context?",
        back: "Everything the model reads in one request: the system prompt, the tool descriptions and the whole conversation so far.",
        keyConcept: true,
      },
      {
        front: "What is a context window?",
        back: "The most tokens a model can read in one request. qwen3.5's is 262,144 tokens.",
        keyConcept: true,
      },
      {
        front: "What is a project notes file?",
        back: "A file in the project, like `AGENTS.md` or `CLAUDE.md`, that the harness loads into the system prompt so the model follows the project's rules.",
        keyConcept: true,
      },
      {
        front: "When does this harness load `AGENTS.md`?",
        back: "Once, on the first message of a conversation. Edits to it apply from the next new conversation.",
      },
      {
        front: "How does the harness know how big the conversation is?",
        back: "Ollama reports it: `prompt_eval_count` (tokens read) plus `eval_count` (tokens written) for the last call.",
      },
      {
        front: "Why keep a context budget far below the model's window?",
        back: "Every token is re-read on every call, so big contexts are slow and use memory. And a full window means the server must refuse or cut text, which the harness does not control.",
      },
      {
        front: "What is summarizing (also called compaction)?",
        back: "When the conversation passes a limit, the harness asks the model to summarize it and replaces the old messages with that summary.",
        keyConcept: true,
      },
      {
        front: "What is lost when the harness summarizes?",
        back: "The exact old messages. The model only sees the summary, so any detail the summary left out is gone.",
      },
      {
        front: "What uses up context fastest in a coding agent?",
        back: "Tool results, such as a whole file read into the conversation. That is why tools cut long output short.",
      },
    ],
  },
  {
    id: 7,
    title: "Swap the model",
    summary: "The same harness on a small and a larger local model. Compare tool use, speed and tokens.",
    entry: "harness/07-swap-model.ts",
    codeFiles: ["harness/07-swap-model.ts", "harness/config.ts"],
    usesSandbox: true,
    comparesModels: true,
    suggestions: [
      "Which method does RFC 2324 add for saying when to stop pouring milk? Check rfc2324-coffee-pot.txt.",
      "Count exactly how many times the word coffee appears in rfc2324-coffee-pot.txt, in any case.",
      { text: "What is 2 to the power of 100? Work it out with Python.", needsRealSandbox: true },
    ],
    chatHint: "Pick a model, or all of them. With all, the same message goes to each model in turn and the x-ray compares them.",
    flashcards: [
      {
        front: "What changes in the harness when you swap the model?",
        back: "Only the `model` name in each request. The loop, tools, permissions and context code stay the same.",
        keyConcept: true,
      },
      {
        front: "What does a model's parameter count roughly tell you?",
        back: "Its size. More parameters usually means better reasoning and tool use, but more memory, a bigger download and slower replies.",
      },
      {
        front: "How big are the course's two models?",
        back: "`qwen3.5:4b` has 4.5 billion parameters and is a 4.0 GB download. `qwen3.5:9b` has 9.7 billion and is 7.6 GB.",
      },
      {
        front: "What does \"supports tool calling\" mean for a model?",
        back: "It was trained to answer with structured `tool_calls` when given a `tools` list. A model without it can only reply with text.",
        keyConcept: true,
      },
      {
        front: "Name three ways to compare two models on the same task.",
        back: "Did the tool calls work and was the answer right, how long it took, and how many tokens it read and wrote.",
      },
      {
        front: "Why would a harness use a smaller model at all?",
        back: "It is faster and uses less memory. Harnesses often use a small model for simple side jobs and a bigger one for the main work.",
        keyConcept: true,
      },
      {
        front: "Why can the same model give different answers to the same message?",
        back: "Models pick each next token with some randomness, so runs differ. Compare models over several tries, not one.",
      },
    ],
  },
  {
    id: 8,
    title: "How Claude Code, Codex and Hermes do it",
    summary: "Tools, sandboxing, permissions, context and model choice in three real agents, next to what you built.",
    codeFiles: [],
    suggestions: [],
    chatHint: "",
    flashcards: [
      {
        front: "Which parts do Claude Code, Codex and Hermes Agent share with the harness you built?",
        back: "All five: tools, a sandbox, permissions, context handling (system prompt, project notes, summarizing) and a choice of model.",
        keyConcept: true,
      },
      {
        front: "What is MCP?",
        back: "The Model Context Protocol: a standard way to plug extra tools into a harness. An MCP server offers tools, and the harness lists them for the model next to its own.",
        keyConcept: true,
      },
      {
        front: "What is a subagent?",
        back: "A second agent conversation with its own context, started as a tool. Only its summary comes back, which keeps big side tasks out of the main context.",
        keyConcept: true,
      },
      {
        front: "How do Claude Code and Codex sandbox commands without Docker?",
        back: "With the operating system's own sandbox: Seatbelt on macOS, and bubblewrap on Linux.",
      },
      {
        front: "What does Claude Code's sandbox cover, and what does it not?",
        back: "Only shell commands, and it is off by default. Its file tools run outside it and are guarded by permission rules instead.",
      },
      {
        front: "In which order does Claude Code check permission rules?",
        back: "Deny first, then ask, then allow, whatever order they are written in. A deny always wins.",
      },
      {
        front: "What new permission idea do all three real harnesses share?",
        back: "A second model can answer permission questions for you: Claude Code's `auto` mode, Codex's `--approve-for-me`, and Hermes's `smart` approvals.",
        keyConcept: true,
      },
      {
        front: "Which project notes file does each one read?",
        back: "Claude Code reads `CLAUDE.md` (or `AGENTS.md` if there is none). Codex reads `AGENTS.md`. Hermes reads the first of `.hermes.md`, `AGENTS.md`, `CLAUDE.md` or `.cursorrules`.",
      },
      {
        front: "When do Codex and Hermes start summarizing?",
        back: "Codex at 90% of the context window. Hermes at 50%, raised to 75% for windows under 512,000 tokens.",
      },
      {
        front: "What is prompt injection?",
        back: "Text in a file or web page that tries to give the model new instructions. Hermes scans project notes for it before adding them to the system prompt.",
        keyConcept: true,
      },
      {
        front: "Which of the three can run a local model through Ollama?",
        back: "Codex with `--oss`, and Hermes with a custom OpenAI-compatible provider. Claude Code only through Ollama's own setup, such as `ollama launch claude`, which Anthropic does not support.",
      },
    ],
  },
];
