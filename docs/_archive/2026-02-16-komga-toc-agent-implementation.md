# Komga TOC Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an agent that uses AI vision to extract table-of-contents data from Komga magazine PDFs and writes structured article listings to the YAML TOC cache.

**Architecture:** A `KomgaTocAgent` extending `BaseAgent` in the agent framework. Uses a `KomgaTocToolFactory` with 5 tools. The agent is triggered on demand via the agents API. It scans the TOC cache for books with empty articles, fetches page thumbnails from Komga, uses gpt-4o vision to identify and OCR TOC pages, then writes structured results to the existing YAML cache.

**Tech Stack:** Mastra agent framework, OpenAI gpt-4o vision (via IAIGateway), Komga REST API, YAML persistence via DataService.

---

### Task 1: Create KomgaTocToolFactory

**Files:**
- Create: `backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs`

**Step 1: Create the tool factory with all 5 tools**

```javascript
// backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs
import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class KomgaTocToolFactory extends ToolFactory {
  static domain = 'komga-toc';

  createTools() {
    const { dataService, configService, aiGateway, logger } = this.deps;

    const komgaAuth = configService.getHouseholdAuth('komga');
    const komgaHost = configService.resolveServiceUrl('komga');
    const apiKey = komgaAuth?.token;

    if (!komgaHost || !apiKey) {
      logger.warn?.('komga-toc.tools.not_configured');
      return [];
    }

    const authHeaders = { 'X-API-Key': apiKey, 'Accept': 'application/json' };

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
        // Read komga query config for series list
        const queryConfigs = dataService.household.readDir('config/lists/queries') || {};
        const komgaConfig = Object.values(queryConfigs).find(q => q.type === 'komga');
        if (!komgaConfig?.params?.series) {
          return { error: 'No komga series configured', booksToProcess: [] };
        }

        const seriesList = komgaConfig.params.series;
        const recentCount = komgaConfig.params.recent_issues || 6;
        const booksToProcess = [];

        for (const series of seriesList) {
          // Fetch books from Komga
          const booksUrl = `${komgaHost}/api/v1/series/${series.id}/books?sort=metadata.numberSort,desc&size=${recentCount}`;
          const booksRes = await fetch(booksUrl, { headers: authHeaders });
          if (!booksRes.ok) continue;

          const booksData = await booksRes.json();
          const books = booksData?.content || [];

          for (const book of books) {
            const bookId = book.id;
            const cachePath = `common/komga/toc/${bookId}.yml`;
            const cached = dataService.household.read(cachePath);

            // Skip if already scanned (even if articles is empty)
            if (cached?.tocScanned) continue;

            // Skip if already has articles
            if (cached?.articles?.length > 0) continue;

            booksToProcess.push({
              bookId,
              seriesId: series.id,
              seriesLabel: series.label,
              issueTitle: book.metadata?.title || book.name || 'Unknown',
              pageCount: book.media?.pagesCount || 0,
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
    // Tool 2: fetch_page_thumbnail
    // ---------------------------------------------------------------
    const fetchPageThumbnail = createTool({
      name: 'fetch_page_thumbnail',
      description: 'Fetch a thumbnail image of a specific page from a Komga book. Returns the image as a base64 data URI suitable for AI vision analysis. Use this for cheap TOC page detection before committing to full-res extraction.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page }) => {
        const url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}/thumbnail`;
        const res = await fetch(url, {
          headers: { 'X-API-Key': apiKey },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          return { error: `Failed to fetch thumbnail: ${res.status}`, bookId, page };
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const base64 = buffer.toString('base64');
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        return {
          bookId,
          page,
          imageDataUri: `data:${contentType};base64,${base64}`,
          sizeBytes: buffer.length,
        };
      },
    });

    // ---------------------------------------------------------------
    // Tool 3: check_page_is_toc
    // ---------------------------------------------------------------
    const checkPageIsToc = createTool({
      name: 'check_page_is_toc',
      description: 'Send a page thumbnail to AI vision to determine if it is a table of contents page. Returns yes/no with confidence. Use fetch_page_thumbnail first to get the image data URI.',
      parameters: {
        type: 'object',
        properties: {
          imageDataUri: { type: 'string', description: 'Base64 data URI of the page thumbnail' },
          bookId: { type: 'string', description: 'Komga book ID (for logging)' },
          page: { type: 'integer', description: 'Page number (for logging)' },
        },
        required: ['imageDataUri', 'bookId', 'page'],
      },
      execute: async ({ imageDataUri, bookId, page }) => {
        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }
        const messages = [
          { role: 'user', content: 'Is this page a table of contents or index page from a magazine? A table of contents typically lists article titles with corresponding page numbers. Answer with ONLY "yes" or "no".' },
        ];
        const response = await aiGateway.chatWithImage(messages, imageDataUri, {
          model: 'gpt-4o',
          maxTokens: 10,
        });
        const answer = (response || '').trim().toLowerCase();
        const isToc = answer.startsWith('yes');
        logger.info?.('komga-toc.check_page', { bookId, page, isToc, answer });
        return { bookId, page, isToc, rawAnswer: answer };
      },
    });

    // ---------------------------------------------------------------
    // Tool 4: extract_toc_from_page
    // ---------------------------------------------------------------
    const extractTocFromPage = createTool({
      name: 'extract_toc_from_page',
      description: 'Fetch a full-resolution page image from Komga and send it to AI vision to extract structured table-of-contents data. Returns an array of {title, page} objects. This is the expensive step — only call after confirming the page is a TOC via check_page_is_toc.',
      parameters: {
        type: 'object',
        properties: {
          bookId: { type: 'string', description: 'Komga book ID' },
          page: { type: 'integer', description: '1-indexed page number of the TOC page' },
        },
        required: ['bookId', 'page'],
      },
      execute: async ({ bookId, page }) => {
        if (!aiGateway?.isConfigured?.()) {
          return { error: 'AI gateway not configured' };
        }

        // Fetch full-resolution page image
        const url = `${komgaHost}/api/v1/books/${bookId}/pages/${page}`;
        const res = await fetch(url, {
          headers: { 'X-API-Key': apiKey },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          return { error: `Failed to fetch page: ${res.status}`, bookId, page };
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const imageDataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

        const messages = [
          { role: 'user', content: `This is a table of contents page from a magazine. Extract every article or feature title and its page number. Return ONLY a JSON array of objects with "title" and "page" fields. Example: [{"title": "The Future of AI", "page": 22}, {"title": "Climate Report", "page": 38}]. Rules:
- Include only actual articles/features, not section headers like "FEATURES" or "DEPARTMENTS" unless they have page numbers
- Use the exact title text as printed
- Page numbers must be integers
- Skip ads, editor letters, and minor items like "Letters to the Editor"
- If a title spans multiple lines, combine into one string` },
        ];
        const response = await aiGateway.chatWithImage(messages, imageDataUri, {
          model: 'gpt-4o',
          maxTokens: 2000,
        });

        // Parse JSON from response
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

        // Validate structure
        articles = articles
          .filter(a => a && typeof a.title === 'string' && typeof a.page === 'number')
          .map(a => ({ title: a.title.trim(), page: Math.round(a.page) }));

        logger.info?.('komga-toc.extract.success', { bookId, page, articleCount: articles.length });
        return { bookId, tocPage: page, articles };
      },
    });

    // ---------------------------------------------------------------
    // Tool 5: write_toc_cache
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
        const cachePath = `common/komga/toc/${bookId}.yml`;
        const tocData = {
          bookId,
          series: seriesLabel,
          issue: issueTitle,
          pages: pageCount,
          tocScanned: true,
          tocPage: tocPage || null,
          articles: articles || [],
        };
        dataService.household.write(cachePath, tocData);
        logger.info?.('komga-toc.cache.written', { bookId, articleCount: (articles || []).length });
        return { success: true, bookId, articleCount: (articles || []).length, cachePath };
      },
    });

    return [scanTocCache, fetchPageThumbnail, checkPageIsToc, extractTocFromPage, writeTocCache];
  }
}
```

**Step 2: Verify file was created correctly**

Run: `node -e "import('./backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: OK (or import path resolution — the actual instantiation needs deps)

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/tools/KomgaTocToolFactory.mjs
git commit -m "feat(agents): add KomgaTocToolFactory with 5 tools for TOC extraction"
```

---

### Task 2: Create System Prompt

**Files:**
- Create: `backend/src/3_applications/agents/komga-toc/prompts/system.mjs`

**Step 1: Write the system prompt**

```javascript
// backend/src/3_applications/agents/komga-toc/prompts/system.mjs
export const systemPrompt = `You are a Komga TOC extraction agent. Your job is to find and extract table-of-contents data from magazine PDFs stored in Komga.

## Workflow

1. Call scan_toc_cache to find books that need TOC extraction.
2. For each book that needs processing:
   a. Search for the TOC page by fetching thumbnails of pages 1 through 8 (use fetch_page_thumbnail).
   b. For each thumbnail, call check_page_is_toc to determine if it's a TOC page.
   c. Stop scanning pages as soon as you find a TOC page.
   d. If a TOC page is found, call extract_toc_from_page with the full-res page to get structured article data.
   e. Call write_toc_cache to save the results (articles array + tocPage number).
   f. If NO TOC page is found after checking pages 1-8, call write_toc_cache with an empty articles array and tocPage: null.
3. After processing all books, report a summary of what was done.

## Rules

- Always start with scan_toc_cache to find work to do.
- Process books one at a time, completing each before moving to the next.
- Use thumbnails for detection (cheap) and full-res only for extraction (expensive).
- Never skip write_toc_cache — even if no TOC is found, write the empty result to prevent re-processing.
- If a tool returns an error, log it and move on to the next book.
`;
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/prompts/system.mjs
git commit -m "feat(agents): add KomgaTocAgent system prompt"
```

---

### Task 3: Create KomgaTocAgent

**Files:**
- Create: `backend/src/3_applications/agents/komga-toc/KomgaTocAgent.mjs`
- Create: `backend/src/3_applications/agents/komga-toc/index.mjs`

**Step 1: Write the agent class**

```javascript
// backend/src/3_applications/agents/komga-toc/KomgaTocAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { KomgaTocToolFactory } from './tools/KomgaTocToolFactory.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class KomgaTocAgent extends BaseAgent {
  static id = 'komga-toc';
  static description = 'Extracts table-of-contents data from Komga magazine PDFs using AI vision';

  registerTools() {
    this.addToolFactory(new KomgaTocToolFactory(this.deps));
  }

  getSystemPrompt() {
    return systemPrompt;
  }
}
```

**Step 2: Write the index.mjs barrel export**

```javascript
// backend/src/3_applications/agents/komga-toc/index.mjs
export { KomgaTocAgent } from './KomgaTocAgent.mjs';
```

**Step 3: Verify import**

Run: `node -e "import('./backend/src/3_applications/agents/komga-toc/index.mjs').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: OK

**Step 4: Commit**

```bash
git add backend/src/3_applications/agents/komga-toc/KomgaTocAgent.mjs backend/src/3_applications/agents/komga-toc/index.mjs
git commit -m "feat(agents): add KomgaTocAgent extending BaseAgent"
```

---

### Task 4: Register Agent in Bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs` (around line 2434, inside `createAgentsApiRouter`)
- Modify: `backend/src/app.mjs` (around line 1311, pass `aiGateway` to `createAgentsApiRouter`)

**Step 1: Add import and registration in bootstrap.mjs**

At the top of `createAgentsApiRouter` function (after existing agent imports around line 2401), add the import. Then register the agent after the HealthCoachAgent registration block (around line 2448).

In `bootstrap.mjs`, find the import block inside or near `createAgentsApiRouter`. The existing agents are imported at the top of the file. Add:

```javascript
// Near line 2401 in createAgentsApiRouter, add to destructured config:
// Add aiGateway to the destructured config parameters

// After HealthCoachAgent registration (around line 2448), add:
  // Register Komga TOC agent (requires AI gateway + data services)
  if (config.aiGateway && dataService && configService) {
    const { KomgaTocAgent } = await import('#apps/agents/komga-toc/index.mjs');
    agentOrchestrator.register(KomgaTocAgent, {
      workingMemory,
      aiGateway: config.aiGateway,
      dataService,
      configService,
    });
  }
```

Note: `createAgentsApiRouter` already receives `dataService` and `configService`. We just need to also pass `aiGateway` from `app.mjs`.

**Step 2: Pass aiGateway in app.mjs**

In `app.mjs` around line 1311, modify the `createAgentsApiRouter` call to include `aiGateway`:

```javascript
  v1Routers.agents = createAgentsApiRouter({
    logger: rootLogger.child({ module: 'agents-api' }),
    healthStore: healthServices.healthStore,
    healthService: healthServices.healthService,
    fitnessPlayableService,
    sessionService: fitnessServices.sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway: sharedAiGateway,  // <-- ADD THIS LINE
  });
```

**Step 3: Update createAgentsApiRouter signature in bootstrap.mjs**

Add `aiGateway` to the destructured config (around line 2402):

```javascript
  const {
    logger = console,
    healthStore,
    healthService,
    fitnessPlayableService,
    sessionService,
    mediaProgressMemory,
    dataService,
    configService,
    aiGateway,  // <-- ADD THIS LINE
  } = config;
```

**Step 4: Verify server starts**

Run: `curl -s http://localhost:3112/api/v1/agents | python3 -m json.tool`
Expected: JSON response listing agents including `komga-toc`

**Step 5: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(agents): register KomgaTocAgent in bootstrap with AI gateway"
```

---

### Task 5: Test the Agent End-to-End

**Step 1: List agents to verify registration**

Run: `curl -s http://localhost:3112/api/v1/agents | python3 -m json.tool`
Expected: Response includes `{ "id": "komga-toc", "description": "..." }`

**Step 2: Run the agent**

Run: `curl -s -X POST http://localhost:3112/api/v1/agents/komga-toc/run -H 'Content-Type: application/json' -d '{"input": "Scan for books that need TOC extraction and process them."}' | python3 -m json.tool`
Expected: Agent processes books, output describes what it found and wrote.

**Step 3: Verify TOC cache was updated**

Run: `cat /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/komga/toc/*.yml | grep -c 'tocScanned: true'`
Expected: Count increases from 0 to match number of processed books.

**Step 4: Verify feed items now have article titles**

Run: `curl -s "http://localhost:3112/api/v1/feed/scroll?source=komga&limit=3" | python3 -m json.tool`
Expected: Items now have descriptive titles (article names) instead of "Page".

**Step 5: Commit any fixes**

If any adjustments were needed during testing, commit them.
