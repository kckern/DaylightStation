# Komga TOC Agent DDD Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix DDD layer violations in `backend/src/3_applications/agents/komga-toc/` by extracting adapter-tier concerns (HTTP, config resolution, direct persistence) into domain-named port interfaces and adapter implementations.

**Architecture:** The tool factory currently does its own HTTP fetching, config resolution, and direct `dataService` access — all adapter-tier work living in `3_applications`. Refactor by creating two port interfaces (`IPagedMediaGateway`, `ITocCacheDatastore`) named after domain concepts (not vendors), implementing them as adapters in `1_adapters/`, reusing the existing `KomgaClient` for JSON API calls, and updating bootstrap to wire pre-resolved dependencies.

**Tech Stack:** Node.js ES modules (.mjs), DDD port/adapter pattern, existing `KomgaClient` for Komga HTTP, YAML persistence via DataService

---

## Existing Code to Reuse

`KomgaClient` at `backend/src/1_adapters/content/readable/komga/KomgaClient.mjs` already handles:
- Komga auth headers (`X-API-Key`)
- `getBooks(seriesId, { page, size })` — paginated book listing
- `getBook(bookId)` — single book fetch
- Proper `InfrastructureError` usage

It does NOT currently support:
- `sort` parameter on `getBooks()` (agent needs `metadata.numberSort,desc`)
- Image/binary responses (it uses `httpClient` which returns parsed JSON)

The adapter will compose `KomgaClient` for JSON operations and handle image fetching directly (since `httpClient` is JSON-oriented).

---

### Task 1: Add `sort` Option to KomgaClient.getBooks()

**Files:**
- Modify: `backend/src/1_adapters/content/readable/komga/KomgaClient.mjs:103-112`

**Step 1: Extend getBooks options to accept sort**

In `KomgaClient.mjs`, change the `getBooks` method to pass through a `sort` query parameter when provided:

```javascript
  async getBooks(seriesId, options = {}) {
    const page = options.page ?? 0;
    const size = options.size ?? 50;
    const sort = options.sort;

    let url = `${this.#host}/api/v1/series/${seriesId}/books?page=${page}&size=${size}`;
    if (sort) url += `&sort=${sort}`;

    const response = await this.#httpClient.get(url, { headers: this.#getHeaders() });
    return response.data;
  }
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/content/readable/komga/KomgaClient.mjs
git commit -m "feat(komga): add sort option to KomgaClient.getBooks()"
```

---

### Task 2: Create IPagedMediaGateway Port Interface

**Files:**
- Create: `backend/src/3_applications/agents/komga-toc/ports/IPagedMediaGateway.mjs`

The port is named after the domain concept ("paged media" — books with scannable pages), not the vendor.

**Step 1: Create the port interface**

```javascript
// backend/src/3_applications/agents/komga-toc/ports/IPagedMediaGateway.mjs

/**
 * IPagedMediaGateway — port interface for accessing paged media (magazines, comics).
 *
 * Abstracts how the agent discovers books and fetches page images,
 * independent of the backing media server.
 *
 * @module applications/agents/komga-toc/ports/IPagedMediaGateway
 */
export class IPagedMediaGateway {
  /**
   * Fetch recent books/issues for a series, sorted newest-first.
   * @param {string} seriesId
   * @param {number} limit - Max books to return
   * @returns {Promise<Array<{id: string, title: string, pageCount: number}>>}
   */
  async getRecentBooks(seriesId, limit) {
    throw new Error('IPagedMediaGateway.getRecentBooks must be implemented');
  }

  /**
   * Fetch a page thumbnail as a base64 data URI (cheap, for detection).
   * @param {string} bookId
   * @param {number} page - 1-indexed page number
   * @returns {Promise<{imageDataUri: string, sizeBytes: number}>}
   */
  async getPageThumbnail(bookId, page) {
    throw new Error('IPagedMediaGateway.getPageThumbnail must be implemented');
  }

  /**
   * Fetch a full-resolution page image as a base64 data URI (for extraction).
   * @param {string} bookId
   * @param {number} page - 1-indexed page number
   * @returns {Promise<{imageDataUri: string, sizeBytes: number}>}
   */
  async getPageImage(bookId, page) {
    throw new Error('IPagedMediaGateway.getPageImage must be implemented');
  }
}

export function isPagedMediaGateway(obj) {
  return obj &&
    typeof obj.getRecentBooks === 'function' &&
    typeof obj.getPageThumbnail === 'function' &&
    typeof obj.getPageImage === 'function';
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/ports/IPagedMediaGateway.mjs
git commit -m "feat(agents): add IPagedMediaGateway port for komga-toc agent"
```

---

### Task 3: Create ITocCacheDatastore Port Interface

**Files:**
- Create: `backend/src/3_applications/agents/komga-toc/ports/ITocCacheDatastore.mjs`

**Step 1: Create the port interface**

```javascript
// backend/src/3_applications/agents/komga-toc/ports/ITocCacheDatastore.mjs

/**
 * ITocCacheDatastore — port interface for TOC cache persistence.
 *
 * Abstracts how TOC extraction results and query config are stored,
 * so the agent never touches file paths, DataService, or YAML.
 *
 * @module applications/agents/komga-toc/ports/ITocCacheDatastore
 */
export class ITocCacheDatastore {
  /**
   * Read cached TOC data for a book.
   * @param {string} bookId
   * @returns {Object|null} Cached TOC object or null
   */
  readCache(bookId) {
    throw new Error('ITocCacheDatastore.readCache must be implemented');
  }

  /**
   * Write TOC data to cache.
   * @param {string} bookId
   * @param {Object} tocData
   */
  writeCache(bookId, tocData) {
    throw new Error('ITocCacheDatastore.writeCache must be implemented');
  }

  /**
   * Read query configuration (series list, recent_issues count).
   * @returns {Object|null} Config with params.series[] and params.recent_issues
   */
  readQueryConfig() {
    throw new Error('ITocCacheDatastore.readQueryConfig must be implemented');
  }
}

export function isTocCacheDatastore(obj) {
  return obj &&
    typeof obj.readCache === 'function' &&
    typeof obj.writeCache === 'function' &&
    typeof obj.readQueryConfig === 'function';
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/ports/ITocCacheDatastore.mjs
git commit -m "feat(agents): add ITocCacheDatastore port for komga-toc agent"
```

---

### Task 4: Create KomgaPagedMediaAdapter

**Files:**
- Create: `backend/src/1_adapters/komga/KomgaPagedMediaAdapter.mjs`

Implements `IPagedMediaGateway`. Composes existing `KomgaClient` for JSON API calls. Handles image fetching with retry directly (since `KomgaClient`'s `httpClient` is JSON-oriented).

**Step 1: Create the adapter**

```javascript
// backend/src/1_adapters/komga/KomgaPagedMediaAdapter.mjs

import { IPagedMediaGateway } from '#apps/agents/komga-toc/ports/IPagedMediaGateway.mjs';

/**
 * KomgaPagedMediaAdapter — Komga implementation of IPagedMediaGateway.
 *
 * Composes KomgaClient for JSON API calls. Handles image fetching
 * with retry logic directly (KomgaClient's httpClient is JSON-oriented).
 *
 * @module adapters/komga/KomgaPagedMediaAdapter
 */
export class KomgaPagedMediaAdapter extends IPagedMediaGateway {
  #client;
  #host;
  #apiKey;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('../content/readable/komga/KomgaClient.mjs').KomgaClient} deps.client - KomgaClient instance
   * @param {string} deps.apiKey - Komga API key (for image fetch headers)
   * @param {Object} [deps.logger]
   */
  constructor({ client, apiKey, logger = console }) {
    super();
    if (!client) throw new Error('KomgaPagedMediaAdapter requires client');
    if (!apiKey) throw new Error('KomgaPagedMediaAdapter requires apiKey');
    this.#client = client;
    this.#host = client.host;
    this.#apiKey = apiKey;
    this.#logger = logger;
  }

  async getRecentBooks(seriesId, limit) {
    const data = await this.#client.getBooks(seriesId, {
      size: limit,
      sort: 'metadata.numberSort,desc',
    });
    return (data?.content || []).map(book => ({
      id: book.id,
      title: book.metadata?.title || book.name || 'Unknown',
      pageCount: book.media?.pagesCount || 0,
    }));
  }

  async getPageThumbnail(bookId, page) {
    const url = `${this.#host}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
    return this.#fetchImage(url, 15000);
  }

  async getPageImage(bookId, page) {
    const url = `${this.#host}/api/v1/books/${bookId}/pages/${page}`;
    return this.#fetchImage(url, 30000);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async #fetchImage(url, timeoutMs) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'X-API-Key': this.#apiKey, 'Accept': 'image/jpeg' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        return {
          imageDataUri: `data:${contentType};base64,${buffer.toString('base64')}`,
          sizeBytes: buffer.length,
        };
      } catch (err) {
        if (attempt < maxRetries && /SSL|ECONNRESET|socket|ETIMEDOUT/i.test(err.message)) {
          const delay = attempt * 2000;
          this.#logger.warn?.('paged-media.fetch.retry', { url, attempt, delay, error: err.message });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Max retries exceeded');
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/komga/KomgaPagedMediaAdapter.mjs
git commit -m "feat(adapters): add KomgaPagedMediaAdapter implementing IPagedMediaGateway"
```

---

### Task 5: Create YamlTocCacheDatastore

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs`

**Step 1: Create the adapter**

```javascript
// backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs

import { ITocCacheDatastore } from '#apps/agents/komga-toc/ports/ITocCacheDatastore.mjs';

/**
 * YamlTocCacheDatastore — YAML-backed persistence for TOC cache.
 *
 * Cache path: household common/komga/toc/{bookId}.yml
 * Config path: household config/lists/queries/komga
 *
 * @module adapters/persistence/yaml/YamlTocCacheDatastore
 */
export class YamlTocCacheDatastore extends ITocCacheDatastore {
  #dataService;

  constructor({ dataService }) {
    super();
    if (!dataService) throw new Error('YamlTocCacheDatastore requires dataService');
    this.#dataService = dataService;
  }

  readCache(bookId) {
    return this.#dataService.household.read(`common/komga/toc/${bookId}.yml`);
  }

  writeCache(bookId, tocData) {
    this.#dataService.household.write(`common/komga/toc/${bookId}.yml`, tocData);
  }

  readQueryConfig() {
    return this.#dataService.household.read('config/lists/queries/komga');
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs
git commit -m "feat(adapters): add YamlTocCacheDatastore implementing ITocCacheDatastore"
```

---

### Task 6: Refactor KomgaTocToolFactory to Use Ports

**Files:**
- Modify: `backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs`

Replace all direct `configService`, `dataService`, and `fetch()` usage with the injected port implementations (`pagedMediaGateway`, `tocCacheDatastore`).

**Step 1: Rewrite the tool factory**

Replace the entire file with:

```javascript
// backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class KomgaTocToolFactory extends ToolFactory {
  static domain = 'komga-toc';

  createTools() {
    const { pagedMediaGateway, tocCacheDatastore, aiGateway, logger } = this.deps;

    if (!pagedMediaGateway) {
      logger.warn?.('komga-toc.tools.no_gateway');
      return [];
    }

    // ---------------------------------------------------------------
    // Tool 1: scan_toc_cache
    // ---------------------------------------------------------------
    const scanTocCache = createTool({
      name: 'scan_toc_cache',
      description: 'Scan the TOC cache and return a list of books that need TOC extraction. Returns books with empty articles arrays that have not been previously scanned (no tocScanned flag). Also fetches the full book list from Komga for all configured series to find books not yet cached.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      execute: async () => {
        const config = tocCacheDatastore.readQueryConfig();
        if (!config?.params?.series) {
          return { error: 'No series configured', booksToProcess: [], count: 0 };
        }

        const seriesList = config.params.series;
        const recentCount = config.params.recent_issues || 6;
        const booksToProcess = [];

        for (const series of seriesList) {
          let books;
          try {
            books = await pagedMediaGateway.getRecentBooks(series.id, recentCount);
          } catch (err) {
            logger.warn?.('komga-toc.scan.series.error', { seriesId: series.id, error: err.message });
            continue;
          }

          for (const book of books) {
            const cached = tocCacheDatastore.readCache(book.id);
            if (cached?.tocScanned) continue;
            if (cached?.articles?.length > 0) continue;

            booksToProcess.push({
              bookId: book.id,
              seriesId: series.id,
              seriesLabel: series.label,
              issueTitle: book.title,
              pageCount: book.pageCount,
            });
          }
        }

        return {
          totalConfiguredSeries: seriesList.length,
          booksToProcess,
          count: booksToProcess.length,
        };
      },
    });

    // ---------------------------------------------------------------
    // Tool 2: scan_page_for_toc
    // ---------------------------------------------------------------
    const scanPageForToc = createTool({
      name: 'scan_page_for_toc',
      description: 'Fetch a thumbnail of a specific page from a Komga book and use AI vision to check if it is a table of contents page. Returns { isToc: true/false }. This is the cheap detection step — use before committing to full-res extraction.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page }) => {
        let fetchResult;
        try {
          fetchResult = await pagedMediaGateway.getPageThumbnail(bookId, page);
        } catch (err) {
          return { error: `Failed to fetch thumbnail: ${err.message}`, bookId, page };
        }

        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        const messages = [
          { role: 'user', content: 'Is this page a table of contents or index page from a magazine? A table of contents typically lists article titles with corresponding page numbers. Answer with ONLY "yes" or "no".' },
        ];
        const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
          model: 'gpt-4o-mini',
          maxTokens: 10,
        });
        const answer = (response || '').trim().toLowerCase();
        const isToc = answer.startsWith('yes');
        logger.info?.('komga-toc.scan_page', { bookId, page, isToc, answer });
        return { bookId, page, isToc, rawAnswer: answer };
      },
    });

    // ---------------------------------------------------------------
    // Tool 3: extract_toc_from_page
    // ---------------------------------------------------------------
    const extractTocFromPage = createTool({
      name: 'extract_toc_from_page',
      description: 'Fetch a full-resolution page image from Komga and send it to AI vision to extract structured table-of-contents data. Returns an array of {title, page} objects. This is the expensive step — only call after confirming the page is a TOC via scan_page_for_toc.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number of the TOC page' },
          pageCount: { type: 'integer', description: 'Total pages in the book (for validation)' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page, pageCount }) => {
        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        let fetchResult;
        try {
          fetchResult = await pagedMediaGateway.getPageImage(bookId, page);
        } catch (err) {
          return { error: `Failed to fetch page: ${err.message}`, bookId, page };
        }

        const messages = [
          { role: 'user', content: `This is a table of contents page from a magazine. Extract every article or feature title and its page number. Return ONLY a JSON array of objects with "title" and "page" fields. Example: [{"title": "The Future of AI", "page": 22}, {"title": "Climate Report", "page": 38}]. Rules:
- Include only actual articles/features, not section headers like "FEATURES" or "DEPARTMENTS" unless they have page numbers
- Use the exact title text as printed
- Page numbers must be integers
- Skip ads, editor letters, and minor items like "Letters to the Editor"
- If a title spans multiple lines, combine into one string` },
        ];
        const response = await aiGateway.chatWithImage(messages, fetchResult.imageDataUri, {
          model: 'gpt-4o',
          maxTokens: 2000,
          imageDetail: 'high',
        });

        let articles = [];
        try {
          const jsonMatch = response.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            articles = JSON.parse(jsonMatch[0]);
          }
        } catch (err) {
          logger.warn?.('komga-toc.extract.parse_error', { bookId, page, error: err.message, response });
          return { error: 'Failed to parse AI response as JSON', bookId, page, rawResponse: response };
        }

        articles = articles
          .filter(a => a && typeof a.title === 'string' && typeof a.page === 'number')
          .map(a => ({ title: a.title.trim(), page: Math.round(a.page) }))
          .filter(a => a.page >= 1 && (!pageCount || a.page <= pageCount));

        logger.info?.('komga-toc.extract.success', { bookId, page, articleCount: articles.length });
        return { bookId, tocPage: page, articles };
      },
    });

    // ---------------------------------------------------------------
    // Tool 4: write_toc_cache
    // ---------------------------------------------------------------
    const writeTocCache = createTool({
      name: 'write_toc_cache',
      description: 'Write extracted TOC data to the YAML cache for a Komga book. Sets tocScanned: true so the book is not re-processed. If no articles were found, writes an empty array with tocScanned: true.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          seriesLabel: { type: 'string', description: 'Series name' },
          issueTitle: { type: 'string', description: 'Issue title' },
          pageCount: { type: 'integer', description: 'Total pages in book' },
          tocPage: { type: 'integer', description: 'Page number where TOC was found (null if not found)' },
          articles: {
            type: 'array',
            description: 'Array of {title, page} objects extracted from the TOC',
          },
        },
        required: ['bookId', 'seriesLabel', 'issueTitle', 'pageCount', 'articles'],
      },
      execute: async ({ bookId, seriesLabel, issueTitle, pageCount, tocPage, articles }) => {
        const tocData = {
          bookId,
          series: seriesLabel,
          issue: issueTitle,
          pages: pageCount,
          tocScanned: true,
          tocPage: tocPage || null,
          articles: articles || [],
        };
        tocCacheDatastore.writeCache(bookId, tocData);
        logger.info?.('komga-toc.cache.written', { bookId, articleCount: (articles || []).length });
        return { success: true, bookId, articleCount: (articles || []).length };
      },
    });

    return [scanTocCache, scanPageForToc, extractTocFromPage, writeTocCache];
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs
git commit -m "refactor(agents): remove DDD violations from KomgaTocToolFactory

Replace direct configService, dataService, and fetch() usage with
domain-named ports (pagedMediaGateway, tocCacheDatastore).
HTTP, config, and persistence concerns now live in adapter layer."
```

---

### Task 7: Update Bootstrap Wiring

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (lines 2456–2464, plus imports)

Move config resolution to bootstrap. Create `KomgaClient`, `KomgaPagedMediaAdapter`, and `YamlTocCacheDatastore`, inject into agent.

**Step 1: Add imports near top of bootstrap.mjs**

Find the existing KomgaTocAgent import and add nearby:

```javascript
import { KomgaClient } from '../1_adapters/content/readable/komga/KomgaClient.mjs';
import { KomgaPagedMediaAdapter } from '../1_adapters/komga/KomgaPagedMediaAdapter.mjs';
import { YamlTocCacheDatastore } from '../1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs';
```

**Step 2: Replace agent registration block (lines 2456–2464)**

Replace:
```javascript
  // Register Komga TOC agent (requires AI gateway + data services)
  if (aiGateway && dataService && configService) {
    agentOrchestrator.register(KomgaTocAgent, {
      workingMemory,
      aiGateway,
      dataService,
      configService,
    });
  }
```

With:
```javascript
  // Register Komga TOC agent (requires AI gateway + Komga access)
  if (aiGateway && dataService && configService) {
    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    if (komgaHost && komgaAuth?.token) {
      const komgaClient = new KomgaClient(
        { host: komgaHost, apiKey: komgaAuth.token },
        { httpClient: config.httpClient || (await import('#system/utils/httpClient.mjs')).default, logger }
      );
      const pagedMediaGateway = new KomgaPagedMediaAdapter({
        client: komgaClient,
        apiKey: komgaAuth.token,
        logger,
      });
      const tocCacheDatastore = new YamlTocCacheDatastore({ dataService });
      agentOrchestrator.register(KomgaTocAgent, {
        workingMemory,
        aiGateway,
        pagedMediaGateway,
        tocCacheDatastore,
      });
    }
  }
```

> **Note:** Check how `httpClient` is obtained elsewhere in bootstrap for the correct import path. Search for existing `KomgaClient` or `KomgaAdapter` construction to find the pattern. If `httpClient` is not available, look at how `KomgaAdapter` is constructed for the content system — it uses the same `KomgaClient`.

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(bootstrap): wire KomgaPagedMediaAdapter and YamlTocCacheDatastore for komga-toc agent"
```

---

### Task 8: Verify

**Step 1: Check import alias resolves**

```bash
node -e "import('#apps/agents/komga-toc/ports/IPagedMediaGateway.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"
```

Expected: `OK`

**Step 2: Start dev server if needed**

```bash
lsof -i :3111
# If not running: npm run dev
```

**Step 3: Run existing komga-toc agent live test**

```bash
npx jest tests/live/agent/komga-toc-agent.test.mjs --verbose
```

Expected: All 3 tests pass (agent listed, assignments returned, background run accepted).

---

## Summary

| Layer | File | Action |
|-------|------|--------|
| `1_adapters` | `content/readable/komga/KomgaClient.mjs` | **Modify** — add `sort` option to `getBooks()` |
| `3_applications` (port) | `agents/komga-toc/ports/IPagedMediaGateway.mjs` | **Create** — domain-named gateway for paged media access |
| `3_applications` (port) | `agents/komga-toc/ports/ITocCacheDatastore.mjs` | **Create** — abstracts TOC cache persistence |
| `1_adapters` | `komga/KomgaPagedMediaAdapter.mjs` | **Create** — implements IPagedMediaGateway, composes KomgaClient |
| `1_adapters` | `persistence/yaml/YamlTocCacheDatastore.mjs` | **Create** — implements ITocCacheDatastore with DataService |
| `3_applications` | `agents/komga-toc/tools/KomgaTocToolFactory.mjs` | **Rewrite** — use ports, no direct HTTP/config/persistence |
| `0_system` | `bootstrap.mjs` | **Modify** — resolve config, create adapters, inject |

### Violations Fixed

| # | Violation | Resolution |
|---|-----------|------------|
| 1 | `configService` in tool factory | Config resolved in bootstrap; injected via adapter constructor |
| 2 | `dataService` direct persistence | Via `ITocCacheDatastore` / `YamlTocCacheDatastore` |
| 3 | Raw `fetch()` with retry in app layer | Moved to `KomgaPagedMediaAdapter` |
| 4 | Komga API URL construction in app layer | Encapsulated in adapter + `KomgaClient` |

### Not Addressed (Lower Priority)

- **Model names** (`gpt-4o-mini`, `gpt-4o`) in tool factory — config concern, not a layer violation. `IAIGateway` port already exists.
- **KomgaFeedAdapter duplication** — `1_adapters/feed/sources/KomgaFeedAdapter.mjs` has its own Komga HTTP code. Could be refactored to use `KomgaClient`/`KomgaPagedMediaAdapter` in a future pass.
