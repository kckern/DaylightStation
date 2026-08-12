# Outdoor run bound to a garage session (activity 19465331355)

**Date:** 2026-07-30
**Status:** guards fixed on `fix/strava-match-guards`; **data remediation applied** (session
unlinked, Strava activity restored to "Afternoon Run" with an empty description)
**Session:** `history/fitness/2026-07-25/20260725132556.yml`
**Activity:** Strava 19465331355

## Symptom

A 5.3 km outdoor run was published to Strava titled **"Super Wings—Webcaster
Disaster"** with twelve of the kids' episodes in its description. Locally, the
runner appeared as a participant of the kids' garage session, earned 59 coins,
and satisfied one of its zone challenges.

## What actually happened

| Time (local) | Event |
|---|---|
| 13:25:56 | Garage session starts — three kids on straps, bikes + step platform |
| 14:49, 15:12 | Runner's strap drifts through ANT+ range at rest (HR 70–87) |
| 15:41:28 | Outdoor run starts (Garmin, GPS fix `[47.41, -122.17]`, 5268 m) |
| 15:53–15:57 | Strap back in range mid-run and cooling down (HR 175 → 102) |
| 16:24:57 | Strava webhook fires. Matches the still-live garage session, pushes name + description |
| 16:41:15 | Session ends; the frontend's final save overwrites the webhook's writeback |
| later | `StravaHarvester` re-stamps `participants.<user>.strava` and writes `homeSessionId` / `homeCoins: 4179` / `homeMedia` |
| 17:23:23 | Reconcile Pass 2 pulls our own pushed description back in as `strava_notes` |

Evidence: `household/common/strava/strava-webhooks/19465331355.yml` records
`matchedSessionId: 20260725132556`, one attempt, `enrichedFields: [name, description]`.

Total strap presence: **3.5 min across a 3h15m session**, 2.5 min of it inside
the run's window — 6% of the run's moving time.

## Why every existing guard missed

- **Sport guard** (2026-05-06) required the session to be zero-distance **and**
  have no media. The garage session had twelve media events, so it was skipped.
- **`MIN_OVERLAP_FRACTION = 0.5`** asks only how much of the *activity* falls
  inside the session. A 43-min run inside a 3h15m session scores **1.0**.
- **`sliverAbsorption`** was written for this exact scenario but only deletes
  separate files under 15 min with no media. Here the contamination was *inside*
  a real session, so there was nothing to absorb.
- **`ParticipantRoster` HR floor** only filters *unregistered* devices. A
  registered strap enrolls its owner with no minimum presence.
- **`StravaHarvester.#findMatches`** — the scheduled path, and the one that
  wrote `homeSessionId` — had **no guards at all**, only participant membership
  plus any positive overlap.
- **`_findMatchingSession`** never checked participant membership, so a session
  the athlete sat out could still donate its title.

## Fix

`backend/src/2_domains/fitness/services/activitySessionMatch.mjs` — one policy
consumed by both matchers:

1. **Membership** — the athlete must be a participant.
2. **Venue** — an outdoor activity (GPS fix, or distance over 100 m with no
   trainer flag) may only bind to a session with distance provenance of its own.
   Locally-recorded sessions are stationary by construction.
3. **Presence** — the athlete's own HR coverage inside the activity window must
   be ≥20% of the activity. Skipped when there is no series to measure, so
   riding with cadence and no strap still matches.

`matchBacklog` now passes `distance` through from summary rows — the only venue
signal those rows carry.

### Calibration

Measured against real stored sessions, not invented numbers:

| Session | Venue signal | Presence | Verdict |
|---|---|---|---|
| 2026-07-25 outdoor run | GPS fix, 5268 m, `trainer: false` | 6% | rejected |
| 2026-07-04 indoor ride | no latlng, 0 m, `trainer: true` | 100% | accepted |
| 2026-06-16 indoor ride | no latlng, 0 m, `trainer: true` | fragmentary | accepted (venue clears it) |

Guards are **prospective** — stored links are untouched, and the fast path for
an already-linked `activityId` still runs ahead of them. A missed match now
becomes a Strava-only session, which is recoverable; a false match corrupts
household data and publishes a wrong title, which is not.

## Remediation for the affected record

Applied 2026-07-30, in this order. Order matters: while the session still
references the activity, reconcile Pass 1 treats an empty description as
fillable (`descIsOurs` is true when `activity.description.trim()` is empty) and
re-pushes the kids' episode list.

```bash
# 1. Local: strip the drive-by participant (dry run first; backup automatic)
node cli/fitness.cli.mjs session drop-participant \
  --file=<DATA>/household/history/fitness/2026-07-25/20260725132556.yml \
  --participant=<user> --also-device=40475 --write

# 2. Strava: restore the activity's own identity. Needs DAYLIGHT_BASE_PATH when
#    run from a worktree — .env is gitignored, so a worktree resolves the stub
#    data/ dir and fails on a missing refresh token.
DAYLIGHT_BASE_PATH=<BASE> node cli/fitness.cli.mjs strava update 19465331355 \
  --name="Afternoon Run" --description="" --user=<user>
```

Dropping the participant is enough to stop re-contamination even before the
guards deploy: the unguarded matcher requires participant membership, so once
the athlete is gone from the session, nothing can re-bind it.

Verified against the pre-drop backup: zero remaining occurrences of the
participant id, their device id, or the activity id; only the one contaminated
challenge roster changed; the primary-media flag, media list, other
participants' blocks, and all surviving series are byte-identical; span and
tick_count unchanged.

**Self-healing tail — three derived files still hold the contaminated title.**
An exhaustive scan of the data tree found the activity id in four places:

| File | Holds | Rebuilt by |
|---|---|---|
| `lifelog/strava.yml` | title, `homeSessionId`, `homeCoins`, `homeMedia` | `#generateAndSaveSummary` replaces the entry wholesale from `#createSummaryObject` on each harvest (90-day window) |
| `lifelog/strava/2026-07-25_Run_19465331355.yml` | archive copy | `#saveToArchives` on each harvest |
| `lifelog/health.yml` → `2026-07-25.workouts[0]` | `title`, `strava.title`, `strava.homeMedia` | `AggregateHealthUseCase.execute` rebuilds a rolling **15-day** window from `strava.yml` |
| `common/strava/strava-webhooks/19465331355.yml` | the job record | terminal job; evidence, leave it |

Ordering: `strava.yml` must refresh (harvest) **before** the health aggregation
runs, or health rebuilds from the still-stale title. Both are scheduled, so it
converges — but `health.yml` only heals while 2026-07-25 stays inside the
15-day window, i.e. **by ~2026-08-09**. After that the wrong title is frozen
there and needs a hand edit.

This is inferred from reading those code paths, not observed. Force it early
with a harvest followed by a health aggregation if certainty matters more than
waiting.

## Secondary defects found, not fixed here

- **Pass 2 echo loop.** `ActivityReconciliationService.#pass2StravaToSession`
  has no provenance check, so it pulled our own pushed description back in as
  `strava_notes`. `buildActivityDescription` then re-emits `strava_notes` as
  `📝 "…"` — clear the Strava description and the next reconcile pushes a
  **doubled** media list.
- **Live-session matching.** The webhook fired 17 minutes before the session
  ended, and the frontend's end-of-session save then overwrote the backend's
  writeback (the file has the harvester's 4-field participant strava block and
  no `strava.pushed` provenance). Deferring the match until `session.end` exists
  would close both.
- **No presence gate on recording.** 3.5 minutes of drive-by HR enrolled a
  participant, credited coins, and satisfied a challenge (`metUsers`).

## Scope check

A scan of every 2026 session dir for the signature (a GPS-distance activity
linked to a media-bearing multi-participant session with low participant
coverage) found **this one occurrence**. The two other candidates,
`20260616185313` and `20260704135839`, are legitimate indoor rides — both
`trainer: true`, zero distance, no GPS.
