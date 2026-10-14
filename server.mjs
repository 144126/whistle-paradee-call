// Local server for the page: serves index.html and lib/, and forwards /api/chat to Baseten
// to Baseten or Groq with their keys from the environment (BASETEN_API_KEY, GROQ_API_KEY or GROQ),
// so a key never reaches the browser or the code.
// Run: node server.mjs   (PORT=8123 by default, bound to 127.0.0.1 only)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8123;
const PROVIDERS = {
  baseten: { url: "https://inference.baseten.co/v1/chat/completions", key: process.env.BASETEN_API_KEY },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY || process.env.GROQ },
};
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const FIELDS = ["model", "messages", "stream", "max_tokens", "temperature", "reasoning_effort"];

// cross-origin isolation lets onnxruntime-web use several threads
const ISOLATE = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const send = (res, status, body, type = "text/plain") => { res.writeHead(status, { "Content-Type": type, ...ISOLATE }); res.end(body); };

async function chat(req, res) {
  if (!ORIGINS.has(req.headers.origin)) return send(res, 403, "bad origin"); // blocks other sites using the keys
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 65536) return send(res, 413, "too large"); }
  let body;
  try { body = JSON.parse(raw); } catch { return send(res, 400, "bad json"); }
  if (typeof body.model !== "string" || !/^[\w.\-/:]+$/.test(body.model) || !Array.isArray(body.messages)) return send(res, 400, "bad request");
  const provider = Object.hasOwn(PROVIDERS, body.provider ?? "baseten") ? PROVIDERS[body.provider ?? "baseten"] : null;
  if (!provider) return send(res, 400, "unknown provider");
  if (!provider.key) return send(res, 500, `no API key for ${body.provider ?? "baseten"} in the server's environment`);
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const up = await fetch(provider.url, {
      method: "POST",
      signal: abort.signal,
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))),
    });
    res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
    pipeline(Readable.fromWeb(up.body), res, () => {}); // a client that hangs up mid-stream is normal, not an error
  } catch (e) {
    if (!res.headersSent) send(res, 502, "upstream error");
    else res.end();
  }
}

async function file(req, url, res) {
  const rel = url === "/" ? "index.html" : decodeURIComponent(url.slice(1));
  if (!/^(index\.html|lib\/[\w.\-]+)$/.test(rel)) return send(res, 404, "not found");
  try {
    const full = path.join(ROOT, rel);
    const st = await fs.stat(full);
    // always revalidate: a cached copy from before a header change must never be reused
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { "Content-Type": TYPES[path.extname(rel)] ?? "application/octet-stream", "Cache-Control": "no-cache", ETag: etag, ...ISOLATE };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(await fs.readFile(full));
  } catch { send(res, 404, "not found"); }
}

http.createServer((req, res) => {
  if (!HOSTS.has(req.headers.host)) return send(res, 403, "bad host"); // blocks DNS rebinding
  const url = req.url.split("?")[0];
  if (req.method === "POST" && url === "/api/chat") return chat(req, res);
  if (req.method === "GET" && url === "/api/config") return send(res, 200, JSON.stringify({ key: Boolean(PROVIDERS.baseten.key), providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, Boolean(p.key)])) }), "application/json");
  if (req.method === "GET") return file(req, url, res);
  send(res, 405, "method not allowed");
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}  (${Object.entries(PROVIDERS).map(([k, p]) => `${k} key ${p.key ? "found" : "NOT set"}`).join(", ")})`));
