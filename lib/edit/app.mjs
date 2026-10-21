// The editor: rendered markdown you move through with the keyboard, read aloud by Phonon,
// and changed by what you say (Whistle hears it, a chat model rewrites the selected lines).
import { create_ear } from "../mic.mjs";
import { create_voice } from "../speak.mjs";
import { create_doc } from "./doc.mjs";
import { rewrite } from "./llm.mjs";
import { render } from "./render.mjs";
import { ACTIONS, save, settings } from "./settings.mjs";
import { combo, label, lone, releases } from "./keys.mjs";
import { FEEL, on_frame, spring } from "./spring.mjs";

const $ = (id) => document.getElementById(id);
const REST_MS = 180; // holding an arrow passes lines faster than this, and they are not read
const PAD = 3; // px the box reaches past its rows
const EDGE = 120; // px kept between the box and the window's edges when following it
const mb = (n) => Math.round(n / 1e6);

const doc = create_doc();
const box = { top: spring(FEEL.snappy), bottom: spring(FEEL.snappy) };
const reader = { top: spring(FEEL.snappy), bottom: spring(FEEL.snappy), shown: spring(FEEL.snappy, 0, 0.002) };
const scroller = spring(FEEL.quick, scrollY, 0.5);
const shift = spring(FEEL.snappy, 0, 0.3);
const heard = spring(FEEL.light, 0, 0.002);
const voiced = spring(FEEL.light, 0, 0.002);
const drawer = spring(FEEL.crisp, 0, 0.001);
const loaded = spring(FEEL.smooth, 0, 0.001);

let rows = [], tops = [], heights = [], speech = [], cover = [], lit = new Set(), shifted = -1, scrolled = scrollY;
let server_groq = false, ear_ready = false, mic_open = false, mic_failed = "", listening = false, held = false, muted = false;
let voice_ready = false, voice_note = "loading the voice", voice_busy = false, say_id = 0, speak_timer = 0, level_timer = 0, flash_timer = 0;
let hearing = null, discard = false, job = null, queue = [], capture = null;

// ---------- the page ----------

function draw(born) {
  const out = render(doc.lines);
  speech = out.map((r) => r.speech);
  $("rows").innerHTML = out.map((r) => `<div class="row" data-kind="${r.kind}"` +
    (r.edge ? ` data-edge="${r.edge}"` : "") + (r.done ? " data-done" : "") +
    (r.depth ? ` style="--depth:${r.depth}"` : r.cols ? ` style="--cols:${r.cols}"` : "") + `>${r.html}</div>`).join("");
  rows = [...$("rows").children];
  if (born) rows.slice(born[0], born[1] + 1).forEach((row, i) => { row.classList.add("born"); row.style.setProperty("--i", i); });
  cover = [];
  lit = new Set();
  shifted = -1;
  measure();
  name();
  $("hint").hidden = doc.lines.length > 1 || doc.lines[0] !== "";
}

function name() {
  $("name").textContent = doc.name ?? "untitled.md";
  document.body.toggleAttribute("data-dirty", doc.dirty);
  document.title = (doc.dirty ? "• " : "") + (doc.name ?? "edit");
}

function measure() {
  tops = rows.map((r) => r.offsetTop);
  heights = rows.map((r) => r.offsetHeight);
  if (job) show_work(job);
}

// the first row whose bottom is below y
function row_at(y) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] + heights[mid] > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function place(jump) {
  const top = tops[doc.start] - PAD;
  const bottom = tops[doc.end] + heights[doc.end] + PAD;
  if (jump) {
    box.top.jump(top);
    box.bottom.jump(bottom);
  } else {
    // the edge in front leads and the one behind follows a little softer, so the box stretches the way it moves
    const down = top + bottom > box.top.target + box.bottom.target;
    box.top.tune(down ? FEEL.snappy : FEEL.tight).to(top);
    box.bottom.tune(down ? FEEL.tight : FEEL.snappy).to(bottom);
  }
  follow(top, bottom, jump);
  $("range").textContent = doc.start === doc.end ? `line ${doc.start + 1}` : `lines ${doc.start + 1}–${doc.end + 1}`;
  status();
}

function follow(top, bottom, jump) {
  const y = $("rows").getBoundingClientRect().top + scrollY;
  const low = y + top - EDGE, high = y + bottom + EDGE - innerHeight;
  const to = Math.max(0, high > low ? low : Math.min(low, Math.max(high, scrollY)));
  if (Math.abs(to - scrollY) < 1) return;
  if (jump) return scrollTo(0, to);
  if (scroller.x === scroller.target && !scroller.v) scroller.jump(scrollY); // the page may have been scrolled by hand since
  scroller.to(to);
}

on_frame(() => {
  const t = box.top.x, b = box.bottom.x;
  $("box").style.transform = `translateY(${t}px)`;
  $("box").style.height = `${b - t}px`;
  $("box").style.setProperty("--lv", heard.x);
  // each row turns orange by how much of it the box covers, so the colour travels with the box
  for (let i = row_at(t + PAD); i < rows.length && tops[i] < b - PAD; i++) lit.add(i);
  for (const i of lit) {
    const c = Math.round(Math.max(0, Math.min(b - PAD, tops[i] + heights[i]) - Math.max(t + PAD, tops[i])) / (heights[i] || 1) * 100) / 100;
    if (cover[i] !== c) rows[i].style.setProperty("--sel", (cover[i] = c));
    if (!c) lit.delete(i);
  }
  $("reader").style.transform = `translateY(${reader.top.x}px)`;
  $("reader").style.height = `${reader.bottom.x - reader.top.x}px`;
  $("reader").style.opacity = reader.shown.x;
  $("reader").style.setProperty("--vl", voiced.x);
  $("mic").style.setProperty("--lv", heard.x);
  $("drawer").style.transform = `translateX(${(1 - drawer.x) * 100}%)`;
  $("scrim").style.opacity = drawer.x * 0.6;
  $("progress").style.transform = `scaleX(${loaded.x})`;
  if (scroller.x !== scrolled) scrollTo(0, (scrolled = scroller.x));
  if (shifted < 0) return;
  for (const row of rows.slice(shifted, shifted + 90)) row.style.transform = shift.x ? `translateY(${shift.x}px)` : "";
  if (!shift.x && !shift.v) shifted = -1;
});

function caption(text, tone = "", quiet) {
  const c = $("caption");
  if (c.textContent === text && (c.dataset.tone ?? "") === tone) return;
  c.textContent = text;
  c.dataset.tone = tone;
  if (quiet) return;
  c.classList.remove("rise");
  void c.offsetWidth; // restarts the animation
  c.classList.add("rise");
}

function flash(text, tone, ms = 1800) {
  caption(text, tone);
  clearTimeout(flash_timer);
  flash_timer = setTimeout(idle_caption, ms);
}

function idle_caption(quiet) {
  if (job || hearing) return;
  caption(mic_failed ? `microphone ${mic_failed}`
    : !ear_ready ? "loading whistle"
    : !voice_ready ? voice_note
    : settings.mode === "p" ? `hold ${label(settings.keys.talk)} and say what to change`
    : muted ? `muted · ${label(settings.keys.mute)} to listen`
    : "say what to change", mic_failed ? "bad" : "", quiet);
}

function status() {
  const state = mic_failed ? "off" : !mic_open || !ear_ready ? "loading" : voice_busy ? "speaking" : hearing ? "hearing"
    : listening ? "listening" : drawer.target ? "paused" : "idle";
  $("mic").dataset.state = state;
  $("mode").textContent = state === "idle" ? (settings.mode === "p" ? `hold ${label(settings.keys.talk)}` : "muted")
    : { off: "no microphone", loading: "loading", speaking: "speaking", hearing: "hearing you", listening: "listening", paused: "paused" }[state];
  $("box").toggleAttribute("data-hearing", Boolean(hearing) && hearing[0] === doc.start && hearing[1] === doc.end);
}

// ---------- moving ----------

function move(delta, extend) {
  const was = [doc.anchor, doc.head];
  doc.select(doc.head + delta, extend);
  if (doc.anchor === was[0] && doc.head === was[1]) {
    box.top.kick(delta * 160); // the end of the document pushes back
    box.bottom.kick(delta * 160);
    return;
  }
  place();
  auto_speak();
}

// ---------- speaking ----------

function speak() {
  if (!voice_ready) return flash(voice_note);
  const id = ++say_id, start = doc.start;
  voice_busy = true;
  update_listen();
  clearInterval(level_timer);
  level_timer = setInterval(() => voiced.to(voice.level()), 33);
  voice.say(speech.slice(start, doc.end + 1), (i) => read_line(start + i)).then(() => { if (id === say_id) quiet(); });
}

function read_line(i) {
  const top = tops[i] + 4, bottom = tops[i] + heights[i] - 4;
  if (reader.shown.target) {
    reader.top.to(top);
    reader.bottom.to(bottom);
  } else {
    reader.top.jump(top);
    reader.bottom.jump(bottom);
  }
  reader.shown.to(1);
}

function quiet() {
  voice_busy = false;
  clearInterval(level_timer);
  voiced.to(0);
  reader.shown.to(0);
  update_listen();
}

function stop_speaking() {
  clearTimeout(speak_timer);
  if (!voice_busy) return;
  say_id++;
  voice.stop();
  quiet();
}

function auto_speak() {
  stop_speaking();
  if (voice_ready && (doc.start === doc.end ? settings.speak_one : settings.speak_many)) speak_timer = setTimeout(speak, REST_MS);
}

const voice = create_voice({
  progress(done, total) {
    loaded.to(done / total);
    voice_note = `loading the voice · ${mb(done)} of ${mb(total)} mb`;
    idle_caption(true);
  },
  ready() {
    voice_ready = true;
    loaded.to(1);
    $("progress").toggleAttribute("data-done", true);
    idle_caption();
  },
  error: (message) => flash(`voice: ${message}`, "bad", 5000),
});

// ---------- listening ----------

function update_listen() {
  const on = ear_ready && mic_open && !voice_busy && !drawer.target && (settings.mode === "p" ? held : !muted);
  if (on !== listening) {
    listening = on;
    ear.listen(on);
  }
  status();
}

const tune_ear = () => { ear.turn_ms = settings.mode === "p" ? Infinity : settings.silence_ms; };

const ear = create_ear({
  ready() {
    ear_ready = true;
    update_listen();
    idle_caption();
  },
  hear() {
    hearing = [doc.start, doc.end];
    discard = false;
    status();
    caption("…", "hearing");
  },
  words(text) {
    if (!discard) caption(text, "hearing");
  },
  turn(text) {
    const range = hearing;
    hearing = null;
    status();
    if (discard || !range || !text.trim()) {
      discard = false;
      return idle_caption();
    }
    queue.push({ start: range[0], end: range[1], text: text.trim() });
    next();
  },
  level: (v) => heard.to(v),
  error: (message) => flash(`whistle: ${message}`, "bad", 5000),
});
tune_ear();
ear.open().then(() => {
  mic_open = true;
  update_listen();
}, (e) => {
  mic_failed = e.name === "NotAllowedError" ? "blocked: allow it in the address bar, then reload" : `failed: ${e.message}`;
  status();
  idle_caption();
});

// ---------- editing ----------

function llm() {
  if (settings.key) return settings;
  if (server_groq && settings.base.includes("api.groq.com")) return { ...settings, proxy: true };
  return null;
}

function show_work({ start, end }) {
  $("work").style.transform = `translateY(${tops[start] - PAD}px)`;
  $("work").style.height = `${tops[end] + heights[end] - tops[start] + 2 * PAD}px`;
  $("work").toggleAttribute("data-on", true);
  rows.slice(start, end + 1).forEach((row) => row.classList.add("busy"));
}

async function next() {
  if (job || !queue.length) return;
  job = queue.shift();
  job.abort = new AbortController();
  show_work(job);
  caption(job.text, "sent");
  try {
    if (!llm()) throw new Error(`add an api key in settings (${label(settings.keys.settings)})`);
    const reply = await rewrite(llm(), doc.lines.slice(job.start, job.end + 1).join("\n"), job.text, job.abort.signal);
    apply(job, reply ? reply.split("\n") : []);
    job = null;
    flash(`done · ${label(settings.keys.undo)} to undo`);
  } catch (e) {
    if (e.name !== "AbortError") {
      $("work").toggleAttribute("data-bad", true);
      job = null;
      flash(e.message, "bad", 5000);
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  job = null;
  rows.forEach((row) => row.classList.remove("busy"));
  $("work").removeAttribute("data-on");
  $("work").removeAttribute("data-bad");
  next();
}

function apply({ start, end }, lines) {
  const before = end + 1 < rows.length ? tops[end + 1] : tops[end] + heights[end];
  const delta = lines.length - (end - start + 1);
  doc.replace(start, end, lines);
  // instructions still waiting keep pointing at the lines they were said about
  for (const q of queue) {
    if (q.start > end) { q.start += delta; q.end += delta; }
    else if (q.end >= start) { q.start = start; q.end = Math.max(start, start + lines.length - 1); }
    q.end = Math.min(q.end, doc.lines.length - 1);
  }
  draw(lines.length ? [start, start + lines.length - 1] : null);
  const after = tops[start + lines.length];
  if (after !== undefined && after !== before) {
    shifted = start + lines.length; // the rows below start where they were and slide to their new place
    shift.jump(before - after).to(0);
  }
  place();
  auto_speak();
}

function cancel_edits() {
  job?.abort.abort();
  queue = [];
}

function history(step, word) {
  if (!step()) return flash(`nothing to ${word}`);
  cancel_edits();
  draw([doc.start, doc.end]);
  place();
  auto_speak();
}

// ---------- files ----------

async function open_file(get) {
  try {
    if (!(await get())) return;
  } catch (e) {
    return flash(`could not open it: ${e.message}`, "bad", 5000);
  }
  cancel_edits();
  stop_speaking();
  draw([0, Math.min(doc.lines.length - 1, 30)]);
  scroller.jump(0);
  scrollTo(0, (scrolled = 0));
  place(true);
  flash(`opened ${doc.name}`);
}

async function save_file() {
  try {
    if (!(await doc.save())) return;
  } catch (e) {
    return flash(`could not save: ${e.message}`, "bad", 5000);
  }
  name();
  flash(`saved ${doc.name}`);
}

async function copy_file() {
  try {
    await navigator.clipboard.writeText(doc.lines.join("\n"));
    flash("copied all markdown");
  } catch (e) {
    flash(`could not copy: ${e.message}`, "bad", 5000);
  }
}

// ---------- settings ----------

function open_drawer(open) {
  if (open === Boolean(drawer.target)) return;
  drawer.to(open ? 1 : 0);
  $("drawer").inert = !open;
  document.body.toggleAttribute("data-settings", open);
  capture = null;
  if (open) {
    fill_settings();
    stop_speaking();
    $("s_base").focus();
  } else document.activeElement?.blur();
  update_listen();
}

function fill_settings() {
  $("s_base").value = settings.base;
  $("s_key").value = settings.key;
  $("s_model").value = settings.model;
  $("s_silence").value = settings.silence_ms;
  $("s_key_note").textContent = server_groq ? "empty uses the groq key on this page's server" : "kept only in this browser";
  for (const input of document.querySelectorAll("#s_mode input")) input.checked = input.value === settings.mode;
  for (const [id, name] of [["s_one", "speak_one"], ["s_many", "speak_many"]]) $(id).setAttribute("aria-checked", settings[name]);
  fill_keys();
}

function fill_keys(note = "") {
  $("s_keys").innerHTML = Object.entries(ACTIONS).map(([action, [what]]) => `<div class="key_row"><span>${what}</span>` +
    `<button class="key" data-action="${action}"${capture?.action === action ? " data-capturing" : ""}>` +
    `${capture?.action === action ? "press keys" : label(settings.keys[action])}</button></div>`).join("");
  $("s_keys_note").textContent = note;
}

// a modifier counts on its own only if it is let go with nothing else pressed
function take_key(e) {
  e.preventDefault();
  const c = combo(e);
  if (e.type === "keydown" && lone(c)) return void (capture.lone = c);
  if (e.type === "keyup" && !capture.lone) return;
  const key = e.type === "keyup" ? capture.lone : c;
  const taken = Object.keys(settings.keys).find((a) => a !== capture.action && settings.keys[a] === key);
  const action = capture.action;
  capture = null;
  if (key === "esc" && action !== "stop") return fill_keys();
  if (taken) return fill_keys(`${label(key)} is already ${ACTIONS[taken][0]}`);
  save("keys", { ...settings.keys, [action]: key });
  fill_keys();
  status();
}

for (const [id, field] of [["s_base", "base"], ["s_key", "key"], ["s_model", "model"]]) $(id).oninput = () => save(field, $(id).value.trim());
$("s_show").onclick = () => {
  $("s_key").type = $("s_key").type === "password" ? "text" : "password";
  $("s_show").textContent = $("s_key").type === "password" ? "show" : "hide";
};
$("s_silence").oninput = () => {
  const ms = Math.round(+$("s_silence").value);
  if (ms >= 300 && ms <= 10000) save("silence_ms", ms);
  tune_ear();
};
$("s_mode").onchange = (e) => {
  save("mode", e.target.value);
  held = muted = false;
  tune_ear();
  update_listen();
};
for (const [id, field] of [["s_one", "speak_one"], ["s_many", "speak_many"]]) $(id).onclick = () => {
  save(field, !settings[field]);
  $(id).setAttribute("aria-checked", settings[field]);
};
$("s_keys").onclick = (e) => {
  const b = e.target.closest(".key");
  if (!b) return;
  capture = { action: b.dataset.action };
  fill_keys();
};
$("scrim").onclick = () => open_drawer(false);
$("s_close").onclick = () => open_drawer(false);

// ---------- keys and pointer ----------

const ACT = {
  up: () => move(-1),
  down: () => move(1),
  extend_up: () => move(-1, true),
  extend_down: () => move(1, true),
  speak: () => (voice_busy ? stop_speaking() : speak()),
  stop() {
    stop_speaking();
    if (hearing) discard = true;
    if (job || queue.length) {
      cancel_edits();
      flash("stopped");
    }
  },
  mute() {
    if (settings.mode !== "a") return;
    muted = !muted;
    update_listen();
    flash(muted ? "muted" : "listening");
  },
  auto() {
    save("speak_one", !settings.speak_one);
    flash(`auto speak ${settings.speak_one ? "on" : "off"}`);
  },
  split() {
    stop_speaking();
    queue.push({ start: doc.start, end: doc.end, text: "Split the selected text into multiple shorter markdown source lines at natural thought, clause, or phrase boundaries. Insert actual newline characters, not visual wrapping. Even a single short line should become at least two shorter lines when it has multiple words. Preserve all words, their order, meaning, and markdown formatting; keep code blocks and tables valid. Only split; add no content." });
    next();
  },
  undo: () => history(doc.undo, "undo"),
  redo: () => history(doc.redo, "redo"),
  open: () => open_file(doc.open),
  save: save_file,
  settings: () => open_drawer(true),
};

addEventListener("keydown", (e) => {
  ear.resume();
  voice.resume();
  if (capture) return take_key(e);
  const c = combo(e);
  if (drawer.target) {
    if (c === settings.keys.stop || c === settings.keys.settings) {
      e.preventDefault();
      open_drawer(false);
    }
    return;
  }
  if (settings.mode === "p" && c === settings.keys.talk) {
    e.preventDefault();
    if (held) return;
    held = true;
    stop_speaking();
    return update_listen();
  }
  const action = Object.keys(ACT).find((a) => settings.keys[a] === c);
  if (!action) return;
  e.preventDefault();
  ACT[action]();
});

addEventListener("keyup", (e) => {
  if (capture) return take_key(e);
  if (held && releases(e, settings.keys.talk)) {
    held = false;
    update_listen();
  }
});

addEventListener("blur", () => {
  if (!held) return;
  held = false;
  update_listen();
});

addEventListener("pointerdown", () => {
  ear.resume();
  voice.resume();
});

$("rows").addEventListener("mousedown", (e) => {
  const row = e.target.closest(".row");
  if (!row) return;
  e.preventDefault();
  doc.select(rows.indexOf(row), e.shiftKey);
  place();
  auto_speak();
});

for (const [id, act] of [["open", ACT.open], ["save", save_file], ["copy", copy_file], ["open_settings", ACT.settings]]) {
  $(id).onmousedown = (e) => e.preventDefault(); // keeps focus off the button, so space still speaks
  $(id).onclick = act;
}

addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.toggleAttribute("data-drop", true);
});
addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) document.body.removeAttribute("data-drop");
});
addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.removeAttribute("data-drop");
  open_file(() => doc.drop(e.dataTransfer));
});

// ---------- start ----------

fetch("/api/config").then((r) => (r.ok ? r.json() : {})).then((c) => { server_groq = Boolean(c.providers?.groq); }, () => {});
draw();
place(true);
idle_caption();
document.fonts.ready.then(() => {
  measure();
  place(true);
});
new ResizeObserver(() => {
  measure();
  place();
}).observe($("rows"));
