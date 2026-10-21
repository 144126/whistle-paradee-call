// The model side of a live voice call: the reply streams in from the page's server (/api/chat), or
// straight from a provider when the page holds its key, and is cut into pieces a voice can start on
// before the reply has finished arriving. index.html and phonon.html both call through this.

export const SYSTEM = "You are on a live voice call. Answer in one to three short, plain spoken sentences. No markdown, lists, emojis, code or stage directions. Sound like a person talking.";

// Only delta.content is spoken; reasoning models also stream delta.reasoning, which is ignored.
// `direct` ({ url, key }) calls the provider itself; without it the page's server holds the key.
export async function stream_chat({ provider, model, messages, signal, direct }, on_delta) {
  const res = await fetch(direct?.url ?? "/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...(direct && { Authorization: "Bearer " + direct.key }) },
    body: JSON.stringify({
      ...(!direct && { provider }),
      model, messages, stream: true, max_tokens: 150, temperature: 0.7,
      ...(model.includes("gpt-oss") && { reasoning_effort: "low" }),
      ...(provider === "groq" && model === "qwen/qwen3.8-27b" && { reasoning_effort: "none" }),
    }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new Error(j.error.message || "stream error");
      const d = j.choices?.[0]?.delta?.content;
      if (d) on_delta(d);
    }
  }
}

// Whole sentences go to `say` as soon as each is complete. The exception is the first piece, which
// starts at the first clause break past 20 characters, so the voice begins before the opening
// sentence has finished arriving. Markdown marks and emoji are dropped: they would be read out.
export function pieces(say) {
  let buf = "", started = false;
  return {
    add(delta) {
      buf += delta.replace(/[*_`#>~|\u200d\ufe0f]|\p{Extended_Pictographic}/gu, ""); // with the joiners and selectors emoji leave behind
      const sentences = buf.split(/(?<=[.!?…])\s+/);
      buf = sentences.pop();
      if (sentences.length) { say(sentences.join(" ")); started = true; }
      else if (!started) {
        const clause = buf.match(/^(.{20,}?[,;:—])\s+/s);
        if (clause) { say(clause[1]); buf = buf.slice(clause[0].length); started = true; }
      }
    },
    end() {
      if (buf.trim()) say(buf);
      buf = "";
    },
  };
}
