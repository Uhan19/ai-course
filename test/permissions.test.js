import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULE, decide } from "../app/courses/harness/harness/05-policy.ts";
import * as lesson5 from "../app/courses/harness/harness/05-agent.ts";
import { installFakePage } from "./fake-desktop.js";
import { installFakeModel, recordingXRay, text, toolCalls } from "./fake-model.js";

let restore = () => {};
afterEach(() => {
  restore();
  delete globalThis.coursePage;
});
const model = (script) => {
  const fake = installFakeModel(script);
  restore = fake.restore;
  return fake;
};
const page = () => installFakePage({ answer: (args) => (args[0] === "run" ? { stdout: "ran\n" } : {}) });

function answering(approved) {
  const asked = [];
  const askUser = async (request) => {
    asked.push(request);
    return approved;
  };
  return { asked, askUser };
}

describe("lesson 5: the policy", () => {
  it("allows reading, asks about writing and commands", () => {
    assert.equal(decide("list_files", {}).decision, "allow");
    assert.equal(decide("read_file", { path: "a" }).decision, "allow");
    assert.equal(decide("write_file", { path: "a", content: "" }).decision, "ask");
    assert.equal(decide("run_command", { command: "python3 hello.py" }).decision, "ask");
  });

  it("denies recursive deletes before the general command rule can ask", () => {
    for (const command of ["rm -rf /workspace/*", "rm -r notes", "cd x && rm -fr .", "rm --recursive notes", "rm -f -r x", "rm -v -R notes", "rm -f --recursive x"]) {
      assert.equal(decide("run_command", { command }).decision, "deny", command);
    }
    for (const command of ["rm notes.txt", "rm -f notes.txt", "rm --force notes.txt"]) {
      assert.equal(decide("run_command", { command }).decision, "ask", command);
    }
  });

  it("denies a tool that no rule mentions", () => {
    assert.equal(decide("count_lines", { path: "a" }), DEFAULT_RULE);
    assert.equal(DEFAULT_RULE.decision, "deny");
  });
});

describe("lesson 5: the permission check in the agent loop", () => {
  it("runs an allowed tool without asking, and records the policy's decision", async () => {
    const sandbox = page();
    model([toolCalls(["list_files", {}]), text("Four files.")]);
    const { xray, steps } = recordingXRay();
    const { asked, askUser } = answering(false);

    assert.equal(await lesson5.createHarness().send("List files", xray, askUser), "Four files.");

    assert.equal(asked.length, 0);
    assert.equal(sandbox.runs().length, 1);
    const check = steps.find((step) => step.kind === "permission").data;
    assert.deepEqual([check.tool, check.decision, check.decidedBy], ["list_files", "allow", "policy"]);
  });

  it("asks you, then runs the tool when you approve", async () => {
    const sandbox = page();
    const { requests } = model([toolCalls(["write_file", { path: "a.txt", content: "hi" }]), text("Done.")]);
    const { xray, steps } = recordingXRay();
    const { asked, askUser } = answering(true);

    await lesson5.createHarness().send("Write a.txt", xray, askUser);

    assert.deepEqual(asked, [{ tool: "write_file", arguments: { path: "a.txt", content: "hi" }, action: "write 2 characters to a.txt", rule: "Writing a file changes your files." }]);
    assert.equal(sandbox.runs().length, 1);
    assert.equal(requests[1].messages.at(-1).content, "Wrote 2 characters to a.txt.");
    assert.deepEqual(
      steps.filter((step) => step.kind === "permission").map(({ data }) => [data.decision, data.decidedBy]),
      [
        ["ask", "policy"],
        ["allow", "you"],
      ],
    );
  });

  it("does not run the tool when you deny, and sends the denial back to the model", async () => {
    const sandbox = page();
    const { requests } = model([toolCalls(["run_command", { command: "python3 hello.py" }]), text("Okay, I won't run it.")]);
    const { xray, steps } = recordingXRay();

    assert.equal(await lesson5.createHarness().send("Run hello.py", xray, answering(false).askUser), "Okay, I won't run it.");

    assert.equal(sandbox.runs().length, 0);
    assert.deepEqual(requests[1].messages.at(-1), { role: "tool", tool_name: "run_command", tool_call_id: "call_0", content: lesson5.DENIED_BY_YOU });
    const last = steps.filter((step) => step.kind === "permission").at(-1).data;
    assert.deepEqual([last.decision, last.decidedBy], ["deny", "you"]);
    assert.ok(!steps.some((step) => step.kind === "tool"));
  });

  it("denies by policy without asking you, and tells the model the reason", async () => {
    const sandbox = page();
    const { requests } = model([toolCalls(["run_command", { command: "rm -rf /workspace/*" }]), text("I am not allowed to.")]);
    const { xray, steps } = recordingXRay();
    const { asked, askUser } = answering(true);

    await lesson5.createHarness().send("Delete everything", xray, askUser);

    assert.equal(asked.length, 0);
    assert.equal(sandbox.runs().length, 0);
    assert.equal(requests[1].messages.at(-1).content, "Denied by the harness policy: Deleting folders with rm -r is never allowed.");
    const check = steps.find((step) => step.kind === "permission").data;
    assert.deepEqual([check.decision, check.decidedBy], ["deny", "policy"]);
  });

  it("checks each tool call of one reply on its own", async () => {
    page();
    const { requests } = model([toolCalls(["read_file", { path: "hello.py" }], ["run_command", { command: "python3 hello.py" }]), text("Read it, but could not run it.")]);
    const { asked, askUser } = answering(false);

    await lesson5.createHarness().send("Read and run hello.py", recordingXRay().xray, askUser);

    assert.deepEqual(asked.map((request) => request.tool), ["run_command"]);
    assert.deepEqual(
      requests[1].messages.filter((message) => message.role === "tool").map((message) => message.content),
      ["ran\n", lesson5.DENIED_BY_YOU],
    );
  });
});
