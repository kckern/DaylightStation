# Komga TOC Agent — Design

**Date:** 2026-02-16
**Status:** Approved

## Purpose

Automatically extract table-of-contents data from Komga magazine PDFs that lack PDF bookmarks. Uses AI vision (gpt-4o) to identify TOC pages and extract structured article listings. Writes results to the existing YAML TOC cache consumed by `KomgaFeedAdapter`.

## Approach: YAML-Only

Populate `common/komga/toc/{bookId}.yml` with OCR'd article data. No PDF modification, no Komga refresh needed. The feed adapter already reads this cache.

## Agent Structure

```
backend/src/3_applications/agents/komga-toc/
├── KomgaTocAgent.mjs              # Agent definition (extends BaseAgent)
├── tools/KomgaTocToolFactory.mjs  # Tools for scanning, fetching, OCR, writing
└── prompts/system.mjs             # System prompt for the agent
```

Registered in bootstrap with deps: `{ dataService, configService, aiGateway, logger }`.

Triggered on demand via `POST /api/v1/agents/komga-toc/run`. Checks TOC cache for books with empty `articles` arrays and processes them.

## TOC Extraction Logic

### Step 1: Find TOC Page (low-res thumbnails)

For each book missing TOC data, fetch Komga thumbnail images of pages 1–8. Send each individually to gpt-4o vision asking "Is this a table of contents page? Yes/No." Stop at first "Yes."

Thumbnails are small/cheap — minimizes vision API cost during the detection phase.

### Step 2: Extract Articles (full-res)

For the identified TOC page only, fetch the full-resolution image. Send to gpt-4o vision with a structured extraction prompt. Returns `[{title, page}]` JSON.

### Fallback

If no TOC page found in pages 1–8, write `tocScanned: true` with `articles: []` so the book isn't re-processed.

## Tool Definitions

| Tool | Description |
|------|-------------|
| `scan_toc_cache` | Read cached TOCs, return bookIds with empty/missing articles (skip `tocScanned: true`) |
| `fetch_book_list` | Call Komga API to get all books for configured series |
| `check_page_is_toc` | Fetch thumbnail for bookId+page, send to AI vision, return yes/no |
| `extract_toc_from_page` | Fetch full-res page image, send to AI vision, return structured `[{title, page}]` |
| `write_toc_cache` | Write articles array to `common/komga/toc/{bookId}.yml` |

## Output Format

Successfully processed:

```yaml
bookId: 0MRD748SDYC60
series: MIT Technology Review
issue: MIT-Technology-Review-2025-03
pages: 92
tocScanned: true
tocPage: 4
articles:
  - title: "The Download"
    page: 6
  - title: "AI Is Drowning in Energy"
    page: 22
```

No TOC found:

```yaml
bookId: 0MRBEX5R1R42X
series: National Geographic Interactive Magazine
issue: National Geographic Interactive 2010-07
pages: 139
tocScanned: true
tocPage: null
articles: []
```

## Key Decisions

- **gpt-4o vision** over Tesseract — magazine TOCs have complex layouts
- **Thumbnail-first** — cheap detection pass, full-res only for extraction
- **YAML cache only** — no PDF modification, uses existing infrastructure
- **`tocScanned` flag** — prevents re-processing books without TOC pages
- **On-demand trigger** — not scheduled; runs when invoked and processes all missing
