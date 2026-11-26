import { readFile } from "node:fs/promises";
import { WORKSPACE_SEED_FILES } from "../app/courses/harness/files.js";
import { ensureWorkspace, readWorkspaceFile, runDocker, sandboxRequest } from "../app/courses/harness/js/sandbox.js";

export const HOME = "/home/learner";
export const WORKSPACE = `${HOME}/harness-course-workspace`;
export const DOCKER = "/usr/local/bin/docker";

const seedRoot = new URL("../app/courses/harness/workspace-seed/", import.meta.url);
export const SEED = Object.fromEntries(await Promise.all(WORKSPACE_SEED_FILES.map(async (name) => [name, await readFile(new URL(name, seedRoot), "utf8")])));

// Stands in for the desktop API: scripted processes, an in-memory disk, and a record of every spawn.
export function createFakeDesktop({ answer = () => ({}), dockerOnPath = true } = {}) {
  const calls = [];
  const disk = new Map();
  const running = new Map();

  function spawn(file, args = []) {
    const handlers = { stdout: [], stderr: [], close: [], error: [] };
    const call = { file, args, stdin: "" };
    calls.push(call);
    const emit = (name, ...values) => setImmediate(() => handlers[name].forEach((fn) => fn(...values)));
    const result = args[0] === "kill" ? {} : answer(args, call);
    const finish = (code) => {
      if (result.stdout) for (const chunk of [result.stdout].flat()) emit("stdout", chunk);
      if (result.stderr) emit("stderr", result.stderr);
      emit("close", code, null);
    };
    if (args[0] === "kill") {
      running.get(args[1])?.();
      finish(0);
    } else if (result.hang) running.set(args[3], () => finish(137));
    else finish(result.exitCode ?? 0);
    return {
      pid: Promise.resolve(1),
      stdout: { on: (_event, fn) => handlers.stdout.push(fn) },
      stderr: { on: (_event, fn) => handlers.stderr.push(fn) },
      stdin: {
        write: async (data) => void (call.stdin += data),
        end: async () => {},
      },
      on: (event, fn) => handlers[event]?.push(fn),
      kill: async () => {},
    };
  }

  const entry = (path) => {
    if (!disk.has(path)) throw new Error(`ENOENT: no such file or directory, lstat '${path}'`);
    return disk.get(path);
  };
  const desktop = {
    childProcess: {
      spawn,
      exec: async (command) => {
        calls.push({ command });
        return dockerOnPath && command.includes("command -v docker") ? { stdout: `${DOCKER}\n`, stderr: "", code: 0 } : { stdout: "", stderr: "", code: 1 };
      },
    },
    os: { homedir: async () => HOME, platform: async () => "darwin" },
    fs: {
      exists: async (path) => disk.has(path),
      lstat: async (path) => {
        const item = entry(path);
        return { size: item.text?.length ?? 0, isFile: item.kind === "file", isDirectory: item.kind === "dir", isSymbolicLink: item.kind === "link" };
      },
      mkdir: async (path) => void disk.set(path, { kind: "dir" }),
      writeFile: async (path, text) => {
        if (disk.get(path)?.kind === "link") disk.set(disk.get(path).target, { kind: "file", text: String(text) });
        else disk.set(path, { kind: "file", text: String(text) });
      },
      readFile: async (path) => {
        const item = entry(path);
        if (item.kind === "link") return entry(item.target).text;
        if (item.kind !== "file") throw new Error(`EISDIR: ${path}`);
        return item.text;
      },
    },
    shell: {
      trashItem: async (path) => {
        for (const key of [...disk.keys()]) if (key === path || key.startsWith(`${path}/`)) disk.delete(key);
      },
    },
  };
  return { desktop, calls, disk, runs: () => calls.filter((c) => c.args?.[0] === "run") };
}

// The page's side of the worker bridge, built from the page's own sandbox code, against a fake desktop.
export function installFakePage(options) {
  const fake = createFakeDesktop(options);
  const prepared = [];
  globalThis.coursePage = {
    async prepareSandbox() {
      prepared.push(await ensureWorkspace(fake.desktop, WORKSPACE, SEED));
    },
    runInSandbox: (raw) => runDocker(fake.desktop, { docker: DOCKER, workspace: WORKSPACE }, sandboxRequest(raw)),
    readWorkspaceFile: (name) => readWorkspaceFile(fake.desktop, WORKSPACE, name),
  };
  return { ...fake, prepared };
}
