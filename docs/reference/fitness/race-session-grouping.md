# Race-Session Grouping & Activity Registry

How runs of consecutive **no-video** fitness sessions (e.g. cycle-game races) are merged at read-time into one "giant session," enriched with the games that happened inside them, and rendered with seams + race-band overlays.

> Implemented on branch `feature/race-session-grouping` (2026-06-05). Design: `docs/plans/2026-06-05-race-session-grouping.md`.

## Why

Cycle-game "races" are logged as short no-video workout sessions (often many per afternoon, with idle gaps between). Listing each as a separate "Workout" is noise. When no video was played, it's more meaningful to combine contiguous sessions into one, show how many races happened, and overlay them on the timeline. This is a new *class* of session, distinct from video-backed sessions.

## Grouping (virtual, read-time)

`backend/src/2_domains/fitness/services/groupSessions.mjs` — pure function over session summaries. **Nothing is written to disk; grouping is reversible.** The existing physical `SessionService.mergeSessions` (the video-resume path) is unrelated and untouched.

A run of sessions is collapsed into one virtual group. A **new group starts** when the next session:

- has `media.primary` — a **video session stands alone** *and* acts as a separator;
- crosses the **local calendar day**;
- starts **> 4h** (`GROUP_MAX_GAP_MS`) after the previous member *ended* (gap measured from end, not start);
- has a roster **fully disjoint** from the running group's **union** of riders (the union resets when a group breaks; a disjoint session is both its own group and a hard separator for what follows).

A group exposes `id` (`group:<firstSessionId>`, or the real id for singletons), `isGroup`, `segments:[{sessionId,start,end,durationMs,gapBeforeMs,...}]`, union `participants`, summed `totalCoins`, `media:null`, and `activities:[]` (filled by enrichment). `gapBeforeMs` per segment is what the UI renders as a **seam**.

Applied by default in `GET /api/v1/fitness/sessions` (both `date` and `since` modes). Escape hatch: **`?group=none`** returns the raw ungrouped sessions.

## Activity registry (backend)

`backend/src/3_applications/fitness/activities/` — cross-references each game's own data to a group's time window.

- `ActivityRegistry` — `register(provider)` + `async enrich(group, householdId)` → `[{ type, count, items }]` (only non-empty providers included).
- A **provider** implements `{ type, async loadOverlapping(startMs, endMs, dateStr, householdId) }` → `[{ startMs, endMs, participants:[id], meta:{ raceId, winnerId, distances, timeCapS, backgroundPlexId } }]`.
- `CycleGameProvider` reads `cycle-races/<date>/*.yml` via `CycleRaceService.listByDate`.

**Adding a new game/activity:** write a provider that finds your records in a time window, then `registry.register(new YourProvider({...}))` in `bootstrap.mjs`. Grouping, enrichment, labels, and overlays all work with no further changes.

### UTC chokepoint (important)

`cycle-races/*.yml` stores `race.date` as a **UTC ISO string**, while folder names, filenames, and sessions are **local** time. After 17:00 local (PDT) the in-file date reads as the *next* day. **`raceEpochMs(record)` in `CycleGameProvider.mjs` is the single place that interprets `race.date`** — it converts straight to epoch ms so the skew never leaks into bucketing. Do not parse `race.date` anywhere else; call this helper.

Ghost competitors (participant ids prefixed `ghost:`) are replay reference lines, **not** riders — the provider excludes them from `participants`, `distances`, and winner selection.

## Orchestration

`SessionGroupingService` (`backend/src/3_applications/fitness/services/`):
- `group(sessions, householdId, {enrich=true})` — groups + enriches each non-video group (video groups are skipped). A failing provider is logged and the group keeps `activities:[]` (never crashes the list).
- `getGroupDetail(groupId, householdId)` — for `group:` detail requests: re-derives the day's groups, loads each member's full timeline, and **stitches them with `mergeTimelines(..., gapTicks=0)`** (idle gaps compressed out, no null filler). Produces `segments` (with `offsetMs`), `seams:[{atMs,gapMs}]`, and `activities` whose items are **rebased** onto the compressed axis as `axisStartMs`/`axisEndMs`. Returns a normal-looking session object with `date`, `media:null`, merged `timeline`.

`GET /api/v1/fitness/sessions/:sessionId` intercepts ids starting with `group:` and serves `getGroupDetail`; all other ids use the normal `getSession` path.

## Frontend

- `frontend/src/modules/Fitness/lib/activities/fitnessActivityRegistry.jsx` — maps activity `type` → `{ label:(n)=>"N races", accent, Poster (inline SVG, no asset import), overlayKey }`; `primaryActivity()` picks the highest-count activity. Posters are inline `currentColor` SVG (matching `SportIcon.jsx`); the accent is applied via inline `color`.
- **List card** (`FitnessSessionsWidget`): `sessionDisplay.js` resolves the title (`"{N} races"` for no-video activity sessions, else video/strava/Workout) and the poster.
- **Detail** (`FitnessSessionDetailWidget` + `FitnessTimeline`): `timelineOverlay.js` (pure) maps compressed-axis ms → x via the chart's tick formula; race bands render as translucent accent rects under the HR lanes, seams as dashed full-height dividers on top. Header title/poster come from the registry; `dateStr` prefers `sessionData.date` so `group:` ids don't break date derivation.

## Not covered / future

- Single (un-merged) race sessions don't get band overlays (only `group:` detail enriches/stitches).
- No Strava re-aggregation of merged groups.
- The morning-races-missing-from-sessions issue is a separate concern (those sessions never existed), not a grouping bug.
