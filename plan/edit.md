# edit: a markdown editor you talk to

You move through rendered markdown with the arrow keys.
The line you land on is read aloud by Phonon.
You say what to change. Whistle transcribes it, a model rewrites the selected lines, and they change in place.

## Where it lives

A new page, `edit.html`, in `~/whistle`, next to `phonon.html`.
Why here: Whistle (speech in), Phonon (speech out), the COOP/COEP headers, `server.mjs` and the Cloudflare deploy already exist. A new repo would rebuild all of it.
Plain HTML + ES modules like its neighbours. No build step.

Shared modules, so the next page does not copy them:
- `lib/mic.mjs` (+ `lib/whistle-worker.js`, `lib/rec-worklet.js`): mic capture, the 270 ms segmenter, the Whistle worker, and turns. Ported from `index.html`, which still has its own copy until it is switched over.
- `lib/speak.mjs`: Phonon loaded from the pinned checkpoint, parts spoken back to back, an output level for meters.

New modules, one job each:
- `lib/edit/doc.mjs`: the lines, the selection, undo/redo, save to localStorage and to the file.
- `lib/edit/render.mjs`: one markdown line to HTML, and one markdown line to plain speech text.
- `lib/edit/keys.mjs`: hotkey strings (`ctrl+shift+k`, `AltRight`), matching, and capturing a new one.
- `lib/edit/llm.mjs`: the OpenAI-compatible call.
- `lib/edit/settings.mjs`: defaults and localStorage.
- `lib/edit/spring.mjs`: every moving thing is a spring (see Motion).
- `lib/edit/app.mjs`: the page's wiring.
- `server.mjs`: serves `edit.html` like `phonon.html`. Lambda and the Cloudflare `dist/` copy do not carry it yet.

## The document

- One row per source line, always. The whole app depends on line 7 on screen being line 7 in the file.
- Each row is rendered on its own: headings, list items, task boxes, quotes, `---`, and inline bold, italic, code, links (`marked.parseInline`, vendored pinned in `lib/`).
- Lines inside a ``` fence are tracked by a running in-fence flag and shown monospace on a dark block. Table lines show monospace, raw.
- A blank line is an empty row one line tall. It can be selected, so "write a paragraph about x here" works.
- Open: ctrl+o or drop a `.md` file. Save: ctrl+s writes back to the same file (File System Access API, Chrome). The document is also kept in localStorage, so a refresh loses nothing.
- No file open: one empty line, already selected. You can start by speaking.

## Selection

- ↑ / ↓: select one line. The anchor is that line.
- shift+↑ / shift+↓: grow or shrink from the anchor, the anchor always included.
- The selected range is one box, not a box per line.
- The view scrolls only enough to keep the box on screen.

## Speaking (Phonon)

- Auto speak is on for one line, off for several. Both are settings.
- Holding an arrow key does not speak every line it passes: speech starts once the selection rests 180 ms.
- Space speaks the selection (any length). Moving or esc stops it.
- Markdown is stripped before speaking: `## goals` says "goals", `- [x] milk` says "done, milk", links say their text. Blank lines say nothing.
- While several lines are read, the line being read gets a 2 px orange bar at its left edge.
- The mic is ignored while Phonon talks, so the app never transcribes itself (Whistle already does this).

## Listening (Whistle)

Two modes, set in settings:
- **auto** (default): always listening. Speech is collected; 2160 ms of silence after the last word sends it. The silence is a setting.
- **push to talk**: listens only while the key is held, sends on release. Any key or combination, modifiers alone included (`AltRight`, `ctrl+space`).

- m mutes and unmutes listening (auto mode).
- The selection is taken when you start speaking, not when it sends. Moving during the 2 s wait does not redirect the edit.
- Speech under 200 ms or with an empty transcript is dropped.

## The edit

Request, OpenAI-compatible `POST {base}/chat/completions`, not streamed:
- system: "you edit part of a markdown document. the user spoke an instruction; speech recognition transcribed it and may have errors. apply it to the given lines. reply with only the new lines as raw markdown: no code fences, no comments. to delete the lines, reply with nothing."
- user: `lines:\n<selected lines>\n\ninstruction: <transcript>`
- temperature 0. For Groq's qwen, `reasoning_effort: "none"`; any `<think>…</think>` left in the reply is stripped anyway.

The reply replaces the range. It may be longer or shorter: two lines can become five. The new lines become the selection and are spoken by the same auto speak rule.
One edit at a time; a second instruction waits its turn.
Every edit is one undo step: ctrl+z, ctrl+shift+z.
On an error, the lines stay as they were and the error shows in the bottom bar.

Default model: Groq, `https://api.groq.com/openai/v1`, `qwen/qwen3.8-27b` (the id Whistle already uses).
Any OpenAI-compatible base URL, key and model can be set. All are kept in localStorage.
The call goes straight from the browser. If a provider blocks browser calls (CORS), it goes through `server.mjs`'s existing `/api/chat`.

## Hotkeys (defaults, all changeable)

| key | does |
|---|---|
| ↑ ↓ | select a line |
| shift+↑ shift+↓ | grow or shrink the selection |
| space | speak the selection |
| esc | stop speaking, close settings |
| m | mute / unmute listening |
| a | auto speak on / off for one line |
| ctrl+z, ctrl+shift+z | undo, redo |
| ctrl+o, ctrl+s | open, save |
| ctrl+, | settings |
| right alt | push to talk, when that mode is picked |

Changing one: click its field, press the new keys, done. A key already in use is refused with its current owner named.

## How it looks

Dark only. No light theme. Black, white, one orange.

### Colours

| token | value | use |
|---|---|---|
| `--bg` | `#000000` | page |
| `--surface` | `#1c1c1e` | settings drawer, code blocks |
| `--edge` | `#3a3a3c` | input borders, dividers |
| `--text` | `#f5f5f7` | document text, unselected |
| `--muted` | `#8e8e93` | bullets, quote bars, `---`, filename, hints, the transcript while you speak |
| `--orange` | `#ff9f0a` | selected text, the selection box, mic on, focus rings, progress |
| `--orange-dim` | `#ff9f0a33` | box fill while the model works |
| `--bad` | `#ff6961` | errors |

`#ff9f0a` is Apple's dark-mode system orange: bright on black, not neon.
Only orange marks state. Nothing else is coloured.

### Type

- `system-ui` for everything. No serifs. Code: `ui-monospace`.
- Body 17 px, line height 1.6. Headings by size and weight only: h1 28 px / 600, h2 22 px / 600, h3 18 px / 600.
- All app text is lowercase ("listening", "settings"). The document is shown as written.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ notes.md ·                                          settings │  top bar, 40 px, muted
│                                                              │
│        # the plan                                            │
│                                                              │
│        we ship the first version in march.                   │
│     ╭──────────────────────────────────────────────────╮     │
│     │  - write the editor                    (orange)  │     │  selection box
│     │  - wire up whistle                     (orange)  │     │
│     ╰──────────────────────────────────────────────────╯     │
│        - pick a name                                         │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ "make these two shorter"              lines 4–5   ● auto     │  bottom bar, 48 px
└──────────────────────────────────────────────────────────────┘
```

- One centred column, max 720 px, 24 px side padding. Nothing else on the page.
- Top bar: filename left (`·` when unsaved), "settings" right. Muted, no background, no border.
- Bottom bar: the only place status lives. `--bg`, 1 px `--edge` line above it.
  - left: what Whistle hears, live, in quotes. Muted while you speak, white once sent. Errors here in `--bad`.
  - right: the selected range, then the mic dot and the mode (`auto`, `ptt`, `muted`).
- Desktop only. It is a keyboard app.

### The selection box

- 1 px `--orange` border, 8 px radius, 4 px inside the row edges, no fill. Selected text turns orange.
- States, all on the same box:
  - **idle**: as above.
  - **hearing**: border full orange, and a glow that follows your voice's level.
  - **working** (the model has it, drawn on its own layer over those lines): text at 50 %, a light runs round the edge and a faint sweep crosses the lines.
  - **error**: border `--bad` for 1800 ms, then back to idle.
- Its two edges are springs. The edge in front leads (4.2 Hz, ζ 0.85) and the one behind follows a little softer (3.4 Hz, ζ 0.82), so the box stretches the way it moves, about 12 px while an arrow is held, and settles in about 130 ms.
- Text turns orange by how much of its row the box covers, so the colour travels with the box instead of switching.
- At the first or last line the box gets a small push back, a wall.

### The mic dot

8 px circle, right of the bottom bar.
- listening: solid orange.
- hearing you: solid orange, scaled by your live voice level (1.0 to 1.6).
- muted, or push to talk not held: hollow, `--muted` ring.
- loading: hollow orange ring.

### Motion

Springs, not durations (`lib/edit/spring.mjs`, numbers from the feel vocabulary): the selection box, the reading bar, following the box with the scroll, the settings drawer, the mic dot's level, and rows below an edit sliding to their new place.
New lines from an edit, an undo or an opened file come in with a short fade, rise and unblur, one after another.
Reduced motion turns all of it off.

### First load

Phonon is 65 MB and Whistle downloads its model too. The bottom bar shows "loading voice 32 / 65 mb" with a 2 px orange line filling along its top edge. Arrows and selection work at once; speaking and listening start when their parts are ready. The browser's mic prompt appears on first load.

### Settings

A drawer from the right, 380 px, `--surface`, over the page with the page dimmed to 50 %. esc or ctrl+, closes. Saves as you type.

```
settings
─────────────────────────────
model
  base url   https://api.groq.com/openai/v1
  api key    ••••••••••••••••  show
  model      qwen/qwen3.8-27b

listening
  mode       (•) auto   ( ) push to talk
  silence    2160 ms
  push key   [ press keys ]

speaking
  auto speak one line      on
  auto speak many lines    off

hotkeys
  speak         space
  mute          m
  ...
```

- Section names muted, 13 px. Inputs: `--bg` fill, 1 px `--edge` border, 8 px radius, 40 px tall, orange border on focus.
- Toggles are text buttons ("on" / "off"), orange when on.

### Empty file

The page shows one empty selected line and, under it in muted text: "open a .md file (ctrl+o), drop one here, or just start talking".

## Build order

1. Move mic + Whistle out of `index.html` into `lib/mic.mjs`; move Phonon out of `phonon.html` into `lib/speak.mjs`. Both pages work as before.
2. `edit.html` with the look above, `render.mjs`, `doc.mjs`: open, show, select, save, undo.
3. Speaking: auto speak, space, esc, the reading bar.
4. Listening: auto mode with the 2160 ms send, mute, the bottom bar transcript and mic dot.
5. `llm.mjs` and the edit in place, with the box states.
6. Settings drawer, push to talk, hotkey capture.
7. Serve `edit.html` from `server.mjs` and Lambda; deploy with the rest of Whistle.

## Open

- The name. "edit" is a working name.
