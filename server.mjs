// Local server for the page: serves index.html and lib/, and forwards /api/chat to Baseten,
// Groq or OpenRouter with their keys from the environment (BASETEN_API_KEY, GROQ_API_KEY or GROQ,
// WHISTLE_OPENROUTER_KEY), so a key never reaches the browser or the code.
// /api/tts does the same for remote voices: Pocket TTS on your own Baseten deployment
// (BASETEN_TTS_URL) and Orpheus on Groq. The on-device voice needs neither.
// It also serves the Phonon checkpoint same-origin from this machine's Hugging Face cache, when a
// complete copy is there, so the Phonon page's first load reads the disk instead of the network.
// Run: node server.mjs   (PORT=8123 by default, bound to 127.0.0.1 only)
import http from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { CHECKPOINT } from "./lib/phonon-checkpoint.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// keys from ./.env (gitignored) when the shell does not set them
try { process.loadEnvFile(path.join(ROOT, ".env")); } catch {}
const PORT = Number(process.env.PORT) || 8123;
const PROVIDERS = {
  baseten: { url: "https://inference.baseten.co/v1/chat/completions", key: process.env.BASETEN_API_KEY },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY || process.env.GROQ },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", key: process.env.WHISTLE_OPENROUTER_KEY },
};
// Remote voices. Pocket TTS is not in Baseten's model library, so BASETEN_TTS_URL is the predict URL
// of your own deployment (see truss-pocket-tts/); Groq's only TTS is Orpheus, which it hosts itself.
const VOICES = {
  baseten: {
    url: process.env.BASETEN_TTS_URL,
    key: process.env.BASETEN_API_KEY,
    body: (b) => ({ text: b.text, language: b.model, voice: b.voice ?? "alba" }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/audio/speech",
    key: process.env.GROQ_API_KEY || process.env.GROQ,
    body: (b) => ({ model: b.model, input: b.text, voice: b.voice ?? "autumn", response_format: "wav" }),
  },
};
const MAX_TTS_CHARS = 400; // Groq's Orpheus rejects input over 200; the page splits well below both
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const FIELDS = ["model", "messages", "stream", "max_tokens", "temperature", "reasoning_effort"];
// A directory named for its version (lib/phonon-0.4.0/) never changes in place, so it is cached for
// a year without revalidating; a new version is a new directory. Everything else revalidates.
const VERSIONED = /^lib\/[\w.]+-\d+\.\d+\.\d+\//;
const IMMUTABLE = "public, max-age=31536000, immutable";

// Phonon's checkpoint, where huggingface_hub keeps it. Offered to the page only when every file is
// there at its pinned size, so a partial or different copy is never served.
const PHONON_DIR = path.join(process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface"), "hub",
  `models--${CHECKPOINT.repo.replace("/", "--")}`, "snapshots", CHECKPOINT.commit);
const PHONON_PATH = `/models/${CHECKPOINT.repo}@${CHECKPOINT.commit}/`;
const phononLocal = (await Promise.all(Object.entries(CHECKPOINT.files).map(([name, size]) =>
  fs.stat(path.join(PHONON_DIR, name)).then((st) => st.size === size, () => false)))).every(Boolean);

// cross-origin isolation lets onnxruntime-web use several threads
const ISOLATE = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const send = (res, status, body, type = "text/plain") => { res.writeHead(status, { "Content-Type": type, ...ISOLATE }); res.end(body); };

// the JSON body, or null once the error has been sent
async function read(req, res, cap) {
  if (!ORIGINS.has(req.headers.origin)) return send(res, 403, "bad origin"), null; // blocks other sites using the keys
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > cap) return send(res, 413, "too large"), null; }
  try { return JSON.parse(raw); } catch { return send(res, 400, "bad json"), null; }
}

// forwards the upstream response as it arrives, whether that is an SSE stream or wav bytes
function forward(res, up) {
  res.writeHead(up.status, { "Content-Type": up.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
  pipeline(Readable.fromWeb(up.body), res, () => {}); // a client that hangs up mid-stream is normal, not an error
}

async function chat(req, res) {
  const body = await read(req, res, 65536);
  if (!body) return;
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
    forward(res, up);
  } catch (e) {
    if (!res.headersSent) send(res, 502, "upstream error");
    else res.end();
  }
}

// one short utterance in, wav bytes out. The page sends a sentence at a time so the first
// audio starts before the whole reply is written.
async function tts(req, res) {
  const body = await read(req, res, 8192);
  if (!body) return;
  const name = body.provider ?? "groq";
  const voice = Object.hasOwn(VOICES, name) ? VOICES[name] : null;
  if (!voice) return send(res, 400, "unknown provider");
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TTS_CHARS) return send(res, 400, "bad text");
  if (typeof body.model !== "string" || !/^[\w.\-/:]+$/.test(body.model)) return send(res, 400, "bad model");
  if (body.voice !== undefined && !/^[\w.\-]{1,64}$/.test(body.voice)) return send(res, 400, "bad voice");
  if (!voice.key) return send(res, 500, `no API key for ${name} in the server's environment`);
  if (!voice.url) return send(res, 500, "no BASETEN_TTS_URL: deploy truss-pocket-tts/ and set it to the predict URL");
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const up = await fetch(voice.url, {
      method: "POST",
      signal: abort.signal,
      headers: { Authorization: `Bearer ${voice.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(voice.body(body)),
    });
    forward(res, up);
  } catch (e) {
    if (!res.headersSent) send(res, 502, "upstream error");
    else res.end();
  }
}

async function file(req, url, res) {
  const rel = url === "/" ? "index.html" : decodeURIComponent(url.slice(1));
  // lib/ is nested up to six deep: lib/phonon-0.4.0/wasm-threads/snippets/<hash>/src/workerHelpers.js
  if (!/^(index\.html|phonon\.html|edit\.html|lib(?:\/[\w.\-]+){1,6})$/.test(rel) || rel.includes("..")) return send(res, 404, "not found");
  try {
    const full = path.join(ROOT, rel);
    const st = await fs.stat(full);
    // always revalidate: a cached copy from before a header change must never be reused
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { "Content-Type": TYPES[path.extname(rel)] ?? "application/octet-stream", "Cache-Control": VERSIONED.test(rel) ? IMMUTABLE : "no-cache", ETag: etag, ...ISOLATE };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(await fs.readFile(full));
  } catch { send(res, 404, "not found"); }
}

// Streamed rather than read whole: the weights are 64.5 MB. no-store because the page keeps them in
// the Cache API, and the HTTP cache keeping them as well would hold a second copy.
function phononFile(name, res) {
  if (!phononLocal || !Object.hasOwn(CHECKPOINT.files, name)) return send(res, 404, "not found");
  res.writeHead(200, { "Content-Type": TYPES[path.extname(name)] ?? "application/octet-stream", "Content-Length": CHECKPOINT.files[name], "Cache-Control": "no-store", ...ISOLATE });
  pipeline(createReadStream(path.join(PHONON_DIR, name)), res, () => {});
}

async function transcription(req, res) {
  const body = await read(req, res, 1_100_000);
  if (!body) return;
  const { onRequestPost } = await import("./functions/api/transcribe.js");
  forward(res, await onRequestPost({
    request: new Request(`http://${req.headers.host}/api/transcribe`, {
      method: "POST", headers: { Origin: req.headers.origin }, body: JSON.stringify(body),
    }),
    env: process.env,
  }));
}

http.createServer((req, res) => {
  if (!HOSTS.has(req.headers.host)) return send(res, 403, "bad host"); // blocks DNS rebinding
  const url = req.url.split("?")[0];
  if (req.method === "POST" && url === "/api/chat") return chat(req, res);
  if (req.method === "POST" && url === "/api/transcribe") return transcription(req, res);
  if (req.method === "POST" && url === "/api/tts") return tts(req, res);
  if (req.method === "GET" && url.startsWith(PHONON_PATH)) return phononFile(decodeURIComponent(url.slice(PHONON_PATH.length)), res);
  if (req.method === "GET" && url === "/api/config") return send(res, 200, JSON.stringify({
    key: Boolean(PROVIDERS.baseten.key),
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, Boolean(p.key)])),
    tts: Object.fromEntries(Object.entries(VOICES).map(([k, v]) => [k, Boolean(v.key && v.url)])),
    phonon: phononLocal ? PHONON_PATH : null,
  }), "application/json");
  if (req.method === "GET") return file(req, url, res);
  send(res, 405, "method not allowed");
}).listen(PORT, "127.0.0.1", () => console.log(
  `http://localhost:${PORT}  (${Object.entries(PROVIDERS).map(([k, p]) => `${k} key ${p.key ? "found" : "NOT set"}`).join(", ")}` +
  `; voices: ${Object.entries(VOICES).map(([k, v]) => `${k} ${v.key && v.url ? "ready" : v.key ? "no endpoint" : "no key"}`).join(", ")}` +
  `; phonon checkpoint: ${phononLocal ? "served from " + PHONON_DIR : "from the Hub (no complete local copy)"})`));
