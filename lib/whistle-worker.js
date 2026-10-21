// Whistle speech-to-text for mic.mjs: loads the model once, then transcribes each segment it is sent.

const ENGINE = "https://huggingface.co/Cactus-Compute/needle3/resolve/c7c415a3d1b3d929014bc6e866d51ebb971f7089/wasm";
const MODEL = "https://huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact";
const CAP = 16384;

async function get(url, name) {
  let cache;
  try { cache = await caches.open(name); const hit = await cache.match(url); if (hit) return hit; } catch {}
  const r = await fetch(url);
  if (!r.ok) throw new Error("download failed: " + url);
  try { await cache.put(url, r.clone()); } catch {}
  return r;
}

async function load() {
  const [js, wasm, model] = await Promise.all([
    get(ENGINE + "/needle.js", "whistle-v1").then(r => r.text()),
    get(ENGINE + "/needle.wasm", "whistle-v1").then(r => r.arrayBuffer()),
    get(MODEL, "whistle-v1").then(r => r.arrayBuffer()),
  ]);
  importScripts(URL.createObjectURL(new Blob([js], { type: "text/javascript" })));
  const m = await createNeedle({ wasmBinary: wasm });
  const bytes = new Uint8Array(model);
  const p = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, p);
  if (m._needle_load(p, BigInt(bytes.length)) !== 0) throw new Error("model load failed");
  return { m, out: m._malloc(CAP) };
}

const ready = load();
ready.then(() => postMessage({ type: "ready" }), e => postMessage({ type: "error", message: String(e.message || e) }));

onmessage = async ({ data }) => {
  try {
    const { m, out } = await ready;
    const pcm = m._malloc(data.audio.byteLength);
    m.HEAPU8.set(new Uint8Array(data.audio.buffer), pcm);
    const n = m._needle_transcribe(pcm, data.audio.length, 0, 0, 0, out, CAP);
    m._free(pcm);
    if (n < 0) throw new Error("transcription failed");
    postMessage({ type: "transcript", sent: data.sent, transcript: JSON.parse(m.UTF8ToString(out)) });
  } catch (e) {
    postMessage({ type: "error", sent: data.sent, message: String(e.message || e) });
  }
};
