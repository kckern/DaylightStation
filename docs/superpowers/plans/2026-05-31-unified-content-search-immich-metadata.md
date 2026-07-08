# Unified Content Search + Rich Immich Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified `/api/v1/content/query/search` endpoint correctly filter Immich by date and optionally return rich metadata (full curated EXIF + people/faces) via native `withExif`/`withPeople` passthrough, strip empty fields from responses, and deprecate the legacy `/api/v1/content/search` endpoint.

**Architecture:** The unified search path currently drops the translated `takenAfter`/`takenBefore` date params inside `ImmichAdapter.#buildImmichQuery` (it only reads legacy `dateFrom`/`dateTo`), so date filtering silently no-ops. We fix the date plumbing and, in the same spot, pass `withExif`/`withPeople` straight through to Immich's `/api/search/metadata` (one call — verified Immich v2.7.5 returns full exif + people/faces inline). The Immich item mappers gain a curated `exif` block. A small `stripEmpty` helper removes `null`/`undefined`/`[]`/`{}` from item payloads at the API boundary. The legacy endpoint gets RFC 8594 deprecation headers; its only two callers (runtime tests) migrate to the unified endpoint.

**Tech Stack:** Node ESM (`.mjs`), Express, Vitest v4 (isolated tests via `npx vitest run <file>`), Playwright (live runtime tests).

---

## Background (verified facts)

These were confirmed live against the running container + Immich server. Do not re-litigate:

- **Immich version:** v2.7.5.
- **Date filter is dropped on the unified endpoint.** `time=1900` and `time=2025-12-25` and no-filter all return the same 1968 video. Root cause: `ImmichAdapter.#buildImmichQuery` reads `query.dateFrom`/`query.dateTo` but `ContentQueryService` translates `time` → `takenAfter`/`takenBefore`, which `#buildImmichQuery` never copies.
- **`parseTime('2025-12-25')` returns `{ value: '2025-12-25' }`** (a single value, not a range), which translates to a malformed `takenAfter` object. Year (`2025`) and year-month (`2025-12`) already return ranges.
- **Immich search with `withExif:true, withPeople:true` returns full exif + people/faces in ONE call.** Sample exif keys: `make, model, lensModel, fNumber, focalLength, iso, exposureTime, latitude, longitude, city, state, country, dateTimeOriginal, orientation, rating, ...`. People came back as `[{name:'User_3', faces:1}]`.
- **Tags are ABSENT from Immich search responses** (only available on per-asset detail). Therefore tags are OUT OF SCOPE for the search path (no N+1 hydration).
- **Legacy `/api/v1/content/search` has no frontend callers.** Only two runtime tests use it: `tests/live/flow/content/immich-video-playback.runtime.test.mjs` and `tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs`, both with `?sources=X&mediaType=Y&take=1`.
- **Curated EXIF subset** (chosen output shape): `capturedAt, city, state, country, latitude, longitude, make, model, lensModel, fNumber, iso, exposureTime, focalLength`.

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/src/4_api/v1/parsers/rangeParser.mjs` | Parse `time` strings into date ranges | Modify: single full date → same-day range |
| `backend/src/4_api/v1/parsers/contentQueryParser.mjs` | Normalize HTTP query → ContentQuery | Modify: recognize `withExif`/`withPeople` booleans |
| `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs` | Immich adapter: query build + item mapping | Modify: passthrough date+flags; curated exif block |
| `backend/src/3_applications/content/ContentQueryService.mjs` | Orchestration / capability gating | Modify: treat `withExif`/`withPeople` as meta keys |
| `backend/src/4_api/v1/utils/stripEmpty.mjs` | Recursively remove empty fields | Create |
| `backend/src/4_api/v1/routers/content.mjs` | Content query router | Modify: strip empties on items; deprecate legacy `/search` |
| `backend/src/4_api/v1/routers/info.mjs` | Single-item info router | Modify: strip empties on response |
| `tests/live/flow/content/immich-video-playback.runtime.test.mjs` | Live test | Modify: migrate to `/query/search` |
| `tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs` | Live test | Modify: migrate to `/query/search` |
| `docs/reference/content/content-sources.md` | Source/driver reference | Modify: document date + enrich behavior |
| Test files under `tests/isolated/...` | Unit tests | Create/Modify per task |

---

### Task 1: `parseTime` — single full date becomes a same-day range

**Files:**
- Modify: `backend/src/4_api/v1/parsers/rangeParser.mjs` (the `parseTime` function, around lines 93–113)
- Test: `tests/isolated/api/parsers/rangeParser.test.mjs`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe` block for `parseTime` in `tests/isolated/api/parsers/rangeParser.test.mjs`:

```javascript
test('single full date returns a same-day range (from..next day)', () => {
  expect(parseTime('2025-12-25')).toEqual({ from: '2025-12-25', to: '2025-12-26' });
});

test('single full date crossing month boundary increments correctly', () => {
  expect(parseTime('2025-01-31')).toEqual({ from: '2025-01-31', to: '2025-02-01' });
});

test('single full date crossing year boundary increments correctly', () => {
  expect(parseTime('2025-12-31')).toEqual({ from: '2025-12-31', to: '2026-01-01' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/parsers/rangeParser.test.mjs`
Expected: FAIL — current code returns `{ value: '2025-12-25' }`.

- [ ] **Step 3: Implement the range expansion**

In `backend/src/4_api/v1/parsers/rangeParser.mjs`, locate this block at the end of `parseTime` (after the year-month branch, before `return { value: result };`):

```javascript
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return {
      from: `${value}-01`,
      to: `${value}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  return { value: result };
```

Replace the trailing `return { value: result };` with:

```javascript
  // Single full date (YYYY-MM-DD): expand to a same-day window [date, nextDay].
  // Immich's takenBefore is effectively an exclusive upper bound at day granularity,
  // so a zero-width [date, date] window returns nothing — use the next day as the end.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const next = new Date(`${value}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const to = next.toISOString().slice(0, 10);
    return { from: value, to };
  }

  return { value: result };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/api/parsers/rangeParser.test.mjs`
Expected: PASS (all existing tests still green too).

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/parsers/rangeParser.mjs tests/isolated/api/parsers/rangeParser.test.mjs
git commit -m "fix(content): expand single-date time filter to a same-day range"
```

---

### Task 2: `parseContentQuery` recognizes `withExif`/`withPeople`

**Files:**
- Modify: `backend/src/4_api/v1/parsers/contentQueryParser.mjs` (around lines 96–102)
- Test: `tests/isolated/api/parsers/contentQueryParser.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/isolated/api/parsers/contentQueryParser.test.mjs`:

```javascript
test('recognizes withExif and withPeople as boolean passthrough flags', () => {
  const q = parseContentQuery({ source: 'immich', time: '2025-12-25', withExif: '1', withPeople: 'true' });
  expect(q.withExif).toBe(true);
  expect(q.withPeople).toBe(true);
});

test('omits withExif/withPeople when not provided', () => {
  const q = parseContentQuery({ source: 'immich', time: '2025-12-25' });
  expect(q.withExif).toBeUndefined();
  expect(q.withPeople).toBeUndefined();
});

test('treats bare withExif key (no value) as true', () => {
  const q = parseContentQuery({ source: 'immich', withExif: '' });
  expect(q.withExif).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/parsers/contentQueryParser.test.mjs`
Expected: FAIL — `q.withExif` is `undefined`.

- [ ] **Step 3: Implement the boolean recognition**

In `backend/src/4_api/v1/parsers/contentQueryParser.mjs`, find the boolean params block:

```javascript
  // Boolean params
  if (isTruthy(rawParams.shuffle) || hasKey(rawParams, 'shuffle')) {
    query.sort = 'random';
  }
  if (isTruthy(rawParams.favorites) || hasKey(rawParams, 'favorites')) {
    query.favorites = true;
  }
```

Add immediately after it:

```javascript
  // Native Immich enrichment flags — passed straight through to the adapter,
  // which forwards them to Immich's /api/search/metadata. Other adapters ignore them.
  if (isTruthy(rawParams.withExif) || hasKey(rawParams, 'withExif')) {
    query.withExif = true;
  }
  if (isTruthy(rawParams.withPeople) || hasKey(rawParams, 'withPeople')) {
    query.withPeople = true;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/api/parsers/contentQueryParser.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/parsers/contentQueryParser.mjs tests/isolated/api/parsers/contentQueryParser.test.mjs
git commit -m "feat(content): parse withExif/withPeople enrichment flags"
```

---

### Task 3: `ContentQueryService` treats `withExif`/`withPeople` as meta keys

**Why:** `#canHandle` (ContentQueryService.mjs:604) decides whether an adapter handles a query by checking that each non-meta query key matches the adapter's declared capabilities. `withExif`/`withPeople` are not capabilities; without excluding them, a query whose only filter is an enrichment flag would skip the adapter. `#translateQuery` already passes unmapped keys through, so no change is needed there — only the capability gate.

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` (the `#canHandle` method, around line 604–614)
- Test: `tests/isolated/application/content/ContentQueryService.canHandle.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/application/content/ContentQueryService.canHandle.test.mjs`:

```javascript
import { describe, test, expect, vi } from 'vitest';
import { ContentQueryService } from '#apps/content/ContentQueryService.mjs';

function makeImmichLikeAdapter() {
  return {
    source: 'immich',
    getSearchCapabilities: () => ({ canonical: ['text', 'time', 'mediaType'], specific: [] }),
    getQueryMappings: () => ({ time: { from: 'takenAfter', to: 'takenBefore' } }),
    search: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  };
}

describe('ContentQueryService enrichment-flag handling', () => {
  test('a time query carrying withExif/withPeople still reaches the adapter', async () => {
    const adapter = makeImmichLikeAdapter();
    const registry = {
      get: () => adapter,
      resolveSource: () => [adapter],
    };
    const svc = new ContentQueryService({ registry });

    await svc.search({
      source: 'immich',
      time: { from: '2025-12-25', to: '2025-12-26' },
      withExif: true,
      withPeople: true,
    });

    expect(adapter.search).toHaveBeenCalledTimes(1);
    const passed = adapter.search.mock.calls[0][0];
    expect(passed.takenAfter).toBe('2025-12-25');
    expect(passed.takenBefore).toBe('2025-12-26');
    expect(passed.withExif).toBe(true);
    expect(passed.withPeople).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.canHandle.test.mjs`
Expected: FAIL — adapter is skipped because `withExif`/`withPeople` are treated as unsupported query keys (or `search` not called / passed without flags).

- [ ] **Step 3: Implement the meta-key exclusion**

In `backend/src/3_applications/content/ContentQueryService.mjs`, find `#canHandle`:

```javascript
  #canHandle(adapter, query) {
    const caps = adapter.getSearchCapabilities?.() ?? { canonical: [], specific: [] };
    const queryKeys = Object.keys(query).filter(k => !['source', 'take', 'skip', 'sort'].includes(k));
```

Change the exclusion list to also drop the enrichment flags:

```javascript
  #canHandle(adapter, query) {
    const caps = adapter.getSearchCapabilities?.() ?? { canonical: [], specific: [] };
    const META_KEYS = ['source', 'take', 'skip', 'sort', 'withExif', 'withPeople'];
    const queryKeys = Object.keys(query).filter(k => !META_KEYS.includes(k));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/content/ContentQueryService.canHandle.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/application/content/ContentQueryService.canHandle.test.mjs
git commit -m "feat(content): pass withExif/withPeople through capability gate"
```

---

### Task 4: `ImmichAdapter.#buildImmichQuery` — passthrough date + enrichment flags

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs` (the `#buildImmichQuery` method, lines 619–663)
- Test: `tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs` (the file already defines `mockHttpClient` with `get`/`post` vi.fns):

```javascript
describe('search date + enrichment passthrough', () => {
  test('forwards takenAfter/takenBefore and withExif/withPeople to Immich', async () => {
    mockHttpClient.post.mockResolvedValue({ data: { assets: { items: [], total: 0 } } });
    const adapter = new ImmichAdapter(
      { host: 'http://localhost:2283', apiKey: 'test-key' },
      { httpClient: mockHttpClient }
    );

    // Shape the adapter receives AFTER ContentQueryService translation (no text → assets-only path).
    await adapter.search({
      takenAfter: '2025-12-25',
      takenBefore: '2025-12-26',
      withExif: true,
      withPeople: true,
    });

    expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockHttpClient.post.mock.calls[0];
    expect(url).toContain('/api/search/metadata');
    expect(body.takenAfter).toBe('2025-12-25');
    expect(body.takenBefore).toBe('2025-12-26');
    expect(body.withExif).toBe(true);
    expect(body.withPeople).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: FAIL — `body.takenAfter` is `undefined` (current `#buildImmichQuery` ignores these keys).

- [ ] **Step 3: Implement the passthrough**

In `ImmichAdapter.mjs`, find `#buildImmichQuery`. After the existing `dateTo` block:

```javascript
    if (query.dateTo) {
      immichQuery.takenBefore = query.dateTo;
    }
```

Add:

```javascript
    // Canonical time filter arrives pre-translated as takenAfter/takenBefore
    // (ContentQueryService maps `time` → { takenAfter, takenBefore }). Forward verbatim.
    if (query.takenAfter) {
      immichQuery.takenAfter = query.takenAfter;
    }
    if (query.takenBefore) {
      immichQuery.takenBefore = query.takenBefore;
    }

    // Native Immich enrichment flags — forwarded so a single search call returns
    // full exifInfo and people/faces inline (no per-asset hydration).
    if (query.withExif) {
      immichQuery.withExif = true;
    }
    if (query.withPeople) {
      immichQuery.withPeople = true;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs
git commit -m "fix(immich): forward takenAfter/takenBefore + withExif/withPeople to search"
```

---

### Task 5: `ImmichAdapter` — curated `exif` block on items

**Why:** When Immich returns `exifInfo` (because `withExif` was forwarded, or on the per-asset detail path), surface a stable, source-neutral curated `exif` object instead of discarding everything but `capturedAt`/`city`. Keep the existing `capturedAt`/`location` fields for backward compatibility with current consumers (feed, canvas).

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs` (add `#curateExif` helper; use it in `#toListableItem` ~line 766 and `#toPlayableItem` ~line 816)
- Test: `tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to `tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`:

```javascript
describe('curated exif block', () => {
  const FULL_EXIF = {
    dateTimeOriginal: '2025-12-25T15:11:57.000Z',
    city: 'Lakeland South', state: 'Washington', country: 'United States of America',
    latitude: 47.292154, longitude: -122.310757,
    make: 'samsung', model: 'Galaxy S24', lensModel: null,
    fNumber: 1.8, iso: 160, exposureTime: '1/120', focalLength: 5.4,
    fileSizeInByte: 123456, orientation: '1', projectionType: null, // noise — must be dropped
  };

  test('getItem maps a curated exif subset (and drops noise fields)', async () => {
    mockHttpClient.get.mockResolvedValue({
      data: { id: 'abc-123', type: 'IMAGE', originalFileName: 'beach.jpg', width: 4624, height: 2604, exifInfo: FULL_EXIF, people: [] }
    });
    const adapter = new ImmichAdapter(
      { host: 'http://localhost:2283', apiKey: 'test-key' },
      { httpClient: mockHttpClient }
    );

    const result = await adapter.getItem('immich:abc-123');
    const exif = result.metadata.exif;

    expect(exif).toMatchObject({
      capturedAt: '2025-12-25T15:11:57.000Z',
      city: 'Lakeland South', state: 'Washington', country: 'United States of America',
      latitude: 47.292154, longitude: -122.310757,
      make: 'samsung', model: 'Galaxy S24',
      fNumber: 1.8, iso: 160, exposureTime: '1/120', focalLength: 5.4,
    });
    // Noise fields must NOT appear in the curated block.
    expect(exif.fileSizeInByte).toBeUndefined();
    expect(exif.projectionType).toBeUndefined();
  });

  test('omits exif block entirely when Immich returns no exifInfo', async () => {
    mockHttpClient.get.mockResolvedValue({
      data: { id: 'no-exif', type: 'IMAGE', originalFileName: 'x.jpg', width: 1, height: 1 }
    });
    const adapter = new ImmichAdapter(
      { host: 'http://localhost:2283', apiKey: 'test-key' },
      { httpClient: mockHttpClient }
    );
    const result = await adapter.getItem('immich:no-exif');
    expect(result.metadata.exif).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: FAIL — `result.metadata.exif` is `undefined`.

- [ ] **Step 3: Add the `#curateExif` helper and wire it into both mappers**

In `ImmichAdapter.mjs`, add this private method (place it next to the other `#to*` helpers, e.g. just above `#toListableItem`):

```javascript
  /**
   * Build a stable, curated EXIF subset from Immich's raw exifInfo.
   * Returns undefined when no exif is present so the field can be omitted entirely.
   * Individual null/undefined members are left in place; the API boundary strips them.
   * @param {Object|null|undefined} exifInfo
   * @returns {Object|undefined}
   */
  #curateExif(exifInfo) {
    if (!exifInfo || typeof exifInfo !== 'object') return undefined;
    return {
      capturedAt: exifInfo.dateTimeOriginal,
      city: exifInfo.city,
      state: exifInfo.state,
      country: exifInfo.country,
      latitude: exifInfo.latitude,
      longitude: exifInfo.longitude,
      make: exifInfo.make,
      model: exifInfo.model,
      lensModel: exifInfo.lensModel,
      fNumber: exifInfo.fNumber,
      iso: exifInfo.iso,
      exposureTime: exifInfo.exposureTime,
      focalLength: exifInfo.focalLength,
    };
  }
```

In `#toListableItem`, find the metadata object (around line 766) and add an `exif` entry alongside the existing `capturedAt`/`location` keys:

```javascript
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        exif: this.#curateExif(asset.exifInfo),
        favorite: asset.isFavorite,
```

In `#toPlayableItem`, find the matching metadata object (around line 826) and add the same `exif` entry:

```javascript
        capturedAt: asset.exifInfo?.dateTimeOriginal,
        location: asset.exifInfo?.city,
        exif: this.#curateExif(asset.exifInfo),
        favorite: asset.isFavorite,
```

Note: when `asset.exifInfo` is absent, `#curateExif` returns `undefined`. The object literal will carry `exif: undefined`; the `stripEmpty` boundary (Task 7) removes it. The Task 5 test "omits exif block" passes because `metadata.exif` is `undefined` either way (unit test asserts `toBeUndefined()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: PASS. Also run the faces test to confirm no regression: `npx vitest run "tests/isolated/adapter/content/gallery/immich/ImmichAdapter.faces.test.mjs"`

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs
git commit -m "feat(immich): surface curated exif block on gallery items"
```

---

### Task 6: `stripEmpty` utility

**Files:**
- Create: `backend/src/4_api/v1/utils/stripEmpty.mjs`
- Test: `tests/isolated/api/utils/stripEmpty.test.mjs` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/api/utils/stripEmpty.test.mjs`:

```javascript
import { describe, test, expect } from 'vitest';
import { stripEmpty } from '#api/v1/utils/stripEmpty.mjs';

describe('stripEmpty', () => {
  test('removes null, undefined, empty arrays, and empty objects', () => {
    const input = { a: 1, b: null, c: undefined, d: [], e: {}, f: 'keep' };
    expect(stripEmpty(input)).toEqual({ a: 1, f: 'keep' });
  });

  test('keeps falsy-but-meaningful values 0, false, and empty string', () => {
    const input = { zero: 0, no: false, blank: '' };
    expect(stripEmpty(input)).toEqual({ zero: 0, no: false, blank: '' });
  });

  test('recurses into nested objects and arrays', () => {
    const input = {
      metadata: { city: null, exif: { make: 'samsung', lensModel: null }, people: [] },
      items: [{ id: 'x', tag: null }, { id: 'y', notes: [] }],
    };
    expect(stripEmpty(input)).toEqual({
      metadata: { exif: { make: 'samsung' } },
      items: [{ id: 'x' }, { id: 'y' }],
    });
  });

  test('drops nested objects that become empty after stripping', () => {
    expect(stripEmpty({ a: { b: null }, keep: 1 })).toEqual({ keep: 1 });
  });

  test('returns primitives unchanged', () => {
    expect(stripEmpty('hi')).toBe('hi');
    expect(stripEmpty(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/api/utils/stripEmpty.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the utility**

Create `backend/src/4_api/v1/utils/stripEmpty.mjs`:

```javascript
// backend/src/4_api/v1/utils/stripEmpty.mjs

/**
 * True for values we treat as "empty" and remove from API responses:
 * null, undefined, [], and {}. Deliberately keeps 0, false, and '' —
 * those carry meaning (a zero count, an explicit false flag, an empty title).
 * @param {*} v
 * @returns {boolean}
 */
function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/**
 * Recursively remove empty members from objects and arrays to trim response
 * payloads. Returns a new structure; does not mutate the input. Primitives are
 * returned as-is.
 * @param {*} value
 * @returns {*}
 */
export function stripEmpty(value) {
  if (Array.isArray(value)) {
    return value
      .map(stripEmpty)
      .filter(v => !isEmpty(v));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const stripped = stripEmpty(v);
      if (!isEmpty(stripped)) out[k] = stripped;
    }
    return out;
  }
  return value;
}

export default stripEmpty;
```

Note: confirm the `#api` import alias resolves to `backend/src/4_api`. If the test errors with "Cannot find package '#api'", check `package.json` `imports` for the correct alias (e.g. `#api/*` → `backend/src/4_api/*`) and use that exact specifier in both the test and later importers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/api/utils/stripEmpty.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/4_api/v1/utils/stripEmpty.mjs tests/isolated/api/utils/stripEmpty.test.mjs
git commit -m "feat(api): add stripEmpty response trimmer"
```

---

### Task 7: Apply `stripEmpty` at the response boundary

**Why:** Strip empties from item payloads (where the noise lives) without breaking envelope contracts. The search/list envelopes keep their `items`/`total`/`sources` keys even when empty (clients depend on `items` being an array); only the per-item objects are trimmed. The `/info` response is a single item object, so it is trimmed whole.

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs` (import + `/query/search` response ~line 308, `/query/list` response ~line 420)
- Modify: `backend/src/4_api/v1/routers/info.mjs` (response ~line 205)
- Test: `tests/isolated/api/utils/stripEmpty.test.mjs` already covers the helper; behavior here is verified by the live runtime check in the Manual Verification section.

- [ ] **Step 1: Add the import to `content.mjs`**

At the top of `backend/src/4_api/v1/routers/content.mjs`, after the existing imports, add:

```javascript
import { stripEmpty } from '#api/v1/utils/stripEmpty.mjs';
```

(Use whatever specifier resolves to `backend/src/4_api/v1/utils/stripEmpty.mjs` per the alias confirmed in Task 6.)

- [ ] **Step 2: Trim items in the `/query/search` response**

In `content.mjs`, find the success response in the `/query/search` handler:

```javascript
      // Include perf in response for debugging (can be stripped in production)
      const { _perf, ...cleanResult } = result;
      res.json({
        query,
        ...cleanResult,
        _perf: { ...(_perf || {}), requestMs: totalMs },
      });
```

Replace with:

```javascript
      // Include perf in response for debugging (can be stripped in production)
      const { _perf, ...cleanResult } = result;
      res.json({
        query,
        ...cleanResult,
        items: (cleanResult.items || []).map(stripEmpty),
        _perf: { ...(_perf || {}), requestMs: totalMs },
      });
```

- [ ] **Step 3: Trim items in the `/query/list` response**

In `content.mjs`, find the `/query/list` success response:

```javascript
      const result = await contentQueryService.list(query);
      res.json({
        from: query.from,
        ...result
      });
```

Replace with:

```javascript
      const result = await contentQueryService.list(query);
      res.json({
        from: query.from,
        ...result,
        items: (result.items || []).map(stripEmpty),
      });
```

- [ ] **Step 4: Trim the `/info` response**

In `backend/src/4_api/v1/routers/info.mjs`, add the import near the other imports at the top:

```javascript
import { stripEmpty } from '#api/v1/utils/stripEmpty.mjs';
```

Then find the final `res.json(response);` in `handleInfoRequest` and replace with:

```javascript
    res.json(stripEmpty(response));
```

- [ ] **Step 5: Verify backend boots and isolated suite is green**

Run: `npx vitest run tests/isolated/api/utils/stripEmpty.test.mjs tests/isolated/adapter/content/gallery/immich/ImmichAdapter.test.mjs`
Expected: PASS. (Full boundary behavior is checked live in Manual Verification.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs backend/src/4_api/v1/routers/info.mjs
git commit -m "feat(api): strip empty fields from content + info responses"
```

---

### Task 8: Deprecate the legacy `/api/v1/content/search` endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/content.mjs` (the `/search` handler, ~line 450)

- [ ] **Step 1: Add deprecation headers + JSDoc**

In `content.mjs`, find the legacy `/search` handler:

```javascript
  router.get('/search', asyncHandler(async (req, res) => {
    // Parse sources filter
    const sourcesParam = req.query.sources;
```

Insert deprecation headers as the first statements inside the handler:

```javascript
  router.get('/search', asyncHandler(async (req, res) => {
    // DEPRECATED: superseded by /api/v1/content/query/search (unified query interface).
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Tue, 01 Sep 2026 00:00:00 GMT');
    res.set('Link', '</api/v1/content/query/search>; rel="successor-version"');

    // Parse sources filter
    const sourcesParam = req.query.sources;
```

Also update the JSDoc above the handler so the `@deprecated` line names the sunset date:

```javascript
   * @deprecated Use /api/v1/content/query/search instead. Sunset: 2026-09-01.
```

- [ ] **Step 2: Verify the header is emitted**

Run (requires the app running on the configured port — see CLAUDE.md dev server section):

```bash
curl -s -D - -o /dev/null "http://localhost:3111/api/v1/content/search?sources=immich&take=1" | grep -i -E "deprecation|sunset|link"
```

Expected output includes:
```
deprecation: true
sunset: Tue, 01 Sep 2026 00:00:00 GMT
link: </api/v1/content/query/search>; rel="successor-version"
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/content.mjs
git commit -m "chore(content): deprecate legacy /content/search with sunset headers"
```

---

### Task 9: Migrate the two runtime tests off the legacy endpoint

**Files:**
- Modify: `tests/live/flow/content/immich-video-playback.runtime.test.mjs` (~lines 62–96)
- Modify: `tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs` (~lines 62–96)

**Note:** The unified endpoint uses singular `source` and returns `{ query, items, total, sources }` — the same fields these tests already read (`data.total`, `data.items`, `data.sources`).

- [ ] **Step 1: Update the Immich video test request**

In `tests/live/flow/content/immich-video-playback.runtime.test.mjs`, change the request block:

```javascript
    const response = await request.get(`${BASE_URL}/api/v1/content/search`, {
      params: {
        sources: 'immich',
        mediaType: 'video',
        take: 1
      }
    });
```

to:

```javascript
    const response = await request.get(`${BASE_URL}/api/v1/content/query/search`, {
      params: {
        source: 'immich',
        mediaType: 'video',
        take: 1
      }
    });
```

Also update the adjacent `console.log` that prints the URL (search for `content/search` in the file and replace with `content/query/search`).

- [ ] **Step 2: Update the Audiobookshelf test request**

In `tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs`, change:

```javascript
    const response = await request.get(`${BASE_URL}/api/v1/content/search`, {
      params: {
        sources: 'abs',
        mediaType: 'audio',
        take: 1
      }
    });
```

to:

```javascript
    const response = await request.get(`${BASE_URL}/api/v1/content/query/search`, {
      params: {
        source: 'abs',
        mediaType: 'audio',
        take: 1
      }
    });
```

Also update the adjacent `console.log` URL string from `content/search` to `content/query/search`.

- [ ] **Step 3: Run both runtime tests**

Requires the dev server running (see CLAUDE.md). Run:

```bash
npx playwright test tests/live/flow/content/immich-video-playback.runtime.test.mjs tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs --reporter=line
```

Expected: PASS (or `skip` if the corresponding source has no media — but NOT fail). If a test now fails because the unified endpoint returns a different shape, inspect the response and reconcile — do not silently skip (CLAUDE.md Test Discipline).

- [ ] **Step 4: Commit**

```bash
git add tests/live/flow/content/immich-video-playback.runtime.test.mjs tests/live/flow/content/audiobookshelf-playback.runtime.test.mjs
git commit -m "test(content): migrate runtime search tests to unified query endpoint"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/reference/content/content-sources.md` (the `### immich` driver block, ~lines 162–170)

- [ ] **Step 1: Document date filtering + enrichment flags**

In `docs/reference/content/content-sources.md`, find the `### immich` section:

```markdown
### immich

Connects to an Immich photo/video management server.

- **Protocol**: Remote HTTP API
- **Formats produced**: `image`, `video`
- **Capabilities**: `playable`, `listable`, `displayable`, `searchable`
- **Multi-instance**: Yes
- **Config**: host, API key, albums
```

Append these bullets to that list:

```markdown
- **Date filtering**: `time` accepts a single day (`2025-12-25`), month (`2025-12`), year (`2025`), or range (`2024..2025`). A single day expands to a same-day window. Date filters are forwarded to Immich as `takenAfter`/`takenBefore`.
- **Rich metadata (opt-in)**: add `withExif=1` and/or `withPeople=1` to a `query/search` request. These pass straight through to Immich's `/api/search/metadata`, so exif and people/faces come back in a single call (no per-asset hydration). Output is normalized into a curated `metadata.exif` block (`capturedAt, city, state, country, latitude, longitude, make, model, lensModel, fNumber, iso, exposureTime, focalLength`) and `metadata.people` (with face bounding boxes). Tags are not available on the search path.
- **Empty fields**: `null`/`[]`/`{}` members are stripped from item payloads at the API boundary to reduce response size.
```

- [ ] **Step 2: Update the docs freshness marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/content/content-sources.md docs/docs-last-updated.txt
git commit -m "docs(content): document Immich date filtering + enrichment flags"
```

---

## Manual Verification (after all tasks)

Run against the live app (dev server on the configured port). These prove the end-to-end behavior the unit tests can't (real Immich):

- [ ] **Date filter now works on the unified endpoint** (was returning a 1968 video for every date):

```bash
curl -s "http://localhost:3111/api/v1/content/query/search?source=immich&time=2025-12-25&take=3" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print([i['title'] for i in d['items']])"
```
Expected: titles dated 2025-12-25 (e.g. `2025-12-25 15.11.57.jpg`), NOT the 1968 film.

- [ ] **Enrichment returns curated exif + people in one call:**

```bash
curl -s "http://localhost:3111/api/v1/content/query/search?source=immich&time=2025-12-25&withExif=1&withPeople=1&take=3" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);m=d['items'][0]['metadata'];print('exif:',m.get('exif'));print('people:',m.get('people'))"
```
Expected: `exif` dict with gps/city/make/model present; `people` present when faces exist.

- [ ] **Empty fields are gone** (no `location: null`, no `people: []` when absent):

```bash
curl -s "http://localhost:3111/api/v1/content/query/search?source=immich&time=2025-12-25&take=3" \
  | grep -E '"(location|people|parentTitle)":\s*(null|\[\])' && echo "FAIL: empties present" || echo "OK: no empties"
```
Expected: `OK: no empties`.

- [ ] **Legacy endpoint still works but warns:**

```bash
curl -s -D - -o /dev/null "http://localhost:3111/api/v1/content/search?sources=immich&take=1" | grep -i sunset
```
Expected: `sunset: Tue, 01 Sep 2026 00:00:00 GMT`.

---

## Self-Review Notes

- **Spec coverage:** beef up real endpoint (Tasks 1,3,4 — date fix end-to-end) ✓; retire old (Tasks 8,9 — deprecate + migrate callers) ✓; rich Immich metadata via optional flags (Tasks 2,4,5 — `withExif`/`withPeople` passthrough + curated exif) ✓; strip null/empty (Tasks 6,7) ✓.
- **Type consistency:** flag names `withExif`/`withPeople` identical across parser, service, adapter, docs. Curated exif keys identical between Task 5 implementation, Task 5 test, and Task 10 docs.
- **Out of scope (documented):** Immich tags (absent from search responses; would require per-asset N+1). Legacy endpoint deletion (deferred to post-sunset follow-up).
```

