# 2026-05-01 — Primary session episode picked the warmup instead of the workout

## Symptom

The session summary's `media[].primary = true` flag was set on a warmup video instead of the main workout. Concrete case (today): session `20260501061820.yml` marked **"22 Minute Hard Corps—Cold Start"** as primary even though the user's actual workout that session was **"Week 1 Day 4 - Upper Body"** (10 Minute Speed Train).

## Evidence

`data/household/history/fitness/2026-05-01/20260501061820.yml`:

```yaml
summary:
  media:
    - contentId: plex:600877
      title: 22 Minute Hard Corps—Cold Start
      mediaType: video
      durationMs: 686164          # ~11.4 min
      description: Optional warmup that will increase your heart rate, warm up your muscles and joints…
      primary: true               # ← WRONG: this is a warmup
    - contentId: plex:674501
      title: Week 1 Day 4 - Upper Body
      mediaType: video
      showTitle: 10 Minute Speed Train
      durationMs: 642081          # ~10.7 min
      labels: [nomusic]
      description: Strengthen your back, shoulders, chest, and biceps…
```

Cold Start was the *first* video played, was longer than the second by ~44s, and has `description` that opens with "Optional warmup". Yet it survived warmup detection in `selectPrimaryMedia()` and won the "longest survivor" tiebreaker.

## Why the existing logic missed it

`frontend/src/hooks/fitness/selectPrimaryMedia.js`

The warmup filter currently uses:

1. Built-in title regexes: `/warm[\s-]?up/i`, `/cool[\s-]?down/i`, `/stretch/i` — title `"22 Minute Hard Corps—Cold Start"` matches **none** of these. "Cold Start" is not lexically a warmup token.
2. `warmup_labels` (config) — Cold Start's `labels` is `[]`, so no match.
3. `warmup_description_tags` (config) — appears not to be configured (or doesn't include the word `warmup` / `Optional warmup`).

After all three filters miss, both videos survive into the candidate pool. The function then picks the longest, which is Cold Start (by 44s).

## Logic change requested by user

Two stacked rules. Both are needed:

1. **Tighten warmup detection** so episodes like Cold Start are filtered out:
   - Add patterns that catch obvious-warmup titles ("Cold Start", possibly "Intro", "Mobility", "Activation"). Make this configurable in the fitness `plex` config rather than hard-coding.
   - Make sure `warmup_description_tags` is actually populated in the deployed config (e.g. `["Optional warmup", "warm-up"]`). Verify after the code change.

2. **Positional bias on tiebreak**: among non-warmup, non-deprioritized survivors that are each ≥ 10 minutes, prefer the **last** one played (later in `media[]`, which is event-chronological). This codifies "the workout typically comes after the warmup, even if both clear the warmup filter".

The existing "longest wins" rule stays as the final fallback when only one survivor is ≥ 10 min, or when no survivor is ≥ 10 min.

### Proposed selection algorithm

```
videos = items.filter(mediaType !== 'audio')
candidates = videos.filter(!isWarmup && !isDeprioritized)
pool = candidates.length ? candidates : videos          // existing fallback

longCandidates = pool.filter(durationMs >= 10*60*1000)
if (longCandidates.length >= 2) return last(longCandidates)  // NEW: positional bias
return pool.reduce(longest)                              // existing tiebreak
```

`media[]` is built from `safeEvents.filter(e => e.type === 'media')` in `buildSessionSummary.js:65-66`, which preserves chronological order, so "last in array" == "played last".

## Backfill

The flag must be moved on the existing session file:

- File: `data/household/history/fitness/2026-05-01/20260501061820.yml`
- Remove `primary: true` from the entry with `contentId: plex:600877`
- Add `primary: true` to the entry with `contentId: plex:674501`

Single file, single edit. Do this from inside the container with the heredoc pattern (do not `sed -i` per CLAUDE.local.md). After the code fix lands, also re-scan recent history (last ~30 days) for similar misclassifications: any session where `primary` is on a media entry whose title or description contains warmup language and where a later, ≥10-min, non-warmup video exists.

## Files involved

- `frontend/src/hooks/fitness/selectPrimaryMedia.js` — selection logic
- `frontend/src/hooks/fitness/buildSessionSummary.js` — caller, builds `warmupConfig` consumer
- `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` (if present — confirm) — needs new cases
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:215, 662` — `buildSelectionConfig(plex)` call sites; same selection module is reused server-side, so the fix flows through to Strava enrichment as well
- The fitness app config (location TBD: search for `warmup_labels` / `warmup_description_tags`) needs to be populated with description tags for cases like "Optional warmup".

## Test cases to write

- One short warmup + one long workout → workout wins (existing behavior, regression test).
- Two ≥10-min videos, neither flagged warmup → second one wins (NEW).
- Two ≥10-min videos, first is flagged warmup → second wins via warmup filter (existing).
- One ≥10-min + one <10-min → ≥10-min one wins (existing "longest", but make sure positional bias doesn't fire when only one is long).
- Three ≥10-min videos → third wins.
- Cold Start title pattern → filtered as warmup (regression for *this* bug).
- "Optional warmup…" description tag → filtered as warmup.
