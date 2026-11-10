"""HTTP API: turn one short piece of text into a WAV clip.

The extension owns document structure and sentence splitting; this server only
speaks the strings it is given.
"""

import asyncio
import re
from collections import OrderedDict

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import Settings
from .engine import Clip, Engine, encode_wav

CacheKey = tuple[str, str, float]


class ClipCache:
    """Small LRU of encoded clips, so replaying or jumping back is instant."""

    def __init__(self, size: int) -> None:
        self._size = size
        self._items: OrderedDict[CacheKey, Clip] = OrderedDict()

    def get(self, key: CacheKey) -> Clip | None:
        clip = self._items.get(key)
        if clip is not None:
            self._items.move_to_end(key)
        return clip

    def put(self, key: CacheKey, clip: Clip) -> None:
        if self._size <= 0:
            return
        self._items[key] = clip
        self._items.move_to_end(key)
        while len(self._items) > self._size:
            self._items.popitem(last=False)


class SpeakRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float = Field(1.0, ge=0.5, le=2.0)


def create_app(settings: Settings, engine: Engine) -> FastAPI:
    app = FastAPI(title="tts-reader server", docs_url=None, redoc_url=None)
    voices = sorted(engine.voices())
    if settings.default_voice not in voices:
        raise ValueError(f"default voice {settings.default_voice!r} is not in the model")

    cache = ClipCache(settings.cache_size)
    # One synthesis at a time: ONNX Runtime already uses every core per call.
    synth_lock = asyncio.Lock()
    origin_pattern = re.compile(settings.allowed_origin_regex)

    @app.middleware("http")
    async def refuse_foreign_origins(request: Request, call_next):
        # Requests without an Origin (curl, scripts) are local and allowed.
        # Anything sent by a web page carries one and is refused.
        origin = request.headers.get("origin")
        if origin and not origin_pattern.fullmatch(origin):
            return JSONResponse({"detail": "origin not allowed"}, status_code=403)
        return await call_next(request)

    # Added after the origin check, so it wraps it and answers preflights first.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Audio-Duration"],
    )

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "voice": settings.default_voice}

    @app.get("/voices")
    async def list_voices() -> dict:
        return {"default": settings.default_voice, "voices": voices}

    @app.post("/speak")
    async def speak(body: SpeakRequest, request: Request) -> Response:
        text = " ".join(body.text.split())
        if not text:
            raise HTTPException(422, "text is empty")
        if len(text) > settings.max_chars:
            raise HTTPException(422, f"text is longer than {settings.max_chars} characters")
        voice = body.voice or settings.default_voice
        if voice not in voices:
            raise HTTPException(422, f"unknown voice {voice!r}")

        key: CacheKey = (text, voice, round(body.speed, 2))
        clip = cache.get(key)
        if clip is None:
            async with synth_lock:
                # The reader cancels requests it no longer needs (e.g. after a
                # jump); don't spend CPU on those.
                if await request.is_disconnected():
                    return Response(status_code=499)
                clip = cache.get(key)
                if clip is None:
                    samples, rate = await run_in_threadpool(engine.synthesize, text, voice, key[2])
                    clip = encode_wav(samples, rate)
                    cache.put(key, clip)

        return Response(
            clip.wav,
            media_type="audio/wav",
            headers={"X-Audio-Duration": f"{clip.duration:.3f}", "Cache-Control": "no-store"},
        )

    return app
