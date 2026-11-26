import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSandboxController } from "../app/courses/harness/js/sandbox-controller.js";
import { createFakeDesktop } from "./fake-desktop.js";

function fakeSources({ local = "checked", source = "local", dockerOnPath = true, answer } = {}) {
  const listeners = new Set();
  const { desktop } = createFakeDesktop({ dockerOnPath, answer: answer ?? ((args) => (args[0] === "info" ? { stdout: "29.0.1\n" } : {})) });
  const sources = { local, source, platform: "darwin", desktop, subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
  return { sources, change: (patch) => (Object.assign(sources, patch), listeners.forEach((fn) => fn())) };
}

async function settled(sandbox) {
  for (let i = 0; i < 500 && sandbox.docker === "checking"; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
}

describe("choosing the real sandbox or the simulation", () => {
  it("uses Docker with the local model once Docker is ready", async () => {
    const { sources } = fakeSources();
    const sandbox = createSandboxController({ sources });
    sandbox.activate();
    await settled(sandbox);
    assert.equal(sandbox.docker, "ready");
    assert.deepEqual(sandbox.modeFor("local"), { mode: "docker" });
  });

  it("simulates with Claude as the model, even when Docker is ready", async () => {
    const { sources } = fakeSources();
    const sandbox = createSandboxController({ sources });
    sandbox.activate();
    await settled(sandbox);
    assert.deepEqual(sandbox.modeFor("claude"), { mode: "simulated", reason: "the real sandbox runs only with the local model in the installed app" });
  });

  it("simulates and says why when Docker isn't running", async () => {
    const { sources } = fakeSources({ answer: (args) => (args[0] === "info" ? { exitCode: 1 } : {}) });
    const sandbox = createSandboxController({ sources });
    sandbox.activate();
    await settled(sandbox);
    assert.deepEqual(sandbox.modeFor("local"), { mode: "simulated", reason: "Docker isn't running" });
    assert.equal(sandbox.steps[0].command, "open -a Docker");
  });

  it("waits for full access before checking Docker", async () => {
    const { sources, change } = fakeSources({ local: "needs-permission" });
    const sandbox = createSandboxController({ sources });
    sandbox.activate();
    await settled(sandbox);
    assert.equal(sandbox.docker, "idle");
    change({ local: "checked" });
    await settled(sandbox);
    assert.equal(sandbox.docker, "ready");
  });
});
