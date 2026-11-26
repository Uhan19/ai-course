import {
  HIDE_CODES,
  describeError,
  describeRequest,
  describeResponse,
  errorRecord,
  requestRecord,
  responseRecord,
} from "./core/xray.js";
import { emptyProgress, mergeProgress, normalizeProgress, sameProgress } from "./core/progress.js";

export const COOLDOWN_MS = 60_000;
export const LOAD_TIMEOUT_MS = 10_000;

export function createRuntime(claude, { now = () => Date.now(), timers = globalThis } = {}) {
  const listeners = new Set();
  const state = {
    live: "checking",
    reason: "",
    sample: null,
    permissions: null,
    desktop: null,
    installState: "unavailable",
  };
  const progress = createProgressStore({ onChange: notify, timers });

  function notify() {
    for (const fn of [...listeners]) fn(api);
  }

  function setLive(live, reason = "") {
    if (state.live === live && state.reason === reason) return;
    state.live = live;
    state.reason = reason;
    notify();
  }

  async function boot() {
    if (typeof claude?.use !== "function") {
      setLive("off", "no-runtime");
      progress.start(null, null);
      return;
    }
    const use = (name) => Promise.resolve(claude.use(name)).catch(() => null);
    use("sample").then((sample) => {
      state.sample = sample;
      setLive(sample ? "ready" : "off", sample ? "" : "no-runtime");
    });
    use("permissions").then((permissions) => {
      state.permissions = permissions;
      notify();
    });
    Promise.all([use("db"), use("user")]).then(async ([db, user]) => {
      const userId = user ? await user.id().catch(() => null) : null;
      progress.start(db, userId);
    });
    use("desktop").then(async (desktop) => {
      state.desktop = desktop;
      state.installState = desktop?.install ? await desktop.install.state().catch(() => "unavailable") : "unavailable";
      notify();
    });
  }

  function react(error) {
    if (HIDE_CODES.has(error.code)) setLive("off", error.code);
    else if (error.code === "rate_limited") {
      setLive("cooling", error.reason === "usage_limit" ? "usage_limit" : "rate_limited");
      timers.setTimeout(() => {
        if (state.live === "cooling") setLive("ready");
      }, COOLDOWN_MS);
    }
  }

  async function callModel(input, options = {}, { xray, why = "", answerWhy = "", json = false } = {}) {
    if (state.live !== "ready" || !state.sample) {
      throw { code: "not_ready", message: "Live examples are not available right now." };
    }
    xray?.add({ kind: "request", summary: describeRequest(input, why), data: requestRecord(input, options) });
    const started = now();
    try {
      if (json) {
        const value = await state.sample.json(input, options);
        const text = JSON.stringify(value);
        xray?.add({
          kind: "response",
          summary: describeResponse({ text: text.replace(/[{}[\]",:]/g, " ") }, now() - started, answerWhy),
          data: { parsedJson: value },
        });
        return value;
      }
      const result = await state.sample(input, options);
      xray?.add({
        kind: "response",
        summary: describeResponse(result, now() - started, answerWhy),
        data: responseRecord(result),
      });
      return result;
    } catch (raw) {
      const error = normalizeError(raw);
      xray?.add({ kind: "error", summary: describeError(error), data: errorRecord(error) });
      react(error);
      throw error;
    }
  }

  async function install() {
    if (!state.desktop?.install) return "unavailable";
    const outcome = await state.desktop.install.request().catch(() => "failed");
    state.installState = outcome === "installed" ? "installed" : state.installState;
    notify();
    return outcome;
  }

  async function managePermissions() {
    if (!state.permissions?.manage) return false;
    try {
      await state.permissions.manage();
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    get live() {
      return state.live;
    },
    get reason() {
      return state.reason;
    },
    get installState() {
      return state.installState;
    },
    get desktop() {
      return state.desktop;
    },
    get canManagePermissions() {
      return Boolean(state.permissions?.manage);
    },
    progress,
    boot,
    callModel,
    install,
    managePermissions,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}

export function normalizeError(raw) {
  if (raw && typeof raw === "object" && typeof raw.code === "string") return raw;
  return { code: "upstream_error", message: String(raw?.message ?? raw) };
}

export function createProgressStore({ onChange = () => {}, timers = globalThis } = {}) {
  const store = {
    value: emptyProgress(),
    mode: "connecting",
    onChange,
  };
  let ref = null;
  let loaded = false;
  let dirty = false;
  let writing = false;
  let loadTimer = null;

  const changed = () => store.onChange();

  store.start = (db, userId) => {
    if (!db || !userId) {
      store.mode = "unsaved";
      changed();
      return;
    }
    try {
      ref = db.doc(`data/users/${userId}/progress`);
    } catch {
      store.mode = "unsaved";
      changed();
      return;
    }
    loadTimer = timers.setTimeout(() => {
      if (!loaded) {
        store.mode = "unreachable";
        changed();
      }
    }, LOAD_TIMEOUT_MS);
    ref.onSnapshot(
      (snap) => {
        const remote = normalizeProgress(snap.exists ? snap.data() : null);
        if (snap.metadata?.fromCache && !snap.exists) return;
        const firstLoad = !loaded;
        if (!snap.metadata?.fromCache) {
          loaded = true;
          timers.clearTimeout(loadTimer);
        }
        store.value = dirty || firstLoad ? mergeProgress(remote, store.value) : remote;
        if (store.mode === "connecting" || store.mode === "unreachable") store.mode = "saved";
        changed();
        if (dirty && loaded && !sameProgress(store.value, remote)) flush();
        else if (sameProgress(store.value, remote)) dirty = false;
      },
      (error) => {
        timers.clearTimeout(loadTimer);
        store.mode = error?.code === "revoked" ? "unsaved" : "error";
        changed();
      },
    );
  };

  store.update = (fn) => {
    const next = fn(store.value);
    if (sameProgress(next, store.value)) return;
    store.value = next;
    changed();
    if (!ref || store.mode === "unsaved" || store.mode === "readonly") return;
    dirty = true;
    if (loaded) flush();
  };

  async function flush() {
    if (writing || !ref) return;
    writing = true;
    store.mode = "saving";
    changed();
    let retried = false;
    while (dirty) {
      dirty = false;
      const snapshot = store.value;
      try {
        await ref.set(snapshot);
        store.mode = "saved";
      } catch (error) {
        if (error?.code === "unavailable" && !retried) {
          retried = true;
          dirty = true;
          await new Promise((r) => timers.setTimeout(r, 500 + Math.random() * 1000));
          continue;
        }
        store.mode = error?.code === "invalid_argument" ? "readonly" : "error";
        break;
      }
    }
    writing = false;
    changed();
  }

  return store;
}
