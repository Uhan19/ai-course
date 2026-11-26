import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PREVIEW_HOME, createNodeDesktop } from "../dev/node-desktop.mjs";
import { SANDBOX_LIMITS, checkDocker, ensureWorkspace, runDocker, sandboxRequest, workspacePath } from "../app/courses/harness/js/sandbox.js";

// Runs real commands in the real container, through the page's own sandbox code. Needs Docker: npm run test:docker
const home = join(PREVIEW_HOME, `locks-${process.pid}`);
const desktop = createNodeDesktop({ home });
let docker;
let workspace;
const sh = (script, timeoutMs = SANDBOX_LIMITS.timeoutMs) => runDocker(desktop, { docker, workspace }, sandboxRequest({ command: ["sh", "-c", script], timeoutMs }));

before(async () => {
  const check = await checkDocker(desktop);
  if (check.state !== "ready") throw new Error(`Docker isn't ready (${check.state}).`);
  docker = check.docker;
  await mkdir(join(home, ".ssh"), { recursive: true });
  await writeFile(join(home, ".ssh", "id_ed25519"), "not for the sandbox\n");
  workspace = await workspacePath(desktop);
  await ensureWorkspace(desktop, workspace, { "hello.py": 'print("hi")\n' });
});
after(() => rm(home, { recursive: true, force: true }));

describe("the real sandbox keeps its locks", () => {
  it("has no network", async () => {
    const run = await sh("python3 -c \"import urllib.request; urllib.request.urlopen('http://example.com', timeout=3)\"");
    assert.notEqual(run.exitCode, 0);
    assert.match(run.stderr, /URLError|Temporary failure|Name or service not known|Network is unreachable|Try again/);
  });

  it("has no network routes at all", async () => {
    const run = await sh("tail -n +2 /proc/net/route");
    assert.equal(run.exitCode, 0);
    assert.equal(run.stdout.trim(), "");
  });

  it("runs as an ordinary user, not root", async () => {
    assert.deepEqual((await sh("id -u; id -g")).stdout.trim().split("\n"), ["1000", "1000"]);
  });

  it("cannot write outside the workspace", async () => {
    const run = await sh("touch /etc/hacked; touch /usr/hacked; touch /hacked; echo done");
    assert.equal(run.stderr.match(/Read-only file system/g)?.length, 3);
  });

  it("can write inside the workspace, and the file lands in the workspace folder", async () => {
    const run = await sh("echo from-the-sandbox > proof.txt");
    assert.equal(run.exitCode, 0);
    assert.equal(await readFile(join(workspace, "proof.txt"), "utf8"), "from-the-sandbox\n");
  });

  it("cannot see the rest of the home folder", async () => {
    const run = await sh("ls -a /workspace/.. ; test -e /workspace/../.ssh/id_ed25519 && echo LEAK || echo ok");
    assert.match(run.stdout, /ok/);
    assert.doesNotMatch(run.stdout, /LEAK/);
  });

  it("caps memory and processes", async () => {
    assert.equal(Number((await sh("cat /sys/fs/cgroup/memory.max")).stdout.trim()), 256 * 1024 * 1024);
    assert.equal((await sh("cat /sys/fs/cgroup/pids.max")).stdout.trim(), String(SANDBOX_LIMITS.processes));
  });

  it("runs a flag the harness sends after the image as the command, not as a docker flag", async () => {
    const run = await runDocker(desktop, { docker, workspace }, sandboxRequest({ command: ["--network", "host", "ls"] }));
    assert.equal(run.exitCode, 127);
  });

  it("kills a command that runs past the timeout", async () => {
    const run = await sh("sleep 30", 2_000);
    assert.equal(run.timedOut, true);
    assert.ok(run.elapsedMs < 2_000 + 5_000);
  });
});
