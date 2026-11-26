import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSourceController } from "../app/courses/harness/js/source-controller.js";

const flush = () => new Promise((r) => setImmediate(r));
const ollamaReply = (body) => ({ stdout: `${body}\n__PRIMER_HTTP_STATUS__200`, stderr: "", code: 0 });

function installedApp(exec) {
  return {
    desktopChecked: true,
    installState: "installed",
    live: "ready",
    desktop: {
      childProcess: { exec },
      permissions: { state: async () => "granted" },
      os: { platform: async () => "darwin" },
    },
    subscribe: () => () => {},
  };
}

describe("choosing the model source", () => {
  it("keeps the local model while it checks again", async () => {
    let held = null;
    const exec = async (command) => {
      if (held) await held;
      if (command.includes("/api/version")) return ollamaReply('{"version":"0.40.16"}');
      if (command.includes("/api/tags")) return ollamaReply('{"models":[{"name":"qwen3.5:9b"}]}');
      return { stdout: "", stderr: "", code: 1 };
    };
    const sources = createSourceController({ runtime: installedApp(exec), getModel: () => "qwen3.5:9b" });
    await flush();
    assert.equal(sources.source, "local");

    let release;
    held = new Promise((r) => (release = r));
    const again = sources.refresh();
    await flush();
    assert.equal(sources.busy, true);
    assert.equal(sources.source, "local");

    release();
    await again;
    assert.equal(sources.busy, false);
    assert.equal(sources.source, "local");
  });

  it("names a newly configured model but lets its first request reach Ollama", async () => {
    const commands = [];
    const exec = async (command) => {
      commands.push(command);
      if (command.includes("/api/version")) return ollamaReply('{"version":"0.40.16"}');
      if (command.includes("/api/tags")) return ollamaReply('{"models":[{"name":"qwen3.5:9b"}]}');
      return { stdout: "", stderr: "", code: 1 };
    };
    let model = "qwen3.5:9b";
    const sources = createSourceController({ runtime: installedApp(exec), getModel: () => model });
    await flush();
    const probes = commands.length;
    let redraws = 0;
    sources.subscribe(() => (redraws += 1));

    model = "no-such-model";
    sources.modelChanged();
    await flush();
    assert.equal(sources.model, "no-such-model");
    assert.equal(sources.source, "local");
    assert.equal(commands.length, probes);
    assert.ok(redraws > 0);
  });

  it("checks again when the learner fixes a model that was missing", async () => {
    const exec = async (command) => {
      if (command.includes("/api/version")) return ollamaReply('{"version":"0.40.16"}');
      if (command.includes("/api/tags")) return ollamaReply('{"models":[{"name":"qwen3.5:9b"}]}');
      return { stdout: "", stderr: "", code: 1 };
    };
    let model = "no-such-model";
    const sources = createSourceController({ runtime: installedApp(exec), getModel: () => model });
    await flush();
    assert.equal(sources.localIsReady, false);
    assert.equal(sources.steps[0].command, "ollama pull no-such-model");

    model = "qwen3.5:9b";
    sources.modelChanged();
    await flush();
    assert.equal(sources.localIsReady, true);
    assert.equal(sources.source, "local");
  });
});
