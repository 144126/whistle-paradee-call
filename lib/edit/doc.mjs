// The document: its lines, the selection, undo and redo, and where it is kept (this browser always,
// and the file on disk once it came from one or was saved to one).
const WELCOME = `# edit

talk to this page to change it.

- ↑ ↓ picks a line, shift ↑ ↓ picks more.
- the line you land on is read to you.
- say what to change. stop talking and it changes.
- ctrl+z takes it back.

## try it

this sentence is far too long, and it wanders on about nothing in particular for quite a while before it ends.

- [ ] pick the line above and say "make it shorter"
- [ ] pick an empty line and say "three bullet points about coffee"

open your own file with ctrl+o, or drop one here.`;
const TYPES = [{ description: "markdown", accept: { "text/markdown": [".md", ".markdown", ".txt"] } }];

const kept = (k) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const keep = (k, v) => {
  try { localStorage.setItem(k, v); } catch {}
};

export function create_doc() {
  if (kept("edit.doc") === null) {
    keep("edit.doc", WELCOME);
    keep("edit.name", "welcome.md");
  }
  const doc = {
    lines: (kept("edit.doc") ?? WELCOME).split("\n"),
    name: kept("edit.name"),
    handle: null,
    dirty: false,
    anchor: 0,
    head: 0,
    undos: [],
    redos: [],
    get start() { return Math.min(doc.anchor, doc.head); },
    get end() { return Math.max(doc.anchor, doc.head); },
    select(i, extend) {
      doc.head = Math.max(0, Math.min(doc.lines.length - 1, i));
      if (!extend) doc.anchor = doc.head;
    },
    replace(start, end, lines) {
      doc.undos.push(snap());
      doc.redos = [];
      doc.lines.splice(start, end - start + 1, ...lines);
      if (!doc.lines.length) doc.lines.push("");
      doc.anchor = Math.min(start, doc.lines.length - 1);
      doc.head = Math.max(doc.anchor, start + lines.length - 1);
      changed();
    },
    undo: () => step(doc.undos, doc.redos),
    redo: () => step(doc.redos, doc.undos),
    async open() {
      const [handle] = await showOpenFilePicker({ types: TYPES }).catch(cancelled);
      return Boolean(handle) && load(await handle.getFile(), handle);
    },
    // both reads start before the first await: a drop's items are gone once the event returns
    async drop(data) {
      const item = [...data.items].find((i) => i.kind === "file");
      const file = item?.getAsFile();
      const handle = item?.getAsFileSystemHandle?.().catch(() => null);
      if (!file || !/\.(md|markdown|mdx|txt)$/i.test(file.name)) return false;
      return load(file, await handle);
    },
    async save() {
      doc.handle ??= await showSaveFilePicker({ suggestedName: doc.name ?? "untitled.md", types: TYPES }).catch(cancelled);
      if (!doc.handle || (await doc.handle.requestPermission({ mode: "readwrite" })) !== "granted") return false;
      const out = await doc.handle.createWritable();
      await out.write(doc.lines.join("\n") + "\n");
      await out.close();
      doc.name = doc.handle.name;
      doc.dirty = false;
      keep("edit.name", doc.name);
      return true;
    },
  };

  const snap = () => ({ lines: doc.lines.slice(), anchor: doc.anchor, head: doc.head });

  function step(from, to) {
    if (!from.length) return false;
    to.push(snap());
    Object.assign(doc, from.pop());
    changed();
    return true;
  }

  function changed() {
    doc.dirty = true;
    keep("edit.doc", doc.lines.join("\n"));
  }

  async function load(file, handle) {
    const text = await file.text();
    Object.assign(doc, {
      lines: text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"),
      name: file.name, handle: handle?.kind === "file" ? handle : null, dirty: false, anchor: 0, head: 0, undos: [], redos: [],
    });
    keep("edit.doc", doc.lines.join("\n"));
    keep("edit.name", doc.name);
    return true;
  }

  return doc;
}

function cancelled(e) {
  if (e.name === "AbortError") return [];
  throw e;
}
