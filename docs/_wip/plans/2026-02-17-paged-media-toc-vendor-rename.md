# Paged-Media-TOC Vendor Name Rename — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the vendor name "Komga" from the application layer by renaming the `komga-toc` agent to `paged-media-toc`, adhering to DDD principles (no vendor names in `3_applications/`).

**Architecture:** The ports (`IPagedMediaGateway`, `ITocCacheDatastore`) are already vendor-agnostic. This rename targets the agent directory, class names, agent ID, system prompt, tool factory, CLI tool, and test file. Adapter-layer files (`1_adapters/komga/`) keep their vendor names — that's correct per DDD.

**Tech Stack:** Node.js ES modules (.mjs), git mv for renames

---

### Task 1: Rename agent directory and class files

**Files:**
- Rename: `backend/src/3_applications/agents/komga-toc/` → `backend/src/3_applications/agents/paged-media-toc/`
- Rename: `backend/src/3_applications/agents/paged-media-toc/KomgaTocAgent.mjs` → `PagedMediaTocAgent.mjs`
- Rename: `backend/src/3_applications/agents/paged-media-toc/tools/KomgaTocToolFactory.mjs` → `PagedMediaTocToolFactory.mjs`

**Step 1: Move directory**

```bash
git mv backend/src/3_applications/agents/komga-toc backend/src/3_applications/agents/paged-media-toc
```

**Step 2: Rename class files**

```bash
git mv backend/src/3_applications/agents/paged-media-toc/KomgaTocAgent.mjs backend/src/3_applications/agents/paged-media-toc/PagedMediaTocAgent.mjs
git mv backend/src/3_applications/agents/paged-media-toc/tools/KomgaTocToolFactory.mjs backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs
```

**Step 3: Commit the renames (preserves git history)**

```bash
git add -A
git commit -m "refactor(agents): rename komga-toc directory and files to paged-media-toc"
```

---

### Task 2: Update PagedMediaTocAgent class

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/PagedMediaTocAgent.mjs`

**Step 1: Rewrite the agent class**

Replace entire file contents with:

```javascript
// backend/src/3_applications/agents/paged-media-toc/PagedMediaTocAgent.mjs
import { BaseAgent } from '../framework/BaseAgent.mjs';
import { PagedMediaTocToolFactory } from './tools/PagedMediaTocToolFactory.mjs';
import { systemPrompt } from './prompts/system.mjs';

export class PagedMediaTocAgent extends BaseAgent {
  static id = 'paged-media-toc';
  static description = 'Extracts table-of-contents data from paged media (magazines, comics) using AI vision';

  registerTools() {
    this.addToolFactory(new PagedMediaTocToolFactory(this.deps));
  }

  getSystemPrompt() {
    return systemPrompt;
  }
}
```

**Step 2: Update index.mjs**

Replace `backend/src/3_applications/agents/paged-media-toc/index.mjs` with:

```javascript
// backend/src/3_applications/agents/paged-media-toc/index.mjs
export { PagedMediaTocAgent } from './PagedMediaTocAgent.mjs';
```

**Step 3: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/PagedMediaTocAgent.mjs backend/src/3_applications/agents/paged-media-toc/index.mjs
git commit -m "refactor(agents): update PagedMediaTocAgent class and index exports"
```

---

### Task 3: Update PagedMediaTocToolFactory class

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs`

**Step 1: Rename class and update vendor references in code**

Changes to make:
1. Class name: `KomgaTocToolFactory` → `PagedMediaTocToolFactory`
2. Static domain: `'komga-toc'` → `'paged-media-toc'`
3. Logger keys: `'komga-toc.tools.no_gateway'` → `'paged-media-toc.tools.no_gateway'`
4. Logger keys: `'komga-toc.scan.series.error'` → `'paged-media-toc.scan.series_error'`
5. Logger keys: `'komga-toc.scan_page'` → `'paged-media-toc.scan_page'`
6. Logger keys: `'komga-toc.extract.parse_error'` → `'paged-media-toc.extract.parse_error'`
7. Logger keys: `'komga-toc.extract.success'` → `'paged-media-toc.extract.success'`
8. Logger keys: `'komga-toc.cache.written'` → `'paged-media-toc.cache.written'`
9. Tool descriptions: Remove "Komga" from all 4 tool description strings, replace with domain language:
   - `scan_toc_cache`: "...from Komga for all configured series..." → "...from the media server for all configured series..."
   - `scan_page_for_toc`: "Fetch a thumbnail of a specific page from a Komga book..." → "Fetch a thumbnail of a specific page from a book..."
   - `extract_toc_from_page`: "Fetch a full-resolution page image from Komga..." → "Fetch a full-resolution page image..."
   - `write_toc_cache`: "...for a Komga book." → "...for a book."
10. Parameter descriptions: `'Komga book ID'` → `'Book ID'` (appears in scanPageForToc, extractTocFromPage, writeTocCache — 3 occurrences)

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/tools/PagedMediaTocToolFactory.mjs
git commit -m "refactor(agents): remove vendor names from PagedMediaTocToolFactory"
```

---

### Task 4: Update system prompt

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/prompts/system.mjs`

**Step 1: Replace vendor references with domain language**

Replace full contents with:

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
   e. Call write_toc_cache to save the results (articles array + first tocPage number).
   f. If NO TOC page is found after checking pages 1-8, call write_toc_cache with an empty articles array and tocPage: null.
3. After processing all books, report a summary of what was done.

## Rules

- Always start with scan_toc_cache to find work to do.
- Process books one at a time, completing each before moving to the next.
- scan_page_for_toc is cheap (thumbnail + mini model) — use it freely for detection.
- extract_toc_from_page is expensive (full-res + large model) — only call on confirmed TOC pages.
- Never skip write_toc_cache — even if no TOC is found, write the empty result to prevent re-processing.
- If a tool returns an error, log it and move on to the next book.
`;
```

Only two strings changed: line 1 "You are a Komga TOC extraction agent" → "You are a paged-media TOC extraction agent" and "magazine PDFs stored in Komga" → "magazine PDFs stored in a paged media library".

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/prompts/system.mjs
git commit -m "refactor(agents): remove vendor name from paged-media-toc system prompt"
```

---

### Task 5: Update port JSDoc module paths

**Files:**
- Modify: `backend/src/3_applications/agents/paged-media-toc/ports/IPagedMediaGateway.mjs:9`
- Modify: `backend/src/3_applications/agents/paged-media-toc/ports/ITocCacheDatastore.mjs:9`

**Step 1: Update @module tags**

In `IPagedMediaGateway.mjs` line 9:
- `@module applications/agents/komga-toc/ports/IPagedMediaGateway` → `@module applications/agents/paged-media-toc/ports/IPagedMediaGateway`

In `ITocCacheDatastore.mjs` line 9:
- `@module applications/agents/komga-toc/ports/ITocCacheDatastore` → `@module applications/agents/paged-media-toc/ports/ITocCacheDatastore`

No other changes — port names and interfaces are already vendor-agnostic.

**Step 2: Commit**

```bash
git add backend/src/3_applications/agents/paged-media-toc/ports/
git commit -m "refactor(agents): update @module paths in port interfaces"
```

---

### Task 6: Update bootstrap.mjs

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:165` (import)
- Modify: `backend/src/0_system/bootstrap.mjs:2460` (comment)
- Modify: `backend/src/0_system/bootstrap.mjs:2475` (registration)

**Step 1: Update import**

Line 165, change:
```javascript
import { KomgaTocAgent } from '#apps/agents/komga-toc/index.mjs';
```
to:
```javascript
import { PagedMediaTocAgent } from '#apps/agents/paged-media-toc/index.mjs';
```

**Step 2: Update registration comment and class reference**

Line 2460, change:
```javascript
  // Register Komga TOC agent (requires AI gateway + Komga access)
```
to:
```javascript
  // Register paged-media-toc agent (requires AI gateway + paged media server access)
```

Line 2475, change:
```javascript
      agentOrchestrator.register(KomgaTocAgent, {
```
to:
```javascript
      agentOrchestrator.register(PagedMediaTocAgent, {
```

The rest of the block (KomgaClient, KomgaPagedMediaAdapter, variable names like `komgaAuth`, `komgaHost`) stays as-is — bootstrap is the wiring layer and these are adapter-side references.

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "refactor(bootstrap): wire PagedMediaTocAgent instead of KomgaTocAgent"
```

---

### Task 7: Rename CLI tool

**Files:**
- Rename: `cli/komga-toc-backfill.cli.mjs` → `cli/paged-media-toc-backfill.cli.mjs`

**Step 1: Rename file**

```bash
git mv cli/komga-toc-backfill.cli.mjs cli/paged-media-toc-backfill.cli.mjs
```

**Step 2: Update header comments and log messages**

In `cli/paged-media-toc-backfill.cli.mjs`:

1. Line 2 JSDoc: `Komga TOC Backfill CLI` → `Paged Media TOC Backfill CLI`
2. Line 4: `Directly executes the Komga TOC extraction pipeline` → `Directly executes the paged-media TOC extraction pipeline`
3. Line 6: `Calls the same logic as KomgaTocToolFactory` → `Calls the same logic as PagedMediaTocToolFactory`
4. Line 10: `node cli/komga-toc-backfill.cli.mjs` → `node cli/paged-media-toc-backfill.cli.mjs` (3 usage lines)
5. Line 14: `@module cli/komga-toc-backfill` → `@module cli/paged-media-toc-backfill`
6. Line 261: `console.log('Komga TOC Backfill');` → `console.log('Paged Media TOC Backfill');`

Leave Komga-specific runtime code (API URLs, auth, config key lookups) as-is — the CLI is an entry point that wires adapters directly, same as bootstrap. Vendor names in wiring code are acceptable.

**Step 3: Commit**

```bash
git add cli/paged-media-toc-backfill.cli.mjs
git commit -m "refactor(cli): rename komga-toc-backfill to paged-media-toc-backfill"
```

---

### Task 8: Rename and update test file

**Files:**
- Rename: `tests/live/agent/komga-toc-agent.test.mjs` → `tests/live/agent/paged-media-toc-agent.test.mjs`

**Step 1: Rename file**

```bash
git mv tests/live/agent/komga-toc-agent.test.mjs tests/live/agent/paged-media-toc-agent.test.mjs
```

**Step 2: Update test contents**

Replace full contents with:

```javascript
// tests/live/agent/paged-media-toc-agent.test.mjs
/**
 * Paged Media TOC Agent — Live Tests
 *
 * Tests agent registration and the background run endpoint.
 * Does NOT test full vision extraction (too slow for CI).
 * Use cli/paged-media-toc-backfill.cli.mjs for actual backfill execution.
 */

import { agentAPI } from './_agent-test-helper.mjs';

const AGENT_ID = 'paged-media-toc';

describe('Paged Media TOC Agent', () => {
  beforeAll(async () => {
    const { res, data } = await agentAPI('/');
    if (!res.ok) throw new Error(`Agent API not responding: ${res.status}`);
    const agent = data.agents?.find(a => a.id === AGENT_ID);
    if (!agent) {
      const available = data.agents?.map(a => a.id).join(', ') || 'none';
      throw new Error(`Agent ${AGENT_ID} not registered. Available: ${available}`);
    }
  });

  test('GET /agents — lists paged-media-toc agent', async () => {
    const { res, data } = await agentAPI('/');
    expect(res.status).toBe(200);
    const agent = data.agents.find(a => a.id === AGENT_ID);
    expect(agent).toBeDefined();
    expect(agent.id).toBe(AGENT_ID);
    expect(agent.description).toMatch(/paged.media/i);
  });

  test('GET /agents/paged-media-toc/assignments — returns assignments array', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/assignments`);
    expect(res.status).toBe(200);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('assignments');
    expect(Array.isArray(data.assignments)).toBe(true);
  });

  test('POST /agents/paged-media-toc/run-background — accepts background run', async () => {
    const { res, data } = await agentAPI(`/${AGENT_ID}/run-background`, {
      method: 'POST',
      body: { input: 'Scan for books that need TOC extraction and process them.' },
      timeout: 10000,
    });
    expect(res.status).toBe(202);
    expect(data).toHaveProperty('agentId', AGENT_ID);
    expect(data).toHaveProperty('taskId');
    expect(data).toHaveProperty('status', 'accepted');
  }, 15000);
});
```

Key changes: `AGENT_ID = 'paged-media-toc'`, description regex `(/paged.media/i)`, all comments updated.

**Step 3: Commit**

```bash
git add tests/live/agent/paged-media-toc-agent.test.mjs
git commit -m "refactor(tests): rename komga-toc test to paged-media-toc"
```

---

### Task 9: Archive old design plans

**Files:**
- Move: `docs/_wip/plans/2026-02-16-komga-toc-agent-design.md` → `docs/_archive/`
- Move: `docs/_wip/plans/2026-02-16-komga-toc-agent-implementation.md` → `docs/_archive/`

**Step 1: Move to archive**

```bash
git mv docs/_wip/plans/2026-02-16-komga-toc-agent-design.md docs/_archive/
git mv docs/_wip/plans/2026-02-16-komga-toc-agent-implementation.md docs/_archive/
```

**Step 2: Commit**

```bash
git add docs/_archive/
git commit -m "docs: archive old komga-toc agent plans"
```

---

### Task 10: Final grep verification

**Step 1: Verify no vendor names remain in application layer**

```bash
grep -r "komga" backend/src/3_applications/ --include="*.mjs" -l
```

Expected: **zero results**

**Step 2: Verify vendor names only exist in acceptable layers**

```bash
grep -ri "komga" backend/src/ --include="*.mjs" -l
```

Expected results (all acceptable):
- `backend/src/0_system/bootstrap.mjs` — wiring layer, uses adapter class names
- `backend/src/1_adapters/komga/*` — adapter layer, vendor names correct
- `backend/src/1_adapters/content/readable/komga/*` — adapter layer, correct
- `backend/src/1_adapters/persistence/yaml/YamlTocCacheDatastore.mjs` — adapter internal path

**Step 3: Verify agent loads**

```bash
node -e "import('./backend/src/3_applications/agents/paged-media-toc/index.mjs').then(m => { console.log('Class:', m.PagedMediaTocAgent.id); console.log('OK') }).catch(e => console.error(e.message))"
```

Expected: `Class: paged-media-toc` then `OK`

**Step 4: Commit verification note (no code change needed)**

No commit — this is a validation step only.
