# Local TTS server for tts-reader. Built and run by ../docker-compose.yml.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.15 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 10001 tts && mkdir -p /models && chown tts /models
USER tts

ENV PATH="/app/.venv/bin:$PATH" \
    TTS_HOST=0.0.0.0 \
    TTS_PORT=8765 \
    TTS_MODEL_DIR=/models

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=4)"

# Downloads the model on first start (skipped when /models already has it).
CMD ["sh", "-c", "tts-download-models && exec tts-server"]
