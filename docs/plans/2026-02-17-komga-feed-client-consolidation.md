# Komga Feed Adapter Client Consolidation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate duplicated HTTP/auth logic in KomgaFeedAdapter by composing the existing KomgaClient instead of rolling its own `fetch()` calls.

**Architecture:** KomgaFeedAdapter currently builds its own Komga API URLs and manages its own auth headers, duplicating what KomgaClient already provides. This refactor makes KomgaFeedAdapter compose KomgaClient for JSON API calls (book listings), following the same pattern KomgaPagedMediaAdapter already uses. The PDF binary download in `#extractBookmarks` stays as raw `fetch()` since KomgaClient is JSON-oriented.

**Tech Stack:** Node.js ES modules, Jest (with `@jest/globals`), axios (httpClient for KomgaClient)

---

## Task 1: Update KomgaFeedAdapter Constructor to Accept KomgaClient

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:16-41`
- Test: `tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs`

**Step 1: Write the failing test**

Add a new test block to `KomgaFeedAdapter.test.mjs` that verifies the adapter accepts a `client` dependency and rejects construction without one:

```javascript
describe('constructor with client', () => {
  test('throws error when client is missing', () => {
    expect(() => new KomgaFeedAdapter({
      apiKey: 'test-key',
      dataService: mockDataService,
    })).toThrow('KomgaFeedAdapter requires client');
  });

  test('accepts client and apiKey without host', () => {
    const mockClient = { host: 'http://localhost:25600', getBooks: jest.fn() };
    const adapter = new KomgaFeedAdapter({
      client: mockClient,
      apiKey: 'test-key',
      dataService: mockDataService,
      logger,
    });
    expect(adapter.sourceType).toBe('komga');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: FAIL — constructor still expects `host` not `client`

**Step 3: Implement the constructor change**

In `KomgaFeedAdapter.mjs`, replace the constructor to accept `client` (a KomgaClient instance) instead of `host`:

```javascript
constructor({ client, apiKey, webUrl = null, dataService, logger = console }) {
  super();
  if (!client) throw new Error('KomgaFeedAdapter requires client');
  if (!apiKey) throw new Error('KomgaFeedAdapter requires apiKey');
  if (!dataService) throw new Error('KomgaFeedAdapter requires dataService');
  this.#client = client;
  this.#apiKey = apiKey;
  this.#webUrl = webUrl ? webUrl.replace(/\/$/, '') : null;
  this.#dataService = dataService;
  this.#logger = logger;
}
```

Also update private fields — replace `#host` with `#client`:

```javascript
#client;
#apiKey;
#webUrl;
#dataService;
#logger;
```

**Step 4: Update existing tests to pass client**

All existing tests construct the adapter with `host` and `apiKey`. Update them to pass a `mockClient` object instead:

```javascript
// At top of describe block, add:
const mockClient = {
  host: 'http://localhost:25600',
  getBooks: jest.fn(),
};

// In each test, change construction from:
const adapter = new KomgaFeedAdapter({
  host: 'http://localhost:25600',
  apiKey: 'test-key',
  dataService: mockDataService,
  logger,
});
// To:
const adapter = new KomgaFeedAdapter({
  client: mockClient,
  apiKey: 'test-key',
  dataService: mockDataService,
  logger,
});
```

**Step 5: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: All tests PASS (existing tests still work because `#fetchOneSeries` hasn't been changed yet — it will fail at runtime but tests mock at a higher level via cached TOC)

**Step 6: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
git commit -m "refactor: update KomgaFeedAdapter constructor to accept KomgaClient"
```

---

## Task 2: Replace Raw fetch() Book Listing with KomgaClient.getBooks()

**Files:**
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:91-101` (`#fetchOneSeries`)
- Modify: `backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs:226-235` (delete `#authHeaders`)
- Test: `tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs`

**Step 1: Write the failing test**

Add a test that verifies `fetchItems` calls `client.getBooks()` with the correct arguments rather than raw `fetch()`:

```javascript
describe('fetchItems delegates to client.getBooks', () => {
  test('calls client.getBooks with correct seriesId, size, and sort', async () => {
    const mockClient = {
      host: 'http://localhost:25600',
      getBooks: jest.fn().mockResolvedValue({
        content: [{
          id: 'book-abc',
          name: 'Issue 42',
          metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
          media: { pagesCount: 50 },
        }],
      }),
    };

    // Return cached TOC so we skip pdfjs
    mockDataService.household.read.mockReturnValue({
      bookId: 'book-abc',
      series: 'Test Series',
      issue: 'Issue 42',
      pages: 50,
      articles: [{ title: 'Article One', page: 12 }],
    });

    const adapter = new KomgaFeedAdapter({
      client: mockClient,
      apiKey: 'test-key',
      dataService: mockDataService,
      logger,
    });

    await adapter.fetchItems({
      tier: 'library',
      priority: 5,
      params: {
        series: [{ id: 'series-1', label: 'Test Series' }],
        recent_issues: 4,
      },
    }, 'testuser');

    expect(mockClient.getBooks).toHaveBeenCalledWith('series-1', {
      size: 4,
      sort: 'metadata.numberSort,desc',
    });
    // Should NOT have called global fetch for book listing
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: FAIL — `#fetchOneSeries` still uses raw `fetch()`, not `client.getBooks()`

**Step 3: Implement the change**

In `#fetchOneSeries`, replace the raw fetch with `this.#client.getBooks()`:

```javascript
async #fetchOneSeries(series, recentCount, query) {
  let booksData;
  try {
    booksData = await this.#client.getBooks(series.id, {
      size: recentCount,
      sort: 'metadata.numberSort,desc',
    });
  } catch (err) {
    this.#logger.warn?.('komga.adapter.books.error', { seriesId: series.id, error: err.message });
    return null;
  }

  const books = booksData?.content || [];
  if (books.length === 0) return null;

  // ... rest of method unchanged from line 104 onward
```

Delete the `#authHeaders()` method (lines 230-235) — it's no longer used. The only remaining raw `fetch()` is in `#extractBookmarks`, which uses `this.#apiKey` directly.

Also update `#extractBookmarks` to get host from `this.#client.host` instead of `this.#host`:

```javascript
// In #extractBookmarks, change:
const fileUrl = `${this.#host}/api/v1/books/${bookId}/file`;
// To:
const fileUrl = `${this.#client.host}/api/v1/books/${bookId}/file`;
```

**Step 4: Update existing tests**

The two existing `fetchItems` tests mock `global.fetch` for the book listing response. Since `fetchItems` now uses `client.getBooks()`, update them to mock the client instead:

```javascript
// In both existing 'fetchItems image URL' tests, replace mockFetch setup with:
mockClient.getBooks.mockResolvedValue({
  content: [{
    id: 'book-abc',
    name: 'Issue 42',
    metadata: { title: 'Issue 42', releaseDate: '2026-01-01' },
    media: { pagesCount: 50 },
  }],
});

// And move mockClient into the outer describe scope with beforeEach reset:
beforeEach(() => {
  jest.clearAllMocks();
  mockDataService.household.read.mockReturnValue(null);
  mockClient.getBooks.mockReset();
});
```

Remove `const mockFetch = jest.fn(); global.fetch = mockFetch;` from the top of the file — no longer needed (KomgaFeedAdapter no longer calls `fetch()` for book listings, and the PDF download path is not exercised in these tests because TOC is cached).

**Step 5: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs --verbose`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add backend/src/1_adapters/feed/sources/KomgaFeedAdapter.mjs tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
git commit -m "refactor: replace raw fetch in KomgaFeedAdapter with KomgaClient.getBooks"
```

---

## Task 3: Update Composition Root to Wire KomgaClient into KomgaFeedAdapter

**Files:**
- Modify: `backend/src/app.mjs:664` (add KomgaClient import)
- Modify: `backend/src/app.mjs:752-760` (create KomgaClient, pass to KomgaFeedAdapter)

**Step 1: Add KomgaClient dynamic import**

At line 664, add the KomgaClient import alongside the KomgaFeedAdapter import:

```javascript
const { KomgaFeedAdapter } = await import('./1_adapters/feed/sources/KomgaFeedAdapter.mjs');
const { KomgaClient } = await import('./1_adapters/content/readable/komga/KomgaClient.mjs');
```

**Step 2: Update the wiring block**

Replace lines 752-760:

```javascript
// Before:
const komgaAuth = configService.getHouseholdAuth('komga');
const komgaHost = configService.resolveServiceUrl('komga');
const komgaFeedAdapter = komgaAuth?.token && komgaHost ? new KomgaFeedAdapter({
  host: komgaHost,
  apiKey: komgaAuth.token,
  webUrl: komgaHost,
  dataService,
  logger: rootLogger.child({ module: 'komga-feed' }),
}) : null;

// After:
const komgaAuth = configService.getHouseholdAuth('komga');
const komgaHost = configService.resolveServiceUrl('komga');
const komgaFeedAdapter = komgaAuth?.token && komgaHost ? new KomgaFeedAdapter({
  client: new KomgaClient(
    { host: komgaHost, apiKey: komgaAuth.token },
    { httpClient: axios, logger: rootLogger.child({ module: 'komga-feed-client' }) }
  ),
  apiKey: komgaAuth.token,
  webUrl: komgaHost,
  dataService,
  logger: rootLogger.child({ module: 'komga-feed' }),
}) : null;
```

Note: `axios` is already imported at line 12 of `app.mjs`.

**Step 3: Verify the server starts**

Run: `node backend/index.js` (or `npm run dev` if not already running)
Expected: No startup errors. Check logs for `komga-feed-client` logger tag.

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "wire: pass KomgaClient to KomgaFeedAdapter in composition root"
```

---

## Task 4: Run Full Test Suite and Verify No Regressions

**Files:**
- No modifications — verification only

**Step 1: Run isolated adapter tests**

Run: `npx jest tests/isolated/adapter/ --verbose`
Expected: All tests PASS, including KomgaFeedAdapter, KomgaClient, and KomgaProxyAdapter tests.

**Step 2: Run full isolated test suite**

Run: `npx jest tests/isolated/ --verbose`
Expected: No regressions.

**Step 3: Final commit (if any fixups needed)**

If any tests needed fixes, commit them here. Otherwise, this task is just verification.
