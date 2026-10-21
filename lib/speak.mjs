// Phonon text-to-speech in the browser: speaks parts back to back and reports the output level.
import { TOTAL, cache_checkpoint, model_spec } from "./phonon-checkpoint.mjs";

export function create_voice(on = {}) {
  const samples = new Float32Array(1024);
  let shown = 0, tts = null, ctx = null, analyser = null, current = null;

  // Settles on failure too, so say() never waits on a model that will not load.
  let done = 0;
  const ready = import("./phonon-0.4.0/index.js").then(async ({ PhononTTS }) => {
    await cache_checkpoint({
      bytes: (n, network) => {
        done += n;
        if (!network) return; // already cached: nothing to show unless something downloads
        const now = performance.now();
        if (now - shown < 100 && done < TOTAL) return;
        shown = now;
        on.progress?.(done, TOTAL);
      },
    });
    return PhononTTS.load({ lang: "en", quant: "q8", device: "cpu", model: model_spec() });
  }).then(
    (model) => { tts = model; on.ready?.(); },
    (e) => on.error?.(e.message),
  );

  function settle(run) {
    if (current === run) current = null;
    for (const src of run.sources) src.stop();
    for (const t of run.timers) clearTimeout(t);
    run.resolve();
  }

  function stop() {
    if (!current) return;
    current.speech?.cancel();
    settle(current);
  }

  async function play(run, parts) {
    await ready;
    if (!tts) return settle(run);
    if (!ctx) { // only once the model is loaded: its sample rate sets the context's
      ctx = new AudioContext({ sampleRate: tts.sampleRate });
      analyser = ctx.createAnalyser();
      analyser.fftSize = samples.length;
      analyser.connect(ctx.destination);
    }
    await ctx.resume();
    let at = ctx.currentTime + 0.03; // scheduled ahead of the clock, so the first chunk never starts late
    let spoken = false;
    for (const [i, part] of parts.entries()) {
      if (current !== run) return;
      if (!/[\p{L}\p{N}]/u.test(part)) continue;
      if (spoken) at += 0.15;
      spoken = true;
      let first = true;
      run.speech = tts.stream(part);
      for await (const pcm of run.speech) {
        if (current !== run) return;
        const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
        buf.copyToChannel(pcm.map((x) => x * 2), 0); // Phonon peaks at 0.42-0.45, so 2 lands just under full scale
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(analyser);
        at = Math.max(at, ctx.currentTime + 0.005); // generation fell behind: start now, not in the past
        if (first) run.timers.push(setTimeout(() => run.on_part?.(i), (at - ctx.currentTime) * 1000));
        first = false;
        src.start(at);
        run.sources.push(src);
        at += buf.duration;
      }
    }
    if (current === run) run.timers.push(setTimeout(() => settle(run), (at - ctx.currentTime) * 1000));
  }

  return {
    ready,
    resume() { ctx?.resume(); },
    say(parts, on_part) {
      stop();
      return new Promise((resolve) => {
        const run = { on_part, resolve, speech: null, sources: [], timers: [] };
        current = run;
        play(run, parts).catch((e) => {
          if (current === run) on.error?.(e.message);
          settle(run);
        });
      });
    },
    stop,
    get speaking() { return current !== null; },
    level() {
      if (!current || !analyser) return 0;
      analyser.getFloatTimeDomainData(samples);
      return Math.min(1, 4 * Math.sqrt(samples.reduce((a, x) => a + x * x, 0) / samples.length));
    },
  };
}
