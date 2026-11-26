import { exec, execFile } from "node:child_process";
import { createServer } from "node:http";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CURL_TIMEOUT_S, OLLAMA_CLI_COMMAND, PROBE_TIMEOUT_S, curlCommand } from "../app/courses/harness/js/model-source.js";
import { DOCKER_IMAGE_ARGS, DOCKER_INFO_ARGS, FIND_DOCKER_COMMAND, WORKSPACE_FOLDER, isSandboxKillArgs, isSandboxRunArgs } from "../app/courses/harness/js/sandbox.js";

const ROOT = fileURLToPath(new URL("../app/", import.meta.url));
const DEV = fileURLToPath(new URL("./", import.meta.url));
const PREVIEW_HOME = fileURLToPath(new URL("./.preview-home", import.meta.url));
const PREVIEW_WORKSPACE = join(PREVIEW_HOME, WORKSPACE_FOLDER);
const SPAWN_LIMIT_MS = 60_000;
const PORT = Number(process.env.PORT ?? 8765);
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};
const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const ALLOWED_COMMANDS = new Set([
  OLLAMA_CLI_COMMAND,
  FIND_DOCKER_COMMAND,
  ...[CURL_TIMEOUT_S, PROBE_TIMEOUT_S].flatMap((timeout) => [
    curlCommand({ path: "/api/chat", method: "POST" }, timeout),
    curlCommand({ path: "/api/tags", method: "GET" }, timeout),
    curlCommand({ path: "/api/version", method: "GET" }, timeout),
  ]),
]);

async function page(url) {
  const body = await readFile(join(ROOT, "index.html"), "utf8");
  const mode = url.searchParams.get("fake");
  const fake = mode
    ? `<script>window.__FAKE_MODE__=${JSON.stringify(mode)};window.__FAKE_HOME__=${JSON.stringify(PREVIEW_HOME)}</script><script src="/dev/fake-claude.js"></script>`
    : "";
  return SKELETON_HEAD + fake + body + "</body></html>";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function runAllowed({ command, input = "", timeout = 10_000 }) {
  return new Promise((resolve) => {
    const child = exec(command, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : 1) : 0, signal: error?.signal ?? null, truncated: false });
    });
    child.stdin.end(input);
  });
}

let dockerPath = null;
async function findDocker() {
  dockerPath ??= (await runAllowed({ command: FIND_DOCKER_COMMAND })).stdout.trim().split("\n")[0] || null;
  return dockerPath;
}

const same = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

async function spawnAllowed({ file, args, input }) {
  const docker = await findDocker();
  const allowed =
    file === docker &&
    Array.isArray(args) &&
    (same(args, DOCKER_INFO_ARGS) || same(args, DOCKER_IMAGE_ARGS) || isSandboxKillArgs(args) || isSandboxRunArgs(args, PREVIEW_WORKSPACE));
  if (!allowed) return null;
  return new Promise((done) => {
    const child = execFile(file, args, { timeout: SPAWN_LIMIT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ stdout, stderr, code: error ? (typeof error.code === "number" ? error.code : null) : 0 });
    });
    child.stdin.end(input ?? "");
  });
}

function insideHome(path) {
  const full = resolve(String(path).replace(/^~(?=\/|$)/, PREVIEW_HOME));
  if (full !== PREVIEW_HOME && !full.startsWith(PREVIEW_HOME + sep)) throw new Error("EPERM: outside the preview home");
  return full;
}

async function fsOp({ op, path, data, options }) {
  const full = insideHome(path);
  if (op === "exists") return lstat(full).then(() => true, () => false);
  if (op === "lstat") {
    const stats = await lstat(full);
    return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory(), isSymbolicLink: stats.isSymbolicLink() };
  }
  if (op === "mkdir") return void (await mkdir(full, options));
  if (op === "writeFile") return void (await writeFile(full, data, "utf8"));
  if (op === "readFile") return readFile(full, "utf8");
  if (op === "realpath") return realpath(full);
  if (op === "trashItem") return void (await rm(full, { recursive: true, force: true }));
  throw new Error(`EINVAL: ${op}`);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(await page(url));
      return;
    }
    if (url.pathname === "/dev/exec" && req.method === "POST") {
      const request = JSON.parse(await readBody(req));
      if (!ALLOWED_COMMANDS.has(request.command)) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Command not allowed in the preview." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(await runAllowed(request)));
      return;
    }
    if (url.pathname === "/dev/spawn" && req.method === "POST") {
      const result = await spawnAllowed(JSON.parse(await readBody(req)));
      res.writeHead(result ? 200 : 403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(result ?? { error: "Command not allowed in the preview." }));
      return;
    }
    if (url.pathname === "/dev/fs" && req.method === "POST") {
      try {
        const value = await fsOp(JSON.parse(await readBody(req)));
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ value: value ?? null }));
      } catch (error) {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: `${error.code ?? "EIO"}: ${error.message}` }));
      }
      return;
    }
    const base = url.pathname.startsWith("/dev/") ? DEV : ROOT;
    const rel = normalize(decodeURIComponent(url.pathname).replace(/^\/(dev\/)?/, ""));
    if (rel.startsWith("..")) throw new Error("outside root");
    const data = await readFile(join(base, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${PORT}/  (add ?fake=local, ?fake=local-nodocker, ?fake=fallback or ?fake=declined)`));
