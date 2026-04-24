# Fitness Deprioritized Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "deprioritized" tier of content labels (initial member: `KidsFun`) that `selectPrimaryMedia` filters out of primary-media candidates, falling back to them only when no other video remains. Distinct from the existing warmup tier so Strava annotation behavior is unchanged.

**Architecture:** Single new config key `plex.deprioritized_labels` in `data/household/config/fitness.yml`. The `selectPrimaryMedia` function (mirrored in backend `.mjs` and frontend `.js`) gains a parallel "deprioritized" filter that combines with the existing warmup filter into one "skip" predicate. Three call sites that build the config object pass the new field through. No changes to `buildStravaDescription`, `PersistenceManager`, `buildSessionSummary`, or suggestions code.

**Casing note (important):** Session timeline events persist labels in **lowercase** (e.g. `kidsfun`, `nomusic`, `resumable`) even though the Plex API and the config file use CamelCase (e.g. `KidsFun`). The existing `warmup_labels` label matcher is broken-but-harmless because warmup is also caught by title regex. The new `deprioritized_labels` matcher has no such fallback, so it must compare **case-insensitively** — mirror the pattern used in `backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs:41`. Tests use lowercase labels (matching real session data).

**Tech Stack:** Node.js (ESM), Jest, YAML config

**Spec:** `docs/superpowers/specs/2026-04-23-fitness-deprioritized-labels-design.md`

---

## File Structure

| File | Role | Change |
|---|---|---|
| `frontend/src/hooks/fitness/selectPrimaryMedia.js` | Frontend selection algorithm (operates on flat media items) | Extend filter |
| `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` | Backend selection algorithm (operates on timeline events with `event.data`) | Extend filter; mirror frontend |
| `tests/unit/fitness/selectPrimaryMedia.test.mjs` | Existing frontend tests (Jest) | Extend with deprioritized cases |
| `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` | NEW backend test (Jest) | Cover deprioritized behavior on event-shape inputs |
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | Builds config object for Strava enrichment (2 sites: lines ~217 and ~670) | Add `deprioritized_labels` to config object |
| `backend/src/3_applications/fitness/StravaReconciliationService.mjs` | Builds config object for reconciliation (line ~50) | Same |
| `frontend/src/context/FitnessContext.jsx` | Builds config object for PersistenceManager (line ~497) | Same |
| `data/household/config/fitness.yml` | Runtime config (in container's data volume) | Add `plex.deprioritized_labels: [KidsFun]` |

The config object's variable name remains `warmupConfig` in all call sites — only the shape grows. Renaming would touch many more files for no functional benefit and is explicitly out of scope.

---

## Background — Function Shapes

The two `selectPrimaryMedia` files have the same algorithm but operate on different inputs:

**Frontend (`frontend/src/hooks/fitness/selectPrimaryMedia.js`):** Takes flat objects:
```js
{ contentId, title, mediaType: 'video'|'audio', durationMs, labels?, description?, artist? }
```
Filters audio via `m.mediaType === 'audio'`. Picks longest by `durationMs`. Labels/description/title checks are direct on `m.labels`, `m.description`, `m.title`.

**Backend (`backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`):** Takes timeline event objects:
```js
{ type: 'media', data: { title, durationSeconds, contentType?, artist?, labels?, description? } }
```
Filters audio via `e.data.contentType === 'track' || e.data.artist`. Picks longest by `e.data.durationSeconds`. Labels/description/title checks are on `e.data.labels`, `e.data.description`, `e.data.title`.

Both export `selectPrimaryMedia` as default + named. Backend also exports `buildWarmupChecker` (consumed by `buildStravaDescription` for warmup annotation — must remain warmup-only).

---

## Task 1: Extend frontend tests with deprioritized cases (RED)

**Files:**
- Modify: `tests/unit/fitness/selectPrimaryMedia.test.mjs`

- [ ] **Step 1: Add `deprioritized_labels` to the `defaultConfig` constant**

Open `tests/unit/fitness/selectPrimaryMedia.test.mjs` and replace the `defaultConfig` block at the top:

```js
const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
  deprioritized_labels: ['KidsFun'],
};
```

- [ ] **Step 2: Add three new test cases at the end of the `describe` block (before the closing `});`)**

```js
  test('filters out deprioritized by labels — workout wins over longer kids video', () => {
    // Session-persisted labels are lowercase (kidsfun); config is CamelCase (KidsFun).
    // The matcher must compare case-insensitively.
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun', 'resumable', 'sequential'] }),
      vid('Lower Body Workout', 675000, { labels: ['nomusic'] }),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Lower Body Workout');
  });

  test('falls back to longest deprioritized when only deprioritized + audio', () => {
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Danny Go Dance', 500000, { labels: ['kidsfun'] }),
      audio('Workout Mix', 999999),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Mario Kart World');
  });

  test('combined skip — warmup + deprioritized + workout, workout wins', () => {
    const items = [
      vid('Ten minute warm-up', 600000),
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Real Workout', 500000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('deprioritized matching is case-insensitive (CamelCase config vs lowercase labels)', () => {
    const items = [
      vid('Mario Kart World', 763000, { labels: ['kidsfun'] }),
      vid('Real Workout', 500000),
    ];
    // defaultConfig has deprioritized_labels: ['KidsFun'] — must still match 'kidsfun'.
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });
```

- [ ] **Step 3: Run tests — expect the new cases to FAIL**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs -t deprioritized`

Expected: 3 failing tests with messages like `Expected: "Lower Body Workout" / Received: "Mario Kart World"` (because the algorithm currently picks longest non-warmup, and KidsFun isn't in the warmup set).

The "combined skip" test will fail with `Expected: "Real Workout" / Received: "Mario Kart World"` for the same reason.

The "falls back" test may PASS by coincidence (the longest video wins regardless of label when nothing else is filtered) — that's fine, it locks in the fallback behavior.

- [ ] **Step 4: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/fitness/selectPrimaryMedia.test.mjs
git commit -m "test(fitness): failing tests for deprioritized labels in selectPrimaryMedia"
```

---

## Task 2: Implement frontend deprioritized filter (GREEN)

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js`

- [ ] **Step 1: Replace the file body with the extended algorithm**

Open `frontend/src/hooks/fitness/selectPrimaryMedia.js` and replace its entire contents with:

```js
/**
 * Select the primary media item from a session's media array.
 *
 * Filters out audio, then warmup videos AND deprioritized videos (e.g. kids
 * content). Picks longest of the survivors by durationMs. Falls back to
 * longest video overall if every video is filtered out.
 *
 * @param {Array} mediaItems - Media summary objects from buildSessionSummary
 * @param {Object} [config] - {
 *   warmup_labels, warmup_description_tags, warmup_title_patterns,
 *   deprioritized_labels
 * }
 * @returns {Object|null} The selected primary media item
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

export function selectPrimaryMedia(mediaItems, config) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;

  // Step 1: Filter out audio
  const videos = mediaItems.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;

  // Step 2: Build skip-predicate combining warmup + deprioritized rules
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (config?.warmup_title_patterns?.length) {
    for (const p of config.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip invalid regex */ }
    }
  }
  const descTags = config?.warmup_description_tags || [];
  const warmupLabels = config?.warmup_labels || [];
  const deprioritizedLabels = config?.deprioritized_labels || [];

  function isWarmup(item) {
    if (warmupLabels.length && Array.isArray(item.labels)) {
      for (const label of warmupLabels) {
        if (item.labels.includes(label)) return true;
      }
    }
    if (descTags.length && item.description) {
      for (const tag of descTags) {
        if (item.description.includes(tag)) return true;
      }
    }
    if (item.title) {
      for (const re of titlePatterns) {
        if (re.test(item.title)) return true;
      }
    }
    return false;
  }

  // Pre-lowercase config labels once for case-insensitive matching (session
  // events persist labels lowercased; config uses CamelCase).
  const deprioritizedLowered = deprioritizedLabels.map(l => String(l).toLowerCase());

  function isDeprioritized(item) {
    if (!deprioritizedLowered.length || !Array.isArray(item.labels)) return false;
    const itemLowered = item.labels.map(l => String(l).toLowerCase());
    for (const label of deprioritizedLowered) {
      if (itemLowered.includes(label)) return true;
    }
    return false;
  }

  // Step 3: Drop warmup + deprioritized, pick longest. Fall back to all videos.
  const candidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const pool = candidates.length > 0 ? candidates : videos;

  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}

export default selectPrimaryMedia;
```

- [ ] **Step 2: Run all `selectPrimaryMedia` tests — all should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs`

Expected: All tests pass (16 existing + 4 new = 20 tests).

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/hooks/fitness/selectPrimaryMedia.js
git commit -m "feat(fitness): add deprioritized_labels filter to selectPrimaryMedia (frontend)"
```

---

## Task 3: Add backend tests for deprioritized behavior (RED)

**Files:**
- Create: `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

- [ ] **Step 1: Create the new backend test file**

Create `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` with this content:

```js
// tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
import { selectPrimaryMedia, buildWarmupChecker } from '#adapters/fitness/selectPrimaryMedia.mjs';

// ─── Test data factories (event shape, matches backend timeline events) ───

function videoEvent(title, durationSeconds, dataOverrides = {}) {
  return {
    type: 'media',
    data: {
      contentId: `plex:${Math.floor(Math.random() * 1e9)}`,
      title,
      durationSeconds,
      ...dataOverrides,
    },
  };
}

function audioEvent(title, durationSeconds) {
  return {
    type: 'media',
    data: {
      contentId: `plex:${Math.floor(Math.random() * 1e9)}`,
      title,
      durationSeconds,
      contentType: 'track',
      artist: 'Some Artist',
    },
  };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
  deprioritized_labels: ['KidsFun'],
};

describe('selectPrimaryMedia (backend)', () => {
  test('picks longest video when no warmups or deprioritized', () => {
    const events = [videoEvent('Short', 60), videoEvent('Long', 600)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Long');
  });

  test('filters out audio events', () => {
    const events = [audioEvent('Long Song', 9999), videoEvent('Short Video', 60)];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Short Video');
  });

  test('filters out warmup by label', () => {
    const events = [
      videoEvent('Generic Title', 100, { labels: ['Warmup'] }),
      videoEvent('Real Workout', 90),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('filters out deprioritized — workout wins over longer kids video', () => {
    // Real session timeline events use lowercase labels (kidsfun) regardless
    // of how they appear in the Plex API or in config (KidsFun).
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun', 'resumable'] }),
      videoEvent('Lower Body Workout', 675, { labels: ['nomusic'] }),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Lower Body Workout');
  });

  test('falls back to longest deprioritized when only deprioritized + audio', () => {
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Danny Go Dance', 500, { labels: ['kidsfun'] }),
      audioEvent('Workout Mix', 9999),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Mario Kart World');
  });

  test('combined skip — warmup + deprioritized + workout, workout wins', () => {
    const events = [
      videoEvent('Ten minute warm-up', 600),
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Real Workout', 500),
    ];
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('deprioritized matching is case-insensitive', () => {
    const events = [
      videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] }),
      videoEvent('Real Workout', 500),
    ];
    // defaultConfig has deprioritized_labels: ['KidsFun'] — must still match 'kidsfun'.
    expect(selectPrimaryMedia(events, defaultConfig).data.title).toBe('Real Workout');
  });

  test('buildWarmupChecker does NOT match deprioritized labels', () => {
    // Warmup checker is reused by buildStravaDescription for "(warmup)" annotation.
    // It MUST stay warmup-only — kids videos must not get the warmup tag.
    const isWarmup = buildWarmupChecker(defaultConfig);
    const kidsEvent = videoEvent('Mario Kart World', 763, { labels: ['kidsfun'] });
    expect(isWarmup(kidsEvent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new backend tests — expect the 3 deprioritized cases to FAIL**

Run: `cd /opt/Code/DaylightStation && npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Expected: 4 failures (the deprioritized + combined + case-insensitive cases). The other 4 tests pass (existing behavior + the warmup-checker assertion).

- [ ] **Step 3: Commit the failing backend tests**

```bash
cd /opt/Code/DaylightStation
git add tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs
git commit -m "test(fitness): backend selectPrimaryMedia tests including deprioritized cases"
```

---

## Task 4: Implement backend deprioritized filter (GREEN)

**Files:**
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`

- [ ] **Step 1: Replace the file body with the extended algorithm**

Open `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` and replace its entire contents with:

```js
/**
 * Select the primary media event from a session's timeline events.
 *
 * Same algorithm as frontend selectPrimaryMedia, adapted for backend
 * timeline event objects where data lives under event.data.
 *
 * Filters out audio, then warmup AND deprioritized events (e.g. kids
 * content). Picks longest of the survivors by data.durationSeconds.
 * Falls back to longest video overall if every video is filtered out.
 *
 * @param {Array} mediaEvents - Timeline event objects with { data: { title, durationSeconds, ... } }
 * @param {Object} [config] - {
 *   warmup_labels, warmup_description_tags, warmup_title_patterns,
 *   deprioritized_labels
 * }
 * @returns {Object|null} The selected event object (not just .data)
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

/**
 * Build a warmup checker function from config.
 * Exported so buildStravaDescription can reuse it for warmup annotation.
 *
 * IMPORTANT: This checker is warmup-only. Deprioritized labels are NOT
 * matched here, because buildStravaDescription uses this to add a "(warmup)"
 * annotation in the Strava description — kids videos must not get that tag.
 *
 * @param {Object} [config]
 * @returns {Function} (event) => boolean
 */
export function buildWarmupChecker(config) {
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (config?.warmup_title_patterns?.length) {
    for (const p of config.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip */ }
    }
  }
  const descTags = config?.warmup_description_tags || [];
  const warmupLabels = config?.warmup_labels || [];

  return (event) => {
    const d = event.data || {};
    if (warmupLabels.length && Array.isArray(d.labels)) {
      for (const label of warmupLabels) {
        if (d.labels.includes(label)) return true;
      }
    }
    if (descTags.length && d.description) {
      for (const tag of descTags) {
        if (d.description.includes(tag)) return true;
      }
    }
    if (d.title) {
      for (const re of titlePatterns) {
        if (re.test(d.title)) return true;
      }
    }
    return false;
  };
}

/**
 * Build a deprioritized checker function from config. Internal helper.
 * Matches by labels only, case-insensitively (session timeline events
 * persist labels lowercased while config uses CamelCase).
 */
function buildDeprioritizedChecker(config) {
  const labels = (config?.deprioritized_labels || []).map(l => String(l).toLowerCase());
  return (event) => {
    if (!labels.length) return false;
    const d = event.data || {};
    if (!Array.isArray(d.labels)) return false;
    const itemLowered = d.labels.map(l => String(l).toLowerCase());
    for (const label of labels) {
      if (itemLowered.includes(label)) return true;
    }
    return false;
  };
}

export function selectPrimaryMedia(mediaEvents, config) {
  if (!Array.isArray(mediaEvents) || mediaEvents.length === 0) return null;

  // Step 1: Filter out audio (tracks / items with artist)
  const episodes = mediaEvents.filter(e => {
    const d = e?.data;
    return d && d.contentType !== 'track' && !d.artist;
  });
  if (episodes.length === 0) return null;

  // Step 2: Drop warmups + deprioritized; fall back to all episodes if empty
  const isWarmup = buildWarmupChecker(config);
  const isDeprioritized = buildDeprioritizedChecker(config);
  const candidates = episodes.filter(e => !isWarmup(e) && !isDeprioritized(e));
  const pool = candidates.length > 0 ? candidates : episodes;

  return pool.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}

export default selectPrimaryMedia;
```

- [ ] **Step 2: Run backend tests — all should PASS**

Run: `cd /opt/Code/DaylightStation && npx jest tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Expected: All 8 tests pass.

- [ ] **Step 3: Run frontend tests too to confirm no regression**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs`

Expected: All 20 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
git commit -m "feat(fitness): add deprioritized_labels filter to selectPrimaryMedia (backend)"
```

---

## Task 5: Wire `deprioritized_labels` through call sites

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` (2 sites)
- Modify: `backend/src/3_applications/fitness/StravaReconciliationService.mjs` (1 site)
- Modify: `frontend/src/context/FitnessContext.jsx` (1 site)

Each site builds a `warmupConfig` object from `plex` and passes it to `selectPrimaryMedia` (directly or via `buildStravaDescription`/`PersistenceManager`). Add one field to the object literal in each.

- [ ] **Step 1: Edit `FitnessActivityEnrichmentService.mjs` — first site (~line 217)**

Find this block:

```js
      const warmupConfig = {
        warmup_labels: plex.warmup_labels || [],
        warmup_description_tags: plex.warmup_description_tags || [],
        warmup_title_patterns: plex.warmup_title_patterns || [],
      };
```

Replace with:

```js
      const warmupConfig = {
        warmup_labels: plex.warmup_labels || [],
        warmup_description_tags: plex.warmup_description_tags || [],
        warmup_title_patterns: plex.warmup_title_patterns || [],
        deprioritized_labels: plex.deprioritized_labels || [],
      };
```

- [ ] **Step 2: Edit `FitnessActivityEnrichmentService.mjs` — second site (~line 670)**

Find this block (note: indented one level less):

```js
    const warmupConfig = {
      warmup_labels: plex.warmup_labels || [],
      warmup_description_tags: plex.warmup_description_tags || [],
      warmup_title_patterns: plex.warmup_title_patterns || [],
    };
```

Replace with:

```js
    const warmupConfig = {
      warmup_labels: plex.warmup_labels || [],
      warmup_description_tags: plex.warmup_description_tags || [],
      warmup_title_patterns: plex.warmup_title_patterns || [],
      deprioritized_labels: plex.deprioritized_labels || [],
    };
```

- [ ] **Step 3: Edit `StravaReconciliationService.mjs` (~line 50)**

Find this block:

```js
    const warmupConfig = {
      warmup_labels: plex.warmup_labels || [],
      warmup_description_tags: plex.warmup_description_tags || [],
      warmup_title_patterns: plex.warmup_title_patterns || [],
    };
```

Replace with:

```js
    const warmupConfig = {
      warmup_labels: plex.warmup_labels || [],
      warmup_description_tags: plex.warmup_description_tags || [],
      warmup_title_patterns: plex.warmup_title_patterns || [],
      deprioritized_labels: plex.deprioritized_labels || [],
    };
```

- [ ] **Step 4: Edit `frontend/src/context/FitnessContext.jsx` (~line 497)**

Find this block:

```jsx
      pm.setWarmupConfig({
        warmup_labels: plexConfig.warmup_labels || [],
        warmup_description_tags: plexConfig.warmup_description_tags || [],
        warmup_title_patterns: plexConfig.warmup_title_patterns || [],
      });
```

Replace with:

```jsx
      pm.setWarmupConfig({
        warmup_labels: plexConfig.warmup_labels || [],
        warmup_description_tags: plexConfig.warmup_description_tags || [],
        warmup_title_patterns: plexConfig.warmup_title_patterns || [],
        deprioritized_labels: plexConfig.deprioritized_labels || [],
      });
```

- [ ] **Step 5: Run all `selectPrimaryMedia` tests to confirm no regression**

Run: `cd /opt/Code/DaylightStation && npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs`

Expected: 28 tests pass total (20 frontend + 8 backend).

- [ ] **Step 6: Verify no other call site reads `warmupConfig` and is broken**

Run: `cd /opt/Code/DaylightStation && grep -rn "warmup_labels:" backend/src frontend/src`

Expected: only the 4 sites we just edited (3 backend + 1 frontend). Spot-check there are no others.

- [ ] **Step 7: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        backend/src/3_applications/fitness/StravaReconciliationService.mjs \
        frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): pass deprioritized_labels through to selectPrimaryMedia call sites"
```

---

## Task 6: Add `deprioritized_labels` to runtime config

**Files:**
- Modify: `data/household/config/fitness.yml` (inside the daylight-station Docker container; not in the git repo)

This config file lives on the Docker volume on the host and is bind-mounted into the container. It is **not** version-controlled. The `claude` user cannot read it directly — must use `sudo docker exec`. Per the project's CLAUDE.local.md: never use `sed -i` to edit YAML inside the container; write the file via heredoc instead.

- [ ] **Step 1: Read the current `plex:` section to confirm shape**

Run:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' | grep -A 20 "^plex:"
```

Expected: confirms the existing `warmup_labels`/`warmup_description_tags`/`warmup_title_patterns` block. Note the surrounding fields and indentation.

- [ ] **Step 2: Read the full file to a local working copy**

Run:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml' > /tmp/fitness.yml
```

Verify: `wc -l /tmp/fitness.yml` shows a non-trivial line count (the file is large).

- [ ] **Step 3: Edit the local copy — add `deprioritized_labels` under `plex:`**

Use a normal text editor (not sed) to add the new key right after `warmup_title_patterns:` block. Insert these lines (matching the 2-space indent of sibling keys under `plex:`):

```yaml
  deprioritized_labels:
    - KidsFun
```

The block should end up looking like:

```yaml
  warmup_title_patterns:
    - "warm[\\s-]?up"
    - "cool[\\s-]?down"
    - "stretch"
    - "recovery"
  deprioritized_labels:
    - KidsFun
  governed_types:
    - show
    - movie
```

- [ ] **Step 4: Validate YAML syntax locally before writing back**

Run:

```bash
node -e "const yaml = require('/opt/Code/DaylightStation/node_modules/js-yaml'); const fs = require('fs'); const doc = yaml.load(fs.readFileSync('/tmp/fitness.yml','utf8')); console.log('plex.deprioritized_labels =', JSON.stringify(doc.plex.deprioritized_labels));"
```

Expected output: `plex.deprioritized_labels = ["KidsFun"]`

If this fails, the YAML is malformed — fix indentation and re-run.

- [ ] **Step 5: Copy the validated file into the container**

Run:

```bash
sudo docker cp /tmp/fitness.yml daylight-station:/usr/src/app/data/household/config/fitness.yml
```

- [ ] **Step 6: Verify the file inside the container matches**

Run:

```bash
sudo docker exec daylight-station sh -c 'grep -A1 "deprioritized_labels" data/household/config/fitness.yml'
```

Expected:

```
  deprioritized_labels:
    - KidsFun
```

- [ ] **Step 7: No git commit needed — config file is on the data volume, not in the repo**

Note: the runtime config will be re-read on the next request that calls `getAppConfig('fitness')`. No restart required for this change to take effect (FitnessConfigService reads on demand). If the config caches in memory, a backend restart may be required — see validation step in Task 7.

---

## Task 7: Validate against the triggering session

**Files:**
- None modified. This task verifies the change end-to-end against the real session that motivated the spec.

- [ ] **Step 1: Confirm the session file still exists**

Run:

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-04-22/20260422193014.yml' | grep -B1 -A3 "primary: true"
```

Expected: Mario Kart entry with `primary: true` (this is the persisted output from the OLD algorithm — the file itself doesn't auto-update).

- [ ] **Step 2: Re-run primary selection logic against the session's media events using a one-off script**

Run:

```bash
cd /opt/Code/DaylightStation && node -e "
const { selectPrimaryMedia } = await import('./backend/src/1_adapters/fitness/selectPrimaryMedia.mjs');
const yaml = await import('js-yaml');
const fs = await import('fs');

const raw = (await import('child_process')).execSync('sudo docker exec daylight-station sh -c \"cat data/household/history/fitness/2026-04-22/20260422193014.yml\"').toString();
const session = yaml.load(raw);
const events = (session.timeline?.events || []).filter(e => e?.type === 'media');

// Match runtime config shape
const config = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\\\s-]?up', 'cool[\\\\s-]?down', 'stretch', 'recovery'],
  deprioritized_labels: ['KidsFun'],
};

const primary = selectPrimaryMedia(events, config);
console.log('Primary:', primary?.data?.title, 'contentId=', primary?.data?.contentId);
"
```

Expected output:

```
Primary: Week 1 Day 2 - Lower Body contentId= plex:674499
```

(Previously this would have output `Mario Kart World contentId= plex:661996`.)

If the output is wrong, debug Task 4's implementation. Note the session's Mario Kart event carries `labels: [kidsfun, ...]` (lowercase in the persisted YAML), so the config's `KidsFun` label must match case-sensitively. Check the actual labels with:

```bash
sudo docker exec daylight-station sh -c 'grep -B1 "KidsFun\|kidsfun" data/household/history/fitness/2026-04-22/20260422193014.yml'
```

Note: real session labels are lowercase (`kidsfun`) while config is CamelCase (`KidsFun`). The matcher in Task 4 already handles this case-insensitively, so this should work. If it doesn't, debug the casing logic in `buildDeprioritizedChecker`.

- [ ] **Step 3: Optional — trigger a Strava re-enrichment to confirm the title would change in production**

Run:

```bash
curl -s -X POST "http://localhost:3111/api/v1/fitness/sessions/20260422193014/enrich-strava-dryrun" 2>/dev/null | head -20
```

(If a dry-run endpoint doesn't exist, skip this step — the unit + integration logic verified in Steps 1-2 is sufficient.)

- [ ] **Step 4: Final test sweep — confirm nothing else broke**

Run:

```bash
cd /opt/Code/DaylightStation && npm run test:unit -- --pattern=selectPrimaryMedia
```

Expected: green across all selectPrimaryMedia tests.

Run also:

```bash
cd /opt/Code/DaylightStation && npx jest tests/isolated/adapter/fitness/
```

Expected: green across all backend adapter fitness tests.

- [ ] **Step 5: Update memory if anything surprising came up**

If Step 2 surfaced a label-casing issue, save a feedback memory documenting the canonical casing of Plex labels in persisted session YAML vs. config YAML.

---

## Done

Summary of what changed:

- **Algorithm:** `selectPrimaryMedia` (both files) now drops warmup OR deprioritized as one combined skip step, with the same fallback semantics as before.
- **Config:** `plex.deprioritized_labels: [KidsFun]` added to `data/household/config/fitness.yml`.
- **Wiring:** 4 call sites pass the new field through to the algorithm.
- **Tests:** 3 new frontend cases, 1 new backend test file with 7 cases (3 of which are new behavior, 4 lock in existing behavior + the warmup-checker stays-warmup-only assertion).
- **Strava:** No code change. Title now reflects the real workout instead of kids content; description chronological list is unchanged.
- **Out of scope:** suggestions (already excludes `KidsFun` via `discovery_exclude_labels`), the `warmupConfig` variable name (kept; only the shape grew), warmup `(warmup)` annotation in Strava (intentionally unchanged).
