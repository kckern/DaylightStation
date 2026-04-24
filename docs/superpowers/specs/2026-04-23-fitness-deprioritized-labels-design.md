# Fitness Primary Media — Deprioritized Labels

**Date:** 2026-04-23
**Status:** Design
**Owner:** KC

## Problem

`selectPrimaryMedia` picks the longest non-warmup video in a fitness session. That selection drives the Strava activity title and is surfaced as the session's "main thing." It currently ignores any signal beyond duration, which produces wrong primaries when a long but non-workout video shares the session with a shorter but key workout.

### Triggering case

Session `20260422193014` (2026-04-22):

| Episode | Duration | Labels | Selected? |
|---|---|---|---|
| Mario Kart World (Game Cycling) | 763s | `kidsfun, resumable, sequential` | **YES** (longest) |
| Week 1 Day 2 — Lower Body | 675s | `nomusic` | no |
| Cardio Challenge with Shaun Tubbs | 366s | (none) | no |

The Lower Body workout was the key training event of the session. Mario Kart was kid-driven family content that ran in parallel. The selection should have favored the workout.

## Goal

Add a "deprioritized" tier of content labels — content that should be selected as primary only when nothing else qualifies. Treat it the same way warmups are treated today: filtered out as candidates, retained as fallback. Initial member: `KidsFun`.

## Non-goals

- No multi-tier ranking (warmup vs. kids ordering). Single combined "deprioritize" filter, single fallback.
- No weighted scoring (label multipliers on duration). Binary filter only.
- No changes to suggestions. `suggestions.discovery_exclude_labels: [KidsFun]` already excludes kids content from the suggestions grid; that path is unaffected.
- No changes to Strava description annotation. Warmups continue to be tagged `(warmup)`. Deprioritized episodes appear in the chronological list with no annotation.
- No matching on title regex or description tags. Plex labels are curated and reliable; the warmup config's title-regex surface is not replicated here.

## Design

### Config

Add one new top-level key in `data/household/config/fitness.yml` under `plex:`, parallel to `warmup_labels`:

```yaml
plex:
  warmup_labels: [Warmup, Cooldown]
  warmup_description_tags: ["[Warmup]", "[Cooldown]", "[Stretch]"]
  warmup_title_patterns: [...]
  deprioritized_labels: [KidsFun]    # NEW
```

Initial value: `[KidsFun]`. The list is open-ended; future labels can be added without code changes.

### Algorithm

`selectPrimaryMedia` (both `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` and `frontend/src/hooks/fitness/selectPrimaryMedia.js`).

**Today (3 steps):**

1. Drop audio (tracks / items with `artist`).
2. Drop warmups (matched via `warmup_labels`, `warmup_description_tags`, `warmup_title_patterns`).
3. Pick the longest of the survivors. If step 2 left zero, fall back to longest of all videos from step 1.

**After this change (3 steps):**

1. Drop audio.
2. Drop warmups **and** deprioritized (combined into one "skippable" set).
3. Pick the longest of the survivors. If step 2 left zero, fall back to longest of all videos from step 1.

The fallback semantics are unchanged: if every candidate would be filtered out, the algorithm returns the longest video regardless of label. This preserves the existing behavior for warmup-only sessions and extends it to "kids-only" sessions naturally.

### Function signature

The internal config object passed to `selectPrimaryMedia` and `buildWarmupChecker` grows one field:

```js
// before
{ warmup_labels, warmup_description_tags, warmup_title_patterns }

// after
{ warmup_labels, warmup_description_tags, warmup_title_patterns, deprioritized_labels }
```

`buildWarmupChecker` is exported and reused by `buildStravaDescription` for warmup annotation. Its behavior is unchanged — it still only checks the `warmup_*` fields. A new internal helper `isDeprioritized(event)` (or inline check) handles the new label set inside `selectPrimaryMedia` only.

The combined "skip" predicate inside `selectPrimaryMedia` becomes `isWarmup(e) || isDeprioritized(e)`.

### Call sites

Each existing call site that builds the config object today adds one line:

| File | Lines | Change |
|---|---|---|
| `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` | ~218, ~671 | Add `deprioritized_labels: plex.deprioritized_labels \|\| []` |
| `backend/src/3_applications/fitness/StravaReconciliationService.mjs` | ~51 | Same |
| `frontend/src/context/FitnessContext.jsx` | ~498 | Same |

No changes to `buildStravaDescription` (it only consumes warmup fields) or to `DiscoveryStrategy` / `NextUpStrategy` (suggestions code reads warmup patterns directly from `fitnessConfig.plex` without going through the config object).

### Strava integration

No code change. The Strava title is built from `primaryData` returned by `selectPrimaryMedia`. Once the selection algorithm picks the workout instead of Mario Kart, the Strava title naturally reflects the workout. The chronological episode list in the description includes every episode (including deprioritized ones) without label-based annotation.

## Tests

Extend the existing test file for `selectPrimaryMedia` — if `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` exists, append; otherwise create it. Mirror tests on the frontend file if a frontend test exists.

New cases:

1. **Deprioritized loses to workout:** session with a longer `KidsFun`-labeled video and a shorter unlabeled workout video → workout selected.
2. **Deprioritized fallback:** session containing only `KidsFun`-labeled videos → longest `KidsFun` video selected.
3. **Combined skip:** session with one warmup, one `KidsFun`, one regular workout → workout selected.
4. **Existing behavior preserved:** all current tests continue to pass with `deprioritized_labels: []`.

## Files touched

- `data/household/config/fitness.yml` — add `plex.deprioritized_labels: [KidsFun]`
- `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` — extend filter
- `frontend/src/hooks/fitness/selectPrimaryMedia.js` — mirror filter
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` — pass new key (2 sites)
- `backend/src/3_applications/fitness/StravaReconciliationService.mjs` — pass new key
- `frontend/src/context/FitnessContext.jsx` — pass new key
- `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` (new or extended)

## Validation

After the change, re-run primary selection on session `20260422193014`. Expected result: `plex:674499` "Week 1 Day 2 — Lower Body" is selected as primary instead of `plex:661996` "Mario Kart World."
