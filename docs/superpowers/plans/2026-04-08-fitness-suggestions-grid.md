# Fitness Suggestions Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fitness home screen right panel with a unified suggestions grid powered by five backend strategies (next-up, resume, favorite, memorable, discovery) that always fills two rows of cards.

**Architecture:** Single `GET /api/v1/fitness/suggestions` endpoint backed by `FitnessSuggestionService` orchestrator that runs strategy classes in priority order. Frontend renders a CSS Grid of `SuggestionCard` components. Strategies are independent classes in `backend/src/3_applications/fitness/suggestions/`.

**Tech Stack:** Express.js (backend), React + Mantine (frontend), Jest (tests), YAML config

**Spec:** `docs/superpowers/specs/2026-04-08-fitness-suggestions-grid-design.md`

---

## File Map

### Backend (new files)

| File | Purpose |
|------|---------|
| `backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs` | Orchestrator — runs strategies, deduplicates, fills grid |
| `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs` | Recent programs → next unwatched episode |
| `backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs` | Partial playhead on Resumable shows |
| `backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs` | Config-defined evergreen content |
| `backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs` | High-impact past episodes (suffer score) |
| `backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs` | Lapsed + random fill |
| `tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs` | Orchestrator unit tests |
| `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs` | NextUp strategy tests |
| `tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs` | Resume strategy tests |
| `tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs` | Favorite strategy tests |
| `tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs` | Memorable strategy tests |
| `tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs` | Discovery strategy tests |

### Backend (modified files)

| File | Change |
|------|--------|
| `backend/src/4_api/v1/routers/fitness.mjs` | Add `GET /suggestions` route |
| `backend/src/0_system/bootstrap.mjs` | Wire `FitnessSuggestionService` into `createFitnessApiRouter` |

### Frontend (new files)

| File | Purpose |
|------|---------|
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx` | Grid widget component |
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss` | Grid and card styles |
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx` | Individual card component |
| `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/index.jsx` | Re-export |

### Frontend (modified files)

| File | Change |
|------|--------|
| `frontend/src/modules/Fitness/index.js` | Register `fitness:suggestions` widget |

### Config (modified via docker exec)

| File | Change |
|------|--------|
| `data/household/config/fitness.yml` (in container) | Add `suggestions:` block, update `screens.home` layout + data sources |

---

## Task 1: NextUpStrategy

The core strategy — extracts distinct shows from recent sessions and resolves the next unwatched episode per show. All other strategies follow this same pattern, so getting this right sets the template.

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs`
- Create: `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`

- [ ] **Step 1: Write the test file with factory helpers and first test**

```javascript
// tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
import { NextUpStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs';

// --- Factories ---

function makeSession(showId, showTitle, contentId, episodeTitle, date, overrides = {}) {
  return {
    sessionId: date.replace(/-/g, '') + '060000',
    date,
    startTime: new Date(date + 'T06:00:00Z').getTime(),
    media: {
      primary: {
        grandparentId: `plex:${showId}`,
        contentId: `plex:${contentId}`,
        showTitle,
        title: episodeTitle,
      }
    },
    ...overrides
  };
}

function makeEpisode(id, index, { isWatched = false, percent = 0, playhead = 0, duration = 1800 } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration,
    isWatched,
    watchProgress: percent,
    watchSeconds: playhead,
    metadata: {
      type: 'episode',
      grandparentId: 'plex:100',
      grandparentTitle: 'Test Show',
      itemIndex: index,
    },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeContext(sessions, playablesByShow = {}, config = {}) {
  return {
    recentSessions: sessions,
    fitnessConfig: {
      suggestions: { next_up_max: 4, ...config },
      plex: { resumable_labels: ['Resumable'] },
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => {
        const items = playablesByShow[showId] || [];
        return { items, parents: null, info: null };
      }
    },
  };
}

// --- Tests ---

describe('NextUpStrategy', () => {
  const strategy = new NextUpStrategy();

  test('returns empty when no sessions', async () => {
    const ctx = makeContext([]);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('returns next unwatched episode for a recent show', async () => {
    const sessions = [makeSession('100', 'Dig Deeper', '1001', 'Ep 7', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 7, { isWatched: true }),
        makeEpisode(1002, 8, { isWatched: false }),
        makeEpisode(1003, 9, { isWatched: false }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('next_up');
    expect(result[0].contentId).toBe('plex:1002');
    expect(result[0].showTitle).toBe('Dig Deeper');
    expect(result[0].action).toBe('play');
  });

  test('skips shows where all episodes are watched', async () => {
    const sessions = [makeSession('100', 'Done Show', '1001', 'Ep 1', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: true }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('respects max slots and next_up_max', async () => {
    const sessions = [
      makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-05'),
      makeSession('300', 'Show C', '3001', 'Ep 1', '2026-04-04'),
      makeSession('400', 'Show D', '4001', 'Ep 1', '2026-04-03'),
      makeSession('500', 'Show E', '5001', 'Ep 1', '2026-04-02'),
    ];
    const playables = {};
    for (const s of sessions) {
      const showId = s.media.primary.grandparentId.replace('plex:', '');
      playables[showId] = [
        makeEpisode(parseInt(showId) * 10 + 1, 1, { isWatched: true }),
        makeEpisode(parseInt(showId) * 10 + 2, 2, { isWatched: false }),
      ];
    }
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(4);
  });

  test('deduplicates by show — only one card per show', async () => {
    const sessions = [
      makeSession('100', 'Same Show', '1001', 'Ep 7', '2026-04-06'),
      makeSession('100', 'Same Show', '1002', 'Ep 8', '2026-04-05'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 7, { isWatched: true }),
        makeEpisode(1002, 8, { isWatched: true }),
        makeEpisode(1003, 9, { isWatched: false }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
  });

  test('sorts by most recently done show first', async () => {
    const sessions = [
      makeSession('200', 'Show B', '2001', 'Ep 1', '2026-04-06'),
      makeSession('100', 'Show A', '1001', 'Ep 1', '2026-04-08'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
      '200': [makeEpisode(2001, 1, { isWatched: true }), makeEpisode(2002, 2)],
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result[0].showTitle).toBe('Show A');
    expect(result[1].showTitle).toBe('Show B');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs --no-cache`
Expected: FAIL — cannot find module `NextUpStrategy.mjs`

- [ ] **Step 3: Implement NextUpStrategy**

```javascript
// backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs

/**
 * NextUpStrategy — resolves the next unwatched episode for each
 * distinct show found in recent sessions.
 *
 * Priority: most recently done show first.
 * Max: configurable via suggestions.next_up_max (default 4).
 */
export class NextUpStrategy {
  async suggest(context, remainingSlots) {
    const { recentSessions, fitnessConfig, fitnessPlayableService } = context;
    const max = Math.min(fitnessConfig?.suggestions?.next_up_max ?? 4, remainingSlots);
    if (max <= 0) return [];

    // Extract distinct shows, most-recent-session first
    const showMap = new Map();
    for (const session of recentSessions) {
      const gid = session.media?.primary?.grandparentId;
      if (!gid || showMap.has(gid)) continue;
      showMap.set(gid, {
        showId: gid,
        showTitle: session.media.primary.showTitle,
        lastSessionDate: session.date,
      });
    }

    const results = [];
    for (const show of showMap.values()) {
      if (results.length >= max) break;

      const localId = show.showId.replace(/^plex:/, '');
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(localId);
      } catch {
        continue;
      }

      const nextEp = (episodeData.items || []).find(ep => !ep.isWatched);
      if (!nextEp) continue;

      const isShow = nextEp.metadata?.type === 'show';
      results.push({
        type: 'next_up',
        action: 'play',
        contentId: nextEp.id,
        showId: show.showId,
        title: nextEp.title,
        showTitle: show.showTitle,
        thumbnail: nextEp.thumbnail || `/api/v1/display/plex/${nextEp.localId}`,
        poster: `/api/v1/content/plex/image/${localId}`,
        durationMinutes: nextEp.duration ? Math.round(nextEp.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
        lastSessionDate: show.lastSessionDate,
      });
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs --no-cache`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs \
       tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
git commit -m "feat(fitness): add NextUpStrategy for suggestions grid"
```

---

## Task 2: ResumeStrategy

Finds episodes with partial playhead on shows labeled `Resumable` that were done within the lookback window.

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs`
- Create: `tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs
import { ResumeStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs';

function makeSession(showId, showTitle, contentId, episodeTitle, date) {
  return {
    sessionId: date.replace(/-/g, '') + '060000',
    date,
    startTime: new Date(date + 'T06:00:00Z').getTime(),
    media: {
      primary: {
        grandparentId: `plex:${showId}`,
        contentId: `plex:${contentId}`,
        showTitle,
        title: episodeTitle,
      }
    },
  };
}

function makeEpisode(id, index, { isWatched = false, percent = 0, playhead = 0, duration = 3600, labels = [] } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration,
    isWatched,
    watchProgress: percent,
    watchSeconds: playhead,
    resumable: labels.includes('Resumable'),
    metadata: {
      type: 'episode',
      grandparentId: 'plex:100',
      grandparentTitle: 'Test Show',
      itemIndex: index,
      labels,
    },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeContext(sessions, playablesByShow = {}, config = {}) {
  return {
    recentSessions: sessions,
    fitnessConfig: {
      suggestions: config,
      plex: { resumable_labels: ['Resumable'] },
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => ({
        items: playablesByShow[showId] || [],
        parents: null,
        info: null,
      }),
    },
  };
}

describe('ResumeStrategy', () => {
  const strategy = new ResumeStrategy();

  test('returns empty when no sessions', async () => {
    const result = await strategy.suggest(makeContext([]), 4);
    expect(result).toEqual([]);
  });

  test('finds in-progress episode on resumable show', async () => {
    const sessions = [makeSession('100', 'VG Cycling', '1001', 'Ep 14', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 14, { percent: 55, playhead: 1980, duration: 3600, labels: ['Resumable'] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('resume');
    expect(result[0].action).toBe('play');
    expect(result[0].progress.percent).toBe(55);
  });

  test('skips non-resumable shows', async () => {
    const sessions = [makeSession('100', 'Regular Show', '1001', 'Ep 5', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 5, { percent: 40, playhead: 720, duration: 1800, labels: [] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('skips fully watched episodes', async () => {
    const sessions = [makeSession('100', 'VG Cycling', '1001', 'Ep 14', '2026-04-06')];
    const playables = {
      '100': [
        makeEpisode(1001, 14, { isWatched: true, percent: 100, playhead: 3600, duration: 3600, labels: ['Resumable'] }),
      ]
    };
    const ctx = makeContext(sessions, playables);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement ResumeStrategy**

```javascript
// backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs

/**
 * ResumeStrategy — finds episodes with partial playhead on Resumable-labeled
 * shows that appear in recent sessions.
 */
export class ResumeStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { recentSessions, fitnessConfig, fitnessPlayableService } = context;

    const resumableLabels = fitnessConfig?.plex?.resumable_labels || ['Resumable'];

    // Collect distinct shows from recent sessions
    const showMap = new Map();
    for (const session of recentSessions) {
      const gid = session.media?.primary?.grandparentId;
      if (!gid || showMap.has(gid)) continue;
      showMap.set(gid, {
        showId: gid,
        showTitle: session.media.primary.showTitle,
        lastSessionDate: session.date,
      });
    }

    const results = [];
    for (const show of showMap.values()) {
      if (results.length >= remainingSlots) break;

      const localId = show.showId.replace(/^plex:/, '');
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(localId);
      } catch {
        continue;
      }

      for (const ep of episodeData.items || []) {
        if (results.length >= remainingSlots) break;

        const labels = ep.metadata?.labels || [];
        const isResumable = labels.some(l => resumableLabels.includes(l));
        if (!isResumable) continue;

        const percent = ep.watchProgress ?? 0;
        if (percent <= 0 || ep.isWatched) continue;

        const remainingSec = ep.duration - (ep.watchSeconds || 0);
        const remainingMin = Math.floor(remainingSec / 60);
        const remainingSecs = Math.floor(remainingSec % 60);

        const isShowLevel = ep.metadata?.type === 'show';
        results.push({
          type: 'resume',
          action: 'play',
          contentId: ep.id,
          showId: show.showId,
          title: ep.title,
          showTitle: show.showTitle,
          thumbnail: ep.thumbnail || `/api/v1/display/plex/${ep.localId}`,
          poster: `/api/v1/content/plex/image/${localId}`,
          durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
          orientation: isShowLevel ? 'portrait' : 'landscape',
          lastSessionDate: show.lastSessionDate,
          progress: {
            percent,
            remaining: `${remainingMin}:${String(remainingSecs).padStart(2, '0')}`,
            playhead: ep.watchSeconds || 0,
          },
        });
      }
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs --no-cache`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/ResumeStrategy.mjs \
       tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs
git commit -m "feat(fitness): add ResumeStrategy for suggestions grid"
```

---

## Task 3: FavoriteStrategy

Resolves content from the `suggestions.favorites` config list. Can be show IDs (browse action, portrait) or episode IDs (play action, landscape).

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs`
- Create: `tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs
import { FavoriteStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs';

function makeContext(favorites = [], contentItems = {}) {
  return {
    fitnessConfig: {
      suggestions: { favorites },
    },
    contentAdapter: {
      getItem: async (compoundId) => contentItems[compoundId] || null,
    },
  };
}

describe('FavoriteStrategy', () => {
  const strategy = new FavoriteStrategy();

  test('returns empty when no favorites configured', async () => {
    const result = await strategy.suggest(makeContext([]), 4);
    expect(result).toEqual([]);
  });

  test('returns show-level favorite with browse action', async () => {
    const ctx = makeContext([12345], {
      'plex:12345': {
        id: 'plex:12345',
        localId: '12345',
        title: 'Video Game Cycling',
        metadata: { type: 'show' },
        thumbnail: '/api/v1/content/plex/image/12345',
      }
    });
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('favorite');
    expect(result[0].action).toBe('browse');
    expect(result[0].orientation).toBe('portrait');
    expect(result[0].showTitle).toBe('Video Game Cycling');
  });

  test('returns episode-level favorite with play action', async () => {
    const ctx = makeContext([67890], {
      'plex:67890': {
        id: 'plex:67890',
        localId: '67890',
        title: 'Ep 5: Best Ride',
        duration: 2400,
        metadata: {
          type: 'episode',
          grandparentId: 'plex:12345',
          grandparentTitle: 'VG Cycling',
        },
        thumbnail: '/api/v1/display/plex/67890',
      }
    });
    const result = await strategy.suggest(ctx, 4);

    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('play');
    expect(result[0].orientation).toBe('landscape');
  });

  test('skips favorites that fail to resolve', async () => {
    const ctx = makeContext([99999], {});
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('respects remainingSlots', async () => {
    const ctx = makeContext([100, 200, 300], {
      'plex:100': { id: 'plex:100', localId: '100', title: 'A', metadata: { type: 'show' } },
      'plex:200': { id: 'plex:200', localId: '200', title: 'B', metadata: { type: 'show' } },
      'plex:300': { id: 'plex:300', localId: '300', title: 'C', metadata: { type: 'show' } },
    });
    const result = await strategy.suggest(ctx, 2);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement FavoriteStrategy**

```javascript
// backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs

/**
 * FavoriteStrategy — resolves content from configured favorite IDs.
 * Shows get action=browse (portrait), episodes get action=play (landscape).
 */
export class FavoriteStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, contentAdapter } = context;
    const favoriteIds = fitnessConfig?.suggestions?.favorites || [];
    if (favoriteIds.length === 0 || !contentAdapter) return [];

    const results = [];
    for (const rawId of favoriteIds) {
      if (results.length >= remainingSlots) break;

      const compoundId = String(rawId).includes(':') ? String(rawId) : `plex:${rawId}`;
      let item;
      try {
        item = await contentAdapter.getItem(compoundId);
      } catch {
        continue;
      }
      if (!item) continue;

      const isShow = item.metadata?.type === 'show';
      const localId = item.localId || compoundId.replace(/^plex:/, '');
      const showId = isShow ? compoundId : (item.metadata?.grandparentId || compoundId);
      const showTitle = isShow ? item.title : (item.metadata?.grandparentTitle || item.title);

      results.push({
        type: 'favorite',
        action: isShow ? 'browse' : 'play',
        contentId: compoundId,
        showId,
        title: item.title,
        showTitle,
        thumbnail: item.thumbnail || `/api/v1/content/plex/image/${localId}`,
        poster: `/api/v1/content/plex/image/${isShow ? localId : showId.replace(/^plex:/, '')}`,
        durationMinutes: item.duration ? Math.round(item.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
      });
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs --no-cache`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/FavoriteStrategy.mjs \
       tests/unit/suite/fitness/suggestions/FavoriteStrategy.test.mjs
git commit -m "feat(fitness): add FavoriteStrategy for suggestions grid"
```

---

## Task 4: MemorableStrategy

Ranks historical sessions by a pluggable metric (suffer score initially). The ranking is abstracted so future metrics can be added.

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs`
- Create: `tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs
import { MemorableStrategy, SufferScoreRanker } from '../../../../../backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs';

function makeSession(contentId, showId, showTitle, title, date, sufferScore) {
  return {
    sessionId: date.replace(/-/g, '') + '060000',
    date,
    startTime: new Date(date + 'T06:00:00Z').getTime(),
    media: {
      primary: {
        contentId: `plex:${contentId}`,
        grandparentId: `plex:${showId}`,
        showTitle,
        title,
      }
    },
    maxSufferScore: sufferScore,
    durationMs: 1800000,
  };
}

function makeContext(sessions, config = {}) {
  return {
    fitnessConfig: {
      suggestions: {
        memorable_lookback_days: 90,
        memorable_max: 2,
        ...config,
      },
    },
    sessionDatastore: {
      findInRange: async () => sessions,
    },
    householdId: 'test',
  };
}

describe('MemorableStrategy', () => {
  test('returns top sessions by suffer score', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', 180),
      makeSession('2001', '200', 'Show B', 'Ep 7', '2026-03-15', 120),
      makeSession('3001', '300', 'Show C', 'Ep 1', '2026-03-20', 200),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);

    expect(result).toHaveLength(2);
    expect(result[0].metric.value).toBe(200);
    expect(result[1].metric.value).toBe(180);
    expect(result[0].type).toBe('memorable');
  });

  test('skips sessions without suffer score', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', null),
      makeSession('2001', '200', 'Show B', 'Ep 7', '2026-03-15', 150),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);

    expect(result).toHaveLength(1);
    expect(result[0].metric.value).toBe(150);
  });

  test('returns empty when no sessions have scores', async () => {
    const sessions = [
      makeSession('1001', '100', 'Show A', 'Ep 3', '2026-03-12', null),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions), 4);
    expect(result).toEqual([]);
  });

  test('respects memorable_max config', async () => {
    const sessions = [
      makeSession('1001', '100', 'A', 'Ep 1', '2026-03-10', 200),
      makeSession('2001', '200', 'B', 'Ep 2', '2026-03-11', 180),
      makeSession('3001', '300', 'C', 'Ep 3', '2026-03-12', 160),
    ];
    const strategy = new MemorableStrategy({ ranker: new SufferScoreRanker() });
    const result = await strategy.suggest(makeContext(sessions, { memorable_max: 1 }), 4);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement MemorableStrategy**

```javascript
// backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs

/**
 * Ranker interface: { rank(sessions) → sorted sessions, getMetric(session) → {label, value}, getReason(session) → string }
 */

export class SufferScoreRanker {
  rank(sessions) {
    return sessions
      .filter(s => s.maxSufferScore != null && s.maxSufferScore > 0)
      .sort((a, b) => b.maxSufferScore - a.maxSufferScore);
  }

  getMetric(session) {
    return { label: 'Suffer Score', value: session.maxSufferScore };
  }

  getReason(session) {
    const d = new Date(session.date + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Highest suffer score — ${dateStr}`;
  }
}

/**
 * MemorableStrategy — surfaces high-impact past episodes ranked by a pluggable metric.
 */
export class MemorableStrategy {
  #ranker;

  constructor({ ranker } = {}) {
    this.#ranker = ranker || new SufferScoreRanker();
  }

  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, sessionDatastore, householdId } = context;
    const cfg = fitnessConfig?.suggestions || {};
    const lookbackDays = cfg.memorable_lookback_days ?? 90;
    const max = Math.min(cfg.memorable_max ?? 2, remainingSlots);

    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - lookbackDays);
    const startDate = startD.toISOString().split('T')[0];

    let sessions;
    try {
      sessions = await sessionDatastore.findInRange(startDate, endDate, householdId);
    } catch {
      return [];
    }

    // Filter to sessions with media
    sessions = sessions.filter(s => s.media?.primary?.contentId);

    const ranked = this.#ranker.rank(sessions);

    // Dedup by episode contentId — only first occurrence
    const seen = new Set();
    const results = [];
    for (const session of ranked) {
      if (results.length >= max) break;
      const cid = session.media.primary.contentId;
      if (seen.has(cid)) continue;
      seen.add(cid);

      const showId = session.media.primary.grandparentId;
      const localShowId = showId?.replace(/^plex:/, '');

      results.push({
        type: 'memorable',
        action: 'play',
        contentId: cid,
        showId: showId || cid,
        title: session.media.primary.title,
        showTitle: session.media.primary.showTitle,
        thumbnail: `/api/v1/display/plex/${cid.replace(/^plex:/, '')}`,
        poster: localShowId ? `/api/v1/content/plex/image/${localShowId}` : null,
        durationMinutes: session.durationMs ? Math.round(session.durationMs / 60000) : null,
        orientation: 'landscape',
        metric: this.#ranker.getMetric(session),
        reason: this.#ranker.getReason(session),
      });
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs --no-cache`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/MemorableStrategy.mjs \
       tests/unit/suite/fitness/suggestions/MemorableStrategy.test.mjs
git commit -m "feat(fitness): add MemorableStrategy with pluggable ranker for suggestions grid"
```

---

## Task 5: DiscoveryStrategy

Weighted random selection — prefers lapsed shows, falls back to true random. Fills all remaining grid slots.

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs`
- Create: `tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs
import { DiscoveryStrategy } from '../../../../../backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs';

function makeShow(id, title) {
  return { id: String(id), title, type: 'show', episodeCount: 10 };
}

function makeEpisode(id, index, { isWatched = false } = {}) {
  return {
    id: `plex:${id}`,
    localId: String(id),
    title: `Episode ${index}`,
    duration: 1800,
    isWatched,
    watchProgress: isWatched ? 100 : 0,
    metadata: { type: 'episode', itemIndex: index, grandparentTitle: 'Test Show' },
    thumbnail: `/api/v1/display/plex/${id}`,
  };
}

function makeSession(showId, date) {
  return {
    date,
    media: { primary: { grandparentId: `plex:${showId}` } },
  };
}

function makeContext(allShows, playablesByShow = {}, recentSessions = [], config = {}) {
  return {
    recentSessions,
    fitnessConfig: {
      suggestions: {
        discovery_lapsed_days: 30,
        discovery_lapsed_weight: 0.7,
        ...config,
      },
    },
    fitnessPlayableService: {
      listFitnessShows: async () => ({ shows: allShows }),
      getPlayableEpisodes: async (showId) => ({
        items: playablesByShow[showId] || [makeEpisode(showId * 10, 1)],
      }),
    },
    sessionDatastore: {
      findInRange: async () => recentSessions,
    },
    householdId: 'test',
  };
}

describe('DiscoveryStrategy', () => {
  const strategy = new DiscoveryStrategy();

  test('returns cards to fill remaining slots', async () => {
    const shows = [makeShow(100, 'A'), makeShow(200, 'B'), makeShow(300, 'C')];
    const ctx = makeContext(shows);
    const result = await strategy.suggest(ctx, 3);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'discovery')).toBe(true);
  });

  test('returns empty when no remaining slots', async () => {
    const result = await strategy.suggest(makeContext([makeShow(100, 'A')]), 0);
    expect(result).toEqual([]);
  });

  test('sets action to play for episode-level results', async () => {
    const shows = [makeShow(100, 'A')];
    const playables = { '100': [makeEpisode(1001, 1)] };
    const ctx = makeContext(shows, playables);
    const result = await strategy.suggest(ctx, 1);
    expect(result[0].action).toBe('play');
    expect(result[0].orientation).toBe('landscape');
  });

  test('includes reason with days since last done', async () => {
    const shows = [makeShow(100, 'A')];
    const oldSessions = [makeSession('100', '2026-02-01')];
    const ctx = makeContext(shows, {}, oldSessions);
    const result = await strategy.suggest(ctx, 1);
    expect(result[0].reason).toMatch(/Last done \d+ days ago/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement DiscoveryStrategy**

```javascript
// backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs

/**
 * DiscoveryStrategy — weighted random selection to fill remaining grid slots.
 * Prefers lapsed shows (done before but not recently), falls back to true random.
 */
export class DiscoveryStrategy {
  async suggest(context, remainingSlots) {
    if (remainingSlots <= 0) return [];
    const { fitnessConfig, fitnessPlayableService, sessionDatastore, householdId } = context;
    const cfg = fitnessConfig?.suggestions || {};
    const lapsedDays = cfg.discovery_lapsed_days ?? 30;
    const lapsedWeight = cfg.discovery_lapsed_weight ?? 0.7;

    // Get all shows in the fitness library
    let allShows;
    try {
      const catalog = await fitnessPlayableService.listFitnessShows();
      allShows = catalog.shows || [];
    } catch {
      return [];
    }
    if (allShows.length === 0) return [];

    // Get broader session history to determine lapsed vs fresh
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - 365);
    const startDate = startD.toISOString().split('T')[0];

    let historicalSessions = [];
    try {
      historicalSessions = await sessionDatastore.findInRange(startDate, endDate, householdId);
    } catch { /* proceed without history */ }

    // Build map: showId → most recent session date
    const lastDoneMap = new Map();
    for (const s of historicalSessions) {
      const gid = s.media?.primary?.grandparentId;
      if (!gid) continue;
      const existing = lastDoneMap.get(gid);
      if (!existing || s.date > existing) lastDoneMap.set(gid, s.date);
    }

    const today = new Date();
    const lapsedThreshold = new Date();
    lapsedThreshold.setDate(lapsedThreshold.getDate() - lapsedDays);
    const lapsedThresholdStr = lapsedThreshold.toISOString().split('T')[0];

    // Classify shows
    const lapsed = [];
    const fresh = [];
    for (const show of allShows) {
      const compoundId = `plex:${show.id}`;
      const lastDone = lastDoneMap.get(compoundId);
      if (lastDone && lastDone < lapsedThresholdStr) {
        lapsed.push({ ...show, lastDone });
      } else if (!lastDone) {
        fresh.push({ ...show, lastDone: null });
      }
      // Shows done recently are excluded from discovery
    }

    // Weighted random selection
    const selected = [];
    const usedIds = new Set();

    for (let i = 0; i < remainingSlots; i++) {
      const useLapsed = lapsed.length > 0 && (fresh.length === 0 || Math.random() < lapsedWeight);
      const pool = useLapsed ? lapsed : (fresh.length > 0 ? fresh : lapsed);
      if (pool.length === 0) break;

      // Pick random from pool, avoiding duplicates
      const available = pool.filter(s => !usedIds.has(s.id));
      if (available.length === 0) {
        // Fall back to the other pool
        const otherPool = (pool === lapsed ? fresh : lapsed).filter(s => !usedIds.has(s.id));
        if (otherPool.length === 0) break;
        const pick = otherPool[Math.floor(Math.random() * otherPool.length)];
        selected.push(pick);
        usedIds.add(pick.id);
      } else {
        const pick = available[Math.floor(Math.random() * available.length)];
        selected.push(pick);
        usedIds.add(pick.id);
      }
    }

    // Resolve one episode per selected show
    const results = [];
    for (const show of selected) {
      let episodeData;
      try {
        episodeData = await fitnessPlayableService.getPlayableEpisodes(show.id);
      } catch {
        continue;
      }

      const episodes = episodeData.items || [];
      const nextUnwatched = episodes.find(ep => !ep.isWatched);
      const ep = nextUnwatched || episodes[Math.floor(Math.random() * episodes.length)];
      if (!ep) continue;

      const daysSince = show.lastDone
        ? Math.round((today - new Date(show.lastDone + 'T12:00:00')) / 86400000)
        : null;

      results.push({
        type: 'discovery',
        action: 'play',
        contentId: ep.id,
        showId: `plex:${show.id}`,
        title: ep.title,
        showTitle: show.title,
        thumbnail: ep.thumbnail || `/api/v1/display/plex/${ep.localId}`,
        poster: `/api/v1/content/plex/image/${show.id}`,
        durationMinutes: ep.duration ? Math.round(ep.duration / 60) : null,
        orientation: 'landscape',
        reason: daysSince != null ? `Last done ${daysSince} days ago` : 'New to you',
      });
    }

    return results;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs --no-cache`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/DiscoveryStrategy.mjs \
       tests/unit/suite/fitness/suggestions/DiscoveryStrategy.test.mjs
git commit -m "feat(fitness): add DiscoveryStrategy for suggestions grid"
```

---

## Task 6: FitnessSuggestionService (Orchestrator)

Runs all strategies in priority order, deduplicates by show ID, fills the grid.

**Files:**
- Create: `backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs`
- Create: `tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs`

- [ ] **Step 1: Write the test file**

```javascript
// tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs
import { FitnessSuggestionService } from '../../../../../backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs';

// Stub strategy: returns N cards for given showIds
function stubStrategy(type, showIds) {
  return {
    suggest: async (_ctx, remaining) => {
      return showIds.slice(0, remaining).map(sid => ({
        type,
        action: 'play',
        contentId: `plex:${sid}01`,
        showId: `plex:${sid}`,
        title: `Ep from ${sid}`,
        showTitle: `Show ${sid}`,
      }));
    }
  };
}

function makeService(strategies) {
  return new FitnessSuggestionService({
    strategies,
    sessionService: {
      listSessionsInRange: async () => [],
      resolveHouseholdId: (h) => h || 'default',
    },
    sessionDatastore: { findInRange: async () => [] },
    fitnessConfigService: {
      loadRawConfig: () => ({
        suggestions: { lookback_days: 10, grid_size: 8 },
      }),
    },
    fitnessPlayableService: { listFitnessShows: async () => ({ shows: [] }) },
    contentAdapter: null,
    contentQueryService: null,
    logger: { warn: () => {}, error: () => {}, debug: () => {} },
  });
}

describe('FitnessSuggestionService', () => {
  test('runs strategies in order and fills grid', async () => {
    const strategies = [
      stubStrategy('next_up', ['100', '200']),
      stubStrategy('resume', ['300']),
      stubStrategy('discovery', ['400', '500', '600', '700', '800']),
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 6 });

    expect(result.suggestions).toHaveLength(6);
    expect(result.suggestions[0].type).toBe('next_up');
    expect(result.suggestions[1].type).toBe('next_up');
    expect(result.suggestions[2].type).toBe('resume');
    expect(result.suggestions[3].type).toBe('discovery');
  });

  test('deduplicates by showId — earlier strategy wins', async () => {
    const strategies = [
      stubStrategy('next_up', ['100']),
      stubStrategy('favorite', ['100', '200']),  // show 100 should be skipped
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });

    const show100Cards = result.suggestions.filter(s => s.showId === 'plex:100');
    expect(show100Cards).toHaveLength(1);
    expect(show100Cards[0].type).toBe('next_up');
  });

  test('handles strategy errors gracefully', async () => {
    const strategies = [
      { suggest: async () => { throw new Error('boom'); } },
      stubStrategy('discovery', ['100', '200']),
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 2 });

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0].type).toBe('discovery');
  });

  test('returns empty array when all strategies fail', async () => {
    const strategies = [
      { suggest: async () => { throw new Error('fail'); } },
    ];
    const service = makeService(strategies);
    const result = await service.getSuggestions({ gridSize: 4 });
    expect(result.suggestions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs --no-cache`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement FitnessSuggestionService**

```javascript
// backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs

/**
 * FitnessSuggestionService — orchestrates suggestion strategies to fill a grid.
 *
 * Runs strategies in priority order, deduplicates by showId,
 * and returns a unified sorted array of suggestion cards.
 */
export class FitnessSuggestionService {
  #strategies;
  #sessionService;
  #sessionDatastore;
  #fitnessConfigService;
  #fitnessPlayableService;
  #contentAdapter;
  #contentQueryService;
  #logger;

  constructor({
    strategies,
    sessionService,
    sessionDatastore,
    fitnessConfigService,
    fitnessPlayableService,
    contentAdapter,
    contentQueryService,
    logger = console,
  }) {
    this.#strategies = strategies;
    this.#sessionService = sessionService;
    this.#sessionDatastore = sessionDatastore;
    this.#fitnessConfigService = fitnessConfigService;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#contentAdapter = contentAdapter;
    this.#contentQueryService = contentQueryService;
    this.#logger = logger;
  }

  async getSuggestions({ gridSize, householdId } = {}) {
    const fitnessConfig = this.#fitnessConfigService.loadRawConfig(householdId);
    const slots = gridSize || fitnessConfig?.suggestions?.grid_size || 8;
    const lookbackDays = fitnessConfig?.suggestions?.lookback_days ?? 10;

    // Fetch recent sessions for context
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - lookbackDays);
    const startDate = startD.toISOString().split('T')[0];

    const hid = this.#sessionService.resolveHouseholdId(householdId);
    let recentSessions = [];
    try {
      recentSessions = await this.#sessionService.listSessionsInRange(startDate, endDate, hid);
    } catch (err) {
      this.#logger.warn?.('suggestions.sessions-fetch-failed', { error: err?.message });
    }

    // Build shared context
    const context = {
      recentSessions,
      fitnessConfig,
      householdId: hid,
      fitnessPlayableService: this.#fitnessPlayableService,
      contentAdapter: this.#contentAdapter,
      contentQueryService: this.#contentQueryService,
      sessionDatastore: this.#sessionDatastore,
    };

    // Run strategies in order, dedup by showId
    const results = [];
    const usedShowIds = new Set();

    for (const strategy of this.#strategies) {
      const remaining = slots - results.length;
      if (remaining <= 0) break;

      let cards;
      try {
        cards = await strategy.suggest(context, remaining);
      } catch (err) {
        this.#logger.error?.('suggestions.strategy-failed', {
          strategy: strategy.constructor?.name,
          error: err?.message,
        });
        continue;
      }

      for (const card of cards) {
        if (results.length >= slots) break;
        if (card.showId && usedShowIds.has(card.showId)) continue;
        results.push(card);
        if (card.showId) usedShowIds.add(card.showId);
      }
    }

    return { suggestions: results };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs --no-cache`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs \
       tests/unit/suite/fitness/suggestions/FitnessSuggestionService.test.mjs
git commit -m "feat(fitness): add FitnessSuggestionService orchestrator for suggestions grid"
```

---

## Task 7: Wire Backend — Bootstrap + Router

Connect the orchestrator to the DI container and add the API route.

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:912-972`
- Modify: `backend/src/4_api/v1/routers/fitness.mjs:72-92`

- [ ] **Step 1: Add imports and instantiation in bootstrap.mjs**

In `backend/src/0_system/bootstrap.mjs`, add the import at the top with the other fitness imports:

```javascript
import { FitnessSuggestionService } from '../3_applications/fitness/suggestions/FitnessSuggestionService.mjs';
import { NextUpStrategy } from '../3_applications/fitness/suggestions/NextUpStrategy.mjs';
import { ResumeStrategy } from '../3_applications/fitness/suggestions/ResumeStrategy.mjs';
import { FavoriteStrategy } from '../3_applications/fitness/suggestions/FavoriteStrategy.mjs';
import { MemorableStrategy } from '../3_applications/fitness/suggestions/MemorableStrategy.mjs';
import { DiscoveryStrategy } from '../3_applications/fitness/suggestions/DiscoveryStrategy.mjs';
```

In `createFitnessApiRouter()`, after the `fitnessPlayableService` creation (around line 946) and before the `return createFitnessRouter(...)` call, add:

```javascript
  // Create suggestion strategies and orchestrator
  const fitnessSuggestionService = new FitnessSuggestionService({
    strategies: [
      new NextUpStrategy(),
      new ResumeStrategy(),
      new FavoriteStrategy(),
      new MemorableStrategy(),
      new DiscoveryStrategy(),
    ],
    sessionService: fitnessServices.sessionService,
    sessionDatastore: fitnessServices.sessionStore,
    fitnessConfigService,
    fitnessPlayableService,
    contentAdapter: fitnessContentAdapter,
    contentQueryService,
    logger,
  });
```

Then add `fitnessSuggestionService` to the `createFitnessRouter(...)` call's config object.

- [ ] **Step 2: Add the route in the fitness router**

In `backend/src/4_api/v1/routers/fitness.mjs`, add `fitnessSuggestionService` to the destructured config (around line 73):

```javascript
  const {
    sessionService,
    // ... existing deps ...
    fitnessSuggestionService,  // ADD THIS
    logger = console
  } = config;
```

Add the route after the existing `/sessions` endpoint (after line 316):

```javascript
  // ─── Suggestions Grid ────────────────────────────────────
  router.get('/suggestions', async (req, res) => {
    const { gridSize, household } = req.query;
    try {
      const result = await fitnessSuggestionService.getSuggestions({
        gridSize: gridSize ? parseInt(gridSize, 10) : undefined,
        householdId: household,
      });
      return res.json(result);
    } catch (err) {
      logger.error?.('fitness.suggestions.error', { error: err?.message });
      return res.status(500).json({ error: 'Failed to generate suggestions' });
    }
  });
```

- [ ] **Step 3: Verify the dev server starts without errors**

Run: `node -e "import('./backend/src/3_applications/fitness/suggestions/FitnessSuggestionService.mjs').then(() => console.log('OK')).catch(e => console.error(e))"`
Expected: `OK` (module resolves without syntax errors)

- [ ] **Step 4: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs \
       backend/src/4_api/v1/routers/fitness.mjs
git commit -m "feat(fitness): wire FitnessSuggestionService into bootstrap and router"
```

---

## Task 8: Config Update — fitness.yml

Add the `suggestions` block and update the screen layout in the container's fitness config.

**Files:**
- Modify: `data/household/config/fitness.yml` (inside container, via `docker exec`)

- [ ] **Step 1: Read current config to identify insertion point**

Run: `sudo docker exec daylight-station sh -c 'head -60 data/household/config/fitness.yml'`

The `suggestions` block goes after `screens:` and before `plex:`. The screen layout data sources and right-area need updating too.

- [ ] **Step 2: Add suggestions config block**

Insert the `suggestions:` block after the closing of `screens.home.layout` and before `plex:`:

```yaml
suggestions:
  grid_size: 8
  lookback_days: 10
  next_up_max: 4
  memorable_lookback_days: 90
  memorable_max: 2
  discovery_lapsed_days: 30
  discovery_lapsed_weight: 0.7
  favorites:
    - 642120    # Video Game Cycling (replace with actual Plex show ID)
```

Use `sudo docker exec daylight-station sh -c 'cat data/household/config/fitness.yml'` to read the full file, then write it back with the changes using a heredoc via `docker exec`.

- [ ] **Step 3: Update screen data sources — add suggestions source**

In the `screens.home.data` section, add:

```yaml
      suggestions:
        source: /api/v1/fitness/suggestions?gridSize=8
        refresh: 300
```

- [ ] **Step 4: Update screen layout — simplify right area**

Replace the right-area children (currently two rows of weight+upnext and nutrition+coach) with:

```yaml
        - id: right-area
          basis: "66%"
          direction: column
          children:
            - widget: "fitness:suggestions"
```

- [ ] **Step 5: Verify config is valid YAML**

Run: `sudo docker exec daylight-station sh -c 'node -e "const yaml=require(\"js-yaml\"); yaml.load(require(\"fs\").readFileSync(\"data/household/config/fitness.yml\",\"utf8\")); console.log(\"OK\")"'`
Expected: `OK`

- [ ] **Step 6: Commit a note documenting the config change**

The actual config lives in the container data volume (not version-controlled). Document what was changed:

```bash
echo "## 2026-04-08: Added suggestions config to fitness.yml

- Added \`suggestions:\` block (grid_size, lookback_days, next_up_max, etc.)
- Added \`suggestions\` data source to screens.home.data
- Replaced right-area layout with single \`fitness:suggestions\` widget
- Removed weight, nutrition, coach, upnext from home screen right panel" >> docs/_wip/plans/2026-04-08-fitness-suggestions-config-changes.md
git add docs/_wip/plans/2026-04-08-fitness-suggestions-config-changes.md
git commit -m "docs: record fitness.yml config changes for suggestions grid"
```

---

## Task 9: FitnessSuggestionsWidget — Frontend Component

The main widget that renders the suggestions grid. Consumes data from ScreenDataProvider and renders SuggestionCard components.

**Files:**
- Create: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx`
- Create: `frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/index.jsx`

- [ ] **Step 1: Create the index re-export**

```javascript
// frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/index.jsx
export { default } from './FitnessSuggestionsWidget.jsx';
```

- [ ] **Step 2: Create the SuggestionCard component**

```javascript
// frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/SuggestionCard.jsx
import React from 'react';

const BADGE_STYLES = {
  next_up:    { bg: 'rgba(34,139,230,0.85)', label: 'NEXT UP' },
  resume:     { bg: 'rgba(200,160,40,0.85)', label: 'RESUME' },
  favorite:   { bg: 'rgba(120,120,120,0.7)', label: 'FAVORITE' },
  memorable:  { bg: 'rgba(200,80,40,0.8)',   label: 'TOP EFFORT' },
  discovery:  { bg: 'rgba(80,160,80,0.7)',   label: 'TRY THIS' },
};

export default function SuggestionCard({ suggestion, onClick }) {
  const { type, title, showTitle, thumbnail, poster, orientation,
          durationMinutes, progress, metric, reason, action } = suggestion;

  const badge = BADGE_STYLES[type] || BADGE_STYLES.discovery;
  const isPortrait = orientation === 'portrait';
  const imgSrc = isPortrait ? poster : thumbnail;
  const isMuted = type === 'resume' || type === 'favorite' || type === 'discovery';

  return (
    <div
      className={`suggestion-card suggestion-card--${type}${isMuted ? ' suggestion-card--muted' : ''}`}
      onClick={() => onClick?.(suggestion)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(suggestion); }}
    >
      <div className={`suggestion-card__image${isPortrait ? ' suggestion-card__image--portrait' : ''}`}>
        <img
          src={imgSrc}
          alt=""
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <span className="suggestion-card__badge" style={{ background: badge.bg }}>
          {badge.label}
        </span>
        {durationMinutes != null && (
          <span className="suggestion-card__duration">{durationMinutes}m</span>
        )}
      </div>

      <div className="suggestion-card__body">
        {showTitle && showTitle !== title && (
          <div className="suggestion-card__show-title">{showTitle}</div>
        )}
        <div className="suggestion-card__title">{title}</div>

        {type === 'resume' && progress && (
          <div className="suggestion-card__progress">
            <div className="suggestion-card__progress-bar">
              <div
                className="suggestion-card__progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="suggestion-card__progress-text">{progress.percent}%</span>
          </div>
        )}

        {type === 'memorable' && metric && (
          <div className="suggestion-card__metric">
            {metric.label}: {metric.value}
          </div>
        )}

        {type === 'favorite' && action === 'browse' && (
          <div className="suggestion-card__browse">Browse episodes →</div>
        )}

        {(type === 'next_up' || type === 'resume') && suggestion.lastSessionDate && (
          <div className="suggestion-card__recency">{formatRecency(suggestion.lastSessionDate)}</div>
        )}

        {type === 'discovery' && reason && (
          <div className="suggestion-card__reason">{reason}</div>
        )}
      </div>
    </div>
  );
}

function formatRecency(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const d = new Date(dateStr + 'T12:00:00');
  const days = Math.round((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
```

- [ ] **Step 3: Create the main widget component**

```javascript
// frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.jsx
import React, { useCallback } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import SuggestionCard from './SuggestionCard.jsx';
import './FitnessSuggestionsWidget.scss';

function parseContentId(contentId) {
  if (!contentId) return { source: 'plex', localId: '' };
  const colonIdx = contentId.indexOf(':');
  if (colonIdx === -1) return { source: 'plex', localId: contentId };
  return { source: contentId.slice(0, colonIdx), localId: contentId.slice(colonIdx + 1) };
}

function SuggestionsGridSkeleton() {
  return (
    <div className="suggestions-grid">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="suggestion-card suggestion-card--skeleton">
          <div className="suggestion-card__image skeleton shimmer" />
          <div className="suggestion-card__body">
            <div className="skeleton shimmer" style={{ height: 10, width: '50%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 12, width: '80%', borderRadius: 3 }} />
            <div className="skeleton shimmer" style={{ height: 10, width: '40%', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FitnessSuggestionsWidget() {
  const rawData = useScreenData('suggestions');
  const { onPlay, onNavigate } = useFitnessScreen();

  const handleClick = useCallback((suggestion) => {
    if (suggestion.action === 'browse' && onNavigate) {
      const { localId } = parseContentId(suggestion.showId);
      onNavigate({ type: 'show', id: localId });
      return;
    }

    if (suggestion.action === 'play' && onPlay) {
      const { source, localId } = parseContentId(suggestion.contentId);
      onPlay({
        id: localId,
        contentSource: source,
        type: 'episode',
        title: suggestion.title,
        videoUrl: DaylightMediaPath(`api/v1/play/${source}/${localId}`),
        image: DaylightMediaPath(suggestion.thumbnail?.replace(/^\//, '') || `api/v1/display/${source}/${localId}`),
        duration: suggestion.durationMinutes,
        ...(suggestion.progress ? { resumePosition: suggestion.progress.playhead } : {}),
      });
    }
  }, [onPlay, onNavigate]);

  if (rawData === null) return <SuggestionsGridSkeleton />;

  const suggestions = rawData?.suggestions || [];
  if (suggestions.length === 0) return null;

  return (
    <div className="suggestions-grid">
      {suggestions.map((s, i) => (
        <SuggestionCard key={s.contentId || i} suggestion={s} onClick={handleClick} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create the SCSS styles**

```scss
// frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/FitnessSuggestionsWidget.scss

.suggestions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 0;
}

// ─── Card Base ─────────────────────────────────────────

.suggestion-card {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s;

  &:active { opacity: 0.9; }

  &--muted {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.06);
  }

  &--skeleton {
    pointer-events: none;
    .suggestion-card__body { display: flex; flex-direction: column; gap: 6px; }
  }
}

// ─── Image Area ────────────────────────────────────────

.suggestion-card__image {
  position: relative;
  height: 100px;
  background: rgba(255, 255, 255, 0.03);
  overflow: hidden;

  &--portrait { height: 150px; }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.suggestion-card__badge {
  position: absolute;
  top: 6px;
  left: 6px;
  color: white;
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 3px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.suggestion-card__duration {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  font-size: 9px;
  padding: 2px 5px;
  border-radius: 3px;
}

// ─── Body ──────────────────────────────────────────────

.suggestion-card__body {
  padding: 8px;
}

.suggestion-card__show-title {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-card__title {
  font-size: 12px;
  color: #e0e0e0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-card__recency,
.suggestion-card__reason {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.3);
  margin-top: 2px;
}

.suggestion-card__browse {
  font-size: 9px;
  color: rgba(100, 150, 200, 0.8);
  margin-top: 3px;
}

.suggestion-card__metric {
  font-size: 9px;
  color: rgba(200, 80, 40, 0.8);
  margin-top: 2px;
  font-weight: 600;
}

// ─── Progress Bar (Resume) ─────────────────────────────

.suggestion-card__progress {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
}

.suggestion-card__progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.suggestion-card__progress-fill {
  height: 100%;
  background: rgba(200, 160, 40, 0.7);
  border-radius: 2px;
}

.suggestion-card__progress-text {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSuggestionsWidget/
git commit -m "feat(fitness): add FitnessSuggestionsWidget frontend component"
```

---

## Task 10: Register Widget + Update Index

Register the new widget and remove the old upnext widget from the home screen.

**Files:**
- Modify: `frontend/src/modules/Fitness/index.js`

- [ ] **Step 1: Add import and registration**

In `frontend/src/modules/Fitness/index.js`, add after the existing dashboard widget imports (around line 50):

```javascript
import FitnessSuggestionsWidget from './widgets/FitnessSuggestionsWidget/index.jsx';
```

Add the registration after the existing registrations (around line 58):

```javascript
registry.register('fitness:suggestions', FitnessSuggestionsWidget);
```

- [ ] **Step 2: Verify no import errors**

Run: `npx vite build --mode development 2>&1 | head -20`
Expected: Build starts without import resolution errors for the new widget.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Fitness/index.js
git commit -m "feat(fitness): register fitness:suggestions widget"
```

---

## Task 11: Integration Smoke Test

Verify the full stack works — API returns suggestions, frontend renders the grid.

**Files:** No new files — testing existing work.

- [ ] **Step 1: Run all unit tests**

Run: `npx jest tests/unit/suite/fitness/suggestions/ --no-cache`
Expected: All tests pass (6 test files, ~23 tests total)

- [ ] **Step 2: Start the dev server and test the API**

Start: `node backend/index.js` (check port with `ss -tlnp | grep 3112` first)

Run: `curl -s http://localhost:3112/api/v1/fitness/suggestions?gridSize=8 | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('Count:',j.suggestions?.length);j.suggestions?.forEach(s=>console.log(s.type,s.showTitle,s.title))})"`

Expected: JSON response with suggestions array containing cards of various types.

- [ ] **Step 3: Check for errors in dev server logs**

Run: `tail -20 dev.log` (or check backend console output)
Expected: No errors related to suggestions endpoint.

- [ ] **Step 4: Test the frontend renders**

Open the fitness home screen in the browser. The right panel should show a grid of suggestion cards instead of the old weight/nutrition/coach/upnext layout.

- [ ] **Step 5: Commit any fixes needed**

If any issues found during smoke testing, fix and commit with descriptive messages.
