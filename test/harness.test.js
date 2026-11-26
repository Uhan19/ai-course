import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as lesson1 from "../app/courses/harness/harness/01-talk-to-model.ts";
import * as lesson2 from "../app/courses/harness/harness/02-chat-loop.ts";
import * as lesson3 from "../app/courses/harness/harness/03-agent.ts";
import { TOOLS } from "../app/courses/harness/harness/03-tools.ts";
import { installFakeModel, recordingXRay, stubFetch, text, toolCalls } from "./fake-model.js";

let restore = () => {};
const fake = (script) => {
  const model = installFakeModel(script);
  restore = model.restore;
  return model;
};
afterEach(() => restore());

describe("lesson 1: one request, no memory", () => {
  it("sends only the newest user message every time", async () => {
    const { requests } = fake([text("Hi Sam."), text("I don't know your name.")]);
    const { xray } = recordingXRay();
    const harness = lesson1.createHarness();

    assert.equal(await harness.send("My name is Sam.", xray), "Hi Sam.");
    await harness.send("What is my name?", xray);

    assert.deepEqual(requests[1].messages, [{ role: "user", content: "What is my name?" }]);
  });

  it("throws a clear error when Ollama answers with an HTTP error", async () => {
    restore = stubFetch(async () => new Response('{"error":"model not found"}', { status: 404 }));
    const { xray } = recordingXRay();
    await assert.rejects(lesson1.createHarness().send("hi", xray), { message: 'Ollama answered 404: {"error":"model not found"}' });
  });
});

describe("lesson 2: the chat loop resends history", () => {
  it("sends the system prompt and every earlier message", async () => {
    const { requests } = fake([text("Hi Sam."), text("Your name is Sam.")]);
    const { xray } = recordingXRay();
    const harness = lesson2.createHarness();

    await harness.send("My name is Sam.", xray);
    await harness.send("What is my name?", xray);

    assert.deepEqual(
      requests[1].messages.map((message) => [message.role, message.content]),
      [
        ["system", lesson2.SYSTEM_PROMPT],
        ["user", "My name is Sam."],
        ["assistant", "Hi Sam."],
        ["user", "What is my name?"],
      ],
    );
  });
});

describe("lesson 3: the agent loop", () => {
  it("returns plain text without running tools, and always offers the tools", async () => {
    const { requests } = fake([text("Hello!")]);
    const { xray, steps } = recordingXRay();

    assert.equal(await lesson3.createHarness().send("hi", xray), "Hello!");
    assert.equal(requests.length, 1);
    assert.deepEqual(
      requests[0].tools.map((tool) => tool.function.name),
      TOOLS.map((tool) => tool.name),
    );
    assert.deepEqual(steps.map((step) => step.kind), ["request", "response"]);
  });

  it("runs several tool calls from one reply, in order, then sends all results back", async () => {
    const { requests } = fake([
      toolCalls(["calculator", { expression: "17 * 23" }], ["word_count", { text: "one two three" }]),
      text("391, and 3 words."),
    ]);
    const { xray, steps } = recordingXRay();

    assert.equal(await lesson3.createHarness().send("Do both", xray), "391, and 3 words.");

    const toolMessages = requests[1].messages.filter((message) => message.role === "tool");
    assert.deepEqual(toolMessages, [
      { role: "tool", tool_name: "calculator", tool_call_id: "call_0", content: "391" },
      { role: "tool", tool_name: "word_count", tool_call_id: "call_1", content: "3" },
    ]);
    assert.deepEqual(steps.map((step) => step.kind), ["request", "response", "tool", "tool", "request", "response"]);
  });

  it("turns a tool that throws into an error message the model can read", async () => {
    const { requests } = fake([toolCalls(["calculator", { expression: "sqrt(2)" }]), text("I can't do square roots.")]);
    const { xray, steps } = recordingXRay();

    assert.equal(await lesson3.createHarness().send("sqrt 2?", xray), "I can't do square roots.");

    const toolMessage = requests[1].messages.at(-1);
    assert.equal(toolMessage.role, "tool");
    assert.match(toolMessage.content, /^Error: Only numbers/);
    const toolStep = steps.find((step) => step.kind === "tool");
    assert.equal(toolStep.data.name, "calculator");
    assert.equal(toolStep.data.error, toolMessage.content);
    assert.match(toolStep.why, /threw an error/);
  });

  it("tells the model when it asks for a tool that does not exist", async () => {
    const { requests } = fake([toolCalls(["get_weather", { city: "Paris" }]), text("I can't check the weather.")]);
    const { xray, steps } = recordingXRay();

    await lesson3.createHarness().send("Weather?", xray);

    const toolMessage = requests[1].messages.at(-1);
    assert.equal(toolMessage.role, "tool");
    assert.equal(toolMessage.tool_name, "get_weather");
    assert.equal(toolMessage.content, 'Error: there is no tool named "get_weather". Available tools: get_current_time, calculator, word_count.');
    assert.match(steps.find((step) => step.kind === "tool").why, /does not exist/);
  });

  it("stops at the turn limit when the model keeps asking for tools", async () => {
    const endless = Array.from({ length: lesson3.MAX_MODEL_CALLS + 1 }, () => toolCalls(["get_current_time", {}]));
    const { requests } = fake(endless);
    const { xray, steps } = recordingXRay();

    const answer = await lesson3.createHarness().send("Loop forever", xray);

    assert.equal(requests.length, lesson3.MAX_MODEL_CALLS);
    assert.ok(answer.includes(`hit its limit of model calls (MAX_MODEL_CALLS = ${lesson3.MAX_MODEL_CALLS})`));
    assert.deepEqual(steps.at(-1), {
      kind: "note",
      why: `Stopped: hit the limit (MAX_MODEL_CALLS = ${lesson3.MAX_MODEL_CALLS}) before the model gave a final answer.`,
    });
  });

  it("keeps the conversation, including tool results, for the next message", async () => {
    const { requests } = fake([toolCalls(["word_count", { text: "a b" }]), text("2 words."), text("Still 2.")]);
    const { xray } = recordingXRay();
    const harness = lesson3.createHarness();

    await harness.send("Count: a b", xray);
    await harness.send("And again?", xray);

    assert.deepEqual(
      requests[2].messages.map((message) => message.role),
      ["system", "user", "assistant", "tool", "assistant", "user"],
    );
  });
});

describe("lesson 3 tools", () => {
  const run = (name, args) => TOOLS.find((tool) => tool.name === name).run(args);

  it("calculator does arithmetic and refuses anything else", () => {
    assert.equal(run("calculator", { expression: "(17 * 23) / 4" }), "97.75");
    assert.throws(() => run("calculator", { expression: "process.exit()" }), /Only numbers/);
    assert.throws(() => run("calculator", { expression: "1 / 0" }), /not a finite number/);
  });

  it("word_count counts words", () => {
    assert.equal(run("word_count", { text: "  the quick  brown fox " }), "4");
    assert.equal(run("word_count", { text: "" }), "0");
  });

  it("get_current_time rejects an unknown time zone", () => {
    assert.match(run("get_current_time", { timezone: "Asia/Tokyo" }), /\d{4}/);
    assert.throws(() => run("get_current_time", { timezone: "Mars/Olympus_Mons" }), RangeError);
  });
});
