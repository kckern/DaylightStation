# Cycle Game — Weekly Time-Trial Ladder (Race Weekend, sub-project 1)

**Date:** 2026-07-01
**Status:** Implemented
**Parent initiative:** "Race Weekend" package (weekly TT ladder → Tour de Garage → podium receipts → career layer). Each sub-project gets its own spec/plan cycle; this is the first and lays the data foundation the others reuse.

## Goal

Make racing a persistent family ritual: one featured course per week that everyone rides asynchronously, with a live household ladder, one-tap entry that pre-arms a rival ghost, and ladder-movement feedback at race end. Server-side, establish the course-identity + index + leaderboard foundation the 2026-07-01 cycle-game audit identified as missing (audit: `docs/_wip/audits/2026-07-01-cycle-game-audit.md`, findings C3, backend #2/#4).

## Non-goals (explicit)

- Tour de Garage (stages, GC, jerseys) — sub-project 2.
- Thermal-printed podium receipts — sub-project 3.
- Coins / odometer / trophy cabinet — sub-project 4.
- Kitchen / e-ink ladder surface — later.
- Seasonal resets, handicaps, guest-vs-member ladder policy refinements.
- General remediation from the audit (separate roadmap). Exception: persisting `course_id` and the race index are pulled forward here because they get more expensive to retrofit as races accumulate.

## Design

### 1. Course identity (data model)

- `buildRaceRecord` (`frontend/src/modules/Fitness/lib/cycleGame/raceRecord.js`) gains `course_id` in the persisted `race` object, sourced from the engine config's `courseId` (already produced by `buildRaceConfigFromCourse`, `cycleGameLobby.js:29`; already threaded to the container's `raceMeta`). Null for course-less lobby races.
- **No backfill script.** Historical records are matched by fallback rule (see §4 Matching). No historical YAML is rewritten.

### 2. Race index

New: `YamlCycleRaceDatastore` maintains `_index/{YYYY-MM}.json` shards under the cycle-races root, mirroring the proven `YamlSessionDatastore` pattern (per-day mtime self-heal + write-through invalidation on `save()` — avoids the read-modify-write hazard the audit flagged).

Per race, the index stores:

```json
{
  "id": "20260701063012",
  "epochMs": 1782822612000,
  "course_id": "sprint-1500m",
  "win_condition": "distance",
  "goal_m": 1500,
  "time_cap_s": null,
  "participants": [
    { "userId": "user_3", "isGhost": false, "final_time_s": 161.4,
      "final_distance_m": 1500, "placement": 1 }
  ]
}
```

- `isGhost` = participant key matches `ghost:*` (existing convention).
- `epochMs` derives from `race.date` via the existing `raceEpochMs` UTC chokepoint semantics (reuse/extract it — do not reimplement date parsing).
- Shard rebuild is lazy on read: if any day-folder mtime is newer than the shard's `builtAt`, rebuild that month's shard. `save()` invalidates the affected shard.

### 3. Featured course rotation

Config, in the fitness app config's `cycle_game` block:

```yaml
cycle_game:
  featured_courses:
    - { id: sprint-1500m,   label: "Sprint 1500", win_condition: distance, goal_m: 1500 }
    - { id: endurance-8min, label: "Endurance 8", win_condition: time,     time_cap_s: 480 }
    # optional per course: lap_length_m, background_plex_id
  featured_course_override: null   # set to a course id to pin
```

- Active course = `featured_courses[isoWeekNumber % length]`, unless `featured_course_override` pins one. Deterministic — no cron, no stored state.
- Week window = local Monday 00:00 → next Monday 00:00 (household timezone, consistent with the datastore's local-day folder slicing).

### 4. Endpoints

Both served by `CycleRaceService` (new methods) through `backend/src/4_api/v1/routers/fitness.mjs`. **Route-order constraint:** register `/cycle-races/ladder` and `/cycle-races/personal-bests` BEFORE the existing `/cycle-races/:raceId` route, or Express will swallow them as raceIds.

**`GET /cycle-races/ladder?week=YYYY-Www`** (week optional; default = current)

```json
{
  "course": { "id": "sprint-1500m", "label": "Sprint 1500", "win_condition": "distance", "goal_m": 1500 },
  "week": { "start": "2026-06-29", "end": "2026-07-06" },
  "standings": [
    { "userId": "user_1", "bestValue": 148.2, "raceId": "2026...", "attempts": 3 },
    { "userId": "user_3",   "bestValue": 161.4, "raceId": "2026...", "attempts": 1 }
  ],
  "allTimeRecord": { "userId": "user_1", "bestValue": 141.0, "raceId": "2026...", "date": "2026-05-12" }
}
```

**`GET /cycle-races/personal-bests?userId=<id>&courseId=<id>`**

```json
{ "userId": "user_3", "courseId": "sprint-1500m",
  "best": { "bestValue": 161.4, "raceId": "2026...", "date": "2026-06-30" } }
```

`best: null` when the rider has no qualifying attempt.

**Ladder semantics (the rules, precisely):**
- **Matching:** a race counts for a course when `race.course_id === course.id`, OR (legacy fallback) `win_condition` matches AND the goal matches (`goal_m` for distance, `time_cap_s` for time).
- **Attempt value:** distance course → `final_time_s` (lower is better; participants with null `final_time_s` — DNF/unfinished — do not qualify). Time course → `final_distance_m` (higher is better; any positive distance qualifies).
- **Best per rider:** each rider's single best qualifying attempt in the window; `attempts` counts their qualifying attempts.
- **Eligibility:** ghosts excluded (`isGhost`). All live participants count, including guests. Multi-rider races count each live participant independently; solo rides count equally.
- **Ties:** identical `bestValue` → the earlier attempt ranks higher (first to set it holds the rung).
- **All-time record:** same rules, all history, no week window.
- **Errors:** invalid `week`/missing params → 400. No qualifying races → 200 with empty `standings` / `allTimeRecord: null`. Computation is index-only (no full-YAML fan-out).

### 5. Lobby: "This Week's Course" card (`CycleGameHome`)

- New card, prominent placement above/beside the existing race-type picker: course label, days-remaining chip ("Ends in 3 days"), standings list (avatar via existing identity resolution, best value formatted per win condition, delta to the rung above), all-time record row.
- **Ride It** button: builds the race config via the existing `buildRaceConfigFromCourse(course, opts)` path (which sets `courseId` for free) and pre-arms a rival ghost:
  - Rider ranked directly above the (first assigned) rider on the ladder → their best attempt as ghost.
  - Ladder leader → their own all-time PB as ghost (via personal-bests endpoint).
  - No ladder data / no PB → no ghost, race proceeds plain.
  - Ghost data loads through the existing `GET /cycle-races/:raceId` + existing ghost decode pipeline; no new ghost machinery.
- Card fetches the ladder on lobby mount. On fetch failure: card hides, `warn` logged via the structured logging framework (no raw console). Riders can still race the featured course manually — matching is by course, not by entry point.

### 6. Results integration

After a race that matches the featured course and a successful save, `RaceResults` shows a ladder-movement callout per live rider: "↑ 2nd this week — 4.2s behind Dad", "Ladder lead!", or "Best: 2:41 (your #2 attempt)". Implementation: re-fetch the ladder endpoint post-save; diff against the pre-race standings held from the lobby fetch. Any failure → skip the callout silently (logged), never block the results board.

### 7. Logging

Per house rules, structured logging at each seam: ladder fetch ok/fail + duration, Ride It tap (courseId, ghost armed or not), ladder-movement computation, index shard rebuilds (backend service logs count + duration).

## Testing

- **Unit (backend):** index shard build from fixture race files; mtime self-heal; write-through invalidation on save; ladder ranking — ties, ghost exclusion, DNF exclusion, legacy `(win_condition, goal)` fallback matching, week-boundary edges (race at Sunday 23:59 vs Monday 00:01 local); PB selection incl. `best: null`.
- **Router:** both endpoints — happy path, `week` param, 400s, empty history, and a regression test that `/cycle-races/ladder` is not captured by `/:raceId`.
- **Unit (frontend):** ladder card rendering states (populated / empty / error-hidden); Ride It config building incl. ghost pre-arm selection rules; results callout diffing.
- **Playwright flow:** lobby shows featured card → Ride It → sim race → results shows ladder movement.
- House rules apply: no conditional assertion skipping; capture real test exit codes.

## Dependencies & notes

- **Not blocked on** the audit remediation roadmap, but two audit items materially improve this feature and should land nearby: C6 (ghosts visible on the start line — makes the pre-armed rival feel real) and C1 (save retry — a lost save means a lost ladder attempt).
- Sub-projects 2–4 (Tour, receipts, career) consume this index and these semantics; endpoint shapes above are designed to extend (e.g. Tour adds stage aggregation over the same index rows).
- Config lives in the household fitness config served by `getHouseholdAppConfig` (the audit-noted live file, not the stale `apps/{app}/config.yml` duplicate).

## Known issues / follow-ups (from final branch review, 2026-07-01)

- Card omits the delta-to-rung-above the spec listed for standings rows (delta does appear in results callouts).
- `fetchLadder` hides the card silently on HTTP 5xx (only network throws warn); add a warn on non-404 `!ok`.
- Index shard rebuilds are not logged from the datastore (service logs entries+duration instead).
- Legacy `(win_condition, goal)` fallback can cross-match two configured courses sharing the same goal — constraint to respect when authoring `featured_courses`; revisit for Tour (sub-project 2).
- Index self-heal's pure-mtime (out-of-band file) path and INDEX_VERSION-mismatch branch lack direct tests.
- Ride It with no rider assigned still fetches a rival and arms a ghost before startRace no-ops (benign; one-line guard).
- Results ladder callout fires only for Ride It entries; manual featured-course rides rank but get no callout.
