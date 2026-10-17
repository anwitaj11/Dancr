"""ElevenLabs text-to-speech with an on-disk cache, so repeated lines
("5, 6, 7, 8!", "Nice!") are generated once and reused."""

import hashlib
import os
from pathlib import Path

import httpx

CACHE_DIR = Path(os.getenv("DABLAB_AUDIO_CACHE", Path(__file__).parent.parent / "audio_cache"))
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "uYXf8XasLslADfZ2MB4u")  # same voice as the Dancr Coach agent
MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")

STOCK_LINES = ["Five!", "Six!", "Seven!", "Eight!", "Nice!", "Step complete!", "You nailed it!"]


class TTSUnavailable(Exception):
    pass


def cache_path(text: str) -> Path:
    key = hashlib.sha256(f"{VOICE_ID}:{MODEL_ID}:{text}".encode()).hexdigest()[:24]
    return CACHE_DIR / f"{key}.mp3"


def speak(text: str) -> Path:
    path = cache_path(text)
    if path.exists():
        return path
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip().strip("\"").strip("'").strip()
    if not api_key:
        raise TTSUnavailable("ELEVENLABS_API_KEY is not set")
    try:
        r = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
            headers={"xi-api-key": api_key, "accept": "audio/mpeg"},
            json={"text": text, "model_id": MODEL_ID},
            timeout=20,
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise TTSUnavailable(str(e)) from e
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return path


def pregenerate() -> list[str]:
    done = []
    for line in STOCK_LINES:
        try:
            speak(line)
            done.append(line)
        except TTSUnavailable:
            break
    return done
