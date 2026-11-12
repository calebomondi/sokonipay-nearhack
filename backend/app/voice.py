"""Speaking to your agent and hearing it answer, through ElevenLabs.

The API key stays on this server. Recordings and replies are kept short, so the feature can't be
used to run up a bill. Without a key the app simply has no microphone or speaker buttons."""

import re
from collections.abc import AsyncIterator

import httpx

from app.config import settings

BASE = "https://api.elevenlabs.io/v1"
MAX_AUDIO = 2_000_000  # bytes: about 30 seconds of speech from a browser
MAX_SPOKEN = 600  # characters


class VoiceError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.elevenlabs_api_key)


async def transcribe(audio: bytes, content_type: str) -> str:
    """What was said in a short recording. The language is detected."""
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            res = await http.post(f"{BASE}/speech-to-text", headers={"xi-api-key": settings.elevenlabs_api_key},
                                  data={"model_id": settings.elevenlabs_stt_model, "tag_audio_events": "false", "timestamps_granularity": "none"},
                                  files={"file": ("speech", audio, content_type or "audio/webm")})
    except httpx.HTTPError as e:
        raise VoiceError("The speech service can't be reached right now. Type your message instead.") from e
    if res.status_code >= 400:
        raise VoiceError("That recording couldn't be understood. Try again, or type your message.")
    return str(res.json().get("text", "")).strip()


def for_speech(text: str) -> str:
    """Written amounts read badly aloud: "KES 1,274" becomes "1,274 shillings"."""
    text = re.sub(r"KES\s?([\d,]+(?:\.\d+)?)", r"\1 shillings", text)
    text = re.sub(r"\bsUSD\b", "dollars", text)
    return text[:MAX_SPOKEN]


async def speak(text: str) -> AsyncIterator[bytes]:
    """The text as MP3 audio, streamed as it is made."""
    url = f"{BASE}/text-to-speech/{settings.elevenlabs_voice_id}/stream"
    body = {"text": for_speech(text), "model_id": settings.elevenlabs_tts_model}
    async with httpx.AsyncClient(timeout=30) as http:
        async with http.stream("POST", url, headers={"xi-api-key": settings.elevenlabs_api_key}, json=body,
                               params={"output_format": "mp3_44100_128"}) as res:
            if res.status_code >= 400:
                raise VoiceError("The voice service refused that.")
            async for chunk in res.aiter_bytes():
                yield chunk
