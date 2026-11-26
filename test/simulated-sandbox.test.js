import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SANDBOX_TOOLS } from "../app/courses/harness/harness/04-tools.ts";
import { sandboxRequest, WRITE_FILE_SCRIPT } from "../app/courses/harness/js/sandbox.js";
import { createSimulatedWorkspace, parseScript } from "../app/courses/harness/js/simulated-sandbox.js";
import { SEED } from "./fake-desktop.js";
import { recordingXRay } from "./fake-model.js";

function workspace() {
  const sim = createSimulatedWorkspace({ now: () => new Date("2026-11-26T09:30:00Z") });
  sim.seed(SEED);
  const run = (command, { stdin, timeoutMs = 10_000, maxOutputChars = 8_000 } = {}) => sim.run({ command, stdin, timeoutMs, maxOutputChars });
  const sh = (script, options) => run(["sh", "-c", script], options);
  return { sim, run, sh };
}

describe("the simulated sandbox", () => {
  it("lists the starting files the way ls -la does, and marks every run as simulated", async () => {
    const { run } = workspace();
    const result = await run(["ls", "-la", "--", "."]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.simulated, true);
    assert.deepEqual(result.argv, ["ls", "-la", "--", "."]);
    for (const name of Object.keys(SEED)) assert.match(result.stdout, new RegExp(` ${name.replace(".", "\\.")}\\n`));
    assert.match(result.stdout, /^total \d+\n/);
  });

  it("reads files, and fails like cat does for a missing one", async () => {
    const { run } = workspace();
    assert.equal((await run(["cat", "--", "hello.py"])).stdout, SEED["hello.py"]);
    const missing = await run(["cat", "--", "nope.txt"]);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stderr, "cat: can't open 'nope.txt': No such file or directory\n");
  });

  it("writes a file through write_file's own command, creating folders on the way", async () => {
    const { run, sim } = workspace();
    const written = await run(["sh", "-c", WRITE_FILE_SCRIPT, "sh", "notes/todo.txt"], { stdin: "milk\n" });
    assert.equal(written.exitCode, 0);
    assert.equal(sim.read("AGENTS.md"), SEED["AGENTS.md"]);
    assert.equal((await run(["cat", "--", "notes/todo.txt"])).stdout, "milk\n");
  });

  it("counts coffee both ways the lesson 7 answer key does", async () => {
    const { sh } = workspace();
    assert.equal((await sh("grep -io coffee rfc2324-coffee-pot.txt | wc -l")).stdout, "79\n");
    assert.equal((await sh("grep -iow coffee rfc2324-coffee-pot.txt | wc -l")).stdout, "76\n");
    assert.equal((await sh("wc -l rfc2324-coffee-pot.txt")).stdout, `${SEED["rfc2324-coffee-pot.txt"].split("\n").length - 1} rfc2324-coffee-pot.txt\n`);
  });

  it("runs && and ; lists, pipes, redirects and cd", async () => {
    const { sh } = workspace();
    const result = await sh("mkdir -p out && echo hi > out/a.txt && cd out && pwd && cat a.txt; ls nope 2>&1; echo done");
    assert.equal(result.stdout, "/workspace/out\nhi\nls: nope: No such file or directory\ndone\n");
    assert.equal(result.stderr, "");
  });

  it("answers exit code 127 for commands that need the real sandbox", async () => {
    const { sh } = workspace();
    const result = await sh("python3 hello.py");
    assert.equal(result.exitCode, 127);
    assert.match(result.stderr, /^sh: python3: not available in the simulated sandbox\. This command needs the real Docker sandbox, which runs with the local model in the installed app\./);
  });

  it("tells the model through run_command that Python needs the real Docker sandbox in the installed app", async () => {
    const { sim } = workspace();
    globalThis.coursePage = { runInSandbox: (raw) => sim.run(sandboxRequest(raw)) };
    try {
      const runCommand = SANDBOX_TOOLS.find((tool) => tool.name === "run_command");
      const { xray, steps } = recordingXRay();
      const result = await runCommand.run({ command: "python3 -c 'print(2 ** 100)'" }, xray);
      assert.match(result, /^Exit code: 127\nErrors:\nsh: python3: not available in the simulated sandbox\. This command needs the real Docker sandbox, which runs with the local model in the installed app\./);
      assert.equal(steps[0].data.simulated, true);
      assert.match(steps[0].why, /^Simulated the command in this page, not in Docker\./);
    } finally {
      delete globalThis.coursePage;
    }
  });

  it("cannot write outside the workspace", async () => {
    const { sh } = workspace();
    const result = await sh("echo x > /etc/hacked");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Read-only file system/);
    assert.equal((await sh("cat ../../etc/hacked")).exitCode, 1);
  });

  it("stops a command at the timeout", async () => {
    const { sh } = workspace();
    const result = await sh("sleep 5", { timeoutMs: 30 });
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, null);
    assert.ok(result.elapsedMs < 1_000);
  });

  it("cuts long output like the real sandbox", async () => {
    const { run } = workspace();
    const result = await run(["cat", "rfc2324-coffee-pot.txt"], { maxOutputChars: 100 });
    assert.match(result.stdout, /^[\s\S]{100}\n\[\.\.\. cut \d+ more characters\]$/);
  });

  it("removes folders only with -r, and keeps quoted text as it is", async () => {
    const { sh } = workspace();
    await sh("mkdir notes && touch notes/a");
    assert.equal((await sh("rm notes")).exitCode, 1);
    assert.equal((await sh("rm -r notes && ls")).stdout.includes("notes"), false);
    assert.deepEqual(parseScript("echo '$1 | x' \"$1\"", ["sh", "v"])[0].pipeline[0].argv, ["echo", "$1 | x", "v"]);
  });

  it("puts the starting files back on a new seed", async () => {
    const { sh, sim } = workspace();
    await sh("rm hello.py");
    sim.seed(SEED);
    assert.equal(sim.read("hello.py"), SEED["hello.py"]);
  });
});
