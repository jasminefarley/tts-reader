# tts-reader

Reads long articles and Claude artifacts aloud with a natural voice, highlighting
each sentence as it's spoken so you can follow along. Free, and fully local: speech
is generated on your own CPU with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

Two parts:

| Folder | What |
|---|---|
| [`server/`](server/) | Local Python server that turns a sentence into audio |
| [`extension/`](extension/) | Chrome side-panel reader: paste text, listen, follow along |
| [`spike/`](spike/) | Throwaway experiments from the first feasibility check |

## Installation

### What you need

- **Google Chrome**
- **Git**
- **[uv](https://docs.astral.sh/uv/)**, the Python package manager. You don't need to
  install Python yourself; uv downloads Python 3.12 when it needs it.
- About **400 MB** of disk space for the voice model and its dependencies. No GPU needed.

### 1. Install uv

Windows (PowerShell):

```powershell
winget install --id=astral-sh.uv -e
```

macOS or Linux:

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new terminal afterwards, then check it with `uv --version`.

### 2. Get the code

```sh
git clone https://github.com/jasminefarley/tts-reader.git
cd tts-reader
```

### 3. Set up the server

```sh
cd server
uv sync                      # installs the dependencies
uv run tts-download-models   # downloads the voice model (~350 MB) into ../models, once
```

### 4. Start the server

```sh
uv run tts-server
```

Leave this terminal open while you use the reader. It's ready when it prints
`Uvicorn running on http://127.0.0.1:8765`. To check it from another terminal:

```sh
curl http://127.0.0.1:8765/health
# {"ok":true,"voice":"af_sky"}
```

The server only listens on your own machine, and only accepts requests from Chrome
extensions and local tools. More detail, including settings, is in
[`server/README.md`](server/README.md).

### 5. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder in this repo.
4. Pin **tts-reader** from the puzzle-piece menu, then click its icon to open the
   reader in the side panel.

After pulling new changes, click the reload icon on the extension's card in
`chrome://extensions`.

## Using it

1. Make sure the server is running (step 4).
2. Open the side panel from the tts-reader icon.
3. Copy text from a Claude artifact or an article (select it, then Ctrl+C) and paste it
   into the box (Ctrl+V). Reading starts straight away, and the sentence being read is
   highlighted.

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Previous / next sentence |
| Shift+← / Shift+→ | Previous / next paragraph |
| `[` / `]` | Slower / faster |

Click any sentence to read from there. Code blocks and tables are shown but not read
aloud. Speed and voice are remembered.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Model files not found` when starting | Run `uv run tts-download-models` from the `server` folder |
| `address already in use` / port 8765 busy | Another copy is running. Stop it, or start on another port with `TTS_PORT=8766` (the extension's server address would need to match) |
| Reader says the server isn't running | Start it with `uv run tts-server` in the `server` folder |
| `uv` not found after installing | Open a new terminal so it picks up the updated `PATH` |

## License

MIT. Kokoro-82M is Apache 2.0.
