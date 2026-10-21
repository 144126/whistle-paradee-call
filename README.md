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

The **groq model** dropdown selects the model for **Call Groq** and remembers it in this browser. It lists all eight models in [Groq's function-calling support table](https://console.groq.com/docs/tool-use/overview#supported-models), plus Allam from the live Models API. Safeguard is labeled as a safety model; enterprise models need an eligible account. GPT-OSS uses low reasoning effort; Qwen uses non-thinking mode for quick spoken replies. Speech and Prompt Guard classifiers stay out of this selector. Selecting a model does not add tool execution to Whistle's conversation loop.

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
cloning. Kyutai's claim is 103x faster than real time on one CPU core for the 1.9M model, which did
not reproduce here (measured 2.46-4.61x, see "Benchmarked here" below).
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

### Benchmarked here, and the 103x claim

Run locally on this laptop (i7-8565U, 4 cores / 8 threads) with `pocket-tts` 4.0.0 and
`torch 2.14.1+cpu`, median of 5 generations per text, one core
(`OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 taskset -c 0` and `torch.set_num_threads(1)`):

| model | params, flow_lm only | ckpt MB | load s | gen s short / med / long | RTF long, 1 core | RTF long, 8 threads | peak RSS MB |
|---|---|---|---|---|---|---|---|
| `english_2m_2026-10` | 0.88M (11.67M total) | 46.7 | 0.32 | 0.77 / 2.95 / 7.48 | 4.61x | 4.34x | 528-538 |
| `english_7m_2026-10` | 4.25M (16.61M total) | 66.5 | 0.40 | 1.08 / 3.65 / 10.56 | 3.39x | not run | 643 |
| `english_7m_refl_2026-10` | 4.25M (16.61M total) | 66.5 | 0.52 | 0.96 / 3.72 / 10.63 | 3.49x | not run | 674 |
| `english_18m_2026-10` | 15.56M (27.92M total) | 111.7 | 1.60 | 1.37 / 4.97 / 14.65 | 2.46x | 2.68x | 692-762 |

All four output 24 kHz. Texts were 12, 47 and 128 words, the same for every model.

**The 103x did not reproduce: 2.46x to 4.61x on one core.** Three things explain the gap, and they
matter before anyone designs around that number:

- **The headline parameter counts are the transformer only.** `english_2m` is 0.88M in `flow_lm`,
  but the Mimi encoder/decoder it needs is another 10.79M, so the real model is 11.67M and the
  checkpoint is 46.7 MB. Peak RSS was 528-538 MB. "1.9M" is not the thing you run.
- **This measures the PyTorch path**, and the obvious suspect for the gap — a compiled runtime —
  turned out to be *slower* here, not faster. See "Phonon" below: the Rust engine at `xn-ptts` is
  2.4x slower than this PyTorch path on one core of this laptop. So the 103x figure is not explained
  by "it was the Rust build"; it would have to be much newer hardware, a different text, or a
  measurement that excludes the Mimi decode.
- **The repo's own numbers agree with mine, not with the post.** Its README says ~6x real time on a
  MacBook Air M4 CPU, and RTF ~2.3-2.5x on a 4-vCPU x86 VM. The 18M result here, 2.46x, lands on
  that second figure.

More threads did not help: the 2M model went *down* from 4.61x to 4.34x on 8 threads. These models
are too small to parallelise usefully, which is consistent with Kyutai's one-core framing.

The two speed knobs the library exposes are both dead ends. `sampler_decode_steps` is already at its
fastest default of 1 (`default_parameters.py:5`; the `lsd` flow head is one-step by design, unlike
`flow_matching`, which needs 16 or more). And `quantize=True` — int8 dynamic on the `flow_lm`
attention and FFN, whose docstring claims "about 27% faster on x86" — did not deliver: median RTF
went 3.87x → 3.29x, inside the run-to-run spread, with peak RSS unchanged at about 485 MB. The
backend was `torch.ao` with the x86/FBGEMM engine; `torchao`, which that code prefers when present,
was not installed, so the docstring's figure may belong to that path. 64 linear modules were
quantized, so it did apply.

Nothing else is tunable for speed: there is no float16/bfloat16 option (both `flow_lm` and Mimi are
pinned to `float32` in `english.yaml`), no `torch.compile`, and `torch.set_num_threads(1)` runs at
import time in `models/tts_model.py:56`, so a thread setting applied before the import is silently
discarded — which is how the first attempt here produced an invalid all-core figure.

### Phonon, the other small one

[Phonon](https://gradium.ai/phonon) (Gradium) is the nearest alternative and shares ancestry with
this: its runtime, [`xn-ptts`](https://github.com/gradium-ai/xn-ptts), is a Rust engine whose
acknowledgements say it builds heavily on Kyutai's continuous audio language model work, and it
reads Pocket TTS checkpoints that ship a `config.json`. Phonon 31m is Apache-2.0; the 40m models are
CC BY-NC. It installs as a 9.3 MB prebuilt binary with no Python, and — unlike Pocket TTS — ships an
npm WASM build, which is the only one of the two that could join Paradee in the browser.

Measured on the same laptop, same text, interleaved A/B so load drift hits both equally (8 timed
cycles each, `taskset -c 0`, one thread, RTF = audio / generation, higher is faster):

| engine | median RTF | min-max | peak RSS MB | weights MB |
|---|---|---|---|---|
| Pocket TTS 2M, torch f32 | **3.87x** | 3.02-4.40 | 484 | 47.3 |
| Pocket TTS 2M, torch int8 | 3.29x | 2.26-4.19 | 487 | 47.3 |
| Phonon 31m, f32 | 1.62x | 1.33-1.88 | 377 | 103.4 |
| Phonon 31m, `--quant q8` | 1.95x | 1.30-2.39 | 257 | 64.5 |
| Phonon 31m, `--quant q4k` | 2.51x | 2.31-2.62 | 272 | 55.1 |

**Pocket TTS is 2.4x faster on one core, and the f32 ranges do not overlap**, so that gap is real
and not load noise. It is also the smaller download (47 MB against 103 MB). Phonon's quantization
buys memory rather than speed — q8 cut peak RSS from 377 MB to 257 MB with non-overlapping ranges,
while its RTF change stayed inside the spread.

Two things this does not say. Quality was not compared: Gradium publishes 1.70% WER for Phonon 31m
against Kokoro's 3.50%, and a 2M model beating a 31M one on speed should be expected to lose on
quality, so the samples in `~/Downloads/tts-ab-samples/` want a listen before any choice. And
Phonon's own claims are for hardware this laptop is not: 26x on one MacBook Air M5 core, 22x on an
iPhone 16 Pro Neural Engine, 2.3x on one Raspberry Pi 5 core — that last figure is the one closest
to this machine's class, and it is in the same range as what was measured here.

`ptts` cannot load the public `kyutai/pocket-tts-without-voice-cloning` weights
(`Error: config.json is not in hf://...`), so each engine was timed in its own runtime; that is the
one way this comparison is not apples to apples. The machine also carried unrelated load
(1-min average 4.7-11.3 on 4 cores) throughout, which is why the A/B was interleaved and why the
min-max columns matter more than the medians.

Measured on the public `kyutai/pocket-tts-without-voice-cloning` weights, because the gated repo was
not accessible; the architecture is the same but these figures are not guaranteed to match the gated
build. Voice cloning was not exercised.

**So what is this worth?** Not a speed win. At 2.5-4.6x real time on a CPU, a Baseten deployment of
Pocket TTS lands in the same range as Paradee already does in the browser (about 0.2-0.3 s per second
of audio), and slower end to end than Orpheus on Groq measured above. What the remote options give
is a voice comparison, voice cloning, and keeping the device free — not lower latency. A browser
build next to Paradee (`onnxruntime-web` is already vendored in `lib/`; Kyutai say WebAssembly is
feasible but ship no official build) is still the interesting direction, but on these numbers it
would roughly match the voice already there rather than beat it. Not done here.

### Phonon's load, and why it cannot be made fast

Phonon's first load measured 60.5 s (f32) and 96.7 s (q8) here. Both numbers are worth taking apart,
because the obvious reading of them is wrong twice over.

**The 96.7 s was mostly not loading.** q8 is 69.5 MB and f32 is 107.8 MB, so the *bigger* download
finished 36 s sooner. At the link speed below, f32's 60.5 s is almost exactly right and q8 should
have taken 36 s; the other ~60 s was a machine with 265 MB free and 11.7 GB of swap in use. Any
figure measured under that is a figure about swap.

**The link is the wall, not the Hub.** Measured for the same 8 MB:

| source | throughput |
|---|---|
| huggingface.co | 1.59 MB/s |
| Cloudflare edge (`speed.cloudflare.com`) | 1.92 MB/s |
| jsdelivr | 1.09 MB/s |
| huggingface.co, 8 parallel ranges | 1.01 MB/s aggregate |

Parallel is *slower* than one stream, which is what a saturated line looks like. So 64.5 MB takes
about 34 s whoever serves it, and moving the weights to a CDN, to S3, or to the page's own origin
buys at most 1.2x. It is still worth doing for the other reasons below, just not for throughput.

**The bytes are nearly irreducible.** Parsing the GGUF tensor tables of both quantizations (185
tensors, 41.10M params):

| module | tensors | q8 size | note |
|---|---|---|---|
| `flow_lm.transformer` | 48 | 20.08 MB | the only quantized part, Q8_0 |
| `flow_lm.flow_net` | 68 | 18.99 MB | BF16, untouched by `--quant` |
| `mimi.decoder_transformer` | 20 | 12.60 MB | BF16 |
| `mimi.decoder` | 22 | 7.95 MB | BF16 convolutions |
| `flow_lm.condition_provider` | 9 | 4.77 MB | BF16 |
| everything else | 18 | 0.09 MB | |

`--quant` only ever touches **24 tensors**: Q8_0 20.05 MB, or Q4_K 10.62 MB in `model.q4k.gguf`.
The other 161 stay BF16 at 44.44 MB, which is 69% of the q8 download and 81% of q4k. So q4k is only
55.1 MB against 64.5 MB, and a hypothetical build that quantized every linear would land near 29 MB.
There is also no `mimi.encoder.*` in this checkpoint (it was built with `quantize --no-mimi-encoder`,
which the wasm's own error string names), so there is nothing dead to strip — and cloning a voice
from a recording needs that encoder, so this checkpoint only takes precomputed voice embeddings.

**q4k will not load in the browser.** The wasm carries type names for q4_0, q4_1, q5_0, q5_1, q6k,
q8_0, q8_1 and q8k, and no q4_k, next to an `unsupported quantization '` error string. Pointing the
`q8` slot at `model.q4k.gguf` would therefore download 55 MB and then fail. Not attempted.

Put together: a 100x faster load would need 1.9 MB on the wire, and the floor is 29 MB even in a
build that does not exist. **That is not reachable.** What is reachable is never waiting for it:

- **Pinned `ModelSpec` instead of `hf://...`** — the package's Hub API lookup costs 0.52 s on every
  load, and `index.html` now names every file at a fixed commit instead. The URLs it builds are byte
  for byte the ones the Hub lookup produced, so anything already cached still hits.
- **`PHONON_BASE`, one constant** — on an S3 or CloudFront static site, point it at the bucket and
  the checkpoint comes from the page's own origin. S3 has no per-file cap; Cloudflare Pages refuses
  any asset over 25 MiB, so the 64.5 MB GGUF cannot live there.
- **Idle prefetch** — once Paradee is up and the page is quiet, `prefetchPhonon()` fills the
  package's own cache (`phonon-tts-v1`) with the checkpoint *without starting the model*, so nothing
  is resident until the voice is actually picked. `PHONON_PREFETCH = false` turns it off, and it
  skips itself on `saveData` or a 2g connection.
- **Resumable in 8 MB ranges** — each range is cached under its own key and assembled at the end, so
  a tab closed mid-download resumes instead of starting the 34 s again. `Cache.put` refuses a 206,
  hence the rebuilt `Response`. A server that refuses ranges, or a browser that will not send the
  header cross-origin, falls back to one stream. `huggingface.co` answers an `OPTIONS` preflight with
  `access-control-allow-headers: range` and exposes `Content-Range`, and LFS redirects to
  `us.aws.cdn.hf.co`, which both get a `preconnect`.
- **Kept alive** — the worker is disposed only when the device changes, so switching to another voice
  and back costs nothing. It measured 605 MB resident, which is the reason it is not loaded eagerly.

The warm path is already well built and is not where the remaining time is: the package streams into
one preallocated buffer, caches from a clone rather than re-serialising, and `instantiateStreaming`
does reach Chrome's code cache because the server sends `application/wasm`. What is left of its
3.13 s is the 64.5 MB Cache API read and the Rust-side GGUF parse. OPFS with
`createSyncAccessHandle` in the worker would beat the Cache API at that size, and pre-sizing the
shared heap would avoid repeated `memory.grow` over ~100 MB. Neither is done here.

**On an AWS static site** (S3 behind CloudFront), two things matter beyond the above. Threads need
the page cross-origin isolated, so CloudFront must attach a response-headers policy sending
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — without
it `onnxruntime-web` and Phonon both silently drop to one thread, which costs about 40% and shows up
nowhere. `#meta` now prints the thread count each engine actually got, and the page says so outright
when `crossOriginIsolated` is false. And `.wasm` must be served as `application/wasm`, or
`instantiateStreaming` falls back to the slower non-streaming path.

### Orpheus on Groq

Groq's only text-to-speech is Canopy Labs Orpheus, so "a Kyutai voice on Groq" is not available;
this is a real remote voice through the same route. `canopylabs/orpheus-v1-english`, voices
`autumn, diana, hannah, austin, daniel, troy`, `response_format: "wav"`, and bracketed directions
such as `[cheerful]` steer the delivery. Input is capped at 200 characters.

The docs do not state a sample rate and third-party ones claim 48 kHz. Measured: 24 kHz mono
`pcm_s16le`. The page therefore reads the real rate out of the wav header (bytes 24-27) and builds
the AudioContext at it, so nothing is resampled whichever it turns out to be.

Measured through `/api/tts` on this key, median of 3 runs after a warm-up, `autumn`:

| input | wall | audio out | faster than real time |
|---|---|---|---|
| 28 chars | 0.82 s | 3.04 s | 3.7x |
| 140 chars | 1.73 s | 9.20 s | 5.3x |
| 276 chars | 3.34 s | 20.24 s | 6.0x |

Two things the docs do not tell you. **The first call after an idle period took 18.68 s**, against
0.82 s warm, so the opening turn of a call on this voice can stall badly. And the 200-character
cap is not enforced: the 276-character request returned normally. `TTS_MAX_CHARS = 180` stays
conservative anyway, because one sentence per request is what makes audio start early.

For scale: the page sends a sentence at a time, so what matters is the 0.8-1.7 s per sentence
above, not the throughput figure. Paradee in the browser reaches first audio in about 3.8 s on a
4.4 s sentence (see "Measured", below), so on this laptop Orpheus actually starts speaking sooner
than the on-device voice, cold starts aside.

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
