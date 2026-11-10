"""Speech engines. The app depends only on the Engine protocol, so tests can use a fake."""

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile as sf


class Engine(Protocol):
    def voices(self) -> list[str]: ...

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        """Return (mono float samples, sample rate)."""
        ...


@dataclass(frozen=True)
class Clip:
    wav: bytes
    duration: float


def encode_wav(samples: np.ndarray, sample_rate: int) -> Clip:
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return Clip(wav=buf.getvalue(), duration=len(samples) / sample_rate)


class KokoroEngine:
    """Kokoro-82M through kokoro-onnx, on the CPU."""

    def __init__(self, model_path: Path, voices_path: Path, lang: str = "en-us") -> None:
        from kokoro_onnx import Kokoro  # heavy import, kept out of tests

        self._kokoro = Kokoro(str(model_path), str(voices_path))
        self._lang = lang

    def voices(self) -> list[str]:
        return list(self._kokoro.get_voices())

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        samples, rate = self._kokoro.create(text, voice=voice, speed=speed, lang=self._lang)
        return samples, rate
