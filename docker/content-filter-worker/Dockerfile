# syntax=docker/dockerfile:1.4
# The content-filter worker: runs Admin "Make filter" pipeline runs (refine, scenes, audit).
# Debian, not Alpine like the app image: refine's transcription (faster-whisper / ctranslate2)
# and word alignment (torch, torchaudio) publish no musl wheels. Build from the repo root:
#   sudo docker build -f docker/content-filter-worker/Dockerfile -t kckern/daylight-content-filter-worker:latest .
ARG NODE_VERSION=22.23.2
FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /usr/src/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg imagemagick python3 python3-venv ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# Python for transcribe.py (faster-whisper, CPU int8) and align_words.py (torch + torchaudio, CPU).
RUN python3 -m venv /opt/cf-venv \
    && /opt/cf-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/cf-venv/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch>=2.4" "torchaudio>=2.4" \
    && /opt/cf-venv/bin/pip install --no-cache-dir faster-whisper numpy

# Node deps without build scripts: the worker loads the CLI, the backend utilities and the
# content-filter modules only (no canvas, no native printers).
COPY package*.json ./
COPY __backend/package*.json ./__backend/
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps \
    && cd __backend && npm ci --omit=dev --ignore-scripts --legacy-peer-deps

COPY shared/ ./shared/
COPY __backend/ ./__backend/
COPY __app_modules/ ./__app_modules/
COPY __capabilities/ ./__capabilities/
COPY frontend/src/lib/logging/ ./frontend/src/lib/logging/

ENV NODE_ENV=production \
    CONTENT_FILTER_TRANSCRIBE_PY=/opt/cf-venv/bin/python \
    CONTENT_FILTER_ALIGN_PY=/opt/cf-venv/bin/python \
    DAYLIGHT_DATA_DIR=/usr/src/app/data \
    DAYLIGHT_MEDIA_DIR=/usr/src/app/media \
    HF_HOME=/usr/src/app/media/content-filter/models/hf \
    TORCH_HOME=/usr/src/app/media/content-filter/models/torch

USER node
CMD ["node", "__app_modules/media/media/cli/contentfilter.cli.mjs", "worker"]
