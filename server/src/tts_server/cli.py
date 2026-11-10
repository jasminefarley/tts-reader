"""Command-line entry points: `tts-server` and `tts-download-models`."""

import sys
import urllib.request
from pathlib import Path

from .config import MODEL_FILE, VOICES_FILE, Settings

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"


def serve() -> None:
    settings = Settings.from_env()
    missing = [p for p in (settings.model_path, settings.voices_path) if not p.exists()]
    if missing:
        names = ", ".join(str(p) for p in missing)
        sys.exit(f"Model files not found: {names}\nRun `uv run tts-download-models` first.")

    import uvicorn

    from .app import create_app
    from .engine import KokoroEngine

    print(f"Loading Kokoro from {settings.model_dir} ...", flush=True)
    engine = KokoroEngine(settings.model_path, settings.voices_path, settings.lang)
    app = create_app(settings, engine)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


def download_models() -> None:
    settings = Settings.from_env()
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    for name in (MODEL_FILE, VOICES_FILE):
        target = settings.model_dir / name
        if target.exists():
            print(f"{name}: already present")
            continue
        _download(f"{RELEASE}/{name}", target)


def _download(url: str, target: Path) -> None:
    partial = target.with_suffix(target.suffix + ".part")
    print(f"Downloading {url}")
    with urllib.request.urlopen(url) as response, partial.open("wb") as out:
        total = int(response.headers.get("Content-Length", 0))
        done = 0
        while chunk := response.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done * 100 // total}%", end="", flush=True)
    print()
    partial.replace(target)
