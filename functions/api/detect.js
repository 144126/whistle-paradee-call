export async function onRequestPost({ request }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("bad origin", { status: 403 });
  const raw = await request.text();
  if (raw.length > 100_000) return new Response("text too large", { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (typeof body?.t !== "string" || !body.t.trim() || body.t.length > 15_000) {
    return new Response("select 1–15,000 characters to check", { status: 400 });
  }
  try {
    const response = await fetch("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.zerogpt.com",
        Referer: "https://www.zerogpt.com/",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ input_text: body.t }),
    });
    if (!response.ok) return new Response(`ZeroGPT HTTP ${response.status}`, { status: 502 });
    const result = await response.json();
    if (!result.success || !Number.isFinite(result.data?.fakePercentage) || !Array.isArray(result.data?.h)) {
      return new Response(result.message || "ZeroGPT returned no detection result", { status: 502 });
    }
    // s: suspected AI percentage; v: verdict; p: flagged passages.
    return Response.json({ s: result.data.fakePercentage, v: result.data.feedback, p: result.data.h }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch { return new Response("ZeroGPT unavailable; try again", { status: 502 }); }
}
