import numpy as np
import pytest
from fastapi.testclient import TestClient

from tts_server.app import ClipCache, create_app
from tts_server.config import Settings
from tts_server.engine import Clip

EXT_ORIGIN = "chrome-extension://" + "a" * 32


class FakeEngine:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float]] = []

    def voices(self) -> list[str]:
        return ["af_sky", "am_adam"]

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        self.calls.append((text, voice, speed))
        return np.zeros(2400, dtype=np.float32), 24000  # 0.1 s of silence


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def client(engine: FakeEngine) -> TestClient:
    return TestClient(create_app(Settings(max_chars=50), engine))


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"ok": True, "voice": "af_sky"}


def test_voices(client: TestClient) -> None:
    assert client.get("/voices").json() == {"default": "af_sky", "voices": ["af_sky", "am_adam"]}


def test_speak_returns_wav_with_duration(client: TestClient, engine: FakeEngine) -> None:
    res = client.post("/speak", json={"text": "Hello there."})
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/wav"
    assert res.content[:4] == b"RIFF"
    assert res.headers["x-audio-duration"] == "0.100"
    assert engine.calls == [("Hello there.", "af_sky", 1.0)]


def test_speak_normalizes_whitespace_and_caches(client: TestClient, engine: FakeEngine) -> None:
    client.post("/speak", json={"text": "Hello   there."})
    client.post("/speak", json={"text": " Hello\nthere. "})
    assert len(engine.calls) == 1


def test_speak_cache_key_includes_voice_and_speed(client: TestClient, engine: FakeEngine) -> None:
    client.post("/speak", json={"text": "Hi."})
    client.post("/speak", json={"text": "Hi.", "voice": "am_adam"})
    client.post("/speak", json={"text": "Hi.", "speed": 1.5})
    assert len(engine.calls) == 3


@pytest.mark.parametrize(
    "body",
    [
        {"text": "   "},
        {"text": "x" * 51},
        {"text": "Hi.", "voice": "nope"},
        {"text": "Hi.", "speed": 0.1},
        {"text": "Hi.", "speed": 3},
        {},
    ],
)
def test_speak_rejects_bad_input(client: TestClient, engine: FakeEngine, body: dict) -> None:
    assert client.post("/speak", json=body).status_code == 422
    assert engine.calls == []


def test_extension_origin_allowed_with_cors(client: TestClient) -> None:
    res = client.post("/speak", json={"text": "Hi."}, headers={"Origin": EXT_ORIGIN})
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == EXT_ORIGIN
    assert "x-audio-duration" in res.headers["access-control-expose-headers"].lower()


def test_extension_preflight_allowed(client: TestClient) -> None:
    res = client.options(
        "/speak",
        headers={
            "Origin": EXT_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert res.status_code == 200


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:3000", "null"])
def test_web_origins_refused(client: TestClient, engine: FakeEngine, origin: str) -> None:
    res = client.post("/speak", json={"text": "Hi."}, headers={"Origin": origin})
    assert res.status_code in (400, 403)
    assert engine.calls == []


def test_unknown_default_voice_fails_fast(engine: FakeEngine) -> None:
    with pytest.raises(ValueError):
        create_app(Settings(default_voice="missing"), engine)


def test_clip_cache_evicts_least_recently_used() -> None:
    cache = ClipCache(2)
    a, b, c = (("a", "v", 1.0), ("b", "v", 1.0), ("c", "v", 1.0))
    clip = Clip(b"", 0.0)
    cache.put(a, clip)
    cache.put(b, clip)
    cache.get(a)  # a is now most recent
    cache.put(c, clip)
    assert cache.get(b) is None
    assert cache.get(a) is not None and cache.get(c) is not None


def test_settings_from_env(tmp_path) -> None:
    s = Settings.from_env({"TTS_PORT": "9000", "TTS_MODEL_DIR": str(tmp_path), "TTS_VOICE": "x"})
    assert (s.port, s.model_dir, s.default_voice) == (9000, tmp_path, "x")
    assert Settings.from_env({}).host == "127.0.0.1"
