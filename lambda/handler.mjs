// AWS Lambda behind a Function URL (invoke mode RESPONSE_STREAM): the same job as server.mjs.
// Serves index.html and lib/ from the zip, and /api/chat forwards to Baseten or Groq with keys
// from the function's environment (BASETEN_API_KEY, GROQ_API_KEY).
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS = {
  baseten: { url: "https://inference.baseten.co/v1/chat/completions", key: process.env.BASETEN_API_KEY },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", key: process.env.GROQ_API_KEY },
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const FIELDS = ["model", "messages", "stream", "max_tokens", "temperature", "reasoning_effort"];
const ISOLATE = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

const reply = (stream, status, body, headers = { "Content-Type": "text/plain" }) => {
  stream = awslambda.HttpResponseStream.from(stream, { statusCode: status, headers: { ...ISOLATE, ...headers } });
  stream.end(body);
};

async function chat(event, stream) {
  if (event.headers.origin !== `https://${event.requestContext.domainName}`) return reply(stream, 403, "bad origin");
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body); } catch { return reply(stream, 400, "bad json"); }
  if (typeof body?.model !== "string" || !/^[\w.\-/:]+$/.test(body.model) || !Array.isArray(body.messages)) return reply(stream, 400, "bad request");
  const name = body.provider ?? "baseten";
  if (!Object.hasOwn(PROVIDERS, name)) return reply(stream, 400, "unknown provider");
  if (!PROVIDERS[name].key) return reply(stream, 500, `no API key for ${name}`);
  try {
    const up = await fetch(PROVIDERS[name].url, {
      method: "POST",
      headers: { Authorization: `Bearer ${PROVIDERS[name].key}`, "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))),
    });
    const out = awslambda.HttpResponseStream.from(stream, { statusCode: up.status, headers: { ...ISOLATE, "Content-Type": up.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
    await new Promise((done) => pipeline(Readable.fromWeb(up.body), out, done));
  } catch {
    reply(stream, 502, "upstream error");
  }
}

async function file(rawPath, stream) {
  const rel = rawPath === "/" ? "index.html" : rawPath.slice(1);
  if (!/^(index\.html|lib\/[\w.\-]+)$/.test(rel)) return reply(stream, 404, "not found");
  try {
    reply(stream, 200, await fs.readFile(path.join(ROOT, rel)), { "Content-Type": TYPES[path.extname(rel)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  } catch { reply(stream, 404, "not found"); }
}

export const handler = awslambda.streamifyResponse(async (event, stream) => {
  const method = event.requestContext.http.method;
  if (method === "POST" && event.rawPath === "/api/chat") return chat(event, stream);
  if (method === "GET" && event.rawPath === "/api/config") return reply(stream, 200, JSON.stringify({ key: Boolean(PROVIDERS.baseten.key), providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, Boolean(p.key)])) }), { "Content-Type": "application/json" });
  if (method === "GET") return file(event.rawPath, stream);
  reply(stream, 405, "method not allowed");
});
