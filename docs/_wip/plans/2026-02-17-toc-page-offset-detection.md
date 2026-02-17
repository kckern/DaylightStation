# TOC Page Offset Detection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect and save the offset between printed page numbers (from magazine TOCs) and vendor page indices, then apply it when building page image URLs in the feed adapter.

**Architecture:** Add a `detect_page_offset` tool to `PagedMediaTocToolFactory` that scans thumbnails after the TOC page, asking the AI mini model for the printed page number. The offset (`vendorPage - printedPage`) is saved to the YAML cache as `tocPageOffset`. The `KomgaFeedAdapter` applies the offset when converting TOC article pages to vendor page numbers for image URLs. The CLI backfill script is rewritten to invoke the agent API instead of duplicating extraction logic.

**Tech Stack:** Node.js ES modules, OpenAI gpt-4o-mini vision, YAML cache

---

### Task 1: Add `detect_page_offset` tool to PagedMediaTocToolFactory

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs:170-209`

**Step 1: Add the new tool before `writeTocCache` (between lines 170-171)**

Insert the following tool between `extractTocFromPage` and `writeTocCache`:

```javascript
    // ---------------------------------------------------------------
    // Tool 5: detect_page_offset
    // ---------------------------------------------------------------
    const detectPageOffset = createTool({
      name: 'detect_page_offset',
      description: 'Detect the offset between printed page numbers and vendor page indices. Scans thumbnails starting from a given page, asking AI to read the printed page number. Returns the offset (vendor_page - printed_page). Tries up to 10 pages. Uses cheap thumbnail + mini model.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Book ID' },
          startPage: { type: 'integer', description: '1-indexed page to start scanning from (typically tocPage + 1)' },
        },
        required: ['bookId', 'startPage'],
      },
      execute: async ({ bookId, startPage }) => {
        const maxAttempts = 10;

        for (let i = 0; i < maxAttempts; i++) {
          const vendorPage = startPage + i;
          let fetchResult;
          try {
            fetchResult = await pagedMediaGateway.getPageThumbnail(bookId, vendorPage);
          } catch (err) {
            logger.warn?.('paged-media-toc.offset.fetch_error', { bookId, vendorPage, error: err.message });
            continue;
          }

          if (!aiGateway?.isConfigured?.()) {
            return { error: 'AI gateway not configured' };
          }

          const messages = [
            { role: 'user', content: 'What page number is printed on this page? Look for a number at the top or bottom of the page that indicates the page number. Reply with ONLY the number (e.g. "42"), or "none" if no page number is visible.' },
          ];
          const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
            model: 'gpt-4o-mini',
            maxTokens: 10,
          });

          const answer = (response || '').trim().toLowerCase();
          const parsed = parseInt(answer, 10);

          if (!isNaN(parsed) && parsed > 0) {
            const tocPageOffset = vendorPage - parsed;
            logger.info?.('paged-media-toc.offset.detected', { bookId, vendorPage, printedPage: parsed, tocPageOffset });
            return { bookId, tocPageOffset, detectedOnPage: vendorPage, printedPageNumber: parsed };
          }

          logger.info?.('paged-media-toc.offset.no_number', { bookId, vendorPage, answer });
        }

        logger.info?.('paged-media-toc.offset.not_detected', { bookId, startPage, attempts: maxAttempts });
        return { bookId, tocPageOffset: 0, reason: 'not_detected' };
      },
    });
```

**Step 2: Add `tocPageOffset` parameter to `write_toc_cache` tool**

In the `writeTocCache` tool's `parameters.properties` object (line 180-189), add:

```javascript
          tocPageOffset: { type: 'integer', description: 'Offset between vendor page indices and printed page numbers (vendor_page = printed_page + offset). 0 if not detected.' },
```

In the `execute` function (line 193-206), add `tocPageOffset` to the destructured params and the `tocData` object:

Change line 193:
```javascript
      execute: async ({ bookId, seriesLabel, issueTitle, pageCount, tocPage, tocPageOffset, articles }) => {
```

Add to `tocData` object (after `tocPage: tocPage || null,`):
```javascript
          tocPageOffset: tocPageOffset || 0,
```

**Step 3: Update the return array (line 209)**

Change:
```javascript
    return [scanTocCache, scanPageForToc, extractTocFromPage, writeTocCache];
```
To:
```javascript
    return [scanTocCache, scanPageForToc, extractTocFromPage, detectPageOffset, writeTocCache];
```

**Step 4: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs
git commit -m "feat(agents): add detect_page_offset tool and tocPageOffset to write_toc_cache"
```

---

### Task 2: Update system prompt with offset detection step

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/prompts/system.mjs`

**Step 1: Replace entire file contents**

```javascript
// backend/src/3_applications/agents/paged-media-toc/prompts/system.mjs
export const systemPrompt = `You are a paged-media TOC extraction agent. Your job is to find and extract table-of-contents data from magazine PDFs stored in a paged media library.

## Workflow

1. Call scan_toc_cache to find books that need TOC extraction.
2. For each book that needs processing:
   a. Scan pages 1 through 8 for TOC pages using scan_page_for_toc (one call per page).
   b. Magazines may have multiple TOC pages (e.g. pages 3 and 5). Keep scanning even after finding a TOC page. Only stop when you hit 2 consecutive non-TOC pages after the last TOC page found.
   c. For each page where scan_page_for_toc returns isToc: true, call extract_toc_from_page to get structured article data. Pass the book's pageCount for validation.
   d. Combine articles from all TOC pages into a single array (no duplicates).
   e. Call detect_page_offset with startPage set to the last TOC page + 1. This detects the difference between printed page numbers and vendor page indices (caused by cover/blank pages).
   f. Call write_toc_cache to save the results (articles array, first tocPage number, and tocPageOffset from step e).
   g. If NO TOC page is found after checking pages 1-8, call write_toc_cache with an empty articles array, tocPage: null, and tocPageOffset: 0.
3. After processing all books, report a summary of what was done.

## Rules

- Always start with scan_toc_cache to find work to do.
- Process books one at a time, completing each before moving to the next.
- scan_page_for_toc is cheap (thumbnail + mini model) — use it freely for detection.
- extract_toc_from_page is expensive (full-res + large model) — only call on confirmed TOC pages.
- detect_page_offset is cheap (thumbnail + mini model) — always call it after extracting articles.
- Never skip write_toc_cache — even if no TOC is found, write the empty result to prevent re-processing.
- If a tool returns an error, log it and move on to the next book.
`;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/prompts/system.mjs
git commit -m "feat(agents): update system prompt with page offset detection step"
```

---

### Task 3: Apply offset in KomgaFeedAdapter

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:91-143,153-209`

**Step 1: Apply offset in `#fetchOneSeries` (lines 116-118)**

Replace lines 116-118:
```javascript
    const pageNum = article.page;
    const imageUrl = `/api/v1/proxy/komga/composite/${bookId}/${pageNum}`;
    const readerLink = this.#webUrl ? `${this.#webUrl}/book/${bookId}/read?page=${pageNum}` : null;
```

With:
```javascript
    const offset = toc.tocPageOffset || 0;
    const pageNum = article.page + offset;
    const imageUrl = `/api/v1/proxy/komga/composite/${bookId}/${pageNum}`;
    const readerLink = this.#webUrl ? `${this.#webUrl}/book/${bookId}/read?page=${pageNum}` : null;
```

**Step 2: Apply offset in `getDetail` (lines 153-176)**

The `page` parsed from `localId` is already a vendor page (it was offset-corrected in `#fetchOneSeries`). But `#getArticleEndPage` works with printed page numbers from the cache. We need to offset-correct the boundary too.

Replace the `getDetail` method (lines 153-176):

```javascript
  async getDetail(localId, meta, _username) {
    const colonIdx = localId.lastIndexOf(':');
    const bookId = colonIdx > 0 ? localId.slice(0, colonIdx) : localId;
    const page = colonIdx > 0 ? parseInt(localId.slice(colonIdx + 1), 10) || 1 : 1;
    const sections = [];

    // Read TOC for offset and article boundaries
    const cachePath = `common/komga/toc/${bookId}.yml`;
    const toc = this.#dataService.household.read(cachePath);
    const offset = toc?.tocPageOffset || 0;

    // Convert vendor page back to printed page for boundary lookup
    const printedPage = page - offset;

    // Determine article page range from TOC (in printed page numbers)
    const printedEndPage = this.#getArticleEndPage(bookId, printedPage, meta.pageCount || 0);

    // Convert back to vendor pages for image URLs
    const vendorStartPage = printedPage + offset;
    const vendorEndPage = printedEndPage + offset;

    // All article page images (vertically stacked in detail view)
    const images = [];
    for (let p = vendorStartPage; p <= vendorEndPage; p++) {
      images.push({ url: this.#pageImageUrl(bookId, p) });
    }

    sections.push({
      type: 'media',
      data: { images },
    });

    return { sections };
  }
```

Note: `#getArticleEndPage` continues to work with printed page numbers from the cache — no changes needed there.

**Step 3: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs
git commit -m "feat(feed): apply tocPageOffset when building page image URLs"
```

---

### Task 4: Rewrite CLI backfill to invoke the agent API

**Files:**
- Rewrite: `cli/paged-media-toc-backfill.cli.mjs`

**Step 1: Replace entire file with agent-invoking CLI**

The CLI should bootstrap just enough to resolve the backend URL, then POST to the agent API. The agent is the SSOT for TOC extraction logic.

```javascript
#!/usr/bin/env node
/**
 * Paged Media TOC Backfill CLI
 *
 * Invokes the paged-media-toc agent via the backend API to process books
 * that need TOC extraction. The agent is the single source of truth for
 * all TOC parsing logic — this CLI is just a thin invocation wrapper.
 *
 * Usage:
 *   node cli/paged-media-toc-backfill.cli.mjs              # Run agent (synchronous, wait for result)
 *   node cli/paged-media-toc-backfill.cli.mjs --background  # Run agent in background
 *   node cli/paged-media-toc-backfill.cli.mjs --port 3112   # Specify backend port (default: 3112)
 *
 * @module cli/paged-media-toc-backfill
 */

const args = process.argv.slice(2);
const background = args.includes('--background');
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3112;
const baseUrl = `http://localhost:${port}/api/v1/agents/paged-media-toc`;

const AGENT_INPUT = 'Scan for books that need TOC extraction and process them.';

async function main() {
  console.log('Paged Media TOC Backfill');
  console.log(`  Backend: http://localhost:${port}`);
  console.log(`  Mode: ${background ? 'BACKGROUND' : 'SYNCHRONOUS'}\n`);

  // Health check — verify agent is registered
  const listRes = await fetch(`http://localhost:${port}/api/v1/agents`);
  if (!listRes.ok) {
    console.error(`ERROR: Backend not responding on port ${port} (${listRes.status})`);
    process.exit(1);
  }
  const { agents } = await listRes.json();
  const agent = agents?.find(a => a.id === 'paged-media-toc');
  if (!agent) {
    console.error('ERROR: paged-media-toc agent not registered. Check backend logs.');
    process.exit(1);
  }
  console.log(`Agent: ${agent.id} — ${agent.description}\n`);

  if (background) {
    // Fire and forget
    const res = await fetch(`${baseUrl}/run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: AGENT_INPUT }),
    });
    const data = await res.json();

    if (res.status === 202) {
      console.log(`Background task started: ${data.taskId}`);
      console.log('Agent is processing books in the background.');
    } else {
      console.error(`ERROR: ${res.status}`, data);
      process.exit(1);
    }
  } else {
    // Synchronous — wait for completion
    console.log('Running agent (this may take several minutes)...\n');
    const res = await fetch(`${baseUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: AGENT_INPUT }),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 minute timeout
    });
    const data = await res.json();

    if (res.ok) {
      console.log('Agent output:');
      console.log(data.output || '(no output)');
      if (data.toolCalls?.length) {
        console.log(`\nTool calls: ${data.toolCalls.length}`);
      }
    } else {
      console.error(`ERROR: ${res.status}`, data);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add cli/paged-media-toc-backfill.cli.mjs
git commit -m "refactor(cli): rewrite backfill to invoke agent API instead of duplicating logic"
```

---

### Task 5: Verify end-to-end

**Step 1: Verify agent module loads**

```bash
node -e "import('./backend/src/3_applications/agents/paged-media-toc/index.mjs').then(m => { console.log('Class:', m.PagedMediaTocAgent.id); console.log('OK') }).catch(e => console.error(e.message))"
```

Expected: `Class: paged-media-toc` then `OK`

**Step 2: Verify no vendor names leaked into application layer**

```bash
grep -r "komga" backend/src/3_applications/agents/ --include="*.mjs" -l
```

Expected: zero results

**Step 3: Verify tool factory has 5 tools**

```bash
grep -c "createTool({" backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs
```

Expected: `5`

**Step 4: Verify offset is used in adapter**

```bash
grep "tocPageOffset" backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs
```

Expected: at least 2 matches (in `#fetchOneSeries` and `getDetail`)
