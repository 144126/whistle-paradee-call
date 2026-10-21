// The Phonon checkpoint, committed in this repo under models/ and pinned to one Hugging Face commit,
// so every page loads it from its own origin: server.mjs here, Cloudflare Pages and Lambda deployed.
// The weights are split into 8 MiB parts, because Pages refuses any file over 25 MiB, which also
// makes a first download resumable part by part. Every page that loads Phonon goes through
// cache_checkpoint() and then model_spec().

export const CHECKPOINT = {
  repo: "gradium/phonon-31m-en",
  commit: "8c64b55ec301728e2d1695bfea87a08a267d0c2d",
  dir: "models/phonon-31m-en-8c64b55/", // a new commit goes in a new directory, so no cached file is ever stale
  part: 8 << 20,
  files: {
    "config.json": 2851,
    "tokenizer.json": 277967,
    "default-voice.safetensors": 256136,
    "model.q8.gguf": 64512352,
  },
};
export const TOTAL = Object.values(CHECKPOINT.files).reduce((a, b) => a + b, 0);

const CACHE = "phonon-tts-v1"; // CACHE_NAME in lib/phonon-0.4.0/fetch.js: the package reads its files from here before the network
// relative to this module rather than the page, so a page in any directory finds the same files
const from = () => new URL("../" + CHECKPOINT.dir, import.meta.url).href;

// Where the package should look. The weights URL is only a cache key: on the server the file
// exists as parts, and cache_checkpoint() has put the whole of it in the cache under this name.
export function model_spec() {
  const at = from();
  return {
    weights: { q8: at + "model.q8.gguf" },
    tokenizer: at + "tokenizer.json",
    config: at + "config.json",
    voices: { default: at + "default-voice.safetensors" },
    defaultVoice: "default",
  };
}

async function read(url, on_bytes) {
  const res = await fetch(url, { cache: "no-store" }); // kept in the Cache API; the HTTP cache keeping it too would store it twice
  if (!res.ok) throw new Error(`${url.split("/").pop()} answered HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks);
    chunks.push(value);
    on_bytes(value.length, true);
  }
}

// Fills the package's cache with every file, so PhononTTS.load() never touches the network. Files
// already there count at once (on.bytes(n, false)), the rest as they arrive (on.bytes(n, true)).
// The parts download in order, one at a time (parallel requests measured slower on a saturated
// line), each kept under its own URL until all are in, so a closed tab resumes where it stopped.
// The small files go alongside. Then the parts make one entry for the package, and anything this
// cache still holds from older checkpoints or the Hub goes.
export async function cache_checkpoint(on = {}) {
  const bytes = on.bytes ?? (() => {});
  const cache = typeof caches === "undefined" ? null : await caches.open(CACHE).catch(() => null);
  if (!cache) throw new Error("this page has no Cache API (it needs https or localhost), which the voice loads through");
  const at = from();
  await Promise.all(Object.entries(CHECKPOINT.files).map(async ([name, size]) => {
    const url = at + name;
    if (await cache.match(url)) return bytes(size, false);
    if (size <= CHECKPOINT.part) return cache.put(url, new Response(await read(url, bytes)));
    const parts = [];
    for (let i = 0; i * CHECKPOINT.part < size; i++) {
      const key = `${url}.part${i}`;
      const want = Math.min(CHECKPOINT.part, size - i * CHECKPOINT.part);
      let part = await cache.match(key).then((r) => r?.blob());
      if (part?.size === want) bytes(want, false);
      else {
        part = await read(key, bytes);
        if (part.size !== want) throw new Error(`${name} part ${i} arrived as ${part.size} bytes, not ${want}`);
        await cache.put(key, new Response(part));
      }
      parts.push(part);
    }
    on.saving?.(); // one more write of the whole file: seconds on a slow disk
    await cache.put(url, new Response(new Blob(parts), { headers: { "content-length": String(size) } }));
    await Promise.all(parts.map((_, i) => cache.delete(`${url}.part${i}`)));
  }));
  for (const request of await cache.keys()) if (!request.url.startsWith(at)) await cache.delete(request);
}
