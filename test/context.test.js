import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as context from "../app/courses/harness/harness/06-context.ts";
import * as lesson6 from "../app/courses/harness/harness/06-agent.ts";
import { SYSTEM_PROMPT } from "../app/courses/harness/harness/04-agent.ts";
import { MODEL } from "../app/courses/harness/harness/config.ts";
import { WORKSPACE, installFakePage } from "./fake-desktop.js";
import { installCountingModel, neverAsked, recordingXRay, text } from "./fake-model.js";

let page;
let restore = () => {};
const say = (content, tokensIn, tokensOut = 10) => ({ message: text(content), tokensIn, tokensOut });
const model = (script) => {
  const fake = installCountingModel(script);
  restore = fake.restore;
  return fake;
};
const setNotes = (content) => page.disk.set(`${WORKSPACE}/AGENTS.md`, { kind: "file", text: content });

beforeEach(async () => {
  page = installFakePage();
  await globalThis.coursePage.prepareSandbox();
  setNotes("- Answer in British English.");
});
afterEach(() => {
  restore();
  delete globalThis.coursePage;
});

describe("lesson 6: the system prompt and project notes", () => {
  it("adds AGENTS.md after the harness's own instructions, once per conversation", async () => {
    const { requests } = model([say("Hello.", 100), say("Hi again.", 120)]);
    const { xray, steps } = recordingXRay();
    const harness = lesson6.createHarness();

    await harness.send("hi", xray, neverAsked);
    setNotes("- Changed after the first message.");
    await harness.send("hi again", xray, neverAsked);

    const system = requests[1].messages[0];
    assert.equal(system.role, "system");
    assert.ok(system.content.startsWith(SYSTEM_PROMPT));
    assert.ok(system.content.includes("- Answer in British English."));
    assert.ok(!system.content.includes("Changed after"));
    assert.equal(steps.filter((step) => step.why.startsWith("Loaded AGENTS.md")).length, 1);
  });

  it("works without a notes file", async () => {
    page.disk.delete(`${WORKSPACE}/AGENTS.md`);
    const { requests } = model([say("Hello.", 100)]);
    const { xray, steps } = recordingXRay();

    await lesson6.createHarness().send("hi", xray, neverAsked);

    assert.equal(requests[0].messages[0].content, SYSTEM_PROMPT);
    assert.match(steps[0].why, /No AGENTS.md/);
  });

  it("does not follow AGENTS.md when the agent turned it into a link", async () => {
    page.disk.set("/home/learner/.ssh/id_ed25519", { kind: "file", text: "secret" });
    page.disk.set(`${WORKSPACE}/AGENTS.md`, { kind: "link", target: "/home/learner/.ssh/id_ed25519" });
    const { requests } = model([say("Hello.", 100)]);
    const { xray, steps } = recordingXRay();

    await lesson6.createHarness().send("hi", xray, neverAsked);

    assert.equal(requests[0].messages[0].content, SYSTEM_PROMPT);
    assert.equal(steps[0].why, "AGENTS.md in the workspace is a link, so it isn't read. The system prompt is just the harness's own instructions.");
  });
});

describe("lesson 6: counting and summarizing", () => {
  it("counts the conversation as tokens read plus tokens written", () => {
    assert.equal(context.contextSize({ prompt_eval_count: 700, eval_count: 50 }), 750);
    assert.equal(context.contextSize({}), 0);
  });

  it("leaves the conversation alone under the limit, and says so in the x-ray", async () => {
    const { requests } = model([say("One.", 700), say("Two.", 800)]);
    const { xray, steps } = recordingXRay();
    const harness = lesson6.createHarness();

    await harness.send("first", xray, neverAsked);
    await harness.send("second", xray, neverAsked);

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].messages.map((message) => message.role), ["system", "user", "assistant", "user"]);
    const check = steps.find((step) => step.kind === "context").data;
    assert.deepEqual([check.limit, check.tokensBefore], [context.CONTEXT_LIMIT, 710]);
  });

  it("summarizes everything after the system prompt once the last call went over the limit", async () => {
    const { requests } = model([
      say("A long answer.", context.CONTEXT_LIMIT, 1),
      say("The user said first; the assistant gave a long answer.", 900),
      say("Carrying on from the summary.", 400),
    ]);
    const { xray, steps } = recordingXRay();
    const harness = lesson6.createHarness();

    await harness.send("first", xray, neverAsked);
    assert.equal(await harness.send("second", xray, neverAsked), "Carrying on from the summary.");

    const summaryRequest = requests[1];
    assert.equal(summaryRequest.tools, undefined);
    assert.deepEqual(summaryRequest.messages[0], { role: "system", content: context.SUMMARY_PROMPT });
    assert.equal(summaryRequest.messages[1].content, "user: first\n\nassistant: A long answer.");

    const afterSummary = requests[2].messages;
    assert.deepEqual(afterSummary.map((message) => message.role), ["system", "user"]);
    assert.match(afterSummary[0].content, /Summary of the conversation so far:\nThe user said first; the assistant gave a long answer\.$/);
    assert.equal(afterSummary[1].content, "second");

    const summarized = steps.find((step) => step.kind === "context").data;
    assert.equal(summarized.tokensBefore, context.CONTEXT_LIMIT + 1);
    assert.deepEqual(summarized.summarized, [
      { role: "user", content: "first" },
      { role: "assistant", content: "A long answer." },
    ]);
    assert.equal(summarized.summary, "The user said first; the assistant gave a long answer.");
    assert.equal(steps.at(-1).why, `After summarizing, the conversation is 410 tokens, down from ${context.count(context.CONTEXT_LIMIT + 1)}.`);
  });

  it("replaces the earlier summary with a summary of it and the newer messages", async () => {
    const { requests } = model([say("One.", context.CONTEXT_LIMIT, 1), say("First summary.", 50), say("Two.", context.CONTEXT_LIMIT, 1), say("Second summary.", 50), say("Three.", 300)]);
    const harness = lesson6.createHarness();

    await harness.send("first", recordingXRay().xray, neverAsked);
    await harness.send("second", recordingXRay().xray, neverAsked);
    await harness.send("third", recordingXRay().xray, neverAsked);

    assert.equal(requests[3].messages[1].content, "summary of the earlier conversation: First summary.\n\nuser: second\n\nassistant: Two.");
    const system = requests[4].messages[0].content;
    assert.ok(system.startsWith(SYSTEM_PROMPT));
    assert.match(system, /Summary of the conversation so far:\nSecond summary\.$/);
    assert.ok(!system.includes("First summary."));
  });

  it("puts tool calls and tool results into the text it asks the model to summarize", async () => {
    const { requests } = model([say("Summary.", 10)]);
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: "read it" },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: "a.txt" } } }] },
      { role: "tool", tool_name: "read_file", content: "hello" },
    ];

    const result = await context.summarizeIfNeeded(messages, context.CONTEXT_LIMIT + 1, MODEL, recordingXRay().xray);

    assert.equal(requests[0].messages[1].content, 'user: read it\n\nassistant: asked for read_file({"path":"a.txt"})\n\ntool result from read_file: hello');
    assert.deepEqual(result, [{ role: "system", content: "sys\n\nSummary of the conversation so far:\nSummary." }]);
  });
});

describe("lesson 6: model choice", () => {
  it("sends every request, the summary request included, to the model it was created with", async () => {
    const { requests } = model([say("One.", context.CONTEXT_LIMIT + 5), say("Summary.", 100), say("Two.", 300)]);
    const harness = lesson6.createHarness({ model: "qwen3.5:4b" });

    await harness.send("first", recordingXRay().xray, neverAsked);
    await harness.send("second", recordingXRay().xray, neverAsked);

    assert.deepEqual(requests.map((request) => request.model), ["qwen3.5:4b", "qwen3.5:4b", "qwen3.5:4b"]);
  });

  it("uses MODEL from config.ts when no model is chosen", async () => {
    const { requests } = model([say("One.", 100)]);
    await lesson6.createHarness().send("first", recordingXRay().xray, neverAsked);
    assert.equal(requests[0].model, MODEL);
  });
});
