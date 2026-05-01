# 2026-05-01 — Primary picked on a 48-second demo when only "browsing" content surrounds it

## Symptom

Session `data/household/history/fitness/2026-04-30/20260430192448.yml` was marked with `primary: true` on **"Strength Challenge 1"** (`plex:601458`, 48 s). The user actually did ~21 minutes of cycling while watching **F-Zero** under the "Game Cycling" show (`plex:606445`, 21 min). Neither selection makes sense:

- F-Zero is correctly deprioritized — `kidsfun` label means "casual / browsing content, not the user's actual workout focus" — and per project policy, browsing content should never be picked as primary even when the labels were applied to gameplay-while-cycling sessions.
- Strength Challenge 1 is technically non-warmup, non-deprioritized content, but at 48 s it's a brief demo / "what's next" teaser — calling it the session's primary workout is wrong.

**Correct outcome for this session:** no primary. The user's actual exercise activity (cycling while watching gameplay) is on a deprioritized track, and the only "real" video is a 48-second demo. There is no meaningful workout to surface.

## Evidence

`summary.media` for `20260430192448.yml`:

```yaml
- contentId: plex:606445
  title: F-Zero
  showTitle: Game Cycling
  durationMs: 1254436         # ~20:54
  labels: [kidsfun, resumable, sequential]
  # → dropped by deprioritized filter (kidsfun)

- contentId: plex:140594
  title: Get Ready For This (Workout Mix)
  mediaType: audio
  # → dropped by audio filter

- contentId: plex:601458
  title: Strength Challenge 1
  durationMs: 48682            # ~48 s
  labels: []
  primary: true                # ← WRONG: 48 seconds is a demo, not a workout
```

## Why the existing logic produced this result

In `frontend/src/hooks/fitness/selectPrimaryMedia.js`, after warmup + deprioritized filtering:

- `candidates = [Strength Challenge 1]` (only survivor)
- `pool = candidates` (non-empty)
- Reduce-by-longest returns Strength Challenge 1 — which is the only thing left, regardless of its 48-second length.

The function has no concept of "minimum duration to qualify as primary." Any non-filtered video, however brief, becomes primary.

## Why my Plan 1 sweep missed it

The sweep heuristic was "primary's title looks warmup-ish." Strength Challenge 1's title contains no warmup tokens. The misclassification mode here is different: it's not "warmup mistakenly chosen as primary," it's "trivial-duration demo mistakenly chosen as primary because everything substantive was deprioritized."

## Required behavior change

Two stacked rules, both stated by the user:

1. **Never promote browsing/deprioritized content to primary.** Even when no other survivor exists, do NOT fall back to longest-deprioritized. The existing `pool = candidates.length > 0 ? candidates : videos` fallback is wrong because, when all surviving videos are deprioritized, we currently *would* still return one — but we shouldn't. (This isn't actually exercised today by the bug session because Strength Challenge 1 survives, but it must be hardened anyway.)

2. **A primary must clear a minimum duration threshold.** A 48-second demo doesn't represent a workout. Below the threshold, no primary should be set — return `null` and let `summary.media[]` exist without any `primary: true` flag.

   Default threshold: **5 minutes** (`5 * 60 * 1000 = 300_000` ms). Justification: real workouts are typically 5-60 minutes; below 5 minutes, content is almost always a demo, intro, teaser, or accidental tap. The threshold is configurable so future tuning is cheap.

   Edge case: a session whose only video is a long warmup ("stretching session") should still get the warmup as primary — the fallback "if every survivor is filtered as warmup, pick the longest of those" stays. Only the deprioritized fallback is removed.

## Proposed algorithm

```
videos = items.filter(mediaType !== 'audio')
if (videos.length === 0) return null

const MIN_PRIMARY_MS = 5 * 60 * 1000
const TEN_MIN_MS     = 10 * 60 * 1000

// Step 1: real candidates (non-warmup, non-deprioritized) that clear the duration floor
const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v))
const eligible       = realCandidates.filter(v => durationMs(v) >= MIN_PRIMARY_MS)

if (eligible.length > 0) {
  // Positional bias: ≥2 eligible videos that are also ≥10 min → last wins
  const longSurvivors = eligible.filter(v => durationMs(v) >= TEN_MIN_MS)
  if (longSurvivors.length >= 2) return longSurvivors[longSurvivors.length - 1]
  return longest(eligible)
}

// Step 2: no eligible real workout. Fall back to a long warmup if that's all the user did.
const warmupOnlyMode = videos.every(v => isWarmup(v) || isDeprioritized(v))
if (warmupOnlyMode) {
  const warmups = videos.filter(v => isWarmup(v) && !isDeprioritized(v))
  if (warmups.length > 0) {
    const longestWarmup = longest(warmups)
    if (durationMs(longestWarmup) >= MIN_PRIMARY_MS) return longestWarmup
  }
}

// No primary: short demos, browsing-only sessions, audio-only sessions
return null
```

## Backfill

The 2026-04-30 evening session must be repaired:
- Remove `primary: true` from `plex:601458` in `summary.media[]`
- Do **not** add `primary: true` anywhere — the session has no workout to mark.

## Re-sweep needed

The new sweep heuristic must catch:

1. **Title-warmup misclassifications** (existing — Plan 1 Task 6 already runs this).
2. **Short-demo primaries** — sessions where `summary.media.find(m => m.primary)` has `durationMs < MIN_PRIMARY_MS`.
3. **Deprioritized-only sessions** that happen to have a `primary` set on something short — the same as case 2 in practice, but worth flagging when the session also contains a long deprioritized video (suggests the "real activity" was browsing-mislabeled — informational only, not auto-fixable).

The 2026-04-30 evening session is the seed for this new heuristic. Sweep the same 60-day window plus optionally extend to all of history.

## Files involved

- `frontend/src/hooks/fitness/selectPrimaryMedia.js` — primary algorithm
- `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` — parallel backend implementation (must stay in sync, same way Plan 1 Tasks 2/2b had to)
- `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` — frontend vitest cases
- `tests/isolated/adapter/fitness/selectPrimaryMedia.test.mjs` — backend jest cases
- `frontend/src/hooks/fitness/buildSessionSummary.js:86-90` — caller. **Important behavior change:** when `selectPrimaryMedia` returns `null`, the caller must NOT set `primary` anywhere. Today: `if (primary) primary.primary = true;` already handles null gracefully (no-op). No change to caller.
- Downstream consumers of `summary.media[].primary` (read-only, all use optional chaining):
  - `frontend/src/modules/Fitness/widgets/FitnessSessionsWidget/FitnessSessionsWidget.jsx:119` (`s.media?.primary`)
  - `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx:204` (uses `find(m => m.primary) || summary.media[0]` — already null-safe)
  - Strava enrichment (`session.media?.primary?.contentId`, etc.) — all use optional chaining

## Test cases to add

- F-Zero (deprioritized, 21 min) + Strength Challenge 1 (real, 48 s) → returns `null` (regression for *this* bug, both frontend and backend).
- Only deprioritized survivor (kids cartoon, 30 min) + nothing else → returns `null`.
- Only warmup (10-min stretch) → returns the warmup (existing fallback preserved).
- Real candidate at exactly MIN_PRIMARY_MS → returns it.
- Real candidate just below MIN_PRIMARY_MS (4 min 59 s) → returns `null` if it's the only candidate.
- Two real candidates, one above and one below MIN_PRIMARY_MS → returns the above-threshold one (existing longest behavior, scoped to eligible set).
