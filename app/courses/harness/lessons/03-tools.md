# Tools and the agent loop

A chat loop can only talk.
To act, such as checking the time, doing exact maths or later editing files, the model needs **tools**.

The model cannot run anything itself.
It can only write text.
So a tool works like this: the model writes a structured request saying "please run this tool with these arguments", the harness runs it, and the harness sends the result back.

## Step 1: tell the model which tools exist

Each request now carries a `tools` list next to `messages`.
Each entry is a description, never code:

```json
{
  "type": "function",
  "function": {
    "name": "calculator",
    "description": "Evaluate an arithmetic expression ...",
    "parameters": {
      "type": "object",
      "properties": {
        "expression": {
          "type": "string",
          "description": "The expression to evaluate."
        }
      },
      "required": ["expression"]
    }
  }
}
```

The `parameters` part is **JSON Schema**, a standard way to describe the shape of some JSON.
The model reads the name and description to decide when a tool helps.
It reads the schema to know what arguments to pass.

## Step 2: the model asks for a tool

When a tool would help, the model replies with `tool_calls` instead of an answer:

```json
{
  "role": "assistant",
  "content": "",
  "tool_calls": [
    {
      "id": "call_21rds7wn",
      "function": {
        "name": "get_current_time",
        "arguments": { "timezone": "Asia/Tokyo" }
      }
    },
    {
      "id": "call_mje6hxuu",
      "function": {
        "name": "calculator",
        "arguments": { "expression": "(80 * 15) / 100" }
      }
    }
  ]
}
```

One reply can hold several tool calls.
The harness should run them all.

## Step 3: the harness runs them and reports back

For each call, the harness finds the tool by name, runs its `run` function, and adds a message with the role `tool`:

```json
{
  "role": "tool",
  "tool_name": "calculator",
  "tool_call_id": "call_mje6hxuu",
  "content": "12"
}
```

Then it calls the model again with the longer history.
The model reads the results and either asks for more tools or writes its final answer.

## The agent loop

```flow
You -[question]-> Harness -[history + tools]-> Model
Model -[tool_calls]-> Harness -[runs]-> Tool
Tool -[result]-> Harness -[history + results]-> Model
Model -[final answer]-> Harness -[answer]-> You
```

Rows two and three repeat until the model answers without asking for a tool.
That repetition is the **agent loop**, and it is the core of every coding agent.
In `harness/03-agent.ts` it is one `for` loop:

```ts
for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
  const reply = await callModel(
    { model: MODEL, messages, tools: toolSchemas, stream: false },
    xray,
    "...",
  );
  messages.push(reply.message);

  const toolCalls = reply.message.tool_calls ?? [];
  if (toolCalls.length === 0) return reply.message.content;

  for (const toolCall of toolCalls) {
    messages.push(await runTool(toolCall, xray));
  }
}
```

## When things go wrong

A real harness must expect trouble.
This one handles four cases, and each shows up clearly in the x-ray.

| What happens | What the harness does |
| --- | --- |
| Several tool calls in one reply | Runs each one in order, then sends all the results back together. |
| A tool throws an error | Catches it and sends `Error: ...` back as the tool result, so the model can recover. |
| The model names a tool that does not exist | Sends back an error listing the real tools. |
| The model keeps asking for tools forever | Stops after `MAX_MODEL_CALLS` model calls, which is the **turn limit**. |

The first three never crash the loop.
An error is just more text for the model to read.

## Try it

The suggestions under the chat cover each case:

- *"What time is it in Tokyo and in Paris?"* asks for two tool calls in one reply.
- *"What is (17 * 23) / 4?"* runs the calculator once, then the model answers.
- *"What time is it in the time zone Mars/Olympus_Mons?"* makes the clock tool throw on a time zone that does not exist. Watch the red step, then see how the model handles the error.
- *"Use the calculator to work out sqrt(2)."* The calculator has no square root. Often the model passes `sqrt(2)` and the tool throws. Sometimes it rewrites the sum as `2 ** 0.5` first. Models are not deterministic, so try it a few times and compare the x-rays.

Count the blue steps in each turn.
That is how many times the harness called the model to answer one question.

## Exercises

### 1. Add a tool

Add a `roll_dice` tool to `TOOLS` in `harness/03-tools.ts`.
It takes the number of sides and returns a random roll.
Then ask *"Roll a 20-sided die for me."*

<details>
<summary>Show answer</summary>

```ts
{
  name: "roll_dice",
  description: "Roll a die with this many sides.",
  parameters: {
    sides: { type: "number", description: "Like 6 or 20." },
  },
  required: ["sides"],
  run(args) {
    const sides = Number(args.sides);
    if (!Number.isInteger(sides) || sides < 2) {
      throw new Error(`Bad sides: ${args.sides}`);
    }
    return String(1 + Math.floor(Math.random() * sides));
  },
},
```

The request JSON now lists four tools, and the model calls `roll_dice` with `{ "sides": 20 }`.
You wrote no code that tells the model when to use it.
The name and description were enough.

</details>

### 2. Hit the turn limit

In `harness/03-agent.ts`, set `MAX_MODEL_CALLS` to `1` in the **Code** tab.
Ask *"What time is it?"*

<details>
<summary>Show answer</summary>

The model asks for `get_current_time`, and the harness runs it.
But the harness is out of model calls, so it never sends the result back.
The x-ray ends with a grey note saying it stopped, and the chat says the harness hit its limit instead of telling you the time.
Real agents have the same safety net, usually set much higher.
Set it back to `6` when you are done.

</details>

### 3. Offer a tool the harness cannot run

What if the model asks for a tool the harness does not have?
Offer one without building it.
In `createHarness`, replace the `toolSchemas` line with:

```ts
const getWeather: ToolSchema = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
      },
      required: ["city"],
    },
  },
};
const toolSchemas = [...TOOLS.map(toSchema), getWeather];
```

Add `ToolSchema` to the `import type` line from `./types.ts` at the top of the file.

Ask *"What's the weather in Paris?"*

<details>
<summary>Show answer</summary>

The model asks for `get_weather`, because the request said it exists.
`runTool` cannot find it in `TOOLS`, so the x-ray shows a red step: `there is no tool named "get_weather"`.
That error goes back to the model, which then tells you it cannot check the weather.
In real harnesses this happens when the tool list and the code that runs the tools drift apart, or when a model invents a tool name.
Undo the change when you are done.

</details>
