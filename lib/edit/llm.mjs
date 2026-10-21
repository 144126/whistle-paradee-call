// One edit: the selected lines and what was said go to an OpenAI-compatible chat model, and its reply replaces the lines.
const SYSTEM = [
  "You edit part of a markdown document for someone who speaks their instructions.",
  "You get the selected lines and the instruction. Speech recognition wrote the instruction down, so read past small mistakes in it.",
  "Reply with only the new lines as raw markdown: no code fence around them, no quotes, no explanation.",
  "Change only what the instruction asks for and keep everything else exactly as it is.",
  "To delete the lines, reply with nothing.",
].join(" ");

// proxy: no key in this browser, so the page's own server (server.mjs /api/chat) calls Groq with its key
export async function rewrite({ base, key, model, proxy }, lines, instruction, signal) {
  const res = await fetch(proxy ? "/api/chat" : base.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...(!proxy && { Authorization: "Bearer " + key }) },
    body: JSON.stringify({
      ...(proxy && { provider: "groq" }),
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `<lines>\n${lines}\n</lines>\n<instruction>${instruction}</instruction>` },
      ],
      // Groq runs qwen3 with thinking on unless told otherwise, which costs seconds on every edit
      ...(/^qwen\/qwen3/.test(model) && (proxy || base.includes("api.groq.com")) && { reasoning_effort: "none" }),
    }),
  });
  if (!res.ok) throw new Error(`the model answered ${res.status}: ${(await res.text()).slice(0, 140)}`);
  return ((await res.json()).choices?.[0]?.message?.content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*<lines>\n?|\n?<\/lines>\s*$/g, "")
    .replace(/^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/, lines.trimStart().startsWith("```") ? "$&" : "$1")
    .replace(/^\n+|\s+$/g, "");
}
