import { decideSource, localReady, probeLocal, setupSteps } from "./model-source.js";

const PREFERENCE_KEY = "primer.harness.source.v1";
const FULL_ACCESS = "full-access";

function readPreference() {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === "claude" ? "claude" : "auto";
  } catch {
    return "auto";
  }
}

function writePreference(value) {
  try {
    localStorage.setItem(PREFERENCE_KEY, value);
  } catch {
    // A remembered choice is a convenience only.
  }
}

export function createSourceController({ runtime, getModel }) {
  const listeners = new Set();
  const state = {
    local: "waiting",
    probe: null,
    platform: "darwin",
    preference: readPreference(),
    busy: false,
  };
  let checkedDesktop = false;

  const notify = () => listeners.forEach((fn) => fn(api));

  async function refresh({ ask = false } = {}) {
    const desktop = runtime.desktop;
    if (!runtime.desktopChecked) {
      state.local = "waiting";
      return notify();
    }
    if (!desktop?.childProcess) {
      state.local = runtime.installState === "available" ? "can-install" : "no-desktop";
      state.probe = null;
      return notify();
    }
    state.busy = true;
    notify();
    try {
      let permission = await desktop.permissions.state(FULL_ACCESS).catch(() => "unavailable");
      if (permission === "prompt" && ask) {
        const answer = await desktop.permissions.request([FULL_ACCESS]).catch(() => ({}));
        permission = answer[FULL_ACCESS] ?? "unavailable";
      }
      if (permission !== "granted") {
        state.local = permission === "prompt" ? "needs-permission" : permission === "denied" ? "denied" : "unavailable";
        state.probe = null;
        return;
      }
      state.platform = await desktop.os.platform().catch(() => "darwin");
      if (state.platform === "win32") {
        state.local = "unsupported";
        state.probe = null;
        return;
      }
      if (state.local !== "checked") state.local = "probing";
      notify();
      state.probe = await probeLocal(desktop, getModel());
      state.local = "checked";
    } finally {
      state.busy = false;
      notify();
    }
  }

  runtime.subscribe(() => {
    if (runtime.desktopChecked && !checkedDesktop) {
      checkedDesktop = true;
      refresh();
    } else notify();
  });

  const api = {
    get local() {
      return state.local;
    },
    get probe() {
      return state.probe;
    },
    get platform() {
      return state.platform;
    },
    get busy() {
      return state.busy;
    },
    get preference() {
      return state.preference;
    },
    get localIsReady() {
      return state.local === "checked" && localReady(state.probe);
    },
    get claudeAvailable() {
      return runtime.live === "ready" || runtime.live === "cooling";
    },
    get source() {
      return decideSource({ preference: state.preference, localIsReady: api.localIsReady, claudeAvailable: api.claudeAvailable });
    },
    get steps() {
      return state.probe ? setupSteps(state.probe, state.platform) : [];
    },
    get desktop() {
      return runtime.desktop;
    },
    get model() {
      return getModel();
    },
    refresh,
    modelChanged() {
      if (state.local === "checked" && !localReady(state.probe) && state.probe.model.name !== getModel()) refresh();
      else notify();
    },
    prefer(value) {
      state.preference = value === "claude" ? "claude" : "auto";
      writePreference(state.preference);
      notify();
    },
    async manageDesktopPermissions() {
      await runtime.desktop?.permissions?.manage().catch(() => {});
      return refresh();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  if (runtime.desktopChecked) {
    checkedDesktop = true;
    refresh();
  }
  return api;
}
