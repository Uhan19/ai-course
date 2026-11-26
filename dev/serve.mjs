import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../app/", import.meta.url));
const DEV = fileURLToPath(new URL("./", import.meta.url));
const PORT = Number(process.env.PORT ?? 8765);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

async function page(url) {
  const body = await readFile(join(ROOT, "index.html"), "utf8");
  const mode = url.searchParams.get("fake");
  const fake = mode ? `<script>window.__FAKE_MODE__=${JSON.stringify(mode)}</script><script src="/dev/fake-claude.js"></script>` : "";
  return SKELETON_HEAD + fake + body + "</body></html>";
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(await page(url));
      return;
    }
    const base = url.pathname.startsWith("/dev/") ? DEV : ROOT;
    const rel = normalize(url.pathname.replace(/^\/(dev\/)?/, ""));
    if (rel.startsWith("..")) throw new Error("outside root");
    const data = await readFile(join(base, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}/  (add ?fake=ready or ?fake=declined)`));
