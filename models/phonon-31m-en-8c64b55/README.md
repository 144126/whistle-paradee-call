---
license: apache-2.0
language:
  - en
pipeline_tag: text-to-speech
tags:
  - text-to-speech
  - tts
  - streaming
  - on-device
  - phonon
---

# Phonon S English

**Streaming speech, on your device.**

Phonon S is a text-to-speech model from the Phonon family.
It turns text into natural 24 kHz speech in English.
It streams audio while it is still generating, and it is small enough to run
in a browser tab, on a phone, or on a laptop CPU.

Phonon builds on [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) and
the Mimi codec, developed by Kyutai.

[Try it in your browser](https://huggingface.co/spaces/gradium/phonon) · [All Phonon models](https://huggingface.co/collections/gradium/phonon) · [Runtime on GitHub](https://github.com/gradium-ai/xn-ptts) · [Python](https://pypi.org/project/ptts/) · [Browser](https://www.npmjs.com/package/phonon-tts) · [Discord](https://discord.gg/T85yt8kD33)


## Model details

- **Model type:** text-to-speech. A flow-matching transformer predicts audio latents from the text one 80 ms frame at a time, and the Mimi codec's decoder turns them into audio.
- **Parameters:** 31M (excluding the audio tokenizer)
- **Languages:** English
- **Output:** mono, 24 kHz
- **License:** [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)

## The Phonon family

| Model | Parameters | Languages | License |
|---|---|---|---|
| [Phonon S EN](https://huggingface.co/gradium/phonon-31m-en) | 31M | English | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| [Phonon M EN](https://huggingface.co/gradium/phonon-40m-en) | 40M | English | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Phonon M FR](https://huggingface.co/gradium/phonon-40m-fr) | 40M | French | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Phonon M DE](https://huggingface.co/gradium/phonon-40m-de) | 40M | German | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Phonon M ES](https://huggingface.co/gradium/phonon-40m-es) | 40M | Spanish | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Phonon M PT](https://huggingface.co/gradium/phonon-40m-pt) | 40M | Portuguese | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |
| [Phonon M](https://huggingface.co/gradium/phonon-40m-multilingual) | 40M | English, French, German, Spanish, Portuguese | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |

All of them run on the same runtime and use the same file layout, so switching models means changing the repo ID.

## Quickstart

Every runtime names this model as `hf://gradium/phonon-31m-en`, and takes `lang`, which selects how text is normalized (numbers, symbols, dates). This model speaks English, so use `en`.

### Command line

```sh
uvx ptts --lang en --quant q8 \
  --voice en_us_Zoey "Hello from Phonon." -o speech.wav
```

`uvx` runs the Python package's command without installing it. The standalone `ptts` binary from [GitHub Releases](https://github.com/gradium-ai/xn-ptts/releases) or Homebrew (`brew install gradium-ai/tap/ptts`) takes the same flags.

### Python

```sh
pip install ptts
```

```python
import ptts

tts = ptts.TTS("hf://gradium/phonon-31m-en", lang="en", quant="q8")
tts.save("speech.wav", "Hello from Phonon.", voice="en_us_Zoey")

# Or stream: chunks arrive while the rest is still being generated.
with tts.stream("Speech can start playing right away.", voice="en_us_Zoey") as audio:
    for pcm in audio:
        ...  # float32 chunks at audio.sample_rate
```


### Other platforms

| Platform | Guide |
|---|---|
| Python scripts and backends | [`ptts` on PyPI](https://pypi.org/project/ptts/) · [Python guide](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-pyo3/README.md) |
| Web apps, in the browser | [`phonon-tts` on npm](https://www.npmjs.com/package/phonon-tts) · [Browser guide](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-wasm/js/README.md) |
| iPhone, iPad and Mac apps (Core ML) | [Swift guide](https://github.com/gradium-ai/xn-ptts/blob/main/ios/PhononTTS/README.md) |
| Android apps | [Android guide](https://github.com/gradium-ai/xn-ptts/blob/main/android/README.md) · [Snapdragon NPU preview](https://github.com/gradium-ai/xn-ptts/blob/main/qnn/android/README.md) |
| Android system voice, for TalkBack and every app that uses `TextToSpeech` | [Android TTS engine](https://github.com/gradium-ai/xn-ptts/blob/main/android/tts-engine/README.md) |
| Server with an OpenAI-compatible API (Docker) | [Server guide](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-openai-server/README.md) |
| Home Assistant | [Home Assistant setup](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-openai-server/README.md#home-assistant) |
| Streaming over WebSocket | [WebSocket server](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-ws-server/README.md) |
| Rust | [`ptts` on crates.io](https://crates.io/crates/ptts) · [Rust guide](https://github.com/gradium-ai/xn-ptts/blob/main/ptts/README.md) |
| C and C++ | [`ptts.h`](https://github.com/gradium-ai/xn-ptts/blob/main/ptts-ffi/include/ptts.h) |

## Voices

Phonon comes with a catalog of ~100 voices available in the [gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices) repo.
Instant voice cloning and voice design are available through the [Gradium studio](https://studio.gradium.ai).

## Performance

See the blog post.

## Intended use

Phonon is made for applications that speak on the user's device: offline and private
assistants, screen readers and other accessibility tools, games, and interactive apps that
cannot wait for a cloud round trip. It also runs as a local server with an OpenAI-compatible
API and as a voice for Home Assistant.

### Limitations

- The model speaks only the languages above. Text in other languages is read with the wrong
  pronunciation.
- Text is normalized before synthesis (numbers, currency, dates, emails and so on), and that
  step needs the right language. Choose `lang` to match the text.
- Very long inputs are split into sentences and spoken one after the other, so prosody does not
  carry across the whole text.

### Responsible use

Do not use Phonon to impersonate a real person, to deceive listeners about who is speaking, or
to clone a voice without the speaker's consent. Tell listeners when speech is synthetic where
that matters to them.

## License

The weights, tokenizer and voices in this repository are released under [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), which allows commercial use. The runtime is a separate project, licensed MIT OR Apache-2.0.
