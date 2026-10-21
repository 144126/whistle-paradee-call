// Motion from springs, not durations: each value is a unit mass pulled to its target, so a new target
// mid-flight keeps the velocity it already has. Hz and damping ratio come from the feel vocabulary.
export const FEEL = {
  tight: [4.2, 0.85],
  snappy: [3.4, 0.82],
  crisp: [3.8, 0.92],
  quick: [3.6, 0.95],
  light: [3, 0.62],
  smooth: [1.8, 1],
};

const STEP = 1 / 240;
const moving = new Set();
const painters = new Set();
const calm = matchMedia("(prefers-reduced-motion: reduce)");
let frame = 0;
let last = 0;

export function spring(feel, x = 0, rest = 0.05) {
  const s = {
    x, v: 0, target: x, k: 0, c: 0, rest,
    tune([hz, zeta]) {
      s.k = (2 * Math.PI * hz) ** 2;
      s.c = 2 * zeta * Math.sqrt(s.k);
      return s;
    },
    to(target) {
      s.target = target;
      if (calm.matches) { s.x = target; s.v = 0; }
      return go(s);
    },
    jump(target) {
      s.x = s.target = target;
      s.v = 0;
      return go(s);
    },
    kick(v) {
      if (!calm.matches) s.v += v;
      return go(s);
    },
  };
  return s.tune(feel);
}

export const on_frame = (paint) => painters.add(paint);

export function wake() {
  if (frame) return;
  last = performance.now();
  frame = requestAnimationFrame(tick);
}

function go(s) {
  moving.add(s);
  wake();
  return s;
}

function tick(now) {
  const dt = Math.min(0.064, (now - last) / 1000);
  last = now;
  for (const s of moving) {
    for (let t = 0; t < dt; t += STEP) {
      const h = Math.min(STEP, dt - t);
      s.v += (s.k * (s.target - s.x) - s.c * s.v) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.target - s.x) < s.rest && Math.abs(s.v) < s.rest * 20) {
      s.x = s.target;
      s.v = 0;
      moving.delete(s);
    }
  }
  for (const paint of painters) paint();
  frame = moving.size ? requestAnimationFrame(tick) : 0;
}
