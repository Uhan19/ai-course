import { exec, spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const PREVIEW_HOME = fileURLToPath(new URL("./.preview-home", import.meta.url));

// The parts of the desktop app's API the course uses, on Node, for driving lessons from a terminal.
export function createNodeDesktop({ home = homedir() } = {}) {
  const expand = (path) => String(path).replace(/^~(?=\/|$)/, home);
  return {
    childProcess: {
      exec: (command, { input = "", timeout = 10_000 } = {}) =>
        new Promise((resolve) => {
          const child = exec(command, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
            resolve({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0, signal: error?.signal ?? null, truncated: false }),
          );
          child.stdin.end(input);
        }),
      spawn(file, args = []) {
        const child = spawn(file, args, { stdio: "pipe" });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        return {
          pid: Promise.resolve(child.pid ?? null),
          stdout: { on: (event, fn) => child.stdout.on(event, fn) },
          stderr: { on: (event, fn) => child.stderr.on(event, fn) },
          stdin: {
            write: (data) => new Promise((resolve) => child.stdin.write(data, resolve)),
            end: () => new Promise((resolve) => child.stdin.end(resolve)),
          },
          on: (event, fn) => child.on(event, fn),
          kill: async (signal = "SIGTERM") => child.kill(signal),
        };
      },
    },
    fs: {
      exists: (path) => lstat(expand(path)).then(() => true, () => false),
      lstat: async (path) => {
        const stats = await lstat(expand(path));
        return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory(), isSymbolicLink: stats.isSymbolicLink() };
      },
      mkdir: (path, options) => mkdir(expand(path), options).then(() => {}),
      writeFile: (path, data) => writeFile(expand(path), data, "utf8"),
      readFile: (path) => readFile(expand(path), "utf8"),
      realpath: (path) => realpath(expand(path)),
    },
    os: { platform: async () => process.platform, homedir: async () => home },
    shell: { trashItem: (path) => rm(expand(path), { recursive: true, force: true }), openPath: async () => {} },
  };
}

// The course fetches its own files by URL; on Node those are file: URLs, which fetch can't read.
export function allowFileFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.startsWith("file:")) return original(url, init);
    return new Response(await readFile(fileURLToPath(href), "utf8"));
  };
}
