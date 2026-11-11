// Local-only helper: receives captured detection inputs/outputs from the Pocketry
// page running on this machine and writes them under ./captures. Loopback only.
// Usage: node receiver.mjs <captures-dir> [port]
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 5311);
mkdirSync(dir, { recursive: true });
const ALLOWED = new Set(["http://localhost:5226", "http://127.0.0.1:5226"]);

createServer((req, res) => {
  const origin = req.headers.origin ?? "";
  if (ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const file = url.searchParams.get("file") ?? "";
  if (req.method !== "POST" || url.pathname !== "/save" || !/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(file) || !ALLOWED.has(origin)) {
    res.writeHead(400).end("bad request"); return;
  }
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    writeFileSync(join(dir, file), body);
    console.log(new Date().toISOString(), file, body.length);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ file, bytes: body.length }));
  });
}).listen(port, "127.0.0.1", () => console.log(`receiver on 127.0.0.1:${port} -> ${dir}`));
