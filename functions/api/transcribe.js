export async function onRequestPost({ request, env }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("bad origin", { status: 403 });
  if (!env.WHISTLE_OPENROUTER_KEY) return new Response("add an OpenRouter API key in settings", { status: 503 });
  const raw = await request.text();
  if (raw.length > 1_100_000) return new Response("audio too large", { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (typeof body?.model !== "string" || !/^[\w.\-/:]+$/.test(body.model) || body.input_audio?.format !== "wav" ||
      typeof body.input_audio.data !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(body.input_audio.data)) return new Response("bad audio", { status: 400 });
  try {
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.WHISTLE_OPENROUTER_KEY}` },
      body: JSON.stringify({ model: body.model, input_audio: body.input_audio }),
    });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return new Response("OpenRouter unavailable", { status: 502 }); }
}
