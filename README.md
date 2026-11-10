# tts-reader

Reads long articles and Claude artifacts aloud with a natural voice, highlighting
each sentence as it's spoken so you can follow along. Free, and fully local: speech
is generated on your own CPU with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

Two parts:

| Folder | What |
|---|---|
| [`server/`](server/) | Local Python server that turns a sentence into audio |
| `extension/` | Chrome side-panel reader (coming next) |
| [`spike/`](spike/) | Throwaway experiments from the first feasibility check |

## Quick start

1. Install [uv](https://docs.astral.sh/uv/).
2. Start the server (details in [`server/README.md`](server/README.md)):

   ```sh
   cd server
   uv sync
   uv run tts-download-models
   uv run tts-server
   ```

## License

MIT. Kokoro-82M is Apache 2.0.
