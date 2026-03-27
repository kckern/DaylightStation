# Primary Media Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the naive longest-duration primary media selection with a warmup/music-aware algorithm, and enrich Strava descriptions with all media played.

**Architecture:** Two independent `selectPrimaryMedia` functions (frontend JS + backend ESM) share the same algorithm but differ in input shape. The frontend version is called from `PersistenceManager` during session save; the backend version is called from `buildStravaDescription` during Strava enrichment. Both read warmup config from the fitness YAML.

**Tech Stack:** Vanilla JS (frontend), Node.js ESM (backend), Jest for testing, YAML config

**Spec:** `docs/superpowers/specs/2026-03-27-primary-media-selection-design.md`

---

### Task 1: Frontend `selectPrimaryMedia` — Tests

**Files:**
- Create: `tests/unit/fitness/selectPrimaryMedia.test.mjs`

- [ ] **Step 1: Write test file with all test cases**

```javascript
import { selectPrimaryMedia } from '../../../frontend/src/hooks/fitness/selectPrimaryMedia.js';

// ─── Test data factories ───

function vid(title, durationMs, overrides = {}) {
  return { contentId: `plex:${Math.random()}`, title, mediaType: 'video', durationMs, ...overrides };
}

function audio(title, durationMs) {
  return { contentId: `plex:${Math.random()}`, title, mediaType: 'audio', artist: 'Artist', durationMs };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]', '[Stretch]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
};

// ─── Tests ───

describe('selectPrimaryMedia', () => {
  test('returns null for empty array', () => {
    expect(selectPrimaryMedia([], defaultConfig)).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(selectPrimaryMedia(null)).toBeNull();
    expect(selectPrimaryMedia(undefined)).toBeNull();
  });

  test('picks longest video when no warmups', () => {
    const items = [vid('Short', 5000), vid('Long', 10000)];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Long');
  });

  test('filters out audio — never selected as primary', () => {
    const items = [audio('Long Song', 999999), vid('Short Video', 5000)];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Short Video');
  });

  test('filters out warmup by title pattern — "warm-up"', () => {
    const items = [
      vid('Ten minute warm-up', 10000),
      vid('Shoulders 2', 9000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Shoulders 2');
  });

  test('filters out warmup by title pattern — "Stretch"', () => {
    const items = [
      vid('LIIFT4 Stretch', 12000),
      vid('Chest Day', 10000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Chest Day');
  });

  test('filters out warmup by title pattern — "cool-down"', () => {
    const items = [
      vid('5 Minute Cool-Down', 11000),
      vid('Leg Day', 10000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Leg Day');
  });

  test('filters out warmup by title pattern — "Recovery"', () => {
    const items = [
      vid('Recovery Day', 11000),
      vid('Chest Day', 10000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Chest Day');
  });

  test('title matching is case-insensitive', () => {
    const items = [
      vid('WARM UP Session', 10000),
      vid('Real Workout', 9000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by labels', () => {
    const items = [
      vid('Generic Title', 10000, { labels: ['Warmup'] }),
      vid('Real Workout', 9000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by description tag — "[Warmup]"', () => {
    const items = [
      vid('Generic Title', 10000, { description: 'A [Warmup] for beginners' }),
      vid('Real Workout', 9000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Real Workout');
  });

  test('filters out warmup by description tag — "[Cooldown]"', () => {
    const items = [
      vid('Post Workout', 10000, { description: '[Cooldown] stretch routine' }),
      vid('Main Workout', 9000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Main Workout');
  });

  test('falls back to longest video when ALL videos are warmups', () => {
    const items = [
      vid('Short Warm-Up', 5000),
      vid('Long Warm-Up', 10000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Long Warm-Up');
  });

  test('falls back to longest video when only audio + warmups', () => {
    const items = [
      audio('Song', 999999),
      vid('Warm-Up', 10000),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).title).toBe('Warm-Up');
  });

  test('works with no warmupConfig — uses built-in defaults', () => {
    const items = [
      vid('Ten minute warm-up', 10000),
      vid('Shoulders 2', 9000),
    ];
    expect(selectPrimaryMedia(items).title).toBe('Shoulders 2');
  });

  test('works with empty warmupConfig — uses built-in defaults only', () => {
    const items = [
      vid('Ten minute warm-up', 10000),
      vid('Shoulders 2', 9000),
    ];
    expect(selectPrimaryMedia(items, {}).title).toBe('Shoulders 2');
  });

  test('config title patterns extend built-in defaults', () => {
    const config = { ...defaultConfig, warmup_title_patterns: ['cardio blast'] };
    const items = [
      vid('Cardio Blast', 10000),
      vid('Real Workout', 9000),
    ];
    // "Cardio Blast" matches config pattern
    expect(selectPrimaryMedia(items, config).title).toBe('Real Workout');
  });

  test('mixed session — warmup + workout + music', () => {
    const items = [
      vid('Ten minute warm-up', 650000),
      vid('Shoulders 2', 647000),
      audio('Harlem Shake', 196000),
      audio('Gangnam Style', 217000),
    ];
    const result = selectPrimaryMedia(items, defaultConfig);
    expect(result.title).toBe('Shoulders 2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs --no-cache 2>&1 | tail -20`
Expected: FAIL — module `selectPrimaryMedia.js` not found

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/unit/fitness/selectPrimaryMedia.test.mjs
git commit -m "test: add selectPrimaryMedia unit tests (red)"
```

---

### Task 2: Frontend `selectPrimaryMedia` — Implementation

**Files:**
- Create: `frontend/src/hooks/fitness/selectPrimaryMedia.js`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Select the primary media item from a session's media array.
 *
 * Filters out audio and warmup videos, then picks longest duration.
 * Falls back to longest video overall if all are filtered out.
 *
 * @param {Array} mediaItems - Media summary objects from buildSessionSummary
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
 * @returns {Object|null} The selected primary media item
 */

const BUILTIN_TITLE_PATTERNS = [
  /warm[\s-]?up/i,
  /cool[\s-]?down/i,
  /stretch/i,
];

export function selectPrimaryMedia(mediaItems, warmupConfig) {
  if (!Array.isArray(mediaItems) || mediaItems.length === 0) return null;

  // Step 1: Filter out audio
  const videos = mediaItems.filter(m => m.mediaType !== 'audio');
  if (videos.length === 0) return null;

  // Step 2: Build warmup matchers
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (warmupConfig?.warmup_title_patterns?.length) {
    for (const p of warmupConfig.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip invalid regex */ }
    }
  }
  const descTags = warmupConfig?.warmup_description_tags || [];
  const warmupLabels = warmupConfig?.warmup_labels || [];

  function isWarmup(item) {
    // Check labels
    if (warmupLabels.length && Array.isArray(item.labels)) {
      for (const label of warmupLabels) {
        if (item.labels.includes(label)) return true;
      }
    }
    // Check description tags
    if (descTags.length && item.description) {
      for (const tag of descTags) {
        if (item.description.includes(tag)) return true;
      }
    }
    // Check title patterns
    if (item.title) {
      for (const re of titlePatterns) {
        if (re.test(item.title)) return true;
      }
    }
    return false;
  }

  // Step 3: Filter warmups, pick longest
  const candidates = videos.filter(v => !isWarmup(v));

  const pool = candidates.length > 0 ? candidates : videos; // fallback
  return pool.reduce((best, item) =>
    (item.durationMs || 0) > (best.durationMs || 0) ? item : best
  );
}

export default selectPrimaryMedia;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/fitness/selectPrimaryMedia.test.mjs --no-cache 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js
git commit -m "feat: add selectPrimaryMedia function (frontend)"
```

---

### Task 3: Integrate `selectPrimaryMedia` into `buildSessionSummary`

**Files:**
- Modify: `frontend/src/hooks/fitness/buildSessionSummary.js` (lines 34, 66-93)
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (lines 1012-1017, 1093-1096)

- [ ] **Step 1: Update `buildSessionSummary.js`**

In `buildSessionSummary.js`:

1. Add import at top:
```javascript
import { selectPrimaryMedia } from './selectPrimaryMedia.js';
```

2. Add `warmupConfig` to the function signature (line 34):
```javascript
export function buildSessionSummary({ participants, series, events, treasureBox, intervalSeconds, warmupConfig }) {
```

3. Add `labels` to the media mapping (after line 80, inside the `mediaEvents.map` return object):
```javascript
      ...(Array.isArray(d.labels) && d.labels.length ? { labels: d.labels } : {}),
```

4. Replace lines 84-93 (the inline longest-duration loop) with:
```javascript
  // Mark primary media (warmup-aware selection)
  const primary = selectPrimaryMedia(media, warmupConfig);
  if (primary) {
    primary.primary = true;
  }
```

- [ ] **Step 2: Update `PersistenceManager.js`**

1. Add a setter for warmup config (after `setSeriesLengthValidator` around line 542):
```javascript
  setWarmupConfig(config) {
    this._warmupConfig = config || null;
  }
```

2. Add `warmupConfig` to `summaryInputs` (line 1012-1017). Change:
```javascript
    const summaryInputs = persistSessionData.timeline?.series ? {
      participants: persistSessionData.participants || {},
      series: persistSessionData.timeline.series,
      treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
      intervalSeconds: persistSessionData.timeline.interval_seconds || 5,
    } : null;
```
to:
```javascript
    const summaryInputs = persistSessionData.timeline?.series ? {
      participants: persistSessionData.participants || {},
      series: persistSessionData.timeline.series,
      treasureBox: persistSessionData.treasureBox || sessionData.treasureBox,
      intervalSeconds: persistSessionData.timeline.interval_seconds || 5,
      warmupConfig: this._warmupConfig,
    } : null;
```

- [ ] **Step 3: Wire warmup config from FitnessContext to PersistenceManager**

In `frontend/src/context/FitnessContext.jsx`, find where `fitnessSessionRef.current` is configured after creation (near line 241-328). After the existing `_persistenceManager.setSeriesLengthValidator` call (which is in `FitnessSession.js` constructor), add a useEffect that updates the warmup config when `plexConfig` changes:

Find the `useEffect` that watches `fitnessConfiguration` or `plexConfig` (around line 434-486 where plex config is parsed). After `plexConfig` is computed, add:
```javascript
  // Pass warmup config to persistence manager for primary media selection
  useEffect(() => {
    const pm = fitnessSessionRef.current?._persistenceManager;
    if (pm && plexConfig) {
      pm.setWarmupConfig({
        warmup_labels: plexConfig.warmup_labels || [],
        warmup_description_tags: plexConfig.warmup_description_tags || [],
        warmup_title_patterns: plexConfig.warmup_title_patterns || [],
      });
    }
  }, [plexConfig]);
```

Note: `_persistenceManager` is accessed via `fitnessSessionRef.current`. This follows the existing pattern where `FitnessContext` configures `FitnessSession` internals (see `setLogCallback`, `setSeriesLengthValidator`).

- [ ] **Step 4: Run existing tests to ensure no regressions**

Run: `npx jest tests/unit/fitness/ --no-cache 2>&1 | tail -20`
Expected: All tests PASS (including the new selectPrimaryMedia tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/buildSessionSummary.js frontend/src/hooks/fitness/PersistenceManager.js frontend/src/context/FitnessContext.jsx
git commit -m "feat: integrate selectPrimaryMedia into session save flow"
```

---

### Task 4: Backend `selectPrimaryMedia` — Tests

**Files:**
- Create: `tests/unit/suite/fitness/selectPrimaryMedia.test.mjs`

- [ ] **Step 1: Write test file**

```javascript
import { selectPrimaryMedia } from '../../../../backend/src/1_adapters/fitness/selectPrimaryMedia.mjs';

// ─── Test data factories ───

function episodeEvent(title, durationSeconds, overrides = {}) {
  return {
    type: 'media',
    timestamp: Date.now(),
    data: {
      contentType: 'episode',
      title,
      durationSeconds,
      grandparentTitle: overrides.grandparentTitle || 'Show',
      ...overrides,
    },
  };
}

function trackEvent(title, durationSeconds, artist = 'Artist') {
  return {
    type: 'media',
    timestamp: Date.now(),
    data: { contentType: 'track', title, artist, durationSeconds },
  };
}

const defaultConfig = {
  warmup_labels: ['Warmup', 'Cooldown'],
  warmup_description_tags: ['[Warmup]', '[Cooldown]'],
  warmup_title_patterns: ['warm[\\s-]?up', 'cool[\\s-]?down', 'stretch', 'recovery'],
};

// ─── Tests ───

describe('selectPrimaryMedia (backend)', () => {
  test('returns null for empty array', () => {
    expect(selectPrimaryMedia([], defaultConfig)).toBeNull();
  });

  test('returns null for null/undefined', () => {
    expect(selectPrimaryMedia(null)).toBeNull();
    expect(selectPrimaryMedia(undefined)).toBeNull();
  });

  test('picks longest episode', () => {
    const items = [episodeEvent('Short', 300), episodeEvent('Long', 600)];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Long');
  });

  test('filters out music tracks', () => {
    const items = [trackEvent('Song', 9999), episodeEvent('Workout', 300)];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Workout');
  });

  test('filters warmup by title', () => {
    const items = [
      episodeEvent('Ten minute warm-up', 650),
      episodeEvent('Shoulders 2', 647),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Shoulders 2');
  });

  test('filters warmup by labels', () => {
    const items = [
      episodeEvent('Generic', 650, { labels: ['Warmup'] }),
      episodeEvent('Real Workout', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Real Workout');
  });

  test('filters warmup by description tag', () => {
    const items = [
      episodeEvent('Intro', 650, { description: '[Warmup] get ready' }),
      episodeEvent('Main', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Main');
  });

  test('falls back to longest video when all are warmups', () => {
    const items = [
      episodeEvent('Short Warm-Up', 300),
      episodeEvent('Long Warm-Up', 600),
    ];
    expect(selectPrimaryMedia(items, defaultConfig).data.title).toBe('Long Warm-Up');
  });

  test('returns full event object, not just .data', () => {
    const items = [episodeEvent('Workout', 600)];
    const result = selectPrimaryMedia(items, defaultConfig);
    expect(result).toHaveProperty('type', 'media');
    expect(result).toHaveProperty('data');
    expect(result.data.title).toBe('Workout');
  });

  test('uses built-in defaults without config', () => {
    const items = [
      episodeEvent('Warm-Up', 650),
      episodeEvent('Workout', 600),
    ];
    expect(selectPrimaryMedia(items).data.title).toBe('Workout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/selectPrimaryMedia.test.mjs --no-cache 2>&1 | tail -20`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/unit/suite/fitness/selectPrimaryMedia.test.mjs
git commit -m "test: add backend selectPrimaryMedia unit tests (red)"
```

---

### Task 5: Backend `selectPrimaryMedia` — Implementation

**Files:**
- Create: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`

- [ ] **Step 1: Write the implementation**

```javascript
/**
 * Select the primary media event from a session's timeline events.
 *
 * Same algorithm as frontend selectPrimaryMedia, adapted for backend
 * timeline event objects where data lives under event.data.
 *
 * @param {Array} mediaEvents - Timeline event objects with { data: { title, durationSeconds, ... } }
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
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
 * @param {Object} [warmupConfig]
 * @returns {Function} (event) => boolean
 */
export function buildWarmupChecker(warmupConfig) {
  const titlePatterns = [...BUILTIN_TITLE_PATTERNS];
  if (warmupConfig?.warmup_title_patterns?.length) {
    for (const p of warmupConfig.warmup_title_patterns) {
      try { titlePatterns.push(new RegExp(p, 'i')); } catch { /* skip */ }
    }
  }
  const descTags = warmupConfig?.warmup_description_tags || [];
  const warmupLabels = warmupConfig?.warmup_labels || [];

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

export function selectPrimaryMedia(mediaEvents, warmupConfig) {
  if (!Array.isArray(mediaEvents) || mediaEvents.length === 0) return null;

  // Step 1: Filter out audio (tracks / items with artist)
  const episodes = mediaEvents.filter(e => {
    const d = e?.data;
    return d && d.contentType !== 'track' && !d.artist;
  });
  if (episodes.length === 0) return null;

  // Step 2: Filter warmups, pick longest by durationSeconds
  const isWarmup = buildWarmupChecker(warmupConfig);
  const candidates = episodes.filter(e => !isWarmup(e));
  const pool = candidates.length > 0 ? candidates : episodes;

  return pool.reduce((best, event) => {
    const bestSec = best.data?.durationSeconds || 0;
    const evSec = event.data?.durationSeconds || 0;
    return evSec > bestSec ? event : best;
  });
}

export default selectPrimaryMedia;
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/selectPrimaryMedia.test.mjs --no-cache 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
git commit -m "feat: add selectPrimaryMedia function (backend)"
```

---

### Task 6: Update `buildStravaDescription` — Tests

**Files:**
- Modify: `tests/unit/suite/fitness/buildStravaDescription.test.mjs`

- [ ] **Step 1: Add warmup-aware and new description format tests**

Append these test suites to the existing test file:

```javascript
// ═══════════════════════════════════════════════════════════════════════════════
// WARMUP-AWARE PRIMARY SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — warmup-aware primary selection', () => {
  const warmupConfig = {
    warmup_labels: ['Warmup'],
    warmup_description_tags: ['[Warmup]'],
    warmup_title_patterns: ['warm[\\s-]?up', 'stretch'],
  };

  test('selects non-warmup video as primary even if warmup is longer', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Ten minute warm-up',
          durationSeconds: 650,
          start: now,
          end: now + 10 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: '10 Minute Muscle',
          title: 'Shoulders 2',
          durationSeconds: 647,
          start: now + 10 * 60 * 1000,
          end: now + 21 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.name).toBe('10 Minute Muscle\u2014Shoulders 2');
  });

  test('falls back to warmup if all episodes are warmups', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Warm-Up',
          durationSeconds: 600,
          start: now,
          end: now + 10 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.name).toBe('Insanity\u2014Warm-Up');
  });

  test('backward compatible — works without warmupConfig', () => {
    const session = createSession({
      events: [createEpisodeEvent()],
    });
    const result = buildStravaDescription(session);
    expect(result).not.toBeNull();
    expect(result.name).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW DESCRIPTION FORMAT — ALL EPISODES + INDIVIDUAL MUSIC TRACKS
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildStravaDescription — new description format', () => {
  test('lists all episodes chronologically, not just watched >= 2min', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Show A',
          title: 'Ep A',
          start: now,
          end: now + 60 * 1000, // 1 min — would have been filtered before
        }),
        createEpisodeEvent({
          grandparentTitle: 'Show B',
          title: 'Ep B',
          start: now + 60 * 1000,
          end: now + 31 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('Show A');
    expect(result.description).toContain('Show B');
  });

  test('annotates warmup episodes with (warmup)', () => {
    const now = Date.now();
    const warmupConfig = {
      warmup_labels: [],
      warmup_description_tags: [],
      warmup_title_patterns: ['warm[\\s-]?up'],
    };
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Insanity',
          title: 'Ten minute warm-up',
          start: now,
          end: now + 10 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: '10 Minute Muscle',
          title: 'Shoulders 2',
          start: now + 10 * 60 * 1000,
          end: now + 21 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session, {}, warmupConfig);
    expect(result.description).toContain('Ten minute warm-up (warmup)');
    expect(result.description).not.toContain('Shoulders 2 (warmup)');
  });

  test('episodes ordered chronologically (earliest first)', () => {
    const now = Date.now();
    const session = createSession({
      events: [
        createEpisodeEvent({
          grandparentTitle: 'Second',
          title: 'Ep 2',
          start: now + 20 * 60 * 1000,
          end: now + 40 * 60 * 1000,
        }),
        createEpisodeEvent({
          grandparentTitle: 'First',
          title: 'Ep 1',
          start: now,
          end: now + 20 * 60 * 1000,
        }),
      ],
    });
    const result = buildStravaDescription(session);
    const firstIdx = result.description.indexOf('First');
    const secondIdx = result.description.indexOf('Second');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  test('music tracks listed one per line with 🎵 emoji, no "Playlist" header', () => {
    const session = createSession({
      events: [
        createMusicEvent({ artist: 'Radiohead', title: 'Creep' }),
        createMusicEvent({ artist: 'Nirvana', title: 'Smells Like Teen Spirit' }),
      ],
    });
    const result = buildStravaDescription(session);
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Nirvana \u2014 Smells Like Teen Spirit');
    expect(result.description).not.toContain('Playlist');
  });
});
```

- [ ] **Step 2: Run tests to see which fail**

Run: `npx jest tests/unit/suite/fitness/buildStravaDescription.test.mjs --no-cache 2>&1 | tail -30`
Expected: New tests FAIL (old tests may also fail due to signature change — that's expected)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/suite/fitness/buildStravaDescription.test.mjs
git commit -m "test: add warmup-aware and new format tests for buildStravaDescription (red)"
```

---

### Task 7: Update `buildStravaDescription` — Implementation

**Files:**
- Modify: `backend/src/1_adapters/fitness/buildStravaDescription.mjs`

- [ ] **Step 1: Rewrite `buildStravaDescription.mjs`**

Key changes:
1. Import `selectPrimaryMedia` from `./selectPrimaryMedia.mjs`
2. Add `warmupConfig` as third parameter
3. Replace the three-tier fallback with `selectPrimaryMedia(episodeEvents, warmupConfig)`
4. Update primary media property access to use `.data.` prefix (since `selectPrimaryMedia` returns the full event)
5. Rewrite description: list ALL episodes chronologically, annotate warmups, music one-per-line with 🎵
6. Remove `_selectPrimaryEpisode()`, `MIN_WATCH_MS`, `_getEpisodeWatchMs()`
7. Add truncation for Strava 700-char limit

The full rewritten file:

```javascript
/**
 * buildStravaDescription
 *
 * Pure function that builds a Strava activity name and description
 * from a DaylightStation fitness session.
 *
 * Title:       primary episode (warmup-aware) → "Show — Episode"
 * Description: voice memos, then all episodes chronologically
 *              (warmups annotated), then music tracks one-per-line
 *
 * @module adapters/fitness/buildStravaDescription
 */

import { selectPrimaryMedia, buildWarmupChecker } from './selectPrimaryMedia.mjs';

const STRAVA_DESC_LIMIT = 700;

/**
 * Build Strava activity enrichment payload from a session.
 *
 * @param {Object} session - Parsed session YAML data
 * @param {Object} [currentActivity] - Current Strava activity (for skip logic)
 * @param {Object} [warmupConfig] - { warmup_labels, warmup_description_tags, warmup_title_patterns }
 * @returns {{ name: string|null, description: string|null }|null}
 *   null if nothing to enrich
 */
export function buildStravaDescription(session, currentActivity = {}, warmupConfig = null) {
  const events = session?.timeline?.events || [];
  const summary = session?.summary || {};

  // Extract media events — separate episodes from music tracks
  const mediaEvents = events.filter(e => e?.type === 'media');
  const musicTracks = mediaEvents.filter(e => e?.data?.artist || e?.data?.contentType === 'track');
  const episodeEvents = mediaEvents.filter(e => !e?.data?.artist && e?.data?.contentType !== 'track');

  // Primary episode — warmup-aware selection
  const primaryEvent = selectPrimaryMedia(episodeEvents, warmupConfig);
  const primaryData = primaryEvent?.data || null;

  // Extract voice memos
  const voiceMemos = events
    .filter(e => e?.type === 'voice_memo' && e?.data?.transcript)
    .map(e => e.data);

  // Nothing to enrich
  if (!primaryData && voiceMemos.length === 0 && musicTracks.length === 0) {
    return null;
  }

  // Build title from primary episode
  let name = null;
  if (primaryData) {
    const show = primaryData.grandparentTitle || primaryData.showTitle || null;
    const episode = primaryData.title || null;

    if (show && episode) {
      name = `${show}\u2014${episode}`;
    } else if (show) {
      name = show;
    } else if (episode) {
      name = episode;
    }
  }

  // Skip title if already enriched with a DaylightStation-style name
  if (name && currentActivity.name && currentActivity.name.includes('\u2014')) {
    name = null;
  }

  // Skip description if already set
  if (currentActivity.description && currentActivity.description.trim()) {
    return name ? { name, description: null } : null;
  }

  // Build description
  const parts = [];

  // Voice memos first
  if (voiceMemos.length > 0) {
    const memoTexts = voiceMemos
      .map(m => `\uD83C\uDF99\uFE0F "${m.transcript.trim()}"`)
      .join('\n\n');
    parts.push(memoTexts);
  }

  // All episodes chronologically (earliest first)
  const sortedEpisodes = [...episodeEvents].sort((a, b) => {
    const aStart = a.data?.start ?? a.timestamp ?? 0;
    const bStart = b.data?.start ?? b.timestamp ?? 0;
    return aStart - bStart;
  });

  // Reuse the same warmup checker from selectPrimaryMedia for annotation
  const isWarmupEpisode = buildWarmupChecker(warmupConfig);

  const episodeParts = [];
  for (const ep of sortedEpisodes) {
    const label = _formatMediaLabel(ep.data);
    if (!label) continue;
    const warmupTag = isWarmupEpisode(ep) ? ' (warmup)' : '';
    const desc = ep.data?.description ? _flattenText(ep.data.description) : null;
    episodeParts.push(desc
      ? `\uD83D\uDDA5\uFE0F ${label}${warmupTag}\n${desc}`
      : `\uD83D\uDDA5\uFE0F ${label}${warmupTag}`
    );
  }
  if (episodeParts.length) parts.push(episodeParts.join('\n\n'));

  // Music tracks one per line
  const trackLines = musicTracks
    .map(e => {
      const { title, artist } = e.data;
      if (!title && !artist) return null;
      const line = artist ? `${artist} \u2014 ${title}` : title;
      return `\uD83C\uDFB5 ${line}`;
    })
    .filter(Boolean);
  if (trackLines.length > 0) {
    parts.push(trackLines.join('\n'));
  }

  let description = parts.length > 0 ? parts.join('\n\n') : null;

  // Truncate for Strava limit
  if (description && description.length > STRAVA_DESC_LIMIT) {
    description = _truncateDescription(parts, episodeParts, trackLines, STRAVA_DESC_LIMIT);
  }

  if (!name && !description) {
    return null;
  }

  return { name, description };
}

/**
 * Truncate description to fit Strava limit.
 * Priority: keep voice memos + episode titles, drop music tracks first, then episode descriptions.
 */
function _truncateDescription(parts, episodeParts, trackLines, limit) {
  // Try without music tracks
  const withoutMusic = parts.slice(0, -1); // drop last part (music)
  let desc = withoutMusic.length > 0 ? withoutMusic.join('\n\n') : '';
  if (trackLines.length > 0 && desc.length < limit) {
    // Add back as many tracks as fit
    const remaining = limit - desc.length - 2; // -2 for \n\n separator
    if (remaining > 0) {
      let musicBlock = '';
      for (const line of trackLines) {
        const next = musicBlock ? musicBlock + '\n' + line : line;
        if (next.length > remaining) break;
        musicBlock = next;
      }
      if (musicBlock) desc = desc + '\n\n' + musicBlock;
    }
  }
  if (desc.length <= limit) return desc;

  // Still over — trim episode descriptions to titles only
  const trimmedEpisodes = episodeParts.map(ep => ep.split('\n')[0]); // first line only
  const nonEpisodeParts = parts.filter(p => !episodeParts.includes(p) && !trackLines.some(t => p.includes(t)));
  desc = [...nonEpisodeParts, trimmedEpisodes.join('\n\n')].filter(Boolean).join('\n\n');
  return desc.slice(0, limit);
}

/**
 * Collapse whitespace in a description to single spaces.
 */
function _flattenText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Format: "Show — Episode" or just show/episode.
 */
function _formatMediaLabel(media) {
  const show = media.grandparentTitle || media.showTitle || null;
  const episode = media.title || null;

  if (show && episode) return `${show} \u2014 ${episode}`;
  if (show) return show;
  if (episode) return episode;
  return null;
}

export default buildStravaDescription;
```

- [ ] **Step 2: Update existing tests that break due to signature/format changes**

These specific tests in `buildStravaDescription.test.mjs` need updating:

**Line 107-118** — "returns name but no description when session has only brief media (< 2 min)":
The 2-min filter is removed. Brief episodes now appear in the description. Change:
```javascript
    expect(result.description).toBeNull();
```
to:
```javascript
    expect(result.description).not.toBeNull(); // all episodes now listed
```

**Line 337** — "includes music playlist with musical note emoji":
Change `expect(result.description).toContain('\uD83C\uDFB5 Playlist')` to:
```javascript
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Nirvana \u2014 Smells Like Teen Spirit');
    expect(result.description).not.toContain('Playlist');
```

**Lines 409-414** — "music tracks with no title and no artist are excluded from playlist":
Replace the `split('Playlist')` parsing with:
```javascript
    // Count 🎵 lines — should only be 1 (the valid track)
    const musicLines = result.description.split('\n').filter(l => l.includes('\uD83C\uDFB5'));
    expect(musicLines).toHaveLength(1);
```

**Line 487** — "excludes episodes watched < 2 minutes from description":
The 2-min filter is removed. Change:
```javascript
    expect(result.description).not.toContain('Brief Show');
```
to:
```javascript
    expect(result.description).toContain('Brief Show'); // all episodes now listed
```

**Line 562** — "returns playlist description with null title for music-only":
Change `expect(result.description).toContain('\uD83C\uDFB5 Playlist')` to:
```javascript
    expect(result.description).toContain('\uD83C\uDFB5 Radiohead \u2014 Creep');
    expect(result.description).toContain('\uD83C\uDFB5 Muse \u2014 Hysteria');
    expect(result.description).not.toContain('Playlist');
```

**Line 689** — "events with artist field are classified as music, not episodes":
Change `expect(result.description).toContain('\uD83C\uDFB5 Playlist')` to:
```javascript
    expect(result.description).toContain('\uD83C\uDFB5 Some Artist \u2014 Some Video');
```

**Line 700** — "events with contentType 'track' are classified as music":
Change `expect(result.description).toContain('\uD83C\uDFB5 Playlist')` to:
```javascript
    expect(result.description).toContain('\uD83C\uDFB5 Ambient');
```

- [ ] **Step 3: Run all buildStravaDescription tests**

Run: `npx jest tests/unit/suite/fitness/buildStravaDescription.test.mjs --no-cache 2>&1 | tail -30`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/1_adapters/fitness/buildStravaDescription.mjs tests/unit/suite/fitness/buildStravaDescription.test.mjs
git commit -m "feat: warmup-aware primary selection and enriched Strava descriptions"
```

---

### Task 8: Wire warmup config in `FitnessActivityEnrichmentService`

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` (line 212)

- [ ] **Step 1: Read the warmup config and pass to buildStravaDescription**

In `_attemptEnrichment()`, before the `buildStravaDescription` call at line 212, add config reading:

```javascript
      // Read warmup config for primary media selection
      const fitnessConfig = this.#configService.getAppConfig('fitness');
      const plex = fitnessConfig?.plex || {};
      const warmupConfig = {
        warmup_labels: plex.warmup_labels || [],
        warmup_description_tags: plex.warmup_description_tags || [],
        warmup_title_patterns: plex.warmup_title_patterns || [],
      };
```

Then change line 212 from:
```javascript
      const enrichment = buildStravaDescription(session, currentActivity);
```
to:
```javascript
      const enrichment = buildStravaDescription(session, currentActivity, warmupConfig);
```

- [ ] **Step 2: Run all fitness-related tests**

Run: `npx jest tests/unit/suite/fitness/ tests/unit/fitness/ --no-cache 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs
git commit -m "feat: pass warmup config to buildStravaDescription from enrichment service"
```

---

### Task 9: Add warmup config to fitness.yml

**Files:**
- Modify: `data/household/config/fitness.yml` (inside Docker container)

- [ ] **Step 1: Read current fitness config**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml'
```

- [ ] **Step 2: Add warmup config keys under `plex:` section**

Add these keys alongside existing label configs (after `governed_labels`, before any non-plex section):

```yaml
  warmup_labels:
    - Warmup
    - Cooldown
  warmup_description_tags:
    - "[Warmup]"
    - "[Cooldown]"
    - "[Stretch]"
  warmup_title_patterns:
    - "warm[\\s-]?up"
    - "cool[\\s-]?down"
    - "stretch"
    - "recovery"
```

Use `sudo docker exec daylight-station sh -c 'cat > data/...'` with the complete file contents (never sed).

- [ ] **Step 3: Verify the config is valid**

```bash
sudo docker exec daylight-station sh -c 'node -e "const yaml=require(\"js-yaml\"); const fs=require(\"fs\"); const d=yaml.load(fs.readFileSync(\"data/household/config/fitness.yml\")); console.log(JSON.stringify(d.plex, null, 2))"'
```

Expected: JSON output showing `warmup_labels`, `warmup_description_tags`, `warmup_title_patterns` alongside existing plex config.

- [ ] **Step 4: No git commit** — this file is in the Docker data volume, not in the repo.

---

### Task 10: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all fitness unit tests**

Run: `npx jest tests/unit/suite/fitness/ tests/unit/fitness/ --no-cache 2>&1 | tail -30`
Expected: All tests PASS, no regressions

- [ ] **Step 2: Run the full unit test harness**

Run: `npm run test:unit 2>&1 | tail -40`
Expected: No new failures

- [ ] **Step 3: Verify no lint/import issues**

Run: `node -e "import('./frontend/src/hooks/fitness/selectPrimaryMedia.js')" 2>&1`
Run: `node -e "import('./backend/src/1_adapters/fitness/selectPrimaryMedia.mjs')" 2>&1`
Expected: No import errors
