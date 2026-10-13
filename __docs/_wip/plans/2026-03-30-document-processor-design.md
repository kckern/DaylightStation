# Document Processor — Design

## Overview

Standalone Docker service that watches for scanned JPGs from a ScanSnap scanner, uses a vision LLM to intelligently group pages into documents, fix orientation, categorize, and name them — then feeds clean PDFs into Paperless-ngx for OCR and archival.

## Pipeline

```
ScanSnap → _Inbox/ (individual JPGs, one per page)
  → Filewatcher detects batch complete (15s debounce)
  → Move batch to _Processing/batch-{timestamp}/
  → Generate thumbnails, stitch into numbered contact sheet grid
  → Send grid to vision LLM (single API call)
  → LLM returns: document groupings, orientations, categories, dates, descriptions
  → If ambiguous pages: second pass at higher resolution
  → Fix rotation, group pages into PDFs
  → Name: "YYYY-MM-DD - Category - Description.pdf"
  → Success → _Ready/  (Paperless auto-ingests)
  → Failure → _Pending/
  → Paperless OCRs, archives
  → Post-consume script copies to Dropbox/Documents/YYYY/
```

## Folder Structure

```
Dropbox/Documents/
├── _Inbox/        ← raw JPGs from ScanSnap
├── _Processing/   ← agent working on a batch
├── _Ready/        ← clean PDFs → Paperless consumes here
├── _Pending/      ← failures (LLM down, ambiguous docs)
├── 2024/
├── 2025/
└── 2026/          ← final archive after Paperless OCR
```

## Vision LLM Strategy

### Pass 1 — Triage (cheap, fast)

- Generate small thumbnails (~300px wide) for all pages via `sharp`
- Overlay page number label on each thumbnail (SVG composite, southeast corner)
- Stitch into a single contact sheet grid (e.g. 5 columns)
- Send one image to vision LLM

Example response:

```json
{
  "documents": [
    {
      "pages": [1, 2, 3],
      "category": "Insurance",
      "description": "State Farm Auto Renewal",
      "date": "2026-03-15",
      "issues": { "2": "upside_down" }
    },
    {
      "pages": [4],
      "category": "Receipt",
      "description": "Home Depot Purchase",
      "date": "2026-03-28",
      "issues": {}
    }
  ]
}
```

### Pass 2 — Detail (only if needed)

If the LLM flags ambiguous pages or can't determine a date, send those specific pages at higher resolution. Most batches resolve in pass 1.

### Orientation Issues

LLM identifies per-page issues:
- `upside_down` → rotate 180
- `sideways_right` → rotate 90
- `sideways_left` → rotate 270

### Categories

Configurable via environment variable:

Tax, Medical, Insurance, Banking, Legal, Receipt, Correspondence, School, Church, Mortgage, Auto, Utility, Employment, Government

## Filewatcher & Batch Detection

- Watch `_Inbox/` with `chokidar` (Node.js)
- New JPG resets a 15-second debounce timer
- Timer expiry = batch complete → trigger processing
- Move entire batch to `_Processing/batch-{timestamp}/` atomically before starting
- Longer timeout (5 min) catches partial batches from scanner jams
- Manual override: `POST /process` on port 8190

## Image Processing & PDF Assembly

### Dependencies

- `sharp` — thumbnails, rotation, contact sheet grid, SVG label compositing. No native GUI deps (libvips comes prebuilt). Memory-efficient streaming for large batches.
- `pdf-lib` — assemble JPGs into PDFs. Pure JS, no native deps.

### Contact Sheet Construction

```
┌─────┬─────┬─────┬─────┬─────┐
│  1  │  2  │  3  │  4  │  5  │
├─────┼─────┼─────┼─────┼─────┤
│  6  │  7  │  8  │  9  │ 10  │
├─────┼─────┼─────┼─────┼─────┤
│ ... │     │     │     │     │
└─────┴─────┴─────┴─────┴─────┘
```

Page number labels via sharp SVG composite:

```mjs
const label = Buffer.from(
  `<svg width="40" height="40">
    <text x="20" y="28" text-anchor="middle"
      font-size="20" fill="white" stroke="black"
      stroke-width="1">${pageNum}</text>
  </svg>`
);
sharp(thumbnail).composite([{ input: label, gravity: 'southeast' }]);
```

### Per-Batch Pipeline

1. Generate thumbnails (300px wide) with page number overlays
2. Stitch into contact sheet grid
3. Send to vision LLM → get document groupings
4. Fix orientation on source JPGs (full resolution)
5. For each document group: create PDF, embed pages, save with LLM-chosen filename
6. Success: move PDFs to `_Ready/`, delete source JPGs from `_Processing/`
7. Failure: move entire batch subdir to `_Pending/`

## Date Resolution

Priority:
1. Document-level date identified by vision LLM (from page content)
2. Scan date (file creation timestamp)

Paperless also extracts dates during OCR (`DOCUMENT_CREATED` vs `DOCUMENT_ADDED`), but the vision LLM's date is used for the initial filename since it runs first.

## Paperless Post-Consume Script

After Paperless ingests from `_Ready/`, a post-consume script copies the processed PDF to the year archive:

```bash
#!/bin/bash
YEAR=$(date -d "${DOCUMENT_CREATED:-$(date +%Y-%m-%d)}" +%Y)
DEST="/data/Documents/${YEAR}/"
mkdir -p "$DEST"
cp "$DOCUMENT_FILENAME" "$DEST"
```

Set via `PAPERLESS_POST_CONSUME_SCRIPT` environment variable.

## Docker Deployment

Lives in `_extensions/document-processor/`.

### Dockerfile

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    inotify-tools && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY src/ ./src/

CMD ["node", "src/watcher.mjs"]
```

### docker-compose.yml

```yaml
services:
  document-processor:
    build: .
    container_name: document-processor
    restart: unless-stopped
    volumes:
      - ${DROPBOX_DOCUMENTS}/_Inbox:/data/_Inbox
      - ${DROPBOX_DOCUMENTS}/_Processing:/data/_Processing
      - ${DROPBOX_DOCUMENTS}/_Ready:/data/_Ready
      - ${DROPBOX_DOCUMENTS}/_Pending:/data/_Pending
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      VISION_MODEL: claude-sonnet-4-20250514
      DEBOUNCE_MS: 15000
      CATEGORIES: "Tax,Medical,Insurance,Banking,Legal,Receipt,Correspondence,School,Church,Mortgage,Auto,Utility,Employment,Government"
    ports:
      - "8190:8190"
    networks:
      kckern-net:
        aliases:
          - document-processor

networks:
  kckern-net:
    external: true
```

### API key

Pull from Infisical (already running) or pass as env var. No keys baked into the image.

### Manual trigger

Port 8190 exposes:
- `POST /process` — force-process whatever is in `_Inbox/`
- `GET /status` — current state (idle, processing, last batch result)

## File Structure

```
_extensions/document-processor/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── DESIGN.md
└── src/
    ├── watcher.mjs       ← chokidar on _Inbox/, debounce logic
    ├── processor.mjs     ← orchestrates the pipeline
    ├── vision.mjs        ← Anthropic vision API calls, prompt, response parsing
    ├── images.mjs        ← thumbnails, rotation, contact sheet (sharp)
    ├── pdf.mjs           ← page grouping → PDF assembly (pdf-lib)
    └── server.mjs        ← Express for manual trigger + status
```
