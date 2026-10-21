// Markdown rendered one source line at a time, so row n on screen is always line n of the file.
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escape = (s) => s.replace(/[&<>"]/g, (c) => ESC[c]);
const EMPHASIS = [
  [/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, "<strong><em>$1</em></strong>"],
  [/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>"],
  [/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "<strong>$1</strong>"],
  [/\*(?=\S)(.+?)(?<=\S)\*/g, "<em>$1</em>"],
  [/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "<em>$1</em>"],
  [/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>"],
];

// html for one line's inline markdown, or with plain, only its words (for speech)
function inline(text, plain) {
  const held = [];
  // finished pieces wait in placeholders, so no later rule rewrites them
  const hold = (html, words) => `\u0000${held.push(plain ? words : html) - 1}\u0000`;
  const link = (html, words) => hold(`<span class="link">${html}</span>`, words);
  let s = text
    .replace(/(`+)(.+?)\1(?!`)/g, (_, __, code) => hold(`<code>${escape(code.replace(/^ (.+) $/, "$1"))}</code>`, code.trim()))
    .replace(/\\([!-/:-@[-`{-~])/g, (_, c) => hold(escape(c), c))
    .replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (_, alt) => hold(`<span class="img">${escape(alt || "image")}</span>`, alt || "image"))
    .replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, (_, words) => link(inline(words), inline(words, true)))
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => link(escape(url), url))
    .replace(/https?:\/\/[^\s<]*[^\s<.,;:!?)]/g, (url) => link(escape(url), url));
  if (!plain) s = escape(s);
  for (const [rule, html] of EMPHASIS) s = s.replace(rule, plain ? "$1" : html);
  if (plain) s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
  return plain ? s.replace(/\s+/g, " ").trim() : s;
}

const line = (kind, text, extra) => ({ kind, html: inline(text), speech: inline(text, true), ...extra });
const empty = (kind, extra) => ({ kind, html: "", speech: "", ...extra });
const listed = (kind, mark, text) => ({ kind, html: `${mark}<span class="text">${inline(text)}</span>`, speech: inline(text, true) });

export function render(lines) {
  let fence = ""; // the open fence's marker, or "" outside code
  let stack = []; // indents of the open list items
  const depth = (indent) => {
    const n = indent.replace(/\t/g, "    ").length;
    while (stack.length && stack.at(-1) > n) stack.pop();
    if (!stack.length || n >= stack.at(-1) + 2) stack.push(n);
    return stack.length - 1;
  };
  return lines.map((text) => {
    if (fence) {
      const close = text.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = "";
        return empty("fence", { edge: "bottom" });
      }
      return { kind: "code", html: escape(text), speech: text.trim() };
    }
    if (!text.trim()) return empty("blank");
    const open = text.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    const task = text.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    const item = text.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/);
    const heading = text.match(/^\s{0,3}(#{1,6})(?:\s+(.*))?$/);
    const quote = text.match(/^\s{0,3}((?:>\s?)+)(.*)$/);
    if (task) {
      const done = task[2] !== " ";
      return { ...listed("task", '<span class="mark box"></span>', task[3]), depth: depth(task[1]), done, speech: (done ? "done, " : "") + inline(task[3], true) };
    }
    if (item && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) {
      const ordered = /\d/.test(item[2]);
      return { ...listed(ordered ? "ol" : "li", `<span class="mark">${ordered ? item[2] : "•"}</span>`, item[3]), depth: depth(item[1]) };
    }
    stack = [];
    if (open) {
      fence = open[1];
      return { kind: "fence", edge: "top", html: escape(open[2]), speech: "" };
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) return empty("hr");
    if (heading) return line("h" + heading[1].length, (heading[2] ?? "").replace(/(^|\s+)#+\s*$/, "").trim());
    if (quote) return { ...line("quote", quote[2].trim(), { depth: quote[1].split(">").length - 2 }), html: `<span class="text">${inline(quote[2].trim())}</span>` };
    if (text.trim().startsWith("|")) {
      if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text)) return empty("table-sep");
      const cells = text.trim().replace(/^\||(?<!\\)\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
      return {
        kind: "table",
        html: cells.map((c) => `<span class="cell">${inline(c)}</span>`).join(""),
        speech: cells.map((c) => inline(c, true)).join(", "),
        cols: cells.length,
      };
    }
    return line("p", text.trim());
  });
}
