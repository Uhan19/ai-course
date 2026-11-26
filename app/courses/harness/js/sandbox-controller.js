import { WORKSPACE_SEED_FILES } from "../files.js";
import { fetchText } from "./code-store.js";
import {
  checkDocker,
  dockerSetupSteps,
  ensureWorkspace,
  readWorkspaceFile,
  resetWorkspace,
  runDocker,
  sandboxRequest,
  workspaceFileName,
  workspacePath,
  writeWorkspaceFile,
} from "./sandbox.js";
import { createSimulatedWorkspace } from "./simulated-sandbox.js";

const DAEMON_DOWN = /Cannot connect to the Docker daemon|docker daemon is not running/i;

const NOT_READY = {
  idle: "Docker hasn't been checked yet",
  checking: "Docker is still being checked",
  missing: "Docker isn't installed",
  stopped: "Docker isn't running",
  "no-image": "the sandbox image isn't downloaded yet",
  error: "Docker couldn't be checked",
};

export function createSandboxController({ sources }) {
  const listeners = new Set();
  const state = { docker: "idle", version: "", binary: null, workspace: null, error: "", resets: 0 };
  const simulated = createSimulatedWorkspace();
  let simulatedSeeded = false;
  let seed = null;
  let active = false;

  const notify = () => listeners.forEach((fn) => fn(api));
  const desktop = () => sources.desktop;
  const canUseDocker = () => sources.local === "checked" && Boolean(desktop()?.childProcess);

  function loadSeed() {
    seed ??= Promise.all(WORKSPACE_SEED_FILES.map(async (name) => [name, await fetchText(`workspace-seed/${name}`)]))
      .then(Object.fromEntries)
      .catch((error) => {
        seed = null;
        throw error;
      });
    return seed;
  }

  async function refresh() {
    if (!canUseDocker()) {
      state.docker = "idle";
      return notify();
    }
    state.docker = "checking";
    notify();
    try {
      const check = await checkDocker(desktop());
      state.workspace = await workspacePath(desktop());
      Object.assign(state, { docker: check.state, version: check.version, binary: check.docker, error: "" });
    } catch (error) {
      Object.assign(state, { docker: "error", error: String(error?.message ?? error) });
    }
    notify();
  }

  sources.subscribe(() => {
    if (active && canUseDocker() && state.docker === "idle") refresh();
    else if (!canUseDocker() && state.docker !== "idle") {
      state.docker = "idle";
      notify();
    }
  });

  function modeFor(source) {
    if (source === "local" && canUseDocker() && state.docker === "ready") return { mode: "docker" };
    if (source !== "local") return { mode: "simulated", reason: "the real sandbox runs only with the local model in the installed app" };
    return { mode: "simulated", reason: NOT_READY[state.docker] ?? NOT_READY.error };
  }

  async function prepare(mode) {
    if (mode === "docker") {
      await ensureWorkspace(desktop(), state.workspace, await loadSeed());
    } else if (!simulatedSeeded) {
      simulated.seed(await loadSeed());
      simulatedSeeded = true;
    }
  }

  const api = {
    get docker() {
      return state.docker;
    },
    get version() {
      return state.version;
    },
    get error() {
      return state.error;
    },
    get canUseDocker() {
      return canUseDocker();
    },
    get resets() {
      return state.resets;
    },
    get steps() {
      return dockerSetupSteps({ state: state.docker }, sources.platform);
    },
    modeFor,
    activate() {
      if (active) return;
      active = true;
      if (canUseDocker() && state.docker === "idle") refresh();
    },
    refresh,
    prepare,
    async run(mode, raw) {
      const request = sandboxRequest(raw);
      await prepare(mode);
      if (mode !== "docker") return simulated.run(request);
      const run = await runDocker(desktop(), { docker: state.binary, workspace: state.workspace }, request);
      if (run.exitCode === 125 && DAEMON_DOWN.test(run.stderr)) refresh();
      return run;
    },
    async read(mode, name) {
      await prepare(mode);
      return mode === "docker" ? readWorkspaceFile(desktop(), state.workspace, name) : simulated.read(workspaceFileName(name));
    },
    async write(mode, name, text) {
      await prepare(mode);
      if (mode === "docker") await writeWorkspaceFile(desktop(), state.workspace, name, text);
      else simulated.write(workspaceFileName(name), text);
    },
    async reset(mode) {
      const files = await loadSeed();
      if (mode === "docker") await resetWorkspace(desktop(), state.workspace, files);
      else {
        simulated.seed(files);
        simulatedSeeded = true;
      }
      state.resets += 1;
      notify();
    },
    async openFolder() {
      await prepare("docker");
      await desktop().shell.openPath(state.workspace);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}
