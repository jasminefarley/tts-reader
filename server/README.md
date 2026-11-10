# tts-reader server

A small local HTTP server that turns one short piece of text (about a sentence)
into a WAV clip with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M),
running on the CPU through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).
The Chrome extension does the document handling and sentence splitting, and calls
this server once per sentence.

It listens on `127.0.0.1` only. Nothing leaves your machine.

## Setup

Needs [uv](https://docs.astral.sh/uv/). uv fetches Python 3.12 itself if needed.

```sh
cd server
uv sync
uv run tts-download-models   # ~350 MB, once, into ../models
uv run tts-server            # http://127.0.0.1:8765
```

Check it:

```sh
curl http://127.0.0.1:8765/health
curl -X POST http://127.0.0.1:8765/speak -H "Content-Type: application/json" \
     -d '{"text": "Hello there."}' -o hello.wav
```

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{"ok": true, "voice": "af_sky"}` |
| GET | `/voices` | | `{"default": "af_sky", "voices": [...]}` |
| POST | `/speak` | `{"text": "...", "voice": "af_sky", "speed": 1.0}` | `audio/wav`, with an `X-Audio-Duration` header in seconds |

- `voice` is optional (defaults to `TTS_VOICE`). `speed` is 0.5 to 2.0.
- Text is whitespace-normalized and limited to `TTS_MAX_CHARS` characters.
- Clips are cached in memory (LRU), so replaying or jumping back is instant.
- One clip is generated at a time. If the caller has already cancelled a
  request by the time its turn comes, it is skipped.

## Configuration

All optional, as environment variables:

| Variable | Default |
|---|---|
| `TTS_HOST` | `127.0.0.1` |
| `TTS_PORT` | `8765` |
| `TTS_MODEL_DIR` | `<repo>/models` |
| `TTS_VOICE` | `af_sky` |
| `TTS_LANG` | `en-us` |
| `TTS_CACHE_SIZE` | `200` clips |
| `TTS_MAX_CHARS` | `1000` |
| `TTS_ALLOWED_ORIGIN_REGEX` | any `chrome-extension://` origin |

## Security

Web pages can't use the server: any request that carries a browser `Origin`
other than a Chrome extension is refused with 403, and CORS only allows extension
origins. Requests with no `Origin` (curl, scripts on this machine) are allowed.

## Development

```sh
uv run pytest
uv run ruff check . && uv run ruff format --check .
```

Tests use a fake engine, so they don't need the model files.
