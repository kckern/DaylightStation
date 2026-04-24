# Office program plays the same poem every morning

**Date:** 2026-04-23
**Severity:** Low (annoyance, not a hard failure)
**Component:** `QueueService`, `ListAdapter._getNextPlayableFromChild`, `ItemSelectionService`, office-program list config
**Discovered while:** verifying the wake-and-load fix — noticed `readalong:poetry/remedy/02` had `playCount: 3` and was selected again today.

---

## Summary

The office-program morning sequence kept serving the same poem ("From New Every Morning") every cycle even though there are 50+ poems available. Two independent issues were stacking:

1. **Short audio readalongs got stuck "in progress" at ~71%** because the watched threshold is hardcoded to 90%. A 28-second poem that the user listened to for 20 seconds (then the next program slot fired) saved as 71% complete and was treated as resume-eligible forever.
2. **The office-program poetry slot resolved through a path that doesn't use `ItemSelectionService`** — `ListAdapter._getNextPlayableFromChild` has its own "in_progress > unwatched > first" cascade. It used the same 90% threshold and so always returned the 71%-stuck poem on the first pass. There was no way to declare a per-slot strategy from YAML.

## Reproduction

1. Trigger office-program: `GET /api/v1/queue/office-program`.
2. Observe position 1 is always `readalong:poetry/remedy/02`.
3. Check `data/household/history/media_memory/poetry.yml`:
   ```yaml
   readalong:poetry/remedy/02:
     playhead: 20
     duration: 28
     percent: 71
     playCount: 3
     lastPlayed: '2026-04-23 16:21:53'
   ```
4. Re-trigger: still serves poem 02. Even though 49 other poems are unwatched.

## Root cause

### Bug A: 90% completion threshold is wrong for sub-minute audio

`backend/src/2_domains/content/services/QueueService.mjs:42` and `backend/src/1_adapters/content/list/ListAdapter.mjs:18`:

```javascript
const WATCHED_THRESHOLD = 90;
```

For a 147-second video, "90% watched = done" works (you've seen the meat). For a 28-second poem, the user gets through 20 seconds (71%), the next program slot starts, the poem stops short. 71% of 28 seconds is 9 seconds remaining — practically the whole point. But percent < 90, so the system thinks "you stopped midway, here it is again tomorrow."

Compounded by `_getNextPlayableFromChild` line 775:

```javascript
if (percent > 1 && percent < 90) return item;  // first pass: pick in-progress
```

Poem 02 satisfies this every time forever.

### Bug B: program slots can't declare a selection strategy

The office-program YAML has `shuffle: true` on the poetry slot:

```yaml
- input: 'poem: remedy'
  label: Poetry
  shuffle: true
```

But `shuffle: true` on a program slot only triggers the manual Fisher-Yates path inside `_resolveListPlayables` (line 1244-1248) — and **that path only runs when `item.queue` is truthy** (the queue action returning all items). For the play action (returning a single item), the slot is routed to `_getNextPlayableFromChild`, which ignores `shuffle` entirely.

There was no way to say "for this slot, pick a random unwatched item." `ItemSelectionService` had the right primitives (`{ filter: ['watched'], sort: 'random', pick: 'first' }` is a valid strategy combo) but no `rotation` named strategy and no plumbing from YAML to `select()` overrides.

## Fixes

Three commits, two layers.

### Fix A — duration-aware watched threshold (commit `2c24beef`)

New centralized helper in `QueueService`:

```javascript
const SHORT_DURATION_THRESHOLD_S = 60;
const SHORT_WATCHED_THRESHOLD = 70;

static isWatched(item) {
  if (item?.watched) return true;
  const percent = item?.percent || 0;
  const duration = item?.duration;
  const threshold = (duration && duration < SHORT_DURATION_THRESHOLD_S)
    ? SHORT_WATCHED_THRESHOLD
    : WATCHED_THRESHOLD;
  return percent >= threshold;
}
```

`QueueService.filterByWatched` and `ListAdapter._getNextPlayableFromChild` both delegate to this so the rule is consistent across the program-slot single-pick path and the `ItemSelectionService` watched-filter path.

A 28s poem at 71% now correctly classifies as watched.

### Fix B1 — new `rotation` strategy (commit `eda04ce7`)

Added to `ItemSelectionService.STRATEGIES`:

```javascript
rotation: {
  filter: ['watched'],
  sort: 'random',
  pick: 'first'
}
```

Pair with `allowFallback: true` to recycle the pool when fully watched.

### Fix B2 — wire slot-level `strategy:` through (commit `4a340db2`)

- `listConfigNormalizer.mjs`: preserve `item.strategy` field.
- `ListAdapter._resolveListPlayables`: when a program slot has `item.strategy && resolved.adapter.resolvePlayables`, call new helper `_pickViaStrategy(strategyName, resolved, child)` instead of `_getNextPlayableFromChild`.
- `_pickViaStrategy` does `resolvePlayables` → enrich items with `percent` from `mediaProgressMemory` → `ItemSelectionService.select()` with `allowFallback: true`.

Slots without `strategy:` keep the existing in-progress-first cascade.

### Config — opt poetry slot into rotation

`data/household/config/lists/programs/office-program.yml` (data volume):

```yaml
- input: 'poem: remedy'
  label: Poetry
  shuffle: true
  strategy: rotation       # ADD
  uid: 96fd9a79-...
```

## Verification

Triggered `GET /api/v1/queue/office-program` after deploying the new image:

| Position | Before | After |
|---|---|---|
| 1 (poetry) | `readalong:poetry/remedy/02` ("From New Every Morning"), playCount: 3 | `readalong:poetry/remedy/49` ("Follower"), **playCount: 0** |

Wake-and-load chain ran clean (`wake-and-load.complete totalElapsedMs: 6767, ok`), `subscriberCount: 1` on `homeline:office-tv`, content dispatched to `topic: office`, Aljazeera news played first as expected.

## Out of scope (potential follow-ups)

- `_getNextPlayableFromChild` and `ListAdapter` still have their own copies of `WATCHED_THRESHOLD` / `MIN_PROGRESS_THRESHOLD`. Centralizing is good but the watchlist scoring path (lines 601, 654) wasn't touched. Worth folding in eventually.
- Other slots in office-program (and other programs) may benefit from explicit `strategy:` declarations. Today only the poetry slot got one — out of the 15 slots — because that's where the bug bit. A pass through the catalog could opt other repeating-content slots into `rotation`, `freshvideo`, or `sequential` as appropriate.
- Audio readalong sources could surface duration+watch state more efficiently. Currently `_pickViaStrategy` does `resolvePlayables` (returns all) then enriches with progress. For a 50-poem catalog it's fine; for a 5,000-item source it'd be wasteful — `loadPlayableItemFromKey`-style smart selection would scale better.

## Files

| File | Role |
|---|---|
| `backend/src/2_domains/content/services/QueueService.mjs` | New `isWatched(item)` helper; `filterByWatched` delegates to it. |
| `backend/src/1_adapters/content/list/ListAdapter.mjs` | `_getNextPlayableFromChild` uses `QueueService.isWatched`; new `_pickViaStrategy(strategy, resolved, child)` helper; `_resolveListPlayables` routes slots with `strategy:` to it. |
| `backend/src/2_domains/content/services/ItemSelectionService.mjs` | New `rotation` strategy preset. |
| `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` | Preserves `item.strategy` field through normalization. |
| `backend/tests/unit/domains/content/QueueService.shortAudioWatched.test.mjs` | 11 cases for duration-aware watched rule. |
| `backend/tests/unit/domains/content/ItemSelectionService.rotation.test.mjs` | 4 cases for the new strategy. |
| `data/household/config/lists/programs/office-program.yml` | Poetry slot opts into `strategy: rotation`. (Data volume; not git-tracked.) |
