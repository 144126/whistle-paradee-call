// Cloudflare Pages Function: same job as /api/tts in server.mjs. Set the secrets with
//   wrangler pages secret put GROQ_API_KEY        (Orpheus on Groq)
//   wrangler pages secret put BASETEN_API_KEY     (Pocket TTS on your own Baseten deployment)
//   wrangler pages secret put BASETEN_TTS_URL     (that deployment's predict URL)
const MAX_TTS_CHARS = 400;

const VOICES = {
  baseten: {
    url: (env) => env.BASETEN_TTS_URL,
    key: (env) => env.BASETEN_API_KEY,
    body: (b) => ({ text: b.text, language: b.model, voice: b.voice ?? "alba" }),
  },
  groq: {
    url: () => "https://api.groq.com/openai/v1/audio/speech",
    key: (env) => env.GROQ_API_KEY,
    body: (b) => ({ model: b.model, input: b.text, voice: b.voice ?? "autumn", response_format: "wav" }),
  },
};

export async function onRequestPost({ request, env }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("bad origin", { status: 403 });
  let body;
  try { body = await request.json(); } catch { return new Response("bad json", { status: 400 }); }
  const name = body.provider ?? "groq";
  if (!Object.hasOwn(VOICES, name)) return new Response("unknown provider", { status: 400 });
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TTS_CHARS) return new Response("bad text", { status: 400 });
  if (typeof body.model !== "string" || !/^[\w.\-/:]+$/.test(body.model)) return new Response("bad model", { status: 400 });
  if (body.voice !== undefined && !/^[\w.\-]{1,64}$/.test(body.voice)) return new Response("bad voice", { status: 400 });
  const voice = VOICES[name];
  const key = voice.key(env);
  if (!key) return new Response(`no API key for ${name}`, { status: 500 });
  const url = voice.url(env);
  if (!url) return new Response("no BASETEN_TTS_URL: deploy truss-pocket-tts/ and set it to the predict URL", { status: 500 });
  const up = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(voice.body(body)),
  });
  return new Response(up.body, { status: up.status, headers: { "Content-Type": up.headers.get("content-type") ?? "audio/wav", "Cache-Control": "no-store" } });
}
