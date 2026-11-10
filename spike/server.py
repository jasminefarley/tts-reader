# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["kokoro-onnx>=0.4", "soundfile"]
# ///
"""Phase 0 spike: minimal local TTS server (stdlib only, throwaway).

Checks that a Chrome extension page can reach a local server on this laptop.

    uv run spike/server.py            # listens on 127.0.0.1:8765

GET  /health        -> {"ok": true, "voice": "af_sky"}
POST /speak {text}  -> audio/wav
"""

import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

HOST, PORT, VOICE = "127.0.0.1", 8765, "af_sky"
MODELS = Path(__file__).resolve().parent.parent / "models"
kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, json.dumps({"ok": True, "voice": VOICE}).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self) -> None:
        if self.path != "/speak":
            self._send(404, b"not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        text = str(payload.get("text", "")).strip()[:1000]
        if not text:
            self._send(400, b"text required", "text/plain")
            return
        samples, rate = kokoro.create(
            text, voice=VOICE, speed=float(payload.get("speed", 1.0)), lang="en-us"
        )
        buf = io.BytesIO()
        sf.write(buf, samples, rate, format="WAV")
        self._send(200, buf.getvalue(), "audio/wav")


if __name__ == "__main__":
    print(f"spike server on http://{HOST}:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
