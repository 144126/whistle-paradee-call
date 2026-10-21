// Microphone capture for Whistle: cuts speech at pauses, sends each piece to a worker, and groups the pieces into turns.

const SILENCE_MS = 270;   // pause that ends a segment, which is then transcribed
const FRAME_MS = 20;
const MAX_SEGMENT_MS = 25000;
const MIN_SPEECH_MS = 200;
const PREROLL_FRAMES = 10;
const TAIL_FRAMES = 10;

const rms = (f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / f.length); };

function to16k(frames, rate) {
  const pcm = new Float32Array(frames.reduce((a, f) => a + f.length, 0));
  frames.reduce((o, f) => (pcm.set(f, o), o + f.length), 0);
  if (rate === 16000) return pcm;
  const out = new Float32Array(Math.floor((pcm.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) {
    const x = (i * rate) / 16000, j = x | 0, f = x - j;
    out[i] = pcm[j] * (1 - f) + (pcm[j + 1] ?? pcm[j]) * f;
  }
  return out;
}

async function open_mic() {
  if (!navigator.mediaDevices) throw new Error("needs https or localhost");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  try {
    let ctx, src;
    try { ctx = new AudioContext({ sampleRate: 16000 }); src = ctx.createMediaStreamSource(stream); }
    catch { ctx?.close(); ctx = new AudioContext(); src = ctx.createMediaStreamSource(stream); }
    await ctx.audioWorklet.addModule(new URL("./rec-worklet.js", import.meta.url));
    const node = new AudioWorkletNode(ctx, "rec", { numberOfOutputs: 0 });
    src.connect(node);
    return { stream, ctx, node };
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
}

function segmenter(rate, send) {
  let floor = 0.005, preroll = [], seg = null, onset = 0, silent = 0, voiced = 0, quiet = 0;
  const cut = () => {
    if (voiced * FRAME_MS >= MIN_SPEECH_MS) send(to16k(seg.slice(0, seg.length - Math.max(0, silent - TAIL_FRAMES)), rate));
    seg = null; preroll = []; onset = 0; silent = 0; voiced = 0;
  };
  return {
    get floor() { return floor; },
    get inSpeech() { return !!seg; },
    get quietMs() { return quiet * FRAME_MS; },
    feed(f) {
      const loud = rms(f) > Math.max(0.01, floor * 4);
      quiet = loud ? 0 : quiet + 1;
      if (!seg) {
        if (!loud) floor = Math.max(0.002, floor * 0.95 + rms(f) * 0.05);
        preroll.push(f);
        if (preroll.length > PREROLL_FRAMES) preroll.shift();
        onset = loud ? onset + 1 : 0;
        if (onset >= 2) { seg = preroll; voiced = onset; silent = 0; }
        return;
      }
      seg.push(f);
      if (loud) { silent = 0; voiced++; } else silent++;
      if (silent * FRAME_MS >= SILENCE_MS || seg.length * FRAME_MS >= MAX_SEGMENT_MS) cut();
    },
    flush() { if (seg) cut(); },
  };
}

export function create_ear(on = {}, transcribe = null) {
  const worker = transcribe ? null : new Worker(new URL("./whistle-worker.js", import.meta.url));
  let chain = Promise.resolve();
  const flight = [];   // the turn of each segment sent and not yet answered; the worker answers in order
  let turn = null;     // { text, pending } for the turn in progress
  let listening = false, mic = null, seg = null;

  // the turn is over: it fires now, or once its last pieces are back
  function end_turn() {
    const t = turn;
    turn = null;
    if (!t.pending) on.turn?.(t.text);
  }

  function maybe_end() {
    if (turn && !turn.pending && !seg.inSpeech && seg.quietMs >= ear.turn_ms) end_turn();
  }

  function on_frame(f) {
    if (!listening) return;
    seg.feed(f);
    if (seg.inSpeech && !turn) { turn = { text: "", pending: 0 }; on.hear?.(); }
    on.level?.(Math.min(1, Math.max(0, (rms(f) - seg.floor * 2) / 0.08)));
    maybe_end();
  }

  const answer = ({ data }) => {
    if (data.type === "ready") return on.ready?.();
    if (data.sent === undefined) return on.error?.(data.message);
    const t = flight.shift();
    t.pending--;
    const text = data.transcript?.text.trim();
    if (text) t.text = (t.text + " " + text).trim();
    if (t === turn) {
      if (text) on.words?.(t.text);
      maybe_end();
    } else if (!t.pending) on.turn?.(t.text);
    if (data.type === "error") on.error?.(data.message);
  };
  if (worker) worker.onmessage = answer;
  else queueMicrotask(() => on.ready?.());

  const ear = {
    turn_ms: 2160,   // silence that ends a turn; Infinity leaves the end to listen(false)
    async open() {
      mic = await open_mic();
      seg = segmenter(mic.ctx.sampleRate, (audio) => {
        turn.pending++;
        flight.push(turn);
        const sent = performance.now();
        if (worker) worker.postMessage({ audio, sent }, [audio.buffer]);
        else chain = chain.then(() => transcribe(audio)).then(
          (text) => answer({ data: { type: "transcript", sent, transcript: { text } } }),
          (error) => answer({ data: { type: "error", sent, message: error.message } }),
        );
      });
      mic.node.port.onmessage = ({ data }) => on_frame(data);
    },
    resume() { mic?.ctx.resume(); },
    listen(enabled) {
      if (enabled === listening) return;
      listening = enabled;
      if (enabled) return;
      on.level?.(0);
      seg?.flush();
      if (turn) end_turn();
    },
    close() {
      ear.listen(false);
      mic?.stream.getTracks().forEach((t) => t.stop());
      mic?.ctx.close();
      mic = null;
    },
  };
  return ear;
}
