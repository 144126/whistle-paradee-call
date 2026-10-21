export function selection(rows) {
  let text = "";
  const nodes = [];
  for (const row of rows) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement.closest(".mark")) continue;
      nodes.push({ node: walker.currentNode, start: text.length, end: text.length + walker.currentNode.length });
      text += walker.currentNode.textContent;
    }
    text += "\n";
  }
  return { text: text.slice(0, -1), nodes };
}

export async function detect(text, signal) {
  const response = await fetch("/api/detect", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: text }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function highlight({ text, nodes }, passages) {
  const ranges = [];
  for (const passage of new Set(passages)) {
    if (typeof passage !== "string" || !passage.trim()) continue;
    const pattern = passage.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    for (const match of text.matchAll(new RegExp(pattern, "giu"))) {
      const start = nodes.find((part) => part.end > match.index);
      const end = nodes.find((part) => part.end >= match.index + match[0].length);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, Math.max(0, match.index - start.start));
      range.setEnd(end.node, match.index + match[0].length - end.start);
      ranges.push(range);
    }
  }
  CSS.highlights.set("ai", new Highlight(...ranges));
  return ranges.length;
}
