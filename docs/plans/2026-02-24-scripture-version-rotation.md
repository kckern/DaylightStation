# Scripture Version Rotation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `curl http://localhost:3112/api/v1/queue/scriptures2026` return this week's unwatched chapters first, then past weeks' unwatched, then version-recycled items — with the correct audio/text version resolved at play time.

**Architecture:** The ListAdapter rewrites version-agnostic content IDs (`scriptures:1`) to versioned IDs (`scriptures:esv-music/1`) before handing them to the existing adapter chain. Version selection is driven by `metadata.versions` in the watchlist YAML and per-version watch-state queries. The ScriptureResolver's existing 2-segment smart detection handles audio-only slugs, with a small enhancement to derive matching text editions.

**Tech Stack:** Node.js ESM, YAML config, Vitest for tests

**Design doc:** `docs/plans/2026-02-24-scripture-watchlist-2026-design.md`

**Exit criteria:** `curl http://localhost:3112/api/v1/queue/scriptures2026` returns items in priority cascade order: unwatched current week → unwatched past weeks → partial (version-recycled) current week → partial past weeks.

---

### Task 1: ScriptureResolver — `deriveTextFromAudio` helper

**Files:**
- Modify: `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs` (lines 222–236, the 2-segment smart detection branch)
- Test: `tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs` (create)

**Context:** When the ListAdapter rewrites `scriptures:1` → `scriptures:esv-music/1`, the resolver receives `esv-music/1` as a 2-segment input. The current smart detection correctly identifies `esv-music` as audio-only (not a text dir). But for text, it falls back to `volumeDefaults.text` (kjvf). We want ESV text to match ESV audio.

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs
import { describe, it, expect, vi } from 'vitest';

// We need to mock the filesystem checks (isTextDir, isAudioDir, dirExists)
// The ScriptureResolver is a plain object export, so we test resolve() directly
// by providing paths where we control what "exists"

describe('ScriptureResolver — deriveTextFromAudio', () => {
  it('derives esv text from esv-music audio slug', async () => {
    // Import the resolver
    const { ScriptureResolver } = await import(
      '#adapters/content/readalong/resolvers/scripture.mjs'
    );

    // We need real dirs for isTextDir/isAudioDir checks.
    // Use the actual data paths since this is an isolated test that reads filesystem.
    const dataPath = process.env.DAYLIGHT_DATA_PATH
      ? `${process.env.DAYLIGHT_DATA_PATH}/content/readalong/scripture`
      : null;
    const mediaPath = process.env.DAYLIGHT_MEDIA_PATH
      ? `${process.env.DAYLIGHT_MEDIA_PATH}/audio/readalong/scripture`
      : null;

    // Skip if paths not available (CI without data)
    if (!dataPath || !mediaPath) {
      console.log('SKIP: data paths not configured');
      return;
    }

    const result = ScriptureResolver.resolve('esv-music/1', dataPath, {
      mediaPath,
      defaults: { ot: { text: 'kjvf', audio: 'kjv-maxmclean' } },
      audioDefaults: { kjvf: 'kjv-maxmclean' }
    });

    expect(result).toBeTruthy();
    expect(result.volume).toBe('ot');
    expect(result.verseId).toBe('1');
    expect(result.audioRecording).toBe('esv-music');
    // Key assertion: text should be 'esv' (derived), not 'kjvf' (default)
    expect(result.textVersion).toBe('esv');
    expect(result.textPath).toBe('ot/esv/1');
    expect(result.audioPath).toBe('ot/esv-music/1');
  });

  it('falls back to volume default when suffix-strip finds no text dir', async () => {
    const { ScriptureResolver } = await import(
      '#adapters/content/readalong/resolvers/scripture.mjs'
    );

    // Use a fake audio slug where stripping suffix doesn't yield a text dir
    // "kjv-glyn" — stripping nothing (no -music/-dramatized suffix) → stays kjv-glyn
    const dataPath = process.env.DAYLIGHT_DATA_PATH
      ? `${process.env.DAYLIGHT_DATA_PATH}/content/readalong/scripture`
      : null;
    const mediaPath = process.env.DAYLIGHT_MEDIA_PATH
      ? `${process.env.DAYLIGHT_MEDIA_PATH}/audio/readalong/scripture`
      : null;

    if (!dataPath || !mediaPath) return;

    const result = ScriptureResolver.resolve('kjv-glyn/1', dataPath, {
      mediaPath,
      defaults: { ot: { text: 'kjvf', audio: 'kjv-maxmclean' } },
      audioDefaults: {}
    });

    expect(result).toBeTruthy();
    expect(result.audioRecording).toBe('kjv-glyn');
    // No -music/-dramatized suffix to strip, so text falls back to default
    expect(result.textVersion).toBe('kjvf');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs`
Expected: FAIL — `textVersion` is `'kjvf'` (default) instead of `'esv'`

**Step 3: Write the implementation**

In `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs`, add the helper function before `ScriptureResolver`:

```javascript
/**
 * Derive a text edition slug from an audio recording slug.
 * Convention: strip common audio suffixes (-music, -dramatized) and check
 * if the base slug has a matching text directory.
 * @param {string} audioSlug - Audio recording slug (e.g., 'esv-music')
 * @param {string} dataPath - Base data path
 * @param {string} volume - Volume name (ot, nt, etc.)
 * @returns {string|null} Matching text slug, or null if no match found
 */
function deriveTextFromAudio(audioSlug, dataPath, volume) {
  const base = audioSlug.replace(/-(music|dramatized)$/, '');
  if (base !== audioSlug && isTextDir(dataPath, volume, base)) {
    return base;
  }
  return null;
}
```

Then modify the 2-segment audio-only branch (line ~228–231):

```javascript
      if (slugIsAudio && !slugIsText) {
        // Audio-only dir (e.g., "esv-music/1") → audio override, text derived or from defaults
        const derivedText = deriveTextFromAudio(slug, dataPath, volume);
        textVersion = derivedText || volumeDefaults.text || getFirstDir(path.join(dataPath, volume)) || 'default';
        audioRecording = slug;
      }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/readalong/resolvers/scripture.mjs tests/isolated/adapter/content/readalong/resolvers/scripture-version.test.mjs
git commit -m "feat(scripture): derive text edition from audio slug (esv-music → esv)"
```

---

### Task 2: ListAdapter — Version resolution helpers

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (add helper methods after `_shouldSkipForPlayback`)
- Test: `tests/isolated/adapter/content/list/listVersionRotation.test.mjs` (create)

**Context:** The ListAdapter needs to: (a) determine which scripture volume a verse ID belongs to, (b) query per-version watch state, (c) pick the right version, (d) classify the item as unwatched/partial/complete.

**Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/content/list/listVersionRotation.test.mjs
import { describe, it, expect } from 'vitest';

// Test the pure helper functions in isolation
// We'll extract them as module-level exports for testability

describe('version rotation helpers', () => {
  // Import dynamically to avoid bootstrap deps
  let helpers;

  beforeAll(async () => {
    helpers = await import('#adapters/content/list/listVersionHelpers.mjs');
  });

  describe('getVolumeFromVerseId', () => {
    it('maps Genesis 1 (verse 1) to ot', () => {
      expect(helpers.getVolumeFromVerseId(1)).toBe('ot');
    });

    it('maps Malachi (verse 23091) to ot', () => {
      expect(helpers.getVolumeFromVerseId(23091)).toBe('ot');
    });

    it('maps Moses 1 (verse 41361) to pgp', () => {
      expect(helpers.getVolumeFromVerseId(41361)).toBe('pgp');
    });

    it('returns null for out-of-range IDs', () => {
      expect(helpers.getVolumeFromVerseId(99999)).toBeNull();
    });
  });

  describe('selectVersion', () => {
    it('picks first version when nothing watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        []  // watchedVersions
      );
      expect(result.version).toBe('esv-music');
      expect(result.watchState).toBe('unwatched');
    });

    it('picks second version when first is watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music']
      );
      expect(result.version).toBe('kjv-maxmclean');
      expect(result.watchState).toBe('partial');
    });

    it('returns complete when all versions watched', () => {
      const result = helpers.selectVersion(
        ['esv-music', 'kjv-maxmclean'],
        ['esv-music', 'kjv-maxmclean']
      );
      expect(result.version).toBe('esv-music'); // cycles back to first
      expect(result.watchState).toBe('complete');
    });

    it('returns unwatched with first version when no prefs', () => {
      const result = helpers.selectVersion([], []);
      expect(result.version).toBeNull();
      expect(result.watchState).toBe('unwatched');
    });
  });

  describe('buildVersionedStorageKey', () => {
    it('constructs readalong:scripture/{vol}/{version}/{id} key', () => {
      const key = helpers.buildVersionedStorageKey('1', 'ot', 'esv-music');
      expect(key).toBe('readalong:scripture/ot/esv-music/1');
    });

    it('constructs pgp key', () => {
      const key = helpers.buildVersionedStorageKey('41361', 'pgp', 'rex');
      expect(key).toBe('readalong:scripture/pgp/rex/41361');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/content/list/listVersionRotation.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `backend/src/1_adapters/content/list/listVersionHelpers.mjs`:

```javascript
// backend/src/1_adapters/content/list/listVersionHelpers.mjs

/**
 * Verse ID ranges per scripture volume.
 * Duplicated from ScriptureResolver to avoid cross-adapter coupling.
 */
const VOLUME_RANGES = {
  ot:  { start: 1,     end: 23145 },
  nt:  { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc:  { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

// Threshold for considering an item watched
const WATCHED_THRESHOLD = 90;

/**
 * Get scripture volume from verse ID.
 * @param {number|string} verseId
 * @returns {string|null} Volume name (ot, nt, bom, dc, pgp)
 */
export function getVolumeFromVerseId(verseId) {
  const id = parseInt(verseId, 10);
  if (isNaN(id)) return null;
  for (const [volume, range] of Object.entries(VOLUME_RANGES)) {
    if (id >= range.start && id <= range.end) return volume;
  }
  return null;
}

/**
 * Select the next version to play based on watch history.
 * @param {string[]} versionPrefs - Ordered preference list
 * @param {string[]} watchedVersions - Versions already watched (>=90%)
 * @returns {{ version: string|null, watchState: 'unwatched'|'partial'|'complete' }}
 */
export function selectVersion(versionPrefs, watchedVersions) {
  if (!versionPrefs?.length) {
    return { version: null, watchState: 'unwatched' };
  }

  const watchedSet = new Set(watchedVersions || []);

  // No versions watched at all
  if (watchedSet.size === 0) {
    return { version: versionPrefs[0], watchState: 'unwatched' };
  }

  // Find first unwatched version
  const nextVersion = versionPrefs.find(v => !watchedSet.has(v));
  if (nextVersion) {
    return { version: nextVersion, watchState: 'partial' };
  }

  // All versions watched — cycle back to first
  return { version: versionPrefs[0], watchState: 'complete' };
}

/**
 * Build the media progress storage key for a versioned scripture chapter.
 * Matches the key format used by ReadalongAdapter when storing progress.
 * @param {string} verseId - Bare verse ID
 * @param {string} volume - Volume name (ot, pgp, etc.)
 * @param {string} version - Audio/text version slug
 * @returns {string} Storage key like 'readalong:scripture/ot/esv-music/1'
 */
export function buildVersionedStorageKey(verseId, volume, version) {
  return `readalong:scripture/${volume}/${version}/${verseId}`;
}

/**
 * Query which versions of a chapter have been watched.
 * @param {Object} mediaProgressMemory - Progress memory instance
 * @param {string} verseId - Bare verse ID
 * @param {string} volume - Scripture volume
 * @param {string[]} versionPrefs - Versions to check
 * @returns {Promise<string[]>} Watched version slugs
 */
export async function getWatchedVersions(mediaProgressMemory, verseId, volume, versionPrefs) {
  if (!mediaProgressMemory || !versionPrefs?.length) return [];

  const watched = [];
  for (const version of versionPrefs) {
    const key = buildVersionedStorageKey(verseId, volume, version);
    const state = await mediaProgressMemory.get(key, 'scriptures');
    if (state && (state.percent || 0) >= WATCHED_THRESHOLD) {
      watched.push(version);
    }
  }
  return watched;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/content/list/listVersionRotation.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/list/listVersionHelpers.mjs tests/isolated/adapter/content/list/listVersionRotation.test.mjs
git commit -m "feat(list): add version rotation helper functions"
```

---

### Task 3: ListAdapter — Version-aware `_buildListItems` and content ID rewriting

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (lines 501–506 in `getList`, lines 825–840 in `_buildListItems`, lines 865–871 actions block)

**Context:** When a watchlist has `metadata.versions`, the ListAdapter needs to: (1) query per-version watch state for each scripture item, (2) pick the right version, (3) rewrite the play action's contentId to include the version, (4) store the watch classification in item metadata.

**Step 1: Add imports at top of ListAdapter.mjs**

After the existing imports (~line 13), add:

```javascript
import {
  getVolumeFromVerseId,
  selectVersion,
  getWatchedVersions
} from './listVersionHelpers.mjs';
```

**Step 2: Thread list metadata into `_buildListItems`**

In `getList()` (line ~506), pass `listData.metadata` to `_buildListItems`:

Change:
```javascript
const children = await this._buildListItems(items, parsed.prefix, parsed.name);
```
To:
```javascript
const children = await this._buildListItems(items, parsed.prefix, parsed.name, listData.metadata);
```

Update `_buildListItems` signature (line ~734):

Change:
```javascript
async _buildListItems(items, listPrefix, listName) {
```
To:
```javascript
async _buildListItems(items, listPrefix, listName, listMetadata = {}) {
```

**Step 3: Add version resolution inside the watch-state enrichment block**

After the existing watch-state enrichment (line ~840), add version-aware logic. Inside the `for (const item of items)` loop, after the `if (isWatchlist && this.mediaProgressMemory)` block:

```javascript
      // Version rotation for scripture items with metadata.versions
      let versionState = null; // 'unwatched' | 'partial' | 'complete'
      let selectedVersion = null;
      const versionPrefsMap = listMetadata?.versions;

      if (isWatchlist && versionPrefsMap && source === 'scriptures') {
        // Extract bare verse ID from localId (handles both '1' and 'ot/esv/1' formats)
        const bareVerseId = localId.includes('/') ? localId.split('/').pop() : localId;
        const volume = getVolumeFromVerseId(bareVerseId);

        if (volume && versionPrefsMap[volume]) {
          const versionPrefs = versionPrefsMap[volume];
          const watchedVersions = await getWatchedVersions(
            this.mediaProgressMemory, bareVerseId, volume, versionPrefs
          );

          const selection = selectVersion(versionPrefs, watchedVersions);
          selectedVersion = selection.version;
          versionState = selection.watchState;

          // Override percent/watched based on version-aware state
          if (versionState === 'unwatched') {
            percent = 0;
          } else if (versionState === 'partial') {
            // Check progress of the selected (next) version specifically
            percent = 0; // Not yet started in this version
          } else if (versionState === 'complete') {
            percent = 100;
          }
        }
      }
```

**Step 4: Rewrite play action contentId with selected version**

After the actions block (line ~871), add version rewriting:

```javascript
      // Rewrite play action contentId with selected version for scripture items
      if (selectedVersion && actions.play?.contentId) {
        const bareVerseId = localId.includes('/') ? localId.split('/').pop() : localId;
        actions.play = { ...actions.play, contentId: `scriptures:${selectedVersion}/${bareVerseId}` };
      }
```

**Step 5: Store version metadata on the item**

In the watchlist metadata block (line ~877), add after `assetId`:

```javascript
        // Version rotation state
        versionState: versionState || null,
        selectedVersion: selectedVersion || null,
```

**Step 6: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "feat(list): version-aware watch state and contentId rewriting"
```

---

### Task 4: ListAdapter — Priority cascade sorting in `resolvePlayables`

**Files:**
- Modify: `backend/src/1_adapters/content/list/ListAdapter.mjs` (lines 596–616 `_shouldSkipForPlayback`, lines 1005–1066 `resolvePlayables` watchlist branch)

**Context:** The current `_shouldSkipForPlayback` skips items with `percent >= 90`. With version rotation, "complete" items (all versions watched) should be skipped, but "partial" items (some versions remaining) should not. The queue ordering needs to follow the priority cascade.

**Step 1: Modify `_shouldSkipForPlayback` to respect version state**

Replace the current method (lines 596–616):

```javascript
  _shouldSkipForPlayback(child) {
    const meta = child.metadata || {};

    if (meta.hold) return true;

    // Version-rotation-aware watched check
    if (meta.versionState) {
      // Only skip if ALL versions are complete
      if (meta.versionState === 'complete') return true;
      // 'unwatched' and 'partial' items should play
    } else {
      // Standard watched check (no version rotation)
      if (meta.percent >= WATCHED_THRESHOLD) return true;
      if (meta.watched) return true;
    }

    // Don't skip past skipAfter — we still want these items in the queue,
    // just at lower priority. The cascade sort handles ordering.
    // BUT do skip items whose waitUntil is in the future (not yet in schedule)
    if (meta.waitUntil) {
      const waitDate = new Date(meta.waitUntil);
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      if (waitDate > twoDaysFromNow) return true;
    }

    return false;
  }
```

**Step 2: Add cascade sort in `resolvePlayables`**

After `getList()` at line ~1006, before the `for (const child of list.children)` loop, add a sort step:

```javascript
    if (isWatchlist && list.children?.length > 0) {
      // Sort by priority cascade for version-rotation watchlists
      const now = new Date();
      list.children.sort((a, b) => {
        const ma = a.metadata || {};
        const mb = b.metadata || {};
        const cascadeA = _getCascadePriority(ma, now);
        const cascadeB = _getCascadePriority(mb, now);
        if (cascadeA !== cascadeB) return cascadeA - cascadeB;
        // Within same cascade level, preserve source order
        return 0;
      });
    }
```

Add the helper function (module-level, outside the class, near the top of the file after imports):

```javascript
/**
 * Compute cascade priority for queue ordering.
 * Lower number = higher priority.
 *
 * 0 = unwatched, current week (within skip_after)
 * 1 = unwatched, past weeks (skip_after passed)
 * 2 = partial (version-recycled), current week
 * 3 = partial (version-recycled), past weeks
 * 4 = complete (all versions done)
 */
function _getCascadePriority(meta, now) {
  const isCurrentWeek = !meta.skipAfter || new Date(meta.skipAfter) >= now;
  const vs = meta.versionState;

  if (!vs || vs === 'unwatched') {
    return isCurrentWeek ? 0 : 1;
  }
  if (vs === 'partial') {
    return isCurrentWeek ? 2 : 3;
  }
  return 4; // complete
}
```

**Step 3: Remove skipAfter hard-filter from _shouldSkipForPlayback**

Note: we already removed the skipAfter check in step 1 above. Items past their `skip_after` are no longer filtered out — they're just sorted lower in the cascade. This implements the "catch up on missed chapters" behavior.

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "feat(list): priority cascade sort for version-rotation watchlists"
```

---

### Task 5: Verify media progress key format

**Files:**
- Read-only investigation, no changes expected

**Context:** The `getWatchedVersions` helper queries `mediaProgressMemory.get(key, 'scriptures')` where key is `readalong:scripture/ot/esv-music/1`. We need to verify this matches how the ReadalongAdapter stores progress after playback.

**Step 1: Check how progress is stored**

Read `backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs` and trace the `set()` call from the playback pipeline. Verify the storage category (`'scriptures'` vs `'scripture'`) and key format match.

Look at actual data in `data/household/history/media_memory/scriptures.yml` — keys are like `readalong:scripture/dc/rex/38926`. The file is named `scriptures.yml` (with 's').

**Step 2: Verify category name**

In `ListAdapter._buildListItems` line 738, `watchCategoryMap` has:
```javascript
scripture: 'scripture'
```
But the source from `scriptures:1` parses as `'scriptures'` (with 's'). The map key is `scripture` (without 's'). So `watchCategoryMap['scriptures']` is `undefined`, falling through to `source` = `'scriptures'`.

Check if the media memory file is `scriptures.yml` or `scripture.yml`. If it's `scriptures.yml`, then the category `'scriptures'` is correct. Update `getWatchedVersions` to use `'scriptures'` (with 's') as the storage path.

**Step 3: Fix if needed**

If the storage path doesn't match, update `getWatchedVersions` in `listVersionHelpers.mjs` to use the correct category. This may also require updating the `watchCategoryMap` in `_buildListItems` to add `scriptures: 'scriptures'` (with 's').

**Step 4: Commit if changes were needed**

```bash
git add backend/src/1_adapters/content/list/listVersionHelpers.mjs backend/src/1_adapters/content/list/ListAdapter.mjs
git commit -m "fix(list): correct media progress storage category for scriptures"
```

---

### Task 6: End-to-end manual test

**Files:** None (verification only)

**Step 1: Start the dev server**

```bash
lsof -i :3112  # check if already running
node backend/index.js  # start if not
```

**Step 2: Hit the queue endpoint**

```bash
curl -s http://localhost:3112/api/v1/queue/scriptures2026 | jq '.items[:5] | .[] | {title, contentId}'
```

Expected: This week's unwatched chapters first (e.g., Genesis chapters for current CFM week), with `contentId` containing the version prefix (e.g., `scriptures:esv-music/1`).

**Step 3: Verify ordering**

```bash
curl -s http://localhost:3112/api/v1/queue/scriptures2026 | jq '[.items[] | {title, contentId}] | length'
```

Expected: All eligible items returned (unwatched + partial, up to current week). No future-week items (waitUntil > today + 2 days).

**Step 4: Verify version in resolved content**

```bash
curl -s http://localhost:3112/api/v1/queue/scriptures2026 | jq '.items[0]'
```

Expected: First item has `mediaUrl` pointing to esv-music audio, not kjv-maxmclean.

**Step 5: Check the list endpoint too**

```bash
curl -s http://localhost:3112/api/v1/list/scriptures2026 | jq '.items[:3] | .[] | {title, id, watchProgress: .watchProgress}'
```

Expected: Items show correct watch progress and version-aware state.

---

### Task 7: Regression — ensure non-version watchlists still work

**Files:** None (verification only)

**Step 1: Test existing watchlists**

```bash
# Test a non-version-rotation watchlist (e.g., existing cfmscripturekc)
curl -s http://localhost:3112/api/v1/list/watchlist/cfmscripturekc | jq '.items[:3] | .[] | {title, id}'
```

Expected: Still works — `versionState` is null, standard watched behavior applies.

**Step 2: Run existing tests**

```bash
npx vitest run tests/isolated/adapter/content/list/
npx vitest run tests/isolated/api/routers/list.test.mjs
```

Expected: All existing tests pass.

**Step 3: Commit all if clean**

No commit needed unless fixes were required.
