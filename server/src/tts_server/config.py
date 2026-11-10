"""Settings, read from TTS_* environment variables so nothing is tied to one machine."""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

# server/src/tts_server/config.py -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]

MODEL_FILE = "kokoro-v1.0.onnx"
VOICES_FILE = "voices-v1.0.bin"

# Any unpacked or packed Chrome extension. Web pages are refused.
EXTENSION_ORIGIN_REGEX = r"chrome-extension://[a-p]{32}"


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8765
    model_dir: Path = field(default_factory=lambda: REPO_ROOT / "models")
    default_voice: str = "af_sky"
    lang: str = "en-us"
    cache_size: int = 200
    max_chars: int = 1000
    allowed_origin_regex: str = EXTENSION_ORIGIN_REGEX

    @property
    def model_path(self) -> Path:
        return self.model_dir / MODEL_FILE

    @property
    def voices_path(self) -> Path:
        return self.model_dir / VOICES_FILE

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings":
        defaults = cls()
        return cls(
            host=env.get("TTS_HOST", defaults.host),
            port=int(env.get("TTS_PORT", defaults.port)),
            model_dir=Path(env["TTS_MODEL_DIR"]) if "TTS_MODEL_DIR" in env else defaults.model_dir,
            default_voice=env.get("TTS_VOICE", defaults.default_voice),
            lang=env.get("TTS_LANG", defaults.lang),
            cache_size=int(env.get("TTS_CACHE_SIZE", defaults.cache_size)),
            max_chars=int(env.get("TTS_MAX_CHARS", defaults.max_chars)),
            allowed_origin_regex=env.get("TTS_ALLOWED_ORIGIN_REGEX", defaults.allowed_origin_regex),
        )
