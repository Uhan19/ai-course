import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as harnessSandbox from "../app/courses/harness/harness/04-sandbox.ts";
import { SANDBOX_TOOLS } from "../app/courses/harness/harness/04-tools.ts";
import * as lesson4 from "../app/courses/harness/harness/04-agent.ts";
import {
  DOCKER_IMAGE_ARGS,
  DOCKER_INFO_ARGS,
  SANDBOX_IMAGE,
  SANDBOX_LIMITS,
  checkDocker,
  dockerArgs,
  dockerSetupSteps,
  isSandboxKillArgs,
  isSandboxRunArgs,
  readWorkspaceFile,
  resetWorkspace,
  sandboxRequest,
  workspacePath,
  writeWorkspaceFile,
} from "../app/courses/harness/js/sandbox.js";
import { DOCKER, SEED, WORKSPACE, createFakeDesktop, installFakePage } from "./fake-desktop.js";
import { installFakeModel, neverAsked, recordingXRay, text, toolCalls } from "./fake-model.js";

const tool = (name) => SANDBOX_TOOLS.find((candidate) => candidate.name === name);
const pairs = (args, flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
const originalTimeout = harnessSandbox.LIMITS.timeoutMs;
let restoreModel = () => {};

afterEach(() => {
  restoreModel();
  restoreModel = () => {};
  harnessSandbox.LIMITS.timeoutMs = originalTimeout;
  delete globalThis.coursePage;
});

describe("lesson 4: the locked docker command the page builds", () => {
  it("puts every lock on the container", () => {
    const args = dockerArgs("harness-sandbox-0000abcd", WORKSPACE, ["ls"]);
    assert.deepEqual(args.slice(0, 2), ["run", "--rm"]);
    assert.deepEqual(pairs(args, "--network"), ["none"]);
    assert.deepEqual(pairs(args, "--user"), ["1000:1000"]);
    assert.ok(args.includes("--read-only"));
    assert.deepEqual(pairs(args, "--volume"), [`${WORKSPACE}:/workspace`]);
    assert.deepEqual(pairs(args, "--cpus"), [SANDBOX_LIMITS.cpus]);
    assert.deepEqual(pairs(args, "--memory"), [SANDBOX_LIMITS.memory]);
    assert.deepEqual(pairs(args, "--pids-limit"), [String(SANDBOX_LIMITS.processes)]);
    assert.deepEqual(pairs(args, "--cap-drop"), ["ALL"]);
    assert.deepEqual(pairs(args, "--security-opt"), ["no-new-privileges"]);
    assert.deepEqual(args.slice(-2), [SANDBOX_IMAGE, "ls"]);
    assert.ok(!args.includes("--interactive"));
  });

  it("only mounts the workspace folder", () => {
    const args = dockerArgs("harness-sandbox-0000abcd", WORKSPACE, ["ls"]);
    assert.equal(args.filter((arg) => arg === "--volume" || arg === "-v" || arg === "--mount").length, 1);
  });

  it("keeps flags the harness sends after the image, where docker treats them as the command", async () => {
    const page = installFakePage();
    await harnessSandbox.runInSandbox(["--network", "host", "ls"], recordingXRay().xray);
    const [run] = page.runs();
    assert.deepEqual(pairs(run.args, "--network"), ["none", "host"]);
    assert.ok(run.args.indexOf(SANDBOX_IMAGE) < run.args.lastIndexOf("--network"));
  });

  it("refuses requests that aren't a list of strings, and caps the timeout and output", () => {
    assert.throws(() => sandboxRequest({ command: "rm -rf /" }), /non-empty list of strings/);
    assert.throws(() => sandboxRequest({ command: [] }), /non-empty list of strings/);
    assert.throws(() => sandboxRequest({ command: ["ls", 3] }), /non-empty list of strings/);
    const request = sandboxRequest({ command: ["ls"], timeoutMs: 999_999, maxOutputChars: 1e9 });
    assert.equal(request.timeoutMs, SANDBOX_LIMITS.timeoutMs);
    assert.equal(request.maxOutputChars, SANDBOX_LIMITS.maxOutputChars);
    assert.equal(sandboxRequest({ command: ["ls"], timeoutMs: 2_000 }).timeoutMs, 2_000);
  });

  it("recognizes only its own docker run and kill commands", () => {
    const run = dockerArgs("harness-sandbox-0000abcd", WORKSPACE, ["ls"]);
    assert.equal(isSandboxRunArgs(run, WORKSPACE), true);
    assert.equal(isSandboxRunArgs(dockerArgs("harness-sandbox-0000abcd", WORKSPACE, ["sh"], true), WORKSPACE), true);
    assert.equal(isSandboxRunArgs(run.filter((arg) => arg !== "--read-only"), WORKSPACE), false);
    assert.equal(isSandboxRunArgs(dockerArgs("harness-sandbox-0000abcd", "/", ["ls"]), WORKSPACE), false);
    assert.equal(isSandboxRunArgs(dockerArgs("harness-sandbox-0000abcd", WORKSPACE, []), WORKSPACE), false);
    assert.equal(isSandboxKillArgs(["kill", "harness-sandbox-0000abcd"]), true);
    assert.equal(isSandboxKillArgs(["kill", "postgres"]), false);
  });
});

describe("lesson 4: the sandbox tools", () => {
  it("runs a tool as docker run, and shows the exact command in the x-ray", async () => {
    const page = installFakePage({ answer: () => ({ stdout: "hello.py\n" }) });
    const { xray, steps } = recordingXRay();

    assert.equal(await tool("list_files").run({}, xray), "hello.py\n");

    const [call] = page.runs();
    assert.equal(call.file, DOCKER);
    assert.deepEqual(call.args.slice(-5), [SANDBOX_IMAGE, "ls", "-la", "--", "."]);
    const step = steps.find((candidate) => candidate.kind === "sandbox");
    assert.deepEqual(step.data.argv, ["docker", ...call.args]);
    assert.equal(step.data.stdout, "hello.py\n");
    assert.equal(step.data.exitCode, 0);
    assert.equal(step.data.timedOut, false);
    assert.equal(step.why, "Ran the command in a fresh locked container. It finished normally (exit code 0).");
  });

  it("sends file content to write_file through the container's input", async () => {
    const page = installFakePage();
    assert.equal(await tool("write_file").run({ path: "a.txt", content: "hi\n" }, recordingXRay().xray), "Wrote 3 characters to a.txt.");
    const [call] = page.runs();
    assert.ok(call.args.includes("--interactive"));
    assert.deepEqual(call.args.slice(-2), ["sh", "a.txt"]);
    assert.equal(call.stdin, "hi\n");
  });

  it("turns a failed file command into an error, and a failed shell command into a normal result", async () => {
    installFakePage({ answer: () => ({ stderr: "cat: can't open 'nope.txt': No such file or directory\n", exitCode: 1 }) });
    const { xray, steps } = recordingXRay();

    await assert.rejects(tool("read_file").run({ path: "nope.txt" }, xray), /cat: can't open 'nope.txt'/);
    assert.equal(await tool("run_command").run({ command: "cat nope.txt" }, xray), "Exit code: 1\nErrors:\ncat: can't open 'nope.txt': No such file or directory\n");
    assert.deepEqual(
      steps.filter((step) => step.kind === "sandbox").map((step) => step.why),
      ["Ran the command in a fresh locked container. It failed with exit code 1.", "Ran the command in a fresh locked container. It failed with exit code 1."],
    );
  });

  it("kills the container when a command runs past the harness's timeout", async () => {
    harnessSandbox.LIMITS.timeoutMs = 30;
    const page = installFakePage({ answer: () => ({ hang: true }) });
    const { xray, steps } = recordingXRay();

    assert.equal(await tool("run_command").run({ command: "sleep 30" }, xray), "Timed out: the command was stopped after 0.03 s.");

    const run = page.runs()[0];
    const name = run.args[run.args.indexOf("--name") + 1];
    assert.ok(page.calls.some((call) => call.args?.[0] === "kill" && call.args[1] === name));
    assert.equal(steps.find((step) => step.kind === "sandbox").data.timedOut, true);
  });

  it("cuts very long output so it cannot flood the model", async () => {
    installFakePage({ answer: () => ({ stdout: ["x".repeat(harnessSandbox.MAX_OUTPUT_CHARS), "y".repeat(50)] }) });
    const output = await tool("read_file").run({ path: "big.txt" }, recordingXRay().xray);
    assert.equal(output, `${"x".repeat(harnessSandbox.MAX_OUTPUT_CHARS)}\n[... cut 50 more characters]`);
  });
});

describe("lesson 4: the workspace folder", () => {
  it("lives in the home folder", async () => {
    assert.equal(await workspacePath(createFakeDesktop().desktop), WORKSPACE);
  });

  it("fills a new workspace with the starting files before the first command", async () => {
    const page = installFakePage();
    await harnessSandbox.ensureSandboxReady();
    assert.deepEqual(page.prepared, [true]);
    assert.equal(page.disk.get(`${WORKSPACE}/AGENTS.md`).text, SEED["AGENTS.md"]);
  });

  it("leaves an existing workspace as it is, so files the agent deleted stay deleted", async () => {
    const page = installFakePage();
    await harnessSandbox.ensureSandboxReady();
    page.disk.delete(`${WORKSPACE}/hello.py`);
    await harnessSandbox.ensureSandboxReady();
    assert.deepEqual(page.prepared, [true, false]);
    assert.equal(page.disk.has(`${WORKSPACE}/hello.py`), false);
  });

  it("resets by moving the folder to the Trash and putting the starting files back", async () => {
    const { desktop, disk } = createFakeDesktop();
    disk.set(WORKSPACE, { kind: "dir" });
    disk.set(`${WORKSPACE}/primes.py`, { kind: "file", text: "print(2)\n" });
    await resetWorkspace(desktop, WORKSPACE, SEED);
    assert.equal(disk.has(`${WORKSPACE}/primes.py`), false);
    assert.equal(disk.get(`${WORKSPACE}/hello.py`).text, SEED["hello.py"]);
  });
});

describe("lesson 6: reading a workspace file outside the sandbox", () => {
  const withFile = (kind, extra = {}) => {
    const fake = createFakeDesktop();
    fake.disk.set(`${WORKSPACE}/AGENTS.md`, { kind, text: "- Answer in British English.\n", ...extra });
    fake.disk.set("/home/learner/.ssh/id_ed25519", { kind: "file", text: "not for the model" });
    return fake.desktop;
  };

  it("reads a regular file", async () => {
    assert.equal(await readWorkspaceFile(withFile("file"), WORKSPACE, "AGENTS.md"), "- Answer in British English.\n");
  });

  it("refuses a link the agent planted to a file outside the workspace", async () => {
    const desktop = withFile("link", { target: "/home/learner/.ssh/id_ed25519" });
    await assert.rejects(readWorkspaceFile(desktop, WORKSPACE, "AGENTS.md"), { code: "ELINK" });
    await assert.rejects(writeWorkspaceFile(desktop, WORKSPACE, "AGENTS.md", "x"), /isn't a regular file/);
  });

  it("refuses something that isn't a regular file, such as a named pipe", async () => {
    await assert.rejects(readWorkspaceFile(withFile("fifo"), WORKSPACE, "AGENTS.md"), /is not a regular file/);
  });

  it("says ENOENT when there is no such file", async () => {
    await assert.rejects(readWorkspaceFile(createFakeDesktop().desktop, WORKSPACE, "AGENTS.md"), { code: "ENOENT" });
  });

  it("only reads plain file names at the top of the workspace", async () => {
    for (const name of ["../.ssh/id_ed25519", "/etc/passwd", "..", "notes/a.md", ""]) {
      await assert.rejects(readWorkspaceFile(withFile("file"), WORKSPACE, name), /Only a file at the top of the workspace/, name);
    }
  });
});

describe("lesson 4: checking Docker", () => {
  const desktopWith = (answers, dockerOnPath = true) =>
    createFakeDesktop({ dockerOnPath, answer: (args) => answers[args[0]] ?? {} }).desktop;

  it("is ready when the daemon answers and the image is there", async () => {
    const fake = createFakeDesktop({ answer: (args) => (args[0] === "info" ? { stdout: "29.0.1\n" } : {}) });
    assert.deepEqual(await checkDocker(fake.desktop), { state: "ready", docker: DOCKER, version: "29.0.1" });
    assert.deepEqual(fake.calls.filter((call) => call.args).map((call) => call.args), [DOCKER_INFO_ARGS, DOCKER_IMAGE_ARGS]);
  });

  it("explains how to install Docker when it is missing", async () => {
    const check = await checkDocker(desktopWith({}, false));
    assert.equal(check.state, "missing");
    assert.deepEqual(
      dockerSetupSteps(check).map((step) => step.command),
      ["brew install --cask docker-desktop", "open -a Docker", `docker pull ${SANDBOX_IMAGE}`],
    );
  });

  it("explains how to start Docker when it is not running", async () => {
    const check = await checkDocker(desktopWith({ info: { exitCode: 1 } }));
    assert.equal(check.state, "stopped");
    assert.equal(dockerSetupSteps(check)[0].problem, "Docker is installed but not running.");
    assert.equal(dockerSetupSteps(check)[0].command, "open -a Docker");
  });

  it("explains how to pull the image when it is missing", async () => {
    const check = await checkDocker(desktopWith({ image: { exitCode: 1 } }));
    assert.equal(check.state, "no-image");
    assert.deepEqual(dockerSetupSteps(check).map((step) => step.command), [`docker pull ${SANDBOX_IMAGE}`]);
    assert.deepEqual(dockerSetupSteps({ state: "ready" }), []);
  });
});

describe("lesson 4: the agent loop with sandbox tools", () => {
  beforeEach(() => {
    harnessSandbox.LIMITS.timeoutMs = originalTimeout;
  });

  it("prepares the sandbox, offers the four sandbox tools and sends the command output back to the model", async () => {
    const page = installFakePage({ answer: () => ({ stdout: "Hello from inside the sandbox!\n" }) });
    const model = installFakeModel([toolCalls(["run_command", { command: "python3 hello.py" }]), text("It printed a greeting.")]);
    restoreModel = model.restore;
    const { xray, steps } = recordingXRay();

    assert.equal(await lesson4.createHarness().send("Run hello.py", xray, neverAsked), "It printed a greeting.");

    assert.deepEqual(page.prepared, [true]);
    assert.deepEqual(model.requests[0].tools.map((schema) => schema.function.name), ["list_files", "read_file", "write_file", "run_command"]);
    assert.deepEqual(model.requests[1].messages.at(-1), {
      role: "tool",
      tool_name: "run_command",
      tool_call_id: "call_0",
      content: "Exit code: 0\nOutput:\nHello from inside the sandbox!\n",
    });
    assert.deepEqual(steps.map((step) => step.kind), ["request", "response", "sandbox", "tool", "request", "response"]);
  });
});
