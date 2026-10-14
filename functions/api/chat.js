// Cloudflare Pages Function: same job as /api/chat in server.mjs. Set the secrets with
//   wrangler pages secret put BASETEN_API_KEY      (and GROQ_API_KEY for Groq models)
const FIELDS = ["model", "messages", "stream", "max_tokens", "temperature", "reasoning_effort"];

const URLS = { baseten: "https://inference.baseten.co/v1/chat/completions", groq: "https://api.groq.com/openai/v1/chat/completions" };

export async function onRequestPost({ request, env }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("bad origin", { status: 403 });
  let body;
  try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (typeof body.model !== "string" || !/^[\w.\-/:]+$/.test(body.model) || !Array.isArray(body.messages)) return new Response("bad request", { status: 400 });
  const name = body.provider ?? "baseten";
  if (!Object.hasOwn(URLS, name)) return new Response("unknown provider", { status: 400 });
  const key = { baseten: env.BASETEN_API_KEY, groq: env.GROQ_API_KEY }[name];
  if (!key) return new Response(`no API key for ${name}`, { status: 500 });
  const up = await fetch(URLS[name], {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))),
  });
  return new Response(up.body, { status: up.status, headers: { "Content-Type": up.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
}
