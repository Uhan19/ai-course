import { emptyProgress, mergeProgress, normalizeProgress, sameProgress } from "./core/progress.js";

export const HIDE_CODES = new Set(["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"]);

export const ERROR_COPY = {
  not_granted: "Claude access wasn't allowed for this page, so Claude can't answer here.",
  sampling_disabled: "Claude isn't available for this account here.",
  not_declared: "This version of the page can't call Claude.",
  capability_disabled: "Claude can't be reached from this view.",
  capability_removed: "This Claude app is too old to call Claude from a page.",
  rate_limited: "Too many requests to Claude right now. Wait a minute, then try again.",
  usage_limit: "You've reached your Claude usage limit. Claude will answer again when it resets.",
  session_expired: "Your Claude sign-in expired. Sign in again, then reload this page.",
  refused: "Claude declined this request. Try asking for something different.",
  empty_completion: "Claude sent back an empty answer. Try a simpler message.",
  invalid_json: "Claude's answer wasn't in the format the page asked for. Try again.",
  prompt_too_large: "The conversation is too long to send to Claude. Start a new conversation.",
  invalid_request: "The page sent Claude a malformed request.",
  cancelled: "Stopped.",
  upstream_error: "Claude couldn't be reached just now. Try again in a moment.",
};

export function errorCopy(error) {
  if (error?.code === "rate_limited" && error.reason === "usage_limit") return ERROR_COPY.usage_limit;
  return ERROR_COPY[error?.code] ?? ERROR_COPY.upstream_error;
}

export const COOLDOWN_MS = 60_000;
export const LOAD_TIMEOUT_MS = 10_000;

export function createRuntime(claude, { now = () => Date.now(), timers = globalThis } = {}) {
  const listeners = new Set();
  const state = {
    live: "checking",
    reason: "",
    sample: null,
    desktop: null,
    installState: "unavailable",
    desktopChecked: false,
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
      state.desktopChecked = true;
      setLive("off", "no-runtime");
      progress.start(null, null);
      return;
    }
    const use = (name) => Promise.resolve(claude.use(name)).catch(() => null);
    use("sample").then((sample) => {
      state.sample = sample;
      setLive(sample ? "ready" : "off", sample ? "" : "no-runtime");
    });
    Promise.all([use("db"), use("user")]).then(async ([db, user]) => {
      const userId = user ? await user.id().catch(() => null) : null;
      progress.start(db, userId);
    });
    use("desktop").then(async (desktop) => {
      state.desktop = desktop;
      state.installState = desktop?.install ? await desktop.install.state().catch(() => "unavailable") : "unavailable";
      state.desktopChecked = true;
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

  async function askClaude(input, { json = false, signal, modelTier = "quick" } = {}) {
    if (state.live !== "ready" || !state.sample) {
      throw { code: "not_ready", message: "Claude isn't available on this page right now." };
    }
    const options = { modelTier, signal, cache: false };
    try {
      return json ? await state.sample.json(input, options) : await state.sample(input, options);
    } catch (raw) {
      const error = normalizeError(raw);
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
    get desktopChecked() {
      return state.desktopChecked;
    },
    progress,
    boot,
    askClaude,
    install,
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
