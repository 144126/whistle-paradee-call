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

async function file_handle(value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("edit.files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("handles", value === undefined ? "readonly" : "readwrite");
      const request = value === undefined ? transaction.objectStore("handles").get("current")
        : transaction.objectStore("handles").put(value, "current");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function create_doc(on_save = () => {}) {
  let version = 0, writing = Promise.resolve();
  if (kept("edit.doc") === null) {
    keep("edit.doc", WELCOME);
    keep("edit.name", "welcome.md");
  }
  const doc = {
    lines: (kept("edit.doc") ?? WELCOME).split("\n"),
    name: kept("edit.name"),
    handle: null,
    dirty: kept("edit.dirty") === "1",
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
      if (handle) await handle.requestPermission({ mode: "readwrite" });
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
      if (!doc.handle) return false;
      if ((await doc.handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("allow file access to enable autosave");
      doc.name = doc.handle.name;
      keep("edit.name", doc.name);
      await file_handle(doc.handle).catch(() => {});
      await write();
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
    version++;
    doc.dirty = true;
    keep("edit.dirty", "1");
    keep("edit.doc", doc.lines.join("\n"));
    if (doc.handle) write().catch((e) => on_save(`autosave failed: ${e.message} · press save to retry`, true));
    else on_save("choose save to enable autosave");
  }

  function write() {
    const handle = doc.handle, text = doc.lines.join("\n") + "\n", revision = version;
    on_save("saving…");
    writing = writing.catch(() => {}).then(async () => {
      if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") throw new Error("file permission needed");
      const out = await handle.createWritable();
      try { await out.write(text); await out.close(); }
      catch (e) { await out.abort().catch(() => {}); throw e; }
      if (handle === doc.handle && revision === version) {
        doc.dirty = false;
        keep("edit.dirty", "0");
        on_save("saved to disk");
      }
    });
    return writing;
  }

  async function load(file, handle) {
    const text = await file.text();
    version++;
    Object.assign(doc, {
      lines: text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"),
      name: file.name, handle: handle?.kind === "file" ? handle : null, dirty: false, anchor: 0, head: 0, undos: [], redos: [],
    });
    keep("edit.doc", doc.lines.join("\n"));
    keep("edit.name", doc.name);
    keep("edit.dirty", "0");
    await file_handle(doc.handle).catch(() => {});
    on_save(doc.handle ? "autosave on" : "choose save to enable autosave");
    return true;
  }

  doc.ready = file_handle().then(async (handle) => {
    if (!handle || doc.handle || version || handle.name !== doc.name) return;
    doc.handle = handle;
    if (doc.dirty) await write();
    else if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") on_save("autosave on");
    else on_save("autosave needs file access · press save", true);
  }).catch((e) => { if (doc.handle) on_save(`autosave needs file access · press save: ${e.message}`, true); });

  return doc;
}

function cancelled(e) {
  if (e.name === "AbortError") return [];
  throw e;
}
