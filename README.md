# Whistle + Paradee in the browser

One static page, `index.html`. Speech in, text out, and text back to speech.
Speech-to-text and the default voice run entirely in the browser: no server, no API, no tunnel (the optional
**Call** adds a language-model API for the replies, and the **Voice** picker can swap the on-device voice for a
remote one). The only network use is downloading the model files from Hugging Face, which the browser then caches.

## Replicate from scratch

You need Node 20.12 or newer, a Chromium-based browser (Chrome, Edge; Firefox and Safari are untested),
and, for **Call** and the remote voices only, a Baseten, Groq and/or OpenRouter API key. Dictation and
Read aloud on the default on-device voice need no key at all.

```bash
git clone <this repo> whistle && cd whistle
export BASETEN_API_KEY=...         # optional, for "Call Baseten" and the Pocket TTS voices
export GROQ_API_KEY=...            # optional, for "Call Groq" and the Orpheus voice
export WHISTLE_OPENROUTER_KEY=...  # optional, for "Call Mercury 3" (OpenRouter inception/mercury-3)
export BASETEN_TTS_URL=...         # optional, your own Pocket TTS deployment (see truss-pocket-tts/)
node server.mjs                    # http://localhost:8123 (no npm install: it has no dependencies)
```

Open `http://localhost:8123` (not `file://`: workers are blocked there). Wait for the buttons to leave
"Loading…" (about 10 s on the first visit while about 26 MB of models download and are cached by the
browser). Allow the microphone for that site; if the status line says `NotAllowedError`, allow it and reload.

`server.mjs` serves `index.html` and `lib/` only, bound to 127.0.0.1, and forwards the model calls for
**Call** to Baseten, Groq or OpenRouter with the keys from its environment or from a gitignored `.env` file next to it (`KEY=value` lines). A key never reaches the browser.
Any other static server also works for dictation and Read aloud (it must send the two isolation headers in
`_headers` to get multi-threaded speech); Call then asks for a pasted Baseten key and calls Baseten directly.

### Where everything comes from

The repo is complete except the two models, which the page downloads from Hugging Face at pinned commits
(see "Pinned models" below). `lib/` is vendored from npm and can be rebuilt byte for byte:

```bash
mkdir v && cd v && pnpm init && pnpm add onnxruntime-web@1.22.0 phonemizer@1.2.1
cp node_modules/onnxruntime-web/dist/{ort.wasm.min.mjs,ort-wasm-simd-threaded.mjs,ort-wasm-simd-threaded.wasm} ../lib/
cp node_modules/phonemizer/dist/phonemizer.js ../lib/
cp node_modules/phonemizer/LICENSE ../lib/phonemizer.LICENSE
cd .. && rm -r v
```

To change the pinned Whistle or Paradee files, edit the URLs near the top of `index.html`.

## What it does

- **Start / Stop**: streaming dictation. Each pause (270 ms of silence) sends the
  segment to Whistle, and the text is appended to the box.
- **Read aloud**: speaks the text box one sentence at a time with whichever voice the
  **Voice** picker holds. Press again to stop; stopping cancels generation.
- **Voice**: which engine speaks. `Paradee 8M · on device` is the default and needs no key.
  The rest are remote and need a key on the server, so they are greyed out without one. See
  "Voices" below.

- **Call**: a spoken conversation. Whistle transcribes as you talk, and after 1440 ms of
  silence the turn goes to a language model on Baseten. Its reply streams back and is spoken
  sentence by sentence as it arrives. Mute (during a call) silences your mic without hanging up.
Start/Stop dictation and Read aloud are unchanged.

## The call

Press Call. With `server.mjs` running there is nothing to paste: the page asks `/api/config`
whether the server holds a key, hides the key field if so, and posts the conversation to
`/api/chat`, which adds the key and streams Baseten's reply back. Text goes to the model; audio
never leaves the device.

`server.mjs` only accepts requests whose `Host` and `Origin` are this page, so other sites and
DNS-rebinding tricks can't spend the key. It forwards only `model`, `messages`, `stream`,
`max_tokens`, `temperature`, `reasoning_effort`, caps the body at 64 KB, and uses `pipeline` so a
client that hangs up mid-stream (an interrupt) doesn't crash it.

Without a server key (a plain static host), open "Call settings" and paste one; it is kept in
that browser only and sent straight to `inference.baseten.co`, which allows browser (CORS) calls.

## Deploying

Both options give the page a server-side key, so nothing secret is in the code. **A deployed URL is public:
anyone who opens it can run Call on your keys.** Keep the URL private, cap spend (Baseten/Groq/OpenRouter dashboards, AWS
Budgets), and see the AWS notes below.

### Cloudflare Pages

Live at https://whistle-81u.pages.dev (project `whistle`). `functions/api/chat.js` and `functions/api/config.js`
are the same two routes as `server.mjs`. Keys are Cloudflare secrets, never in code:

```bash
pnpm dlx wrangler login                                  # or set CLOUDFLARE_API_TOKEN
pnpm dlx wrangler pages project create whistle --production-branch main
printf %s "$BASETEN_API_KEY" | pnpm dlx wrangler pages secret put BASETEN_API_KEY --project-name whistle
printf %s "$GROQ_API_KEY"    | pnpm dlx wrangler pages secret put GROQ_API_KEY --project-name whistle
printf %s "$WHISTLE_OPENROUTER_KEY" | pnpm dlx wrangler pages secret put WHISTLE_OPENROUTER_KEY --project-name whistle
printf %s "$BASETEN_TTS_URL" | pnpm dlx wrangler pages secret put BASETEN_TTS_URL --project-name whistle  # Pocket TTS voices

rm -rf dist && mkdir dist && cp index.html _headers dist/ && cp -r lib dist/
pnpm dlx wrangler pages deploy dist --project-name whistle --branch main
```

`dist/` holds only the page, `_headers` (the isolation headers) and `lib/`. The functions are picked up from
`functions/` next to it, so `server.mjs`, `lambda/` and this README are not uploaded. Redeploy with the last
command after any change.

Checked on the live URL: the page loads with the isolation headers, `/api/config` reports both providers,
`/api/chat` streams from Baseten and Groq, a foreign Origin gets 403, and in headless Chromium with a fake
mic both call buttons complete a turn, dictation writes text, and Read aloud plays and stops.

### AWS Lambda

`lambda/handler.mjs` does everything `server.mjs` does (serves the page and `lib/`, `/api/config`, `/api/chat`
streaming to Baseten or Groq, the same origin check, field whitelist and isolation headers) behind a
**Function URL with response streaming**, so the reply streams and the page is same-origin with its API.
It has no dependencies. Tested here by running the handler under a stand-in for Lambda's streaming runtime
(page and wasm served byte for byte, both providers streamed, bad origin/path/provider rejected). **It has
not been deployed to a real AWS account**, so expect to adjust the IAM/URL steps below to what the console says.
Needs the AWS CLI configured, and `zip`.

```bash
# 1. package: the handler must sit next to index.html and lib/
mkdir -p dist && cp lambda/handler.mjs index.html dist/ && cp -r lib dist/
(cd dist && zip -qr ../whistle.zip .)

# 2. role (once)
aws iam create-role --role-name whistle-lambda --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name whistle-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# 3. keys in an uncommitted file (it is in .gitignore), not on the command line
echo '{"Variables":{"BASETEN_API_KEY":"...","GROQ_API_KEY":"...","WHISTLE_OPENROUTER_KEY":"...","BASETEN_TTS_URL":"..."}}' > env.json

# 4. function (wait ~10 s after step 2 for the role to propagate)
aws lambda create-function --function-name whistle --runtime nodejs22.x --handler handler.handler \
  --role arn:aws:iam::<ACCOUNT_ID>:role/whistle-lambda --zip-file fileb://whistle.zip \
  --timeout 60 --memory-size 256 --environment file://env.json

# 5. public URL with streaming (RESPONSE_STREAM is required for the reply to stream)
aws lambda create-function-url-config --function-name whistle --auth-type NONE --invoke-mode RESPONSE_STREAM
aws lambda add-permission --function-name whistle --statement-id url-public \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE
aws lambda add-permission --function-name whistle --statement-id url-public-invoke \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url
```

Step 5 prints a `https://<id>.lambda-url.<region>.on.aws` address: open it. Update later with
`aws lambda update-function-code --function-name whistle --zip-file fileb://whistle.zip`.

- **Cost and limits:** the free tier is 1,000,000 requests and 400,000 GB-seconds a month. The page's files
  and each model call are one short invocation, so a call uses a few invocations per turn. A new account can
  start with a low concurrency quota (one report saw 10); raise it in Service Quotas before sharing the URL.
  Lambda caps an invocation at 15 minutes, which does not matter here because a call is many short requests.
- **Spend cap:** `aws lambda put-function-concurrency --function-name whistle --reserved-concurrent-executions 30`
  limits parallel use, but AWS requires 100 unreserved executions in the account, so it fails on low quotas.
  For real protection put CloudFront with WAF rate limiting in front, or use `--auth-type AWS_IAM`.
- **Keys:** Lambda environment variables are encrypted at rest but readable in the console by anyone with
  access. Use Secrets Manager if that matters (not implemented).
- **Cold starts:** this function is tiny, so a cold start costs well under a second. The expensive
  cold start would be loading speech models on Lambda, which this setup avoids.

### Should speech-to-text and the voice move to Lambda too?

Not recommended, and not implemented. Today Whistle and Paradee run in each visitor's browser, so 27 or 2,700
users cost nothing and need no server capacity; the only shared limit is the model provider (Groq's free tier
failed at 10 callers, see the stress table). On Lambda each warm invocation would have to hold a 9 MB voice
model, the 17 MB Whistle model and a runtime (a cold start of several seconds, unmeasured), audio would travel
both ways, and Lambda cannot hold a WebSocket without API Gateway in front. Native onnxruntime might make each
step 2-3x faster than the browser's wasm, but a network round trip of roughly 0.2-0.3 s would eat most of
that: a guess of 0.3-0.6 s gained per turn on warm environments, none measured. The case for it is weak
phones: Paradee makes audio about 3-5x faster than real time on this laptop; a phone 3-4x slower would be near
real time (first sentence in 3-4 s, possible gaps), which is untested. A middle option is to keep Whistle in the
browser and put only Paradee on a server.

- **Turn end:** `TURN_MS = 1440` of silence, and every transcription has returned. Segments are
  still cut at 270 ms, so by then the text is already ready.
- **Model:** `openai/gpt-oss-120b` (low reasoning effort) by default. Baseten's Model API has no small
  model, only twelve large ones; gpt-oss-120b activates about 5B parameters, so it is also the fastest.
  Median of 3 runs on a real conversation prompt, time to the first speakable chunk (a clause or
  sentence): gpt-oss-120b 689 ms, GLM-5.3-Flash 849, Nemotron-3-Ultra 880, GLM-5.3-Fast 1040,
  DeepSeek-V4.1-Flash-Fast 1091, DeepSeek-V4.1-Flash 1627, the rest 1.8 s or more (DeepSeek-V4-Pro 23 s).
  All are reasoning models; only `delta.content` is spoken.
- **Two call buttons:** "Call Baseten" (model from the settings field, default `openai/gpt-oss-120b`) and
  "Call Groq" (always `openai/gpt-oss-120b` on Groq, server only). The Groq route reads the key from
  `GROQ_API_KEY` (or `GROQ`). Smallest Groq model that
  can call functions is `gpt-oss-20b`; `allam-2-7b` (7B) answers HTTP 400 "tool calling is not supported", and
  `gpt-oss-safeguard-20b` works but is capped at 2000 tokens/min. `gpt-oss-20b` was not faster than Baseten 120B in this app
  (median first audio about 2.0 s against 1.2-1.7 s).
- **Groq rate limits, stress-tested** (this key, `gpt-oss-20b`: 8000 tokens/min, 1000 requests/day). Simulated
  callers take a turn every ~12 s with history and a tool definition (about 350 tokens per request, 6 requests a
  minute each), 60 s per stage, no retries:

  | callers | requests | rejected (429) | first token p50 / p95 |
  |---|---|---|---|
  | 1 | 7 | 0 | 907 / 1437 ms |
  | 3 | 21 | 0 | 815 / 1137 ms |
  | 5 | 34 | 0 (bucket down to 2221 of 8000) | 609 / 1261 ms |
  | 10 | 62 | 21 (34%) | 453 / 949 ms |
  | 20 | 118 | 69 (58%) | 497 / 1299 ms |

  Tokens per minute is the limit that binds: about 2.2k tokens per caller-minute means roughly 3-4 sustained
  callers (5 only passed because the first minute starts with a full bucket). A 429 carries `Retry-After: 2`.
  The daily limit is next: one caller at 5 turns a minute uses 1000 requests in about 3 hours. 20 callers need
  roughly 6x the tokens-per-minute limit, so a higher Groq tier, or Baseten, is needed.
- **Streaming speech:** the reply is split at sentence ends. The first chunk may break at a comma or
  dash after 20 characters, so audio starts sooner. Queued sentences go to Paradee in one call.
- **Continuing a turn:** if you speak again before the reply's audio starts, the pending reply is
  dropped and your new words are merged into the same turn.
- **Half duplex by default:** the mic is ignored while the reply plays, and for 400 ms after.
  With "Let me interrupt" ticked, 8 net loud frames (clearly above the noise floor) cut the reply
  off, and what you said starts the next turn. It relies on the browser's echo cancellation, so
  use headphones if the reply leaks into the mic.
- **Measured (real Baseten, fake mic):** the turn fires 1.44 s after speech ends. First audio came
  1.2, 2.0, 2.3 and 2.3 s after that (the page shows it in the status line). The model's first token
  takes 0.9-1.1 s through the proxy. Whistle itself takes about 0.3 s per short segment, and
  forcing the language to English makes no difference.
- **Limits:** history keeps the whole reply even if you interrupted partway. Free OpenRouter has no
  Ling Flash model (only paid), which is why Baseten is used.

## Voices

The **Voice** picker chooses what speaks. One engine is on the device, the rest go out through
`/api/tts`, which adds the key on the server exactly as `/api/chat` does, so no voice key reaches
the browser. The page sends one sentence per request and plays each as it lands, so audio starts
before the whole reply is written; `TTS_MAX_CHARS = 180` keeps every request under Groq's limit.

| Picker label | Where it runs | Needs |
|---|---|---|
| `Paradee 8M · on device` | the browser, as before | nothing |
| `Pocket TTS 18M / 7M / 7M rl / 2M · Baseten` | your own Baseten deployment | `BASETEN_API_KEY` + `BASETEN_TTS_URL` |
| `Orpheus · Groq` | Groq | `GROQ_API_KEY` |

An option is greyed out until `/api/config` reports its key, and the choice is kept in
`localStorage`. On a plain static host there is no `/api/tts`, so only the on-device voice appears.

Checked in headless Chromium: all six options present and enabled with both keys set; Read aloud
completes and returns to idle on the on-device voice, on a Pocket TTS option (against a stand-in
upstream) and on Orpheus against the real Groq API; stopping mid-sentence leaves nothing running;
the choice survives a reload; no console warnings or errors. `/api/tts` itself was checked for a
403 on a foreign origin, 400 on an unknown provider, empty text or a bad voice name, 500 with a
missing key or no `BASETEN_TTS_URL`, and a clean wav pass-through.

### Kyutai Pocket TTS

Announced 2026-10-20: the ~100M Pocket TTS shrunk to 18.2M, 6.9M and 1.9M, each also in a
`_refl` variant fine-tuned with rewards for naturalness and intelligibility, all with voice
cloning. Kyutai's claim is 103x faster than real time on one CPU core for the 1.9M model.
[Weights](https://huggingface.co/kyutai/pocket-tts) ·
[code](https://github.com/kyutai-labs/pocket-tts) ·
[blog](https://kyutai.org/blog/2026-10-20-pocket-tts-small).

**Baseten does not carry Pocket TTS in its model library**, and Groq does not host custom weights
at all, so there is no managed endpoint to call. `truss-pocket-tts/` is a Truss that serves every
size from one CPU deployment; `BASETEN_TTS_URL` is that deployment's predict URL:

```bash
pipx install truss
cd truss-pocket-tts
baseten secrets create hf_access_token   # kyutai/pocket-tts is a gated repo: ask for access first
truss push --publish
export BASETEN_TTS_URL=https://model-<id>.api.baseten.co/environments/production/predict
```

It takes `{text, language, voice}` and returns a 16-bit mono wav. `language` is the model name the
page sends (`english_18m_2026-10`, `english_7m_2026-10`, `english_7m_refl_2026-10`,
`english_2m_2026-10`); `voice` is a built-in name (default `alba`) or, with the gated weights, a
reference wav for cloning. Models are loaded lazily and kept, so one deployment serves all four
sizes; the default is warmed in `load()`.

**Be clear about what this buys.** Pocket TTS is small enough that a network round trip costs more
than the synthesis: a 2M model at 103x real time makes 9 s of audio in about 90 ms, while reaching
Baseten and back is 200-500 ms, and a scale-to-zero deployment adds a cold start on top. These
options exist to compare the voices and to keep the device free, not to go faster than the local
voice. The version worth having is Pocket TTS **in the browser**, next to Paradee: Kyutai say it is
small enough for WebAssembly but ship no official build, and `onnxruntime-web` is already vendored
in `lib/`, so a community ONNX export (`pocket-tts-onnx-export`) or the Rust/WASM port is the
path. Not done here.

### Orpheus on Groq

Groq's only text-to-speech is Canopy Labs Orpheus, so "a Kyutai voice on Groq" is not available;
this is a real remote voice through the same route. `canopylabs/orpheus-v1-english`, voices
`autumn, diana, hannah, austin, daniel, troy`, `response_format: "wav"`, and bracketed directions
such as `[cheerful]` steer the delivery. Input is capped at 200 characters.

Measured through `/api/tts` on this key: a 40-character sentence returned 3.52 s of 24 kHz mono
PCM in 1.33 s. The docs do not state a rate and third-party ones claim 48 kHz, so the page reads
the real rate out of the wav header (bytes 24-27) and builds the AudioContext at it; nothing is
resampled either way.

## Audio quality: what was checked

The voice was reported as buzzy/static, then "static again" in calls. Verified clean, so don't redo these:
the model output matches the authors' misaki reference on noise metrics (energy above 4 kHz, spectral flatness,
pause floor); threaded and single-threaded synthesis are statistically identical over 12 runs each; clause
chunks start and end at silence; the audio clock doesn't stall under synthesis load; and what Chrome delivers to
the sound server matches the samples the page sent (gain 1.0, 34-42 dB SNR) with echo cancellation on or off.
Found and fixed: playing 24 kHz buffers on a 48 kHz context (Chrome's linear resampler added imaging, 0.35% of
energy above 12 kHz). Not yet explained: static heard only in calls. The analog output stages are all at 100%
and the voice is quiet (RMS about -26 dBFS), so output is boosted 2x (`VOICE_GAIN`, capped at 0.95 peak) to
allow a lower system volume. Playwright launches Chromium with `--mute-audio`, so headless tests never reach a
sound device unless `ignoreDefaultArgs: ["--mute-audio"]`.

## Pinned models (do not use `main` URLs)

| What | Source |
|---|---|
| Whistle engine | `huggingface.co/Cactus-Compute/needle3/resolve/c7c415a3d1b3d929014bc6e866d51ebb971f7089/wasm/` (`needle.js`, `needle.wasm`) |
| Whistle model | `huggingface.co/Cactus-Compute/whistle/resolve/b358ddadd89b7a713b5aa131f23032d3cca1b251/whistle.cact` (16.9 MB) |
| Paradee TTS | `huggingface.co/sahilmahendrakar/Paradee-8M-v1.1/resolve/330617ad1f097b4f6b02c103e54b39006c090b45/` (`onnx/paradee_int8.onnx` 8.5 MB, `config.json`; v1.1, same inputs and vocab as v1.0) |

Both downloads go through the Cache API (`whistle-v1`, `paradee-v1`).

Vendored in `lib/` (no CDN at runtime):

- `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`: onnxruntime-web 1.22.0
- `phonemizer.js`: phonemizer 1.2.1 (espeak-ng compiled to WASM), license in `phonemizer.LICENSE`

Paradee is a distilled Kokoro-82M model. It is not Parakeet, which is NVIDIA's speech-to-text model.

## Speech in: how it segments

Audio is 16 kHz mono, read in 20 ms frames by an AudioWorklet.

- `SILENCE_MS = 270`: a segment ends after this much silence.
- Start: 2 loud frames. Loud means RMS above `max(0.01, 4 × noise floor)`.
  The floor adapts while the room is quiet.
- Pre-roll: 10 frames (200 ms) before the start are kept.
- Tail: at most 10 frames (200 ms) of trailing silence are sent.
- Drop speech shorter than 200 ms. Force a cut at 25 s (the engine's limit is 30 s).

## Speech out: how it works

Clauses are split on `.!?…,;:` and phonemized in one espeak call per passage.
Each phonemize call costs about 650 ms in the browser, mostly fixed, so one call
is much faster than one per sentence.

Each espeak phoneme is mapped to misaki's symbols with `MAP` (the untied form of
misaki's `espeak.py` E2M table). Paradee was trained on misaki phonemes.
Clauses are grouped by sentence so each sentence gets one model call and keeps
its intonation. Phonemes are capped at 510 per call, as in Paradee's Python code.

The voice runs in its own worker. Each sentence's audio is posted back as soon as
it is ready and scheduled on an AudioContext created at 24 kHz (`latencyHint: "playback"`).

Two things that matter for sound quality and correctness:

- **Play at 24 kHz.** Paradee outputs 24 kHz. On a 48 kHz context Chrome resamples each
  buffer with linear interpolation, which measured 0.35% of the energy above 12 kHz (an ideal
  upsample has about 0.00001%) and halved the 8–12 kHz band. That is audible as buzz and
  static. At 24 kHz the page hands over exact samples and the OS does the rate conversion.
- **Ignore the mic while reading.** Otherwise the speaker output is transcribed back into
  the text box. Reading flushes the open segment and drops mic frames until playback ends.

The model itself is not deterministic: two native runs on identical input differ by up to
0.06, because Paradee has a random noise source for fricatives. Don't compare outputs sample by
sample; compare spectra.

## Measured (headless Chromium, 8 CPUs, one WASM thread)

- Model load: about 10 s the first time, instant after caching.
- 4.4 s sentence: first audio at about 3.8 s, all audio after about 4.8 s.
- Three-sentence passage (7.7 s of audio): generation finishes in 5.6 s.
- Stop: cancels generation within one chunk.
- Round trip: Paradee's speech transcribed by Whistle as "Whistle transcribed speech on
  your device, and Paradey reads it back. Is it a question? Yes, it is."

Not measured: live microphone input and real-speech accuracy. The test voice was synthetic.

## Known limits and next steps

- Paradee is multi-threaded only when the page is cross-origin isolated. `server.mjs` sends
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, and
  `_headers` does the same on Cloudflare Pages. That cut synthesis time about 40% (4.3 s sentence:
  1316 ms to 780 ms). Without those headers it falls back to one thread. Whistle's engine is single-threaded.
- Paradee's cost is synthesis, about 0.2-0.3 s per second of audio. Phonemizing is 90-130 ms once warm.
  fp32 is no faster than int8.
- The 270 ms pause is a guess. Real speech may need 300–500 ms to avoid splitting mid-sentence.
- Phonemes come from espeak, not misaki's dictionary, so a few words differ
  (for example "device" comes out "dɪvˈIs" against misaki's "dəvˈIs").
- Language is detected per segment.
- Paradee speaks one voice (Kokoro's `af_heart`) and English only.
- Cached files and isolation: onnxruntime's thread-worker script must carry the isolation headers, and a copy cached
  before they were added is refused, which made the voice hang on "Loading voice…" with no error. The server now
  sends `Cache-Control: no-cache` with an ETag (304 on revalidation), the library folder was renamed `lib/` to drop
  stale entries, and the page retries the voice on one thread after 45 s (`VOICE_TIMEOUT_MS`) or says what to do.
- `file://` is blocked: the page shows a message asking for http.
