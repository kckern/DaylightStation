# Komga Feed Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Komga feed source adapter that surfaces random articles from specified periodical series, using PDF bookmarks to identify article start pages.

**Architecture:** The adapter picks a random series from a YAML-configured list, fetches recent issues via the Komga API, picks a random issue, extracts PDF bookmarks (cached as YAML to disk), picks a random article, and returns a feed card with the article title and page image proxied through the existing Komga proxy infrastructure.

**Tech Stack:** `pdfjs-dist` (Mozilla PDF.js) for PDF bookmark extraction, existing `KomgaProxyAdapter` for page image proxy, `DataService` for YAML TOC cache persistence.

---

## Reference Files

| Purpose | Path |
|---------|------|
| Port interface | `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` |
| Existing adapter (pattern) | `backend/src/1_adapters/feed/sources/RedditFeedAdapter.mjs` |
| Existing adapter (pattern) | `backend/src/1_adapters/feed/sources/ImmichFeedAdapter.mjs` |
| Bootstrap wiring | `backend/src/app.mjs:644-768` |
| Existing Komga client | `backend/src/1_adapters/content/readable/komga/KomgaClient.mjs` |
| Existing Komga proxy | `backend/src/1_adapters/proxy/KomgaProxyAdapter.mjs` |
| Auth config | `data/household/auth/komga.yml` (field: `token`) |
| Query configs dir | `data/household/config/lists/queries/` |
| TOC cache target | `data/household/common/komga/toc/{bookId}.yml` |

## Key API Endpoints (Komga at mags.kckern.net)

- `GET /api/v1/series/{seriesId}/books?sort=metadata.numberSort,desc&size={n}` — recent issues
- `GET /api/v1/books/{bookId}/file` — download PDF (for bookmark extraction)
- `GET /api/v1/books/{bookId}/pages/{pageNum}` — page image (with `Accept: image/jpeg`)
- `GET /api/v1/books/{bookId}/thumbnail` — cover thumbnail
- Auth header: `X-API-Key: {token}`

## Page Image URLs (via existing proxy)

The existing Komga proxy at `/api/v1/proxy/komga/...` handles auth injection. Page image URLs for feed cards:
```
/api/v1/proxy/komga/api/v1/books/{bookId}/pages/{pageNum}
```

## TOC Cache Format

`data/household/common/komga/toc/{bookId}.yml`:
```yaml
bookId: 0MRBEX5JXREYX
series: MIT Sloan Management Review
issue: mitsmr2022winter-dl
pages: 100
articles:
  - title: Setting the Rules of the Road
    page: 46
  - title: Use Networks to Drive Culture Change
    page: 53
```

If 0 bookmarks → file is written with empty `articles: []` (prevents re-downloading).

---

### Task 1: Install pdfjs-dist

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `npm install pdfjs-dist`

**Step 2: Verify it works in Node**

Run:
```bash
node -e "
import('pdfjs-dist/legacy/build/pdf.mjs').then(m => {
  console.log('pdfjs-dist loaded, exports:', Object.keys(m).slice(0,5).join(', '));
}).catch(e => console.error(e));
"
```
Expected: prints export names without error.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfjs-dist for PDF bookmark extraction"
```

---

### Task 2: Create KomgaFeedAdapter

**Files:**
- Create: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs`

**Step 1: Write the adapter**

```javascript
// backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs
/**
 * KomgaFeedAdapter
 *
 * Surfaces random articles from configured Komga periodical series.
 * Extracts PDF bookmarks to identify article boundaries and caches
 * the TOC as YAML for subsequent requests.
 *
 * @module adapters/feed/sources/KomgaFeedAdapter
 */

import { IFeedSourceAdapter } from '#apps/feed/ports/IFeedSourceAdapter.mjs';

export class KomgaFeedAdapter extends IFeedSourceAdapter {
  #host;
  #apiKey;
  #webUrl;
  #dataService;
  #logger;

  /**
   * @param {Object} deps
   * @param {string} deps.host - Komga server URL
   * @param {string} deps.apiKey - Komga API key
   * @param {string} deps.webUrl - Komga web UI base URL (for card links)
   * @param {Object} deps.dataService - DataService for TOC cache persistence
   * @param {Object} [deps.logger]
   */
  constructor({ host, apiKey, webUrl, dataService, logger = console }) {
    super();
    if (!host) throw new Error('KomgaFeedAdapter requires host');
    if (!apiKey) throw new Error('KomgaFeedAdapter requires apiKey');
    if (!dataService) throw new Error('KomgaFeedAdapter requires dataService');
    this.#host = host.replace(/\/$/, '');
    this.#apiKey = apiKey;
    this.#webUrl = (webUrl || host).replace(/\/$/, '');
    this.#dataService = dataService;
    this.#logger = logger;
  }

  get sourceType() { return 'komga'; }

  async fetchItems(query, _username) {
    const seriesList = query.params?.series;
    if (!Array.isArray(seriesList) || seriesList.length === 0) return [];

    try {
      const limit = query.limit || 1;
      const recentIssues = query.params?.recent_issues || 6;
      const items = [];

      for (let i = 0; i < limit; i++) {
        const series = seriesList[Math.floor(Math.random() * seriesList.length)];
        const item = await this.#pickRandomArticle(series, recentIssues, query);
        if (item) items.push(item);
      }

      return items;
    } catch (err) {
      this.#logger.warn?.('komga.adapter.error', { error: err.message });
      return [];
    }
  }

  async getDetail(localId, meta, _username) {
    // localId is "{bookId}:{pageNum}" — show the page image large
    const [bookId, pageStr] = localId.split(':');
    const page = parseInt(pageStr, 10) || 1;

    const sections = [];

    // Show the article page as a large image
    sections.push({
      type: 'media',
      data: {
        images: [{ url: this.#pageImageUrl(bookId, page), caption: meta.articleTitle || null }],
      },
    });

    const metadataItems = [];
    if (meta.seriesName) metadataItems.push({ label: 'Publication', value: meta.seriesName });
    if (meta.issueName) metadataItems.push({ label: 'Issue', value: meta.issueName });
    if (metadataItems.length > 0) {
      sections.push({ type: 'metadata', data: { items: metadataItems } });
    }

    return { sections };
  }

  // ===== Private Methods =====

  async #pickRandomArticle(series, recentIssues, query) {
    // Fetch recent books for this series
    const books = await this.#fetchRecentBooks(series.id, recentIssues);
    if (books.length === 0) return null;

    const book = books[Math.floor(Math.random() * books.length)];
    const toc = await this.#getToc(book, series.label);

    let title, page;
    if (toc.articles.length > 0) {
      // Pick a random article from the TOC
      const article = toc.articles[Math.floor(Math.random() * toc.articles.length)];
      title = article.title;
      page = article.page;
    } else {
      // Fallback: random page from middle 70%
      const totalPages = toc.pages || book.media?.pagesCount || 50;
      const start = Math.ceil(totalPages * 0.15);
      const end = Math.floor(totalPages * 0.85);
      page = start + Math.floor(Math.random() * (end - start));
      title = series.label;
    }

    const issueName = book.metadata?.title || book.name || 'Issue';

    return {
      id: `komga:${book.id}:${page}`,
      type: query.feed_type || 'grounding',
      source: 'komga',
      title,
      body: `${series.label} — ${issueName}`,
      image: this.#pageImageUrl(book.id, page),
      link: `${this.#webUrl}/book/${book.id}/read?page=${page}`,
      timestamp: book.created || new Date().toISOString(),
      priority: query.priority || 5,
      meta: {
        seriesName: series.label,
        seriesId: series.id,
        bookId: book.id,
        issueName,
        articleTitle: title,
        page,
        sourceName: series.label,
        sourceIcon: null,
      },
    };
  }

  async #fetchRecentBooks(seriesId, count) {
    const url = `${this.#host}/api/v1/series/${seriesId}/books?sort=metadata.numberSort,desc&size=${count}`;
    const res = await fetch(url, { headers: this.#headers() });
    if (!res.ok) {
      this.#logger.warn?.('komga.books.fetch.error', { seriesId, status: res.status });
      return [];
    }
    const data = await res.json();
    return data.content || [];
  }

  async #getToc(book, seriesLabel) {
    const bookId = book.id;

    // Check disk cache first
    const cached = this.#dataService.household.read(`common/komga/toc/${bookId}`);
    if (cached) return cached;

    // Download PDF and extract bookmarks
    const toc = await this.#extractBookmarks(book, seriesLabel);

    // Write to disk cache
    try {
      this.#dataService.household.write(`common/komga/toc/${bookId}`, toc);
    } catch (err) {
      this.#logger.warn?.('komga.toc.cache.write.error', { bookId, error: err.message });
    }

    return toc;
  }

  async #extractBookmarks(book, seriesLabel) {
    const bookId = book.id;
    const totalPages = book.media?.pagesCount || 0;
    const emptyToc = {
      bookId,
      series: seriesLabel,
      issue: book.metadata?.title || book.name,
      pages: totalPages,
      articles: [],
    };

    try {
      // Download the PDF file
      const url = `${this.#host}/api/v1/books/${bookId}/file`;
      const res = await fetch(url, { headers: this.#headers() });
      if (!res.ok) {
        this.#logger.warn?.('komga.pdf.download.error', { bookId, status: res.status });
        return emptyToc;
      }

      const buffer = await res.arrayBuffer();

      // Extract outline using pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const outline = await doc.getOutline();

      if (!outline || outline.length === 0) {
        await doc.destroy();
        return emptyToc;
      }

      // Flatten outline and resolve page numbers
      const articles = await this.#flattenOutline(doc, outline);
      await doc.destroy();

      return {
        bookId,
        series: seriesLabel,
        issue: book.metadata?.title || book.name,
        pages: totalPages,
        articles,
      };
    } catch (err) {
      this.#logger.warn?.('komga.bookmark.extract.error', { bookId, error: err.message });
      return emptyToc;
    }
  }

  async #flattenOutline(doc, outlineItems, maxDepth = 2, currentDepth = 0) {
    if (currentDepth >= maxDepth) return [];
    const articles = [];

    for (const item of outlineItems) {
      // Skip structural/container entries (TOC, FEATURES, FRONTIERS, etc.)
      // Keep only items that have a destination (page link)
      if (item.dest) {
        try {
          let pageIndex;
          if (typeof item.dest === 'string') {
            // Named destination — resolve to page ref
            const dest = await doc.getDestination(item.dest);
            if (dest) pageIndex = await doc.getPageIndex(dest[0]);
          } else if (Array.isArray(item.dest)) {
            pageIndex = await doc.getPageIndex(item.dest[0]);
          }

          if (pageIndex != null) {
            articles.push({
              title: item.title?.trim(),
              page: pageIndex + 1, // pdfjs is 0-indexed, Komga is 1-indexed
            });
          }
        } catch {
          // Skip entries with unresolvable destinations
        }
      }

      // Recurse into children
      if (item.items?.length > 0) {
        const children = await this.#flattenOutline(doc, item.items, maxDepth, currentDepth + 1);
        articles.push(...children);
      }
    }

    return articles;
  }

  #pageImageUrl(bookId, page) {
    return `/api/v1/proxy/komga/api/v1/books/${bookId}/pages/${page}`;
  }

  #headers() {
    return {
      'X-API-Key': this.#apiKey,
      'Accept': 'application/json',
    };
  }
}
```

**Step 2: Verify it imports correctly**

Run:
```bash
node -e "import('./backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs').then(m => console.log('OK:', typeof m.KomgaFeedAdapter))"
```
Expected: `OK: function`

**Step 3: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs
git commit -m "feat(feed): add KomgaFeedAdapter for periodical articles"
```

---

### Task 3: Create query config YAML

**Files:**
- Create: `data/household/config/lists/queries/komga.yml`

**Step 1: Write the query config**

```yaml
type: komga
feed_type: grounding
priority: 5
limit: 1
params:
  series:
    - id: 0MRBEX5K1R45W
      label: MIT Technology Review
    - id: 0MRBEX5JXREYQ
      label: MIT Sloan Management Review
  recent_issues: 6
```

**Step 2: Verify it loads**

Run:
```bash
node -e "
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
const data = yaml.load(readFileSync('$(echo /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/komga.yml)', 'utf8'));
console.log(JSON.stringify(data, null, 2));
"
```
Expected: JSON with type=komga, two series entries.

**Step 3: Commit**

```bash
git add /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/config/lists/queries/komga.yml
git commit -m "feat(feed): add Komga query config for periodical series"
```

---

### Task 4: Wire adapter in app.mjs

**Files:**
- Modify: `backend/src/app.mjs:644-768` (feed domain section)

**Step 1: Add import (after line 660)**

Add this import alongside the other feed adapter imports:

```javascript
const { KomgaFeedAdapter } = await import('./1_adapters/feed/sources/KomgaFeedAdapter.mjs');
```

**Step 2: Instantiate adapter (after line 729, after googleNewsAdapter)**

```javascript
const komgaAuth = configService.getHouseholdAuth('komga');
const komgaHost = configService.resolveServiceUrl('komga');
const komgaFeedAdapter = komgaAuth?.token && komgaHost ? new KomgaFeedAdapter({
  host: komgaHost,
  apiKey: komgaAuth.token,
  webUrl: komgaHost,
  dataService,
  logger: rootLogger.child({ module: 'komga-feed' }),
}) : null;
```

**Step 3: Add to sourceAdapters array (line 754)**

Change the sourceAdapters array to include `komgaFeedAdapter`:

```javascript
sourceAdapters: [redditAdapter, weatherAdapter, healthAdapter, gratitudeAdapter, stravaAdapter, todoistAdapter, immichAdapter, plexAdapter, journalAdapter, youtubeAdapter, googleNewsAdapter, komgaFeedAdapter].filter(Boolean),
```

**Step 4: Verify server starts**

Run:
```bash
node backend/index.js &
sleep 3
curl -s http://localhost:3112/api/v1/status | python3 -m json.tool | head -5
kill %1
```
Expected: Server starts without import/instantiation errors.

**Step 5: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat(feed): wire KomgaFeedAdapter into feed assembly"
```

---

### Task 5: Create TOC cache directory

**Files:**
- Create directory: `data/household/common/komga/toc/`

**Step 1: Create the directory**

```bash
mkdir -p /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/komga/toc
```

**Step 2: Add a .gitkeep if the data dir is tracked**

```bash
touch /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/komga/toc/.gitkeep
```

---

### Task 6: Manual integration test

**Step 1: Start dev server and test the scroll endpoint**

```bash
# Start dev server (check if running first)
lsof -i :3112 || node backend/index.js &
```

**Step 2: Fetch the feed scroll and look for Komga items**

```bash
curl -s http://localhost:3112/api/v1/feed/scroll?limit=30 | python3 -c "
import json, sys
data = json.load(sys.stdin)
komga = [i for i in data['items'] if i['source'] == 'komga']
print(f'Total items: {len(data[\"items\"])}')
print(f'Komga items: {len(komga)}')
for item in komga:
    print(f'  {item[\"title\"]} — {item[\"body\"]}')
    print(f'    image: {item[\"image\"]}')
    print(f'    link: {item[\"link\"]}')
"
```
Expected: At least 1 Komga item with article title, series name, and page image URL.

**Step 3: Verify page image proxy works**

Using the image URL from step 2:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}" http://localhost:3112/api/v1/proxy/komga/api/v1/books/{bookId}/pages/{pageNum}
```
Expected: `200 image/jpeg` with non-zero size.

**Step 4: Check TOC cache was written**

```bash
ls /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/komga/toc/
cat /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/komga/toc/*.yml
```
Expected: YAML file(s) with bookId, series, issue, articles list.

---

## Notes

- **0-bookmark PDFs** (like MIT Technology Review): The adapter writes `articles: []` to the cache and falls back to a random page from the middle 70% of the issue. No re-download on subsequent requests.
- **Proxy URL pattern**: Uses `/api/v1/proxy/komga/api/v1/books/{id}/pages/{num}` — the existing KomgaProxyAdapter handles auth injection. Browser `<img>` tags send `Accept: image/*` which triggers Komga to return JPEG for PDF pages.
- **configService.resolveServiceUrl('komga')**: If this returns null (no service URL config), the adapter won't be instantiated. Verify Komga host is configured in the service URL registry or fall back to `configService.getAdapterConfig('komga')?.host`.
