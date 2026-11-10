# tts-reader

Reads long articles and Claude artifacts aloud with a natural voice, highlighting
each sentence as it's spoken so you can follow along. Free, and fully local: speech
is generated on your own CPU with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

Two parts:

| Folder | What |
|---|---|
| [`server/`](server/) | Local Python server that turns a sentence into audio |
| [`extension/`](extension/) | Chrome side-panel reader: read a page, a selection or pasted text, and follow along |
| [`spike/`](spike/) | Throwaway experiments from the first feasibility check |

## Installation

### What you need

- **Google Chrome**
- **Git**
- One of:
  - **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (recommended):
    the server then starts by itself whenever Docker Desktop does, for example at login.
  - **[uv](https://docs.astral.sh/uv/)**, the Python package manager, if you'd rather not
    use Docker. You start the server yourself in a terminal.
- About **400 MB** of disk space for the voice model. No GPU needed.

### 1. Get the code

```sh
git clone https://github.com/jasminefarley/tts-reader.git
cd tts-reader
```

### 2. Start the server

#### With Docker (recommended)

```sh
docker compose up -d --build
```

The first start downloads the voice model (~350 MB) into `models/`; later starts reuse
it. The container restarts by itself whenever Docker Desktop starts, so for it to come
back after a reboot, keep Docker Desktop's **Start Docker Desktop when you sign in**
setting on.

| To | Run |
|---|---|
| See what it's doing | `docker logs -f tts-reader-server` |
| Stop it (stays stopped) | `docker compose stop` |
| Start it again | `docker compose start` |
| Update after pulling changes | `docker compose up -d --build` |

#### Without Docker (uv)

Install uv first: `winget install --id=astral-sh.uv -e` on Windows, or
`curl -LsSf https://astral.sh/uv/install.sh | sh` on macOS and Linux. Then:

```sh
cd server
uv sync                      # installs the dependencies
uv run tts-download-models   # downloads the voice model (~350 MB) into ../models, once
uv run tts-server            # leave this terminal open while you use the reader
```

### 3. Check it

```sh
curl http://127.0.0.1:8765/health
# {"ok":true,"voice":"af_sky"}
```

Either way, the server is only reachable from your own machine, and only accepts
requests from Chrome extensions and local tools. More detail, including settings, is in
[`server/README.md`](server/README.md).

### 4. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder in this repo.
4. Pin **tts-reader** from the puzzle-piece menu, then click its icon to open the
   reader in the side panel.

After pulling new changes, click the reload icon on the extension's card in
`chrome://extensions`.

## Using it

Make sure the server is running (step 2), then any of these:

- **Read a whole page:** open the side panel from the tts-reader icon and click
  **Read this page**. On articles it reads just the main content (no menus, ads or
  footers). On claude.ai it reads the open artifact.
- **Read a selection:** select text, right-click, **Read selection aloud**.
- **Paste:** copy text from anywhere and paste it into the side panel's box (Ctrl+V).

Reading starts straight away, and the sentence being read is highlighted.

The first time you read a page on a new site, Chrome asks whether tts-reader may read
that site. Access is per site; claude.ai and its artifacts are allowed from the start.

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Previous / next sentence |
| Shift+← / Shift+→ | Previous / next paragraph |
| `[` / `]` | Slower / faster |

Click any sentence to read from there. Code blocks and tables are shown but not read
aloud. Speed and voice are remembered, and so is your place: open the same page or text
again and it picks up where you stopped (↺ starts over).

**Pronunciations.** If a word comes out wrong, open **Pronunciations…** (or **Aa** while
reading) and add a line like `uat = you-eh-tee`. Matches are whole words and
case-sensitive. To spell out letters, write them as one hyphenated word
(`you-eh-tee`); separate letters like `U A T` don't work well, because the lone "A"
is read as the word "a". Changes apply straight away.

### Troubleshooting

| Problem | Fix |
|---|---|
| `Model files not found` when starting | Run `uv run tts-download-models` from the `server` folder |
| `address already in use` / port 8765 busy | Another copy is running, for example the Docker container and a `uv run` at the same time. Stop one of them |
| Reader says the server isn't running | Docker: check Docker Desktop is running, then `docker compose up -d`. uv: `uv run tts-server` in the `server` folder |
| `uv` not found after installing | Open a new terminal so it picks up the updated `PATH` |
| Server gone after a reboot (Docker) | Turn on Docker Desktop's **Start Docker Desktop when you sign in** setting |

## License

MIT. Kokoro-82M is Apache 2.0.
