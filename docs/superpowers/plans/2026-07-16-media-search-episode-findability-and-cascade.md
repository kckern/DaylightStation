# Media Search: Episode Findability + Failure-Cascade Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exact-title episodes findable in Media search again, and stop the empty-result cascade (Immich crash, guaranteed-404 freeform dispatch) that turned a missed search into a stuck player.

**Architecture:** Four independent defects from the 2026-07-16 incident, each a self-contained fix with its own unit test. Task 1 (Plex tier-1 episode filter) is the headline cause — it alone would have made the incident invisible. Tasks 2–4 harden the sources and prevent the cascade. All changes are backend except Task 3 (frontend combobox).

**Tech Stack:** Node ESM (`.mjs`) backend, Vitest, React 18 frontend (Mantine combobox), all tests run via the root `vitest.config.mjs`.

**Source bug report:** `docs/_wip/bugs/2026-07-16-media-search-episode-unfindable-freeform-404-spinner.md`

## Global Constraints

- **Test runner (backend + frontend):** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` from repo root (`/opt/Code/DaylightStation`). The root config supplies the React plugin + `#adapters/*` aliases and works for both `.mjs` and `.jsx` tests.
- **Backend import alias:** `#adapters/*` → `backend/src/1_adapters/*` (see `package.json:61`). Use it in tests.
- **TDD required:** failing test first, verify it fails, minimal implementation, verify it passes, commit. One logical fix per commit.
- **Preserve existing behavior:** admin content-list editors rely on the freeform "raw value" row and on tier-1 container/track results. Do not remove those; only add episodes and gate freeform behind an opt-out prop that defaults to the current behavior.
- **No deploy in this plan.** Building/deploying to prod is a separate, gated step (garage-in-use check). This plan ends at green tests + commits.

---

## File Structure

- `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs` — add `episode` to tier-1 default types + a no-hydration episode→PlayableItem converter (Task 1).
- `backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs` — type-guard `parseDuration` (Task 2).
- `frontend/src/modules/Content/combobox/ContentCombobox.jsx` — add `allowFreeform` prop gating the raw-value row (Task 3).
- `frontend/src/modules/Media/search/MediaContentSearch.jsx` — pass `allowFreeform={false}` (Task 3).
- `backend/src/3_applications/content/ContentQueryService.mjs` — add per-source elapsed timings to `searchStream.complete` log (Task 4).
- Tests:
  - `tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs` (new, Task 1)
  - `tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs` (new, Task 2)
  - `frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx` (new, Task 3)
  - `tests/isolated/applications/content/ContentQueryService.timings.test.mjs` (new, Task 4)

---

## Deferred to a follow-up plan (NOT in scope here)

These two incident findings need their own investigation and are intentionally **out of scope**; do not attempt them in this plan:

- **S1 — unencoded contentId in the play URL** (`frontend/src/modules/Player/lib/api.js:60,68`): blanket `encodeURIComponent` is unsafe because the `/play/:source/*splat` route treats `:` and `/` as structural. With Task 3 landed, un-resolvable freeform text no longer reaches this path, which removes the observed trigger. A proper encode-preserving-structure fix belongs in a dedicated Player-URL plan.
- **S2 — loading overlay spins on "Starting…" forever after `queue-init-empty`**: `useQueueController` already fires `onError({ kind: 'empty-queue' })` (`useQueueController.js:252-259`), but `PlayerOverlayLoading` in the 1200-line `Player.jsx` does not dismiss on it. Root-causing the overlay lifecycle is its own effort. File a follow-up.

---

## Task 1: Plex tier-1 search surfaces episodes

**Root cause RC1.** `search()` runs `hubSearch` (which returns episodes) then filters tier-1 results to `['show','movie','artist','album','collection','track']` — `episode` is excluded and nothing in the search-stream path requests tier 2, so exact-title episodes are structurally unfindable.

**Files:**
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs:1844` (add `'episode'` to `TIER1_DEFAULT_TYPES`), `:1849-1853` (route episodes to a new converter), and add `_hubResultToEpisodeItem` near `_hubResultToTrackItem` (`:1967`).
- Test: `tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs` (create)

**Interfaces:**
- Consumes: `PlexAdapter` constructor `new PlexAdapter({ host, token }, { httpClient })`; the instance's `client` is a `PlexClient` whose `hubSearch(text, opts)` returns `{ results: [...] }` and whose `getContainer('/playlists/all')` returns a `MediaContainer`. Tests stub both.
- Produces: `_hubResultToEpisodeItem(item) → PlayableItem` with `id: 'plex:<ratingKey>'`, `mediaType: 'video'`, `mediaUrl: '/api/v1/proxy/plex/stream/<ratingKey>'`, and `metadata` carrying `type:'episode'`, `parentTitle` (season) and `grandparentTitle` (show) from the hub result's `parent`/`grandparent` fields. Episodes appear in tier-1 `search()` output.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { PlexAdapter } from '#adapters/content/media/plex/PlexAdapter.mjs';

// Build an adapter whose PlexClient is stubbed to return one episode hub result
// and no playlists. Mirrors the real "Think! How Intelligent Are Animals?" case.
function adapterWithEpisodeHit() {
  const a = new PlexAdapter({ host: 'http://x', token: 't' }, { httpClient: { get: async () => ({}) } });
  a.client = {
    hubSearch: async () => ({
      results: [{
        ratingKey: '381439',
        type: 'episode',
        title: 'Think! How Intelligent Are Animals?',
        parent: 'Season 1',
        grandparent: 'Zoology: Understanding the Animal World',
        year: 2022,
        thumb: '/library/metadata/381439/thumb',
        librarySectionID: '3',
        librarySectionTitle: 'Science',
      }],
    }),
    // No playlists in this scenario.
    getContainer: async () => ({ MediaContainer: { Metadata: [] } }),
  };
  return a;
}

describe('PlexAdapter tier-1 search — episodes', () => {
  it('returns an exact-title episode as a playable leaf', async () => {
    const a = adapterWithEpisodeHit();
    const { items } = await a.search({ text: 'Think! How Intelligent Are Animals?' });
    const ep = items.find(i => i.id === 'plex:381439');
    expect(ep).toBeTruthy();
    expect(ep.title).toBe('Think! How Intelligent Are Animals?');
    expect(ep.metadata.type).toBe('episode');
    expect(ep.metadata.grandparentTitle).toBe('Zoology: Understanding the Animal World');
    expect(ep.mediaUrl).toBe('/api/v1/proxy/plex/stream/381439');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs`
Expected: FAIL — `ep` is `undefined` (episode filtered out by tier-1 type list).

- [ ] **Step 3: Add the episode converter**

In `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`, immediately after `_hubResultToTrackItem` (ends at `:1991`), add:

```javascript
  /**
   * Convert a hubSearch episode result to a PlayableItem without hydration.
   * Mirrors _hubResultToTrackItem: keeps tier 1 fast (no getItem call) while
   * carrying show/season context so the UI can disambiguate the episode.
   * PlexClient.hubSearch flattens parentTitle → parent (season) and
   * grandparentTitle → grandparent (show).
   * @param {Object} item - Raw hubSearch result of type 'episode'
   * @returns {PlayableItem}
   * @private
   */
  _hubResultToEpisodeItem(item) {
    const thumbPath = item.thumb || item.grandparentThumb || item.parentThumb;
    return new PlayableItem({
      id: `plex:${item.ratingKey}`,
      source: 'plex',
      localId: String(item.ratingKey),
      title: item.title || '[Untitled]',
      mediaType: 'video',
      mediaUrl: `/api/v1/proxy/plex/stream/${item.ratingKey}`,
      resumable: true,
      thumbnail: thumbPath ? `${this.proxyPath}${thumbPath}` : null,
      metadata: {
        type: 'episode',
        category: this.#mapTypeToCategory('episode'),
        year: item.year || null,
        librarySectionTitle: item.librarySectionTitle || null,
        parentTitle: item.parent || null,
        grandparentTitle: item.grandparent || null,
      },
    });
  }
```

- [ ] **Step 4: Add `episode` to the tier-1 type list and route it**

In the same file, change the tier-1 default types (`:1844`) from:

```javascript
        const TIER1_DEFAULT_TYPES = ['show', 'movie', 'artist', 'album', 'collection', 'track'];
```

to:

```javascript
        const TIER1_DEFAULT_TYPES = ['show', 'movie', 'artist', 'album', 'collection', 'track', 'episode'];
```

Then update the converter dispatch (`:1849-1853`) from:

```javascript
        const converted = filtered.map(item => (
          item.type === 'track'
            ? this._hubResultToTrackItem(item)
            : this._hubResultToListableItem(item)
        ));
```

to:

```javascript
        const converted = filtered.map(item => {
          if (item.type === 'track') return this._hubResultToTrackItem(item);
          if (item.type === 'episode') return this._hubResultToEpisodeItem(item);
          return this._hubResultToListableItem(item);
        });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs`
Expected: PASS (1 passed).

- [ ] **Step 6: Run the existing Plex isolated suite for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapters/plex/`
Expected: PASS (all files green — the curriculum tests and any others unaffected).

- [ ] **Step 7: Commit**

```bash
git add backend/src/1_adapters/content/media/plex/PlexAdapter.mjs tests/isolated/adapters/plex/PlexAdapter.search-episode.test.mjs
git commit -m "fix(plex-search): surface episodes in tier-1 search (RC1)

Exact-title episodes were filtered out of tier-1 hub-search results because
episode was absent from TIER1_DEFAULT_TYPES and nothing requests tier 2 in
the search-stream path. Add a no-hydration episode->PlayableItem converter and
include episode in the default type list.

Ref docs/_wip/bugs/2026-07-16-media-search-episode-unfindable-freeform-404-spinner.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: ImmichClient.parseDuration tolerates non-string duration

**Root cause RC2.** `parseDuration` calls `durationStr.split(':')` and throws `durationStr.split is not a function` when Immich returns a non-string `duration` (number/object across API versions). One bad asset kills the entire Immich source for the query.

**Files:**
- Modify: `backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs:313-320` (`parseDuration`)
- Test: `tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs` (create)

**Interfaces:**
- Consumes: `new ImmichClient({ host, apiKey }, { httpClient })` — constructor requires `host`, `apiKey`, and `deps.httpClient` or it throws (`ImmichClient.mjs:22-46`). `parseDuration` is a public method.
- Produces: `parseDuration(value)` returns `null` for nullish/empty/`'0:00:00.00000'`/objects/NaN; returns the integer second count for a valid `"HH:MM:SS.mmm"` string; returns a rounded integer when passed a finite number (already-seconds). Never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { ImmichClient } from '#adapters/content/gallery/immich/ImmichClient.mjs';

function client() {
  return new ImmichClient(
    { host: 'http://immich', apiKey: 'k' },
    { httpClient: { get: async () => ({ data: {} }) } }
  );
}

describe('ImmichClient.parseDuration', () => {
  const c = client();

  it('parses a valid HH:MM:SS.mmm string to seconds', () => {
    expect(c.parseDuration('0:01:30.00000')).toBe(90);
  });

  it('returns null for the zero-duration sentinel and empty input', () => {
    expect(c.parseDuration('0:00:00.00000')).toBeNull();
    expect(c.parseDuration('')).toBeNull();
    expect(c.parseDuration(null)).toBeNull();
    expect(c.parseDuration(undefined)).toBeNull();
  });

  it('does NOT throw on a non-string duration (the RC2 crash)', () => {
    expect(() => c.parseDuration(90)).not.toThrow();
    expect(() => c.parseDuration({})).not.toThrow();
    expect(() => c.parseDuration([1, 2, 3])).not.toThrow();
  });

  it('coerces a finite number to a rounded second count', () => {
    expect(c.parseDuration(90)).toBe(90);
    expect(c.parseDuration(90.7)).toBe(91);
  });

  it('returns null for non-string, non-number inputs', () => {
    expect(c.parseDuration({})).toBeNull();
    expect(c.parseDuration(NaN)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs`
Expected: FAIL — the "does NOT throw" case throws `durationStr.split is not a function`.

- [ ] **Step 3: Add the type guard**

In `backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs`, replace `parseDuration` (`:313-320`) with:

```javascript
  parseDuration(durationStr) {
    if (!durationStr || durationStr === '0:00:00.00000') return null;
    // Immich has returned duration as a raw number (seconds) in some API
    // versions — accept it directly instead of crashing on .split().
    if (typeof durationStr === 'number') {
      return Number.isFinite(durationStr) ? Math.round(durationStr) : null;
    }
    if (typeof durationStr !== 'string') return null;
    const parts = durationStr.split(':');
    if (parts.length !== 3) return null;
    const [h, m, rest] = parts;
    const [s] = rest.split('.');
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/content/gallery/immich/ImmichClient.mjs tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs
git commit -m "fix(immich): parseDuration tolerates non-string duration (RC2)

A non-string asset.duration threw 'durationStr.split is not a function',
killing the entire Immich source mid-search. Guard by type: coerce finite
numbers to rounded seconds, return null for anything else.

Ref docs/_wip/bugs/2026-07-16-media-search-episode-unfindable-freeform-404-spinner.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Suppress the freeform "raw value" row in dispatch-to-play contexts

**Root cause RC4.** The combobox's "Use … as raw value" row bypasses resolution by design (a power-user id-entry path in admin editors). In Media search it was the only actionable row after an empty result, so a normal user clicked it and the raw English title was dispatched to the play pipeline → `Unknown source` 404. Gate the row behind an opt-out prop and turn it off in `MediaContentSearch`.

**Files:**
- Modify: `frontend/src/modules/Content/combobox/ContentCombobox.jsx:91-99` (add `allowFreeform = true` prop), `:511` (`showFreeform` includes `allowFreeform`), and `:703-710` (empty-state copy no longer promises the raw-value row when it's disabled).
- Modify: `frontend/src/modules/Media/search/MediaContentSearch.jsx` (pass `allowFreeform={false}` to `ContentCombobox`).
- Test: `frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx` (create)

**Interfaces:**
- Consumes: `ContentCombobox` props object (`:91`). Adds one optional prop `allowFreeform` (boolean, default `true` — preserves current admin behavior).
- Produces: When `allowFreeform={false}`, the `data-testid="freeform-commit-option"` row never renders and the empty-state text does not mention "Use as raw value". When omitted/`true`, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ContentCombobox } from './ContentCombobox.jsx';

// The combobox drives search through useContentCombobox; for this test we only
// need to reach the "typed 2+ chars, no results" state so the freeform row's
// visibility can be asserted. Mock the hook to a deterministic no-results state.
vi.mock('./useContentCombobox.js', () => ({
  useContentCombobox: ({ value, onChange }) => ({
    state: {
      mode: 'SEARCH',
      search: 'think',
      results: [],
      browse: { items: [], breadcrumbs: [], pagination: null, loading: false },
      highlight: { idx: -1 },
    },
    dispatch: () => {},
    handleInput: () => {},
    activeScope: null,
    clearScope: () => {},
    openWithSiblings: () => {},
    drill: () => {},
    goUp: () => {},
    goToCrumb: () => {},
    paginate: () => {},
    handleClose: () => {},
    select: () => {},
    commit: () => {},
    resolvedTitle: null,
    isSearching: false,
    pendingSources: [],
    sourceErrors: [],
    truncatedAt: null,
  }),
}));

function renderCombobox(props) {
  return render(
    <MantineProvider>
      <ContentCombobox value="" onChange={() => {}} {...props} />
    </MantineProvider>
  );
}

describe('ContentCombobox freeform gating', () => {
  it('renders the raw-value row by default (admin behavior)', () => {
    renderCombobox({});
    // Open the dropdown by focusing the input so options render.
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(screen.queryByTestId('freeform-commit-option')).toBeTruthy();
  });

  it('hides the raw-value row when allowFreeform={false}', () => {
    renderCombobox({ allowFreeform: false });
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.click(input);
    expect(screen.queryByTestId('freeform-commit-option')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx`
Expected: FAIL — the second case still finds the freeform row (prop not yet honored). If the exact open interaction doesn't surface options in jsdom, adjust the focus/click in Step 1 to match how the sibling `ContentCombobox.test.jsx` opens the dropdown (read that file for the working pattern) before proceeding — the assertion (row present by default, absent when gated) stays the same.

- [ ] **Step 3: Add the `allowFreeform` prop and gate the row**

In `frontend/src/modules/Content/combobox/ContentCombobox.jsx`, add the prop to the destructure (`:91-99`):

```jsx
export function ContentCombobox({
  value,
  onChange,
  placeholder = 'Search content...',
  selectContainers = false,
  searchParams = '',
  appResults = false,
  renderValue = null,
  allowFreeform = true,
}) {
```

Change `showFreeform` (`:511`) from:

```jsx
  const showFreeform = !!search && search !== value && !isBrowse && search.length >= 2;
```

to:

```jsx
  const showFreeform = allowFreeform && !!search && search !== value && !isBrowse && search.length >= 2;
```

Change the empty-state copy (`:707-709`) so it only promises the raw-value row when it exists:

```jsx
                  : (!search || search.length < 2)
                    ? 'Type to search...'
                    : (allowFreeform
                        ? 'No results — select “Use as raw value” or press Enter'
                        : 'No results')}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx`
Expected: PASS (both cases).

- [ ] **Step 5: Wire MediaContentSearch to disable freeform**

In `frontend/src/modules/Media/search/MediaContentSearch.jsx`, find the `<ContentCombobox ... />` usage and add `allowFreeform={false}` to its props. (The component is rendered below the scope `<select>`; it currently passes `value=""`, `onChange={handleChange}`, `selectContainers={false}`, and a `searchParams` passthrough — add the new prop alongside them.)

- [ ] **Step 6: Run the existing combobox suite for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Content/combobox/`
Expected: PASS — existing `ContentCombobox.test.jsx` (which relies on the default freeform behavior) stays green because `allowFreeform` defaults to `true`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/modules/Content/combobox/ContentCombobox.jsx frontend/src/modules/Media/search/MediaContentSearch.jsx frontend/src/modules/Content/combobox/ContentCombobox.freeform.test.jsx
git commit -m "fix(media-search): gate freeform raw-value row behind allowFreeform (RC4)

The raw-value row bypasses resolution by design (admin id-entry path). In
Media search it was the only actionable row after an empty result, so raw
title text got dispatched to /play -> 'Unknown source' 404. Add an
allowFreeform prop (default true) and disable it in MediaContentSearch.

Ref docs/_wip/bugs/2026-07-16-media-search-episode-unfindable-freeform-404-spinner.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Instrument per-source search timings

**Root cause RC3 (observability).** `files` (5s), `abs` (6s), `singalong` (8s) all timed out and the stream's `totalMs` (8039) equalled the slowest ceiling, but the completion log records only `totalMs` — we can't tell whether stragglers are endemic or cold-start. Add per-source elapsed to the `searchStream.complete` log so Open Question Q1 in the bug report becomes answerable from prod logs. No behavior change.

**Files:**
- Modify: `backend/src/3_applications/content/ContentQueryService.mjs` — `searchStream` (adapter promise creation `:282-296`, completion log `:365-372`).
- Test: `tests/isolated/applications/content/ContentQueryService.timings.test.mjs` (create)

**Interfaces:**
- Consumes: `ContentQueryService` `searchStream(query)` async generator, yielding `{event:'results'|'complete', ...}`. It calls each adapter's `search(translated)` under `withTimeout`.
- Produces: the final `content-query.searchStream.complete` log payload gains `sourceTimings: { <source>: <ms>, ... }` (integer ms per adapter, whether it resolved or timed out). The yielded `complete` event is unchanged.

- [ ] **Step 1: Read the current searchStream to place the timing capture**

Read `backend/src/3_applications/content/ContentQueryService.mjs:236-375`. Confirm: adapter promises are built at `:282-296`; `performance.now()` is already imported/used (`searchStart` at the top of the method, `totalMs` at `:357`). The per-adapter `search()` await is at `:289`.

- [ ] **Step 2: Write the failing test**

Create `tests/isolated/applications/content/ContentQueryService.timings.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { ContentQueryService } from '#applications/content/ContentQueryService.mjs';

// Minimal fake adapters: one fast, one that rejects (simulating a timeout-ish
// failure). We assert the completion log carries a per-source timing map.
function fakeAdapter(source, behavior) {
  return {
    source,
    canHandle: () => true,
    search: behavior,
  };
}

describe('ContentQueryService.searchStream per-source timings', () => {
  it('logs sourceTimings for every adapter in searchStream.complete', async () => {
    const logs = [];
    const logger = { info: (evt, data) => logs.push({ evt, data }) };

    const svc = new ContentQueryService({
      adapters: [
        fakeAdapter('plex', async () => ({ items: [{ id: 'plex:1', title: 'A' }], total: 1 })),
        fakeAdapter('files', async () => { throw new Error('files timeout after 5000ms'); }),
      ],
      logger,
    });

    // Drain the async generator.
    const events = [];
    for await (const ev of svc.searchStream({ text: 'x' })) events.push(ev);

    const complete = logs.find(l => l.evt === 'content-query.searchStream.complete');
    expect(complete).toBeTruthy();
    expect(complete.data.sourceTimings).toBeTruthy();
    expect(typeof complete.data.sourceTimings.plex).toBe('number');
    expect(typeof complete.data.sourceTimings.files).toBe('number');
  });
});
```

Note: the `ContentQueryService` constructor signature and `#canHandle` contract must match what the real class expects. Before writing the implementation, read the constructor and `#canHandle`/`#translateQuery` (`ContentQueryService.mjs:30-59, 280-296`) and adjust the fake adapters / constructor args in this test to match the real deps shape (e.g. it may expect `adapterTimeoutMs`, `sourceTimeoutsMs`, or a specific adapter interface). Keep the assertion (a numeric `sourceTimings[source]` per adapter) intact.

- [ ] **Step 3: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/applications/content/ContentQueryService.timings.test.mjs`
Expected: FAIL — `complete.data.sourceTimings` is `undefined`.

- [ ] **Step 4: Capture per-source elapsed and add to the log**

In `searchStream`, add a timings accumulator and record each adapter's elapsed. In the adapter promise map (`:282-296`), wrap the timed section:

```javascript
    const sourceTimings = {};
    // Create promises for all adapters
    const adapterPromises = adapters.map(async (adapter) => {
      if (!this.#canHandle(adapter, query)) {
        return { adapter, result: null, skipped: true };
      }

      const startedAt = performance.now();
      try {
        const translated = this.#translateQuery(adapter, query);
        const result = await withTimeout(adapter.search(translated), this.#timeoutFor(adapter.source), adapter.source);
        sourceTimings[adapter.source] = Math.round(performance.now() - startedAt);
        return { adapter, result, error: null };
      } catch (error) {
        sourceTimings[adapter.source] = Math.round(performance.now() - startedAt);
        warnings.push({ source: adapter.source, error: error.message });
        return { adapter, result: null, error };
      }
    });
```

Then add `sourceTimings` to `logData` (`:365-370`):

```javascript
    const logData = {
      query: { text: query.text, source: query.source },
      totalMs,
      adapterCount: adapters.length,
      sourceTimings,
      ...(resolvedIntent && { intent: resolvedIntent })
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/applications/content/ContentQueryService.timings.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the content application/adapter isolated suites for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/adapter/content/ tests/isolated/adapters/content/`
Expected: PASS (no behavior change; only an added log field).

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/content/ContentQueryService.mjs tests/isolated/applications/content/ContentQueryService.timings.test.mjs
git commit -m "feat(content-search): log per-source timings in searchStream.complete (RC3)

Only totalMs was recorded, so we couldn't tell whether files/abs/singalong
timeouts are endemic or cold-start. Record per-adapter elapsed ms (resolved or
failed) and emit it as sourceTimings on the completion log. No behavior change.

Ref docs/_wip/bugs/2026-07-16-media-search-episode-unfindable-freeform-404-spinner.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all four tasks)

- [ ] **Run every new + touched suite together:**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  tests/isolated/adapters/plex/ \
  tests/isolated/adapters/content/gallery/immich/ImmichClient.parseDuration.test.mjs \
  tests/isolated/applications/content/ContentQueryService.timings.test.mjs \
  frontend/src/modules/Content/combobox/
```
Expected: all green.

- [ ] **CLI ground-truth re-check (optional, confirms the item still exists):**

```bash
node cli/plex.cli.mjs search "Think! How Intelligent Are Animals?" --deep
```
Expected: `[381439] Think! How Intelligent Are Animals?` (episode).

- [ ] **Note for the human:** live end-to-end verification (type the episode title in the Media app, confirm it appears and dispatches to the player without a 404/stuck spinner) requires a build + deploy, which is gated on the garage-not-in-use check and is intentionally out of this plan's scope.

---

## Self-Review

**Spec coverage vs. the bug report's root causes:**
- RC1 (episodes unfindable) → Task 1 ✅ (headline fix)
- RC2 (Immich parseDuration crash) → Task 2 ✅
- RC3 (straggler timeouts, no per-source data) → Task 4 ✅ (instrumentation; the deeper "why are they slow" fix is unblocked by this data, deferred to Q1 follow-up)
- RC4 (freeform row dispatched raw text) → Task 3 ✅
- S1 (unencoded contentId URL) → **deferred** (documented; mitigated by Task 3 removing the trigger)
- S2 (immortal loading spinner) → **deferred** (documented; needs Player.jsx overlay-lifecycle investigation)

**Type consistency:** `_hubResultToEpisodeItem` returns `PlayableItem` (imported and used by the sibling `_hubResultToTrackItem`); the dispatch in Task 1 Step 4 references exactly that method name. `allowFreeform` is spelled identically in the prop, `showFreeform`, empty-state copy, and `MediaContentSearch`. `sourceTimings` is spelled identically in the accumulator, `logData`, and the test assertion.

**Placeholder scan:** no TBD/TODO; every code step shows the full code. Two steps (Task 3 Step 2, Task 4 Step 2) instruct the implementer to reconcile a mock against the real hook/constructor before implementing — this is deliberate verification guidance, not a content placeholder; the assertions and target APIs are fully specified.
