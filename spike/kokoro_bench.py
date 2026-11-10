# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["kokoro-onnx>=0.4", "soundfile"]
# ///
"""Phase 0 spike: is Kokoro fast enough on this CPU?

Generates sentences of different lengths with one voice and reports the
real-time factor (generation time / audio duration). Below 1.0 means audio is
produced faster than it plays; well below 0.3 means sentence-by-sentence
streaming will have no gaps.

    uv run spike/kokoro_bench.py [--voice af_sky] [--speed 1.0] [--out out.wav]
"""

import argparse
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = Path(__file__).resolve().parent.parent / "models"

SENTENCES = [
    "Hello there.",
    "This is a short test of the local reader.",
    "When a source system adds a column, the nightly load silently drops it, "
    "and nobody finds out until a report comes back missing data.",
    "The extension owns the structure of the document, deciding what is a "
    "heading, what is code, and where each sentence breaks, while the server "
    "only turns one short string into audio, which keeps it small and lets the "
    "cleanup rules change without a restart.",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="af_sky")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--out", default="spike-output.wav")
    args = parser.parse_args()

    t0 = time.perf_counter()
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    print(f"model load: {time.perf_counter() - t0:.2f}s")

    # Warm-up so the first measured sentence isn't paying one-time costs.
    kokoro.create("Warm up.", voice=args.voice, speed=args.speed, lang="en-us")

    clips = []
    sample_rate = 24000
    print(f"\n{'chars':>5}  {'gen s':>6}  {'audio s':>7}  {'RTF':>5}")
    for text in SENTENCES:
        t = time.perf_counter()
        samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang="en-us")
        gen = time.perf_counter() - t
        dur = len(samples) / sample_rate
        print(f"{len(text):>5}  {gen:>6.2f}  {dur:>7.2f}  {gen / dur:>5.2f}")
        clips.extend([samples, np.zeros(int(0.15 * sample_rate), dtype=samples.dtype)])

    sf.write(args.out, np.concatenate(clips), sample_rate)
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
