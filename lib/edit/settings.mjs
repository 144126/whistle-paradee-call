// What the user can change, kept in this browser under "edit.<name>".
export const ACTIONS = {
  up: ["line above", "up"],
  down: ["line below", "down"],
  extend_up: ["extend up", "shift+up"],
  extend_down: ["extend down", "shift+down"],
  speak: ["speak the selection", "space"],
  stop: ["stop", "esc"],
  mute: ["mute", "m"],
  auto: ["auto speak", "a"],
  split: ["split into shorter lines", "ctrl+shift+l"],
  copy: ["copy the selection", "ctrl+c"],
  select_all: ["select all lines", "ctrl+a"],
  undo: ["undo", "ctrl+z"],
  redo: ["redo", "ctrl+shift+z"],
  open: ["open a file", "ctrl+o"],
  save: ["save", "ctrl+s"],
  settings: ["settings", "ctrl+,"],
  talk: ["push to talk", "altright"],
};

const DEFAULTS = {
  base: "https://api.groq.com/openai/v1",
  key: "",
  model: "qwen/qwen3.8-27b",
  mode: "a", // a: always listening, a pause sends; p: push to talk, letting go sends
  stt: "w", // w: local Whistle; o: OpenRouter
  stt_model: "openai/whisper-1",
  stt_key: "",
  silence_ms: 2160,
  speak_one: true,
  speak_many: false,
  keys: Object.fromEntries(Object.entries(ACTIONS).map(([action, [, c]]) => [action, c])),
};

const read = (name) => {
  try { return JSON.parse(localStorage.getItem("edit." + name)); } catch { return null; }
};

export const settings = Object.fromEntries(Object.entries(DEFAULTS).map(([name, d]) => [name, read(name) ?? d]));
settings.keys = { ...DEFAULTS.keys, ...settings.keys };

export function save(name, value) {
  settings[name] = value;
  try { localStorage.setItem("edit." + name, JSON.stringify(value)); } catch {}
}
