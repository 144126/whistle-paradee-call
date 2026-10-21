// Hotkeys as plain strings, modifiers first in one order: "ctrl+shift+z", "space", "altright".
const NAMES = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Escape: "esc", Space: "space",
  Enter: "enter", Backspace: "backspace", Delete: "delete", Tab: "tab", Comma: ",", Period: ".", Slash: "/",
  Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`",
};
const MODS = { ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" };
const SIGNS = { up: "↑", down: "↓", left: "←", right: "→" };

export const lone = (c) => /^(ctrl|alt|shift|meta)(left|right)$/.test(c.split("+").pop());

// a modifier pressed on its own keeps its side, so push to talk can be one key such as right alt
export function combo(e) {
  const side = e.code.match(/^(Control|Alt|Shift|Meta)(Left|Right)$/);
  const key = side
    ? Object.keys(MODS).find((m) => MODS[m] === side[1]) + side[2].toLowerCase()
    : NAMES[e.code] ?? e.code.replace(/^(Key|Digit)/, "").toLowerCase();
  return [...Object.keys(MODS).filter((m) => e[m + "Key"] && MODS[m] !== side?.[1]), key].join("+");
}

// letting go of any key in the combo ends a hold
export function releases(e, c) {
  const parts = c.split("+");
  const key = combo(e).split("+").pop();
  return parts.includes(key) || parts.includes(key.replace(/(left|right)$/, ""));
}

export const label = (c) => c.split("+").map((p) => SIGNS[p] ?? p.replace(/^(ctrl|alt|shift|meta)(left|right)$/, "$2 $1")).join("+");
