"""Kyutai Pocket TTS behind one predict call: {text, language, voice} in, wav bytes out.

Whistle's /api/tts posts one sentence at a time, so each call is short and the page can start
playing before the whole reply exists. Models are kept per language name because a deployment
serves every size the page offers (english_2m/7m/7m_refl/18m), and they are small enough
(1.9M to 18.2M parameters) that holding several costs almost nothing.
"""

import io
import os
import wave

import numpy as np
from fastapi import Response
from pocket_tts import TTSModel

MAX_CHARS = 400


class Model:
    def __init__(self, **kwargs):
        self._secrets = kwargs.get("secrets") or {}
        self._default = os.environ.get("POCKET_TTS_DEFAULT", "english_18m_2026-10")
        self._models = {}
        self._voices = {}

    def load(self):
        token = self._secrets.get("hf_access_token")
        if token:
            os.environ["HF_TOKEN"] = token  # the weights repo is gated
        self._get(self._default)  # warm, so the first request is not the slow one

    def _get(self, language):
        if language not in self._models:
            self._models[language] = TTSModel.load_model(language=language)
        return self._models[language]

    def _voice(self, model, language, name):
        key = (language, name)
        if key not in self._voices:
            self._voices[key] = model.get_state_for_audio_prompt(name)
        return self._voices[key]

    def predict(self, request):
        text = (request.get("text") or "").strip()
        if not text:
            return Response(content="no text", status_code=400, media_type="text/plain")
        if len(text) > MAX_CHARS:
            return Response(content="text too long", status_code=400, media_type="text/plain")
        language = request.get("language") or self._default
        try:
            model = self._get(language)
            audio = model.generate_audio(self._voice(model, language, request.get("voice") or "alba"), text)
        except Exception as e:  # an unknown language or voice name only shows up here
            return Response(content=f"{type(e).__name__}: {e}", status_code=400, media_type="text/plain")
        return Response(content=_wav(audio, model.sample_rate), media_type="audio/wav")


def _wav(audio, rate):
    """float samples in [-1, 1] to a 16-bit mono wav, which the browser decodes natively."""
    samples = np.asarray(audio.numpy() if hasattr(audio, "numpy") else audio, dtype=np.float32).reshape(-1)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(pcm.tobytes())
    return out.getvalue()
