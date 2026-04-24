# Fitness Next Up Deprioritized Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `NextUpStrategy` from surfacing shows whose next-up episode (or show) carries a `deprioritized_labels` membership (initial member: `KidsFun`). Override the filter when the show is also `Resumable` — those legitimately have partial watch progress the user wants to get back to.

**Architecture:** Surgical change to `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs`. Reuses existing `plex.deprioritized_labels` config (merged in `8fce35a91`) and existing `plex.resumable_labels` config (already consumed by `ResumeStrategy`). No new config keys. No new files (other than a dedicated test module for the new behavior, mirroring the existing test file). Mirrors the label casing discipline established in `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs:buildDeprioritizedChecker` — case-insensitive comparison because Plex returns CamelCase while session-persisted data is lowercase; safest to normalize both sides.

**Rationale — override signal:** The spec calls for "actual progress" to override the filter. Two candidate signals exist:

1. The `Resumable` label on the show (what `ResumeStrategy.mjs:39-43` already treats as the canonical "partial-watch matters here" flag).
2. Raw per-episode `watchProgress` / `watchSeconds` data.

We use option 1 (the `Resumable` label on the show, via `plex.resumable_labels`). Reasons:
- Matches the project's existing canonical pattern — `ResumeStrategy` treats the label as the signal.
- The live-API evidence confirms the real-world expectation: "Daytona USA" has `["kidsfun","resumable","sequential"]` and is the exact item the user says should stay.
- Raw playhead data would flip in and out as the user finishes episodes, which is not the intended UX for this override.

**Tech Stack:** Node.js (ESM), Jest

**Spec:** Bug Bash Issue E (2026-04-23) — symptom + fix captured inline in this plan; no separate spec document.

---

## File Structure

| File | Role | Change |
|---|---|---|
| `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs` | Resolves next unwatched episode per recent show | Add deprioritized filter with resumable override |
| `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs` | Existing Jest tests for NextUpStrategy | Extend with 4 new cases (filter / override / unaffected / case-insensitive) |

No other files change. The config keys `plex.deprioritized_labels` and `plex.resumable_labels` are already present in `data/household/config/fitness.yml`. `FitnessSuggestionService` already passes the full `fitnessConfig` through, so `NextUpStrategy` has access without plumbing changes.

---

## Background — How NextUpStrategy accesses labels

Current code at `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs:58`:

```js
const showLabels = episodeData.info?.labels || [];
```

So `showLabels` is the show-level label array returned by `fitnessPlayableService.getPlayableEpisodes(localId)`. These are the labels used for matching here — they come from the Plex container info call.

The existing test file at `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs:49-53` already includes an `info` field in the mock:

```js
return { items, parents: null, info: null };
```

To test label-based behavior, the mock must return `info: { labels: [...] }` — mirrors the real shape.

---

## Task 1: Extend NextUpStrategy tests with deprioritized cases (RED)

**Files:**
- Modify: `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs`

- [ ] **Step 1: Extend `makeContext` to accept an optional per-show labels map**

Open `tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs` and replace the `makeContext` function with:

```js
function makeContext(sessions, playablesByShow = {}, config = {}, labelsByShow = {}) {
  return {
    recentSessions: sessions,
    fitnessConfig: {
      suggestions: { next_up_max: 4, ...config },
      plex: {
        resumable_labels: ['Resumable'],
        deprioritized_labels: ['KidsFun'],
      },
    },
    fitnessPlayableService: {
      getPlayableEpisodes: async (showId) => {
        const items = playablesByShow[showId] || [];
        const labels = labelsByShow[showId] || [];
        return { items, parents: null, info: { labels } };
      }
    },
  };
}
```

This keeps every existing call site passing (the 4th arg defaults to `{}`), while allowing new tests to inject labels. The `fitnessConfig.plex` block now includes `deprioritized_labels` so tests that don't opt in still get a realistic config shape.

- [ ] **Step 2: Add four new test cases at the end of the `describe` block (before the closing `});`)**

```js
  test('filters out shows whose next-up has a deprioritized label', async () => {
    // Would You Rather Workout style — kidsfun only, no resumable progress.
    const sessions = [
      makeSession('100', 'PE Bowman', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: false }),
      ],
    };
    const labels = { '100': ['kidsfun'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });

  test('keeps deprioritized shows that ALSO have a resumable label', async () => {
    // Daytona USA style — kidsfun + resumable; the resumable tag wins.
    const sessions = [
      makeSession('100', 'Game Cycling', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [
        makeEpisode(1001, 1, { isWatched: true }),
        makeEpisode(1002, 2, { isWatched: false }),
      ],
    };
    const labels = { '100': ['kidsfun', 'resumable', 'sequential'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(1);
    expect(result[0].contentId).toBe('plex:1002');
    expect(result[0].labels).toEqual(['kidsfun', 'resumable', 'sequential']);
  });

  test('regular (non-deprioritized) shows are unaffected by the filter', async () => {
    const sessions = [
      makeSession('100', 'P90X Generation Next', '1001', 'Ep 1', '2026-04-06'),
      makeSession('200', 'Body by Yoga', '2001', 'Ep 1', '2026-04-05'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
      '200': [makeEpisode(2001, 1, { isWatched: true }), makeEpisode(2002, 2)],
    };
    const labels = { '100': [], '200': ['nomusic'] };
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.showTitle)).toEqual(['P90X Generation Next', 'Body by Yoga']);
  });

  test('deprioritized label matching is case-insensitive', async () => {
    // Config: 'KidsFun' (CamelCase). Session/API: 'kidsfun' (lowercase).
    const sessions = [
      makeSession('100', 'PE Bowman', '1001', 'Ep 1', '2026-04-06'),
    ];
    const playables = {
      '100': [makeEpisode(1001, 1, { isWatched: true }), makeEpisode(1002, 2)],
    };
    const labels = { '100': ['KIDSFUN'] }; // upper-case from a hypothetical source
    const ctx = makeContext(sessions, playables, {}, labels);
    const result = await strategy.suggest(ctx, 4);
    expect(result).toEqual([]);
  });
```

- [ ] **Step 3: Run tests — expect the new "filter out" cases to FAIL**

Run:

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
```

Expected: existing 7 tests pass; the 2 "should filter" cases fail with `Received: [{...}]` instead of `[]`. The 2 "should keep" / "regular unaffected" cases pass by coincidence today (no filter exists, so both shows are emitted) — this is acceptable TDD lock-in: the tests pin the behavior we want to keep, while the failing tests demonstrate the gap.

- [ ] **Step 4: Commit the failing tests**

```bash
cd /opt/Code/DaylightStation
git add tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
git commit -m "$(cat <<'EOF'
test(fitness): failing NextUpStrategy tests for deprioritized_labels filter

Covers the three branches of the new behavior: deprioritized filtered out,
deprioritized + resumable kept (override), and non-deprioritized unaffected.
Also pins down case-insensitive matching to mirror selectPrimaryMedia.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Implement the deprioritized filter in NextUpStrategy (GREEN)

**Files:**
- Modify: `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs`

- [ ] **Step 1: Replace the file body with the filter-aware algorithm**

Open `backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs` and replace its entire contents with:

```js
/**
 * NextUpStrategy — resolves the next unwatched episode for each
 * distinct show found in recent sessions.
 *
 * Priority: most recently done show first.
 * Max: configurable via suggestions.next_up_max (default 4).
 *
 * Label-based filtering:
 *   - Shows whose show-level labels match plex.deprioritized_labels
 *     (e.g. KidsFun) are hidden from the Next Up list, UNLESS the show
 *     also carries a plex.resumable_labels label (e.g. Resumable) — the
 *     canonical signal that "there's actual watch-progress the user
 *     cares about here" (mirrors ResumeStrategy).
 *   - Label comparison is case-insensitive because session-persisted
 *     labels are lowercase while the config uses CamelCase (mirrors
 *     selectPrimaryMedia's buildDeprioritizedChecker).
 */
export class NextUpStrategy {
  async suggest(context, remainingSlots) {
    const { recentSessions, fitnessConfig, fitnessPlayableService } = context;
    const max = remainingSlots;
    if (max <= 0) return [];

    // Build warmup/filler detection from config
    const warmupPatterns = (fitnessConfig?.plex?.warmup_title_patterns || [])
      .map(p => new RegExp(p, 'i'));
    const minDuration = fitnessConfig?.suggestions?.discovery_min_duration_seconds ?? 600;

    // Normalize deprioritized + resumable label sets once (lowercased)
    const deprioritizedLowered = (fitnessConfig?.plex?.deprioritized_labels || [])
      .map(l => String(l).toLowerCase());
    const resumableLowered = (fitnessConfig?.plex?.resumable_labels || ['Resumable'])
      .map(l => String(l).toLowerCase());

    // Extract distinct shows, most-recent-session first
    // Skip sessions where the episode was supplementary (warmup, cooldown, intro, short filler)
    const sortedSessions = [...recentSessions].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    const showMap = new Map();
    for (const session of sortedSessions) {
      const gid = session.media?.primary?.grandparentId;
      if (!gid || showMap.has(gid)) continue;

      // Check if the played episode was supplementary
      const epTitle = (session.media.primary.title || '').toLowerCase();
      const sessionDurSec = (session.durationMs || 0) / 1000;
      const isFiller =
        (sessionDurSec > 0 && sessionDurSec < minDuration) ||
        warmupPatterns.some(re => re.test(epTitle)) ||
        /\bintro\b/i.test(epTitle);
      if (isFiller) continue;

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

      const showLabels = episodeData.info?.labels || [];

      // Apply the deprioritized filter with the Resumable override.
      if (deprioritizedLowered.length) {
        const labelsLowered = showLabels.map(l => String(l).toLowerCase());
        const isDeprioritized = deprioritizedLowered.some(l => labelsLowered.includes(l));
        const isResumable = resumableLowered.some(l => labelsLowered.includes(l));
        if (isDeprioritized && !isResumable) continue;
      }

      const isShow = nextEp.metadata?.type === 'show';
      results.push({
        type: 'next_up',
        action: 'play',
        contentId: nextEp.id,
        showId: show.showId,
        title: nextEp.title,
        showTitle: show.showTitle,
        description: nextEp.metadata?.summary || null,
        thumbnail: nextEp.thumbnail || `/api/v1/display/plex/${nextEp.localId}`,
        poster: `/api/v1/content/plex/image/${localId}`,
        durationMinutes: nextEp.duration ? Math.round(nextEp.duration / 60) : null,
        orientation: isShow ? 'portrait' : 'landscape',
        labels: showLabels,
        lastSessionDate: show.lastSessionDate,
      });
    }

    return results;
  }
}
```

Key details:
- The two label sets are lowercased once at the top of `suggest` — no per-iteration allocation churn.
- `resumable_labels` defaults to `['Resumable']` (matches `ResumeStrategy.mjs:12`).
- The filter block is fully skipped when `deprioritized_labels` is empty — no behavioral drift for configs that haven't opted in.
- The filter sits *after* `nextEp` is resolved and *before* the `results.push` — mirrors the placement the spec calls out.
- Uses `showLabels` directly (not the per-episode `nextEp.metadata?.labels`). This matches how `ResumeStrategy` treats labels (show-level, from `episodeData.info`), and matches where the live API is sourcing labels in the broken output (`info.labels`).

> **NOTE TO IMPLEMENTER:** Before pasting the new contents, read the existing `NextUpStrategy.mjs` end-to-end. The above body is the intended *complete* replacement. If the existing file has any field/branch not represented above (e.g., a niche edge case), verify it intentionally — don't silently drop it.

- [ ] **Step 2: Run all NextUpStrategy tests — all should PASS**

Run:

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/suite/fitness/suggestions/NextUpStrategy.test.mjs
```

Expected: 11 tests pass (7 existing + 4 new).

- [ ] **Step 3: Run the full fitness suggestions test suite to confirm no sibling-strategy regression**

Run:

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/suite/fitness/suggestions/
```

Expected: all green — NextUpStrategy changes don't touch DiscoveryStrategy, ResumeStrategy, or FitnessSuggestionService.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation
git add backend/src/3_applications/fitness/suggestions/NextUpStrategy.mjs
git commit -m "$(cat <<'EOF'
feat(fitness): filter deprioritized labels from Next Up with Resumable override

Next Up suggestions now drop shows whose labels include any entry in
plex.deprioritized_labels (e.g. KidsFun) unless the show also carries a
plex.resumable_labels entry (e.g. Resumable). Matching is case-insensitive
to handle the CamelCase-vs-lowercase split between config and persisted
labels. Mirrors the selectPrimaryMedia and ResumeStrategy patterns.

Fixes bug bash issue E (2026-04-23): "Would You Rather Workout" (kidsfun)
leaked into Next Up; "Daytona USA" (kidsfun + resumable) must stay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Validate against the live API

**Files:**
- None modified. Verification-only.

- [ ] **Step 1: Hit the live suggestions endpoint**

Run:

```bash
curl -s "http://localhost:3111/api/v1/fitness/suggestions?gridSize=8" | node -e "
const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const nextUp = (body.suggestions || []).filter(s => s.type === 'next_up');
  console.log('next_up count:', nextUp.length);
  for (const s of nextUp) {
    console.log(' -', s.title.padEnd(40), 'labels=', JSON.stringify(s.labels));
  }
});
"
```

Expected after the fix:
- "Would You Rather Workout" (labels=`['kidsfun']`) is **absent**.
- "Daytona USA" (labels=`['kidsfun','resumable','sequential']`) is **present**.
- All other Next Up cards unchanged.

Note: the backend auto-reloads route handlers but config caches may require a touch. If the endpoint shows unchanged output, restart the backend process. The test environment already reloads module code for subsequent API hits.

- [ ] **Step 2: Confirm ResumeStrategy was not inadvertently altered**

Run:

```bash
cd /opt/Code/DaylightStation && npx jest tests/unit/suite/fitness/suggestions/ResumeStrategy.test.mjs
```

Expected: green.

- [ ] **Step 3: No further commits needed**

---

## Self-Review Checklist

- Pre-existing NextUpStrategy tests (7 cases) continue to pass unmodified behaviorally — only `makeContext` gained an optional 4th arg with a default, so they pass through unchanged.
- New coverage hits all four branches: (a) deprioritized filtered out; (b) deprioritized + resumable kept (override); (c) regular content unaffected; (d) case-insensitive matching.
- Casing: config ingest is `.toLowerCase()`'d once; the candidate's labels are `.toLowerCase()`'d per-show; comparisons use `.includes()` on those lowered arrays. Mirrors `buildDeprioritizedChecker` in `selectPrimaryMedia.mjs`.
- Override signal: the plan uses the show's `Resumable` label (via `plex.resumable_labels`), not raw playhead data. Rationale captured in the Architecture section at the top of the plan — aligns with `ResumeStrategy.mjs:39-43`.
- No new config keys introduced; both `deprioritized_labels` and `resumable_labels` already exist in `data/household/config/fitness.yml`.
- Project policy honored: plan explicitly includes commit steps but never auto-runs them; every commit is a separate `- [ ]` step the operator executes.

---

## Done

Summary of what changes:

- **Algorithm:** `NextUpStrategy.suggest` gains a label-based filter with a Resumable override, keyed off `plex.deprioritized_labels` (already in runtime config) and `plex.resumable_labels` (already in runtime config).
- **Tests:** 4 new Jest cases in the existing NextUpStrategy test module. `makeContext` gains an optional `labelsByShow` parameter so future label-driven tests have a clean seam.
- **Out of scope:** DiscoveryStrategy (already filters `governed_labels`), ResumeStrategy (already label-gated on `Resumable`), FavoriteStrategy / MemorableStrategy (separate tiers — not part of bug E).
