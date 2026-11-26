import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as lesson7 from "../app/courses/harness/harness/07-swap-model.ts";
import { MODELS } from "../app/courses/harness/harness/config.ts";
import { readConfigList } from "../app/courses/harness/js/model-source.js";
import { installFakePage } from "./fake-desktop.js";
import { installFakeModel, neverAsked, recordingXRay, text } from "./fake-model.js";

let restore = () => {};
afterEach(() => {
  restore();
  delete globalThis.coursePage;
});
const model = (script) => {
  installFakePage();
  const fake = installFakeModel(script);
  restore = fake.restore;
  return fake;
};

describe("lesson 7: swap the model", () => {
  it("offers in the page's picker exactly the models the harness accepts", async () => {
    const configSource = await readFile(new URL("../app/courses/harness/harness/config.ts", import.meta.url), "utf8");
    assert.deepEqual(readConfigList(configSource, "MODELS"), MODELS);
  });

  it("sends the same harness's requests to whichever model was chosen", async () => {
    for (const name of MODELS) {
      const { requests } = model([text("Hi.")]);
      await lesson7.createHarness({ model: name }).send("hi", recordingXRay().xray, neverAsked);
      restore();
      assert.equal(requests[0].model, name);
      assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), ["list_files", "read_file", "write_file", "run_command"]);
    }
  });

  it("keeps a separate conversation per harness, so each model only sees its own replies", async () => {
    const { requests } = model([text("Small says hi."), text("Large says hi."), text("Small again.")]);
    const small = lesson7.createHarness({ model: MODELS[0] });
    const large = lesson7.createHarness({ model: MODELS[1] });

    await small.send("hi", recordingXRay().xray, neverAsked);
    await large.send("hi", recordingXRay().xray, neverAsked);
    await small.send("again", recordingXRay().xray, neverAsked);

    assert.deepEqual(requests[2].messages.map((message) => message.content).slice(1), ["hi", "Small says hi.", "again"]);
  });

  it("uses the smaller model when none is chosen", async () => {
    const { requests } = model([text("Hi.")]);
    await lesson7.createHarness().send("hi", recordingXRay().xray, neverAsked);
    assert.equal(requests[0].model, "qwen3.5:4b");
  });

  it("refuses a model that is not in MODELS", () => {
    assert.throws(() => lesson7.createHarness({ model: "no-such-model" }), { message: "Unknown model no-such-model. Pick one of: qwen3.5:4b, qwen3.5:9b." });
  });
});
