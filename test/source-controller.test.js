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
});
