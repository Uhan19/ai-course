import { test } from "node:test";
import assert from "node:assert/strict";
import { createProgressStore, createRuntime } from "../app/js/runtime.js";
import { markVisited } from "../app/js/core/progress.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeXray() {
  const steps = [];
  return { steps, add: (s) => steps.push(s) };
}

function fakeClaude(caps) {
  return { use: async (name) => caps[name] ?? null };
}

test("runtime without window.claude turns live examples off", async () => {
  const rt = createRuntime(undefined);
  await rt.boot();
  assert.equal(rt.live, "off");
  assert.equal(rt.reason, "no-runtime");
  assert.equal(rt.progress.mode, "unsaved");
  await assert.rejects(rt.callModel("hi"), { code: "not_ready" });
});

test("callModel records request and response in the x-ray", async () => {
  const sample = async (input) => ({ text: `echo ${input}`, truncated: false, modelTierApplied: "quick" });
  const rt = createRuntime(fakeClaude({ sample }), { now: (() => { let t = 0; return () => (t += 1000); })() });
  rt.boot();
  await flush();
  assert.equal(rt.live, "ready");
  const xray = fakeXray();
  const result = await rt.callModel("hello", { modelTier: "quick" }, { xray, why: "Testing." });
  assert.equal(result.text, "echo hello");
  assert.deepEqual(xray.steps.map((s) => s.kind), ["request", "response"]);
  assert.deepEqual(xray.steps[0].data, { capability: "sample", input: "hello", options: { modelTier: "quick" } });
  assert.match(xray.steps[0].summary, /Testing\.$/);
  assert.match(xray.steps[1].summary, /2 words in 1\.0 s/);
});

test("not_granted turns live examples off and never retries", async () => {
  let calls = 0;
  const sample = async () => {
    calls += 1;
    throw { code: "not_granted", message: "declined" };
  };
  const rt = createRuntime(fakeClaude({ sample }));
  rt.boot();
  await flush();
  const xray = fakeXray();
  await assert.rejects(rt.callModel("x", {}, { xray }), { code: "not_granted" });
  assert.equal(rt.live, "off");
  assert.equal(rt.reason, "not_granted");
  await assert.rejects(rt.callModel("x"), { code: "not_ready" });
  assert.equal(calls, 1);
  assert.deepEqual(xray.steps.map((s) => s.kind), ["request", "error"]);
});

test("rate_limited cools down live examples", async () => {
  const sample = async () => {
    throw { code: "rate_limited", message: "slow down", reason: "usage_limit" };
  };
  const pending = [];
  const rt = createRuntime(fakeClaude({ sample }), { timers: { setTimeout: (fn) => pending.push(fn), clearTimeout: () => {} } });
  rt.boot();
  await flush();
  await assert.rejects(rt.callModel("x"), { code: "rate_limited" });
  assert.equal(rt.live, "cooling");
  assert.equal(rt.reason, "usage_limit");
  pending.forEach((fn) => fn());
  assert.equal(rt.live, "ready");
});

function fakeDb() {
  const writes = [];
  let listener = null;
  const ref = {
    path: null,
    onSnapshot(next) {
      listener = next;
      return () => {};
    },
    async set(data) {
      writes.push(structuredClone(data));
    },
  };
  return {
    writes,
    emit(data, fromCache = false) {
      listener({ exists: data !== null, data: () => data, metadata: { fromCache, hasPendingWrites: false } });
    },
    db: {
      doc(path) {
        ref.path = path;
        return ref;
      },
    },
    ref,
  };
}

const timers = { setTimeout: () => 0, clearTimeout: () => {} };

test("progress store without db works in memory and never saves", () => {
  const store = createProgressStore({ timers });
  store.start(null, null);
  store.update((p) => markVisited(p, "l1", 1));
  assert.equal(store.mode, "unsaved");
  assert.equal(store.value.lessons.l1.visitedAt, 1);
});

test("progress store loads, merges early changes and writes to the private path", async () => {
  const fake = fakeDb();
  const store = createProgressStore({ timers });
  store.start(fake.db, "u_123");
  assert.equal(fake.ref.path, "data/users/u_123/progress");
  store.update((p) => markVisited(p, "l2", 5));
  assert.equal(fake.writes.length, 0);
  fake.emit({ version: 1, lessons: { l1: { visitedAt: 1 } } });
  await flush();
  assert.equal(fake.writes.length, 1);
  assert.deepEqual(Object.keys(fake.writes[0].lessons).sort(), ["l1", "l2"]);
  assert.equal(store.mode, "saved");
  fake.emit(fake.writes[0]);
  store.update((p) => markVisited(p, "l3", 9));
  await flush();
  assert.equal(fake.writes.length, 2);
  store.update((p) => markVisited(p, "l3", 10));
  await flush();
  assert.equal(fake.writes.length, 2);
});

test("progress store goes read-only when the write is refused", async () => {
  const fake = fakeDb();
  fake.ref.set = async () => {
    throw { code: "invalid_argument", message: "no" };
  };
  const store = createProgressStore({ timers });
  store.start(fake.db, "u_1");
  fake.emit(null);
  store.update((p) => markVisited(p, "l1", 1));
  await flush();
  assert.equal(store.mode, "readonly");
  store.update((p) => markVisited(p, "l2", 1));
  assert.equal(store.value.lessons.l2.visitedAt, 1);
});
