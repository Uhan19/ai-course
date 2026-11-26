import { exec } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { CURL_TIMEOUT_S, OLLAMA_CLI_COMMAND, PROBE_TIMEOUT_S, curlCommand } from "../app/courses/harness/js/model-source.js";

const ROOT = fileURLToPath(new URL("../app/", import.meta.url));
const DEV = fileURLToPath(new URL("./", import.meta.url));
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
  ...[CURL_TIMEOUT_S, PROBE_TIMEOUT_S].flatMap((timeout) => [
    curlCommand({ path: "/api/chat", method: "POST" }, timeout),
    curlCommand({ path: "/api/tags", method: "GET" }, timeout),
    curlCommand({ path: "/api/version", method: "GET" }, timeout),
  ]),
]);

async function page(url) {
  const body = await readFile(join(ROOT, "index.html"), "utf8");
  const mode = url.searchParams.get("fake");
  const fake = mode ? `<script>window.__FAKE_MODE__=${JSON.stringify(mode)}</script><script src="/dev/fake-claude.js"></script>` : "";
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
}).listen(PORT, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${PORT}/  (add ?fake=local, ?fake=fallback or ?fake=declined)`));
