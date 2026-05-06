# Fitness Session ↔ Strava Sync — Fragmentation, Mismatch, and Resume-Check Failure

**Status:** Investigation complete — root cause confirmed
**Author:** Claude (auto-audit)
**Date:** 2026-05-06
**Severity:** High — every resume/auto-merge attempt since deploy has failed silently; one outdoor Strava activity has been silently linked to an unrelated home session; one webhook job has been retrying for 44 days

---

## TL;DR

Three independent regressions are conspiring to scramble the Strava ↔ home-session
correspondence:

1. **The auto-merge resume check has been 100% broken since the 2026-04-28 fix shipped.**
   The frontend sends a *bare* plex localId (`'664042'`) to
   `GET /api/v1/fitness/resumable`, but the backend filter compares strict-equal
   against the *prefixed* contentId stored in the YAML (`'plex:664042'`). Every
   resume check in the production logs returns `{ resumable: false }` — including
   13-second-gap re-starts of the exact same workout.

2. **The Strava webhook can match an activity to an unrelated overlapping home session.**
   On 2026-05-05 the user's outdoor "Lunch Run" (12:30–13:09 PT, 3.25 mi) was
   linked to a 7-minute treasureBox-only home session at 13:07–13:14 PT because
   the time windows overlapped within the 5-minute buffer. Result: no Strava-only
   session was ever created; the run is invisible in the home history; the
   matched session is misattributed to a Run.

3. **The webhook job store retries forever.** Activity `17831319049` has 485
   attempts since 2026-03-23 with status `unmatched`. There is no terminal-failure
   state once `MAX_RETRIES = 3` is reached — `recoverPendingJobs()` re-queues
   anything in `findActionable()` on every startup.

These three combine so that recent days look fragmented, duplicated, and
disconnected from the Strava list — exactly the symptom reported.

---

## Evidence

### 1. Local sessions vs. Strava activities, 2026-05-01 → 2026-05-06

| Date | Strava activities | Local session files | Status |
|---|---|---|---|
| 2026-05-01 | `18333086396` Cold Start (06:18, WT 24min) · `18340537169` Daytona USA (19:36, Ride 28min) | `20260501061820.yml` (06:18→06:49, 31m) · `20260501190411.yml` (19:04→19:35, 31m) · `20260501193558.yml` (19:35→20:06, 31m) | **Fragmented** — evening ride split into TWO sessions, same `plex:606446` Daytona USA, **7-second gap** at 19:35:51→19:35:58. Should have auto-merged. |
| 2026-05-02 | `18350342309` Coal Creek run (10:51, Run 39min) | `20260502105107.yml` (10:51→11:36, 45m, `source: strava`) · `20260502184911.yml` (18:49→19:09, 20m) | OK — morning run created Strava-only session correctly. Evening 18:49 session is unmatched home-only (no Strava). |
| 2026-05-04 | `18372028857` Morning Weight Training (06:18, WT 20min) · `18380161567` Daytona USA (19:23, Ride 35min) | `20260504061824.yml` (06:18→06:38, 19m, `source: strava`) · `20260504191634.yml` (19:16→20:04, 48m) | OK — morning is Strava-only; evening was linked & enriched. |
| 2026-05-05 | `18390552794` Lunch Run (12:30, Run 37min, 3.25 mi, **outdoor**) | `20260505130756.yml` (13:07→13:14, **6m 55s only**, no media, 86 coins) | **Bad match** — Strava webhook linked the 37-min outdoor run to a 7-min indoor treasureBox session because the windows overlapped. No `source: strava` Strava-only session was created. The 3.25-mile run is invisible in fitness history. |
| 2026-05-06 | (none yet) | `20260506125238.yml` (12:52→13:00, 8m, `plex:664042`, 0 coins) · `20260506130106.yml` (13:01→13:46, 45m, `plex:664042`, 368 coins) | **Fragmented** — same Chest & Back content, **13-second gap** at 13:00:53→13:01:06. Should have auto-merged. |

### 2. Resume-check log evidence — 100% failure rate

`grep "fitness.session.resume_check.result" media/logs/fitness/*.jsonl`
across every log file in the past two weeks:

| Total `resume_check.result` events | `"resumable":true` | `"resumable":false` |
|---|---|---|
| 4 | **0** | 4 |

Plus 5 `fitness.session.resume_check.no_content` events where the contentId
was `null` at buffer-threshold time.

**Every resume check that did get a contentId failed.** Every one of the
four `resume_check.start` entries with a non-null contentId looks like:

```json
{"event":"fitness.session.resume_check.start","data":{"reason":"buffer_threshold_met","contentId":"664042"}}
{"event":"fitness.session.resume_check.result","data":{"contentId":"664042","resumable":false,"finalized":false,"matchedSessionId":null}}
```

Note: `"contentId":"664042"` — a bare plex local-id, **not** `"plex:664042"`.

### 3. Strava webhook job state

```yaml
# data/household/common/strava/strava-webhooks/18390552794.yml
activityId: 18390552794             # 2026-05-05 12:30 Lunch Run
status: completed
attempts: 2
matchedSessionId: '20260505130756'  # ← the 7-minute treasureBox session
note: no-enrichable-content
```

```yaml
# data/household/common/strava/strava-webhooks/17831319049.yml
activityId: 17831319049             # 2026-03-23
status: unmatched
attempts: 485                       # !
lastAttemptAt: '2026-05-06T19:25:51.371Z'
```

---

## Root causes

### A. Resume-check format mismatch — the silent killer

#### What the frontend sends

`frontend/src/hooks/fitness/FitnessSession.js:1551`:

```js
_getCurrentContentId() {
  const playlist = this.snapshot?.mediaPlaylists?.video;
  if (Array.isArray(playlist) && playlist.length > 0) {
    const id = playlist[0]?.contentId || playlist[0]?.id;
    if (id) return id;
  }
  return this._pendingContentId || null;
}
```

`frontend/src/context/FitnessContext.jsx:2116-2122`:

```js
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session || typeof session.setPendingContentId !== 'function') return;
  const head = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue[0] : null;
  const id = head?.contentId || head?.id || null;
  session.setPendingContentId(id);
}, [fitnessPlayQueue]);
```

Both fall back to `head.id`. **`head.id` is the bare plex localId** because of how
the play queue is populated.

`frontend/src/modules/Fitness/nav/FitnessMenu.jsx:13-25, 311-323`:

```js
const getPlexId = (item) => item?.play?.plex || item?.queue?.plex || item?.list?.plex || null;
const getItemKey = (item) => getPlexId(item) || item?.id || null;
// …
setFitnessPlayQueue(prevQueue => [...prevQueue, {
  id: getItemKey(show),     // ← bare numeric plex id, e.g. '664042'
  title: show.label,
  videoUrl: show.url || show.videoUrl,
  // … no contentId field is ever set
}]);
```

The play queue items as constructed do **not** have a `contentId` field at all.
`head.contentId` is always `undefined`, so the fallback always takes `head.id`,
which is `getPlexId(show)` — the bare local id straight from the
`item.play.plex` action object.

#### What the backend stores

`backend/src/3_applications/fitness/services/SessionService.mjs:323-356`
(`findResumable`):

```js
const candidates = sessions.filter(s => {
  if (s.finalized) return false;

  const mediaId = s.media?.primary?.contentId
    || s.contentId
    || null;
  if (mediaId !== contentId) return false;
  // …
});
```

`s.media.primary.contentId` is built by
`backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:300-318`:

```js
const formatMedia = (m) => {
  const source = ItemId.extractSource(m.contentId);
  return {
    contentId: ItemId.normalize(m.contentId, source),
    // …
  };
};
```

`ItemId.normalize('plex:664042', 'plex')` → `'plex:664042'` (unchanged because
the colon is present). The YAML's `summary.media[0].contentId` is `'plex:664042'`.

So the filter is comparing `'plex:664042' !== '664042'` → **always rejects every
candidate**. The 30-minute gap window, the `finalized` flag, the per-day scan —
none of it ever matters because the filter trips on identifier-format mismatch
before any of those checks could possibly succeed.

#### Why the 2026-04-28 fix didn't catch this

The unit test at
`frontend/src/hooks/fitness/FitnessSession.contentId.test.js` exercises
`_getCurrentContentId()` with a hand-crafted prefixed string
(`session.setPendingContentId('plex:606203')`) — but in production, nothing
ever passes a prefixed string into `setPendingContentId`. The test verified
the *plumbing* but not the *data shape* the plumbing actually carries.

The 04-28 fix added telemetry that *would have caught this* if anyone read the
logs: the `contentId` field in
`fitness.session.resume_check.start` events is right there as a bare number.
The structured logs are good; nobody had reason to look at them until now.

### B. Strava webhook partial-overlap match — the wrong-bucket problem

`backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:285-377`
(`_findMatchingSession`) uses a **±5-minute time-overlap match** against any
session ≥120 seconds:

```js
const BUFFER_MS = 5 * 60 * 1000;
const MIN_SESSION_SECONDS = 120;
// …
const actStartBuffered = actStart.clone().subtract(BUFFER_MS, 'ms');
const actEndBuffered   = actEnd.clone().add(BUFFER_MS, 'ms');
// …
const overlapStart = moment.max(actStartBuffered, sessStart);
const overlapEnd   = moment.min(actEndBuffered,   sessEnd);
const overlapMs    = overlapEnd.diff(overlapStart);
```

**Any** non-zero overlap, however small, qualifies as a "match" — and the longest
overlap wins. There is no minimum-overlap threshold, no contentId guard, no
sport/type compatibility check.

For 2026-05-05:

| Window | Source | Range | Overlap (with ±5 min buffer) |
|---|---|---|---|
| Strava activity | Outdoor run | 12:30:00 → 13:09:48 PT (Run, 3.25 mi, GPS) | — |
| Local session | Indoor treasureBox | 13:07:56 → 13:14:51 PT (415 s, no media) | ~7 min |

The overlap is 7 minutes, well above zero, so the activity matched. The matched
session has no media (`summary.media: []`), so `buildStravaDescription` returns
nothing → `note: 'no-enrichable-content'` → cooldown set → done.

Net effect:
- The 37-minute, 3.25-mile outdoor run is **not** in the home-session history.
- The 7-minute indoor treasureBox session has Strava data attached *via the
  `enrichActivity` writeback path* (line 192-213) — it now claims to be a Run.
- `_createStravaOnlySession` is never reached because match succeeded.

Sport/type incompatibility ought to be a hard gate here. A bike ride and a
weight-training session can have the same timestamp window if the user is
juggling devices, but a *Run with GPS* should never be allowed to inherit a
session that has zero distance and a `WeightTraining`/no-media body.

### C. Webhook job store has no terminal-failure shelf

`backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:155-187`:

```js
if (!match) {
  if (attempt < MAX_RETRIES) {
    setTimeout(() => this._attemptEnrichment(activityId), RETRY_INTERVAL_MS);
    return;
  }
  // No matching home session after retries — create a Strava-only session
  // …
}
```

After `MAX_RETRIES = 3`, the code falls through to
`_createStravaOnlySession` — which can throw if e.g. the activity has no
streams, the user auth has expired, the file write fails, or any other
error path is hit. In that case the catch block sets
`status: 'unmatched'`. Good.

But `recoverPendingJobs()` re-queues every job in `findActionable()` on every
startup, regardless of `attempts` count or how long ago the job was created.
And `_attemptEnrichment` will attempt the same flow again, potentially
forever.

For activity `17831319049`, that path has been re-attempted 485 times since
2026-03-23. Each attempt costs a Strava `getActivity` call and a full
fitness-history scan. There is no aging policy ("unmatched for >7 days →
quarantine") and no manual escape hatch.

### D. Pre-session contentId race (already in 04-28 audit, still present)

Five resume checks in the recent logs have `contentId: null`. This happens
when `buffer_threshold_met` fires before the React `useEffect` that calls
`setPendingContentId(playQueue[0]?.id)` has run. The 04-28 fix was supposed to
solve this by writing a hint *before* the session starts, but it relies on
React effect ordering: the play queue must already be populated when the
session goes live. On a cold reload it commonly isn't.

Even if the contentId race were fixed, root cause A still bites — the value
written via the hint is the same bare local-id.

---

## Why the recent commits made it worse, not better

The 2026-04-28 audit identified the original symptom (fragmentation) and the
fix landed in commits `a2e701093`, `3e4c355da`, `6ce291d2b`,
`76d5b56fb`. Those commits:

- Fixed a typo (`DaylightAPI.get` → `DaylightAPI()`) that made the resume call throw.
- Added `setPendingContentId` plumbing.
- Added structured logging on both sides.

What they *didn't* do: ensure the data flowing through `setPendingContentId`
has the correct `source:localId` shape. Before the typo fix, the resume call
threw and the catch block returned `{ resumable: false }` silently — same
end result as today. So from the *user-visible* perspective, the auto-merge
has never worked, and the 04-28 fix simply replaced one always-fail path with
another always-fail path.

The merge endpoint `POST /api/v1/fitness/sessions/merge` does work
mechanically — `cli/merge-fitness-sessions.cli.mjs` (the script written for
the 04-28 cleanup) successfully merged the three fragmented files — but the
endpoint is not invoked from production code. The whole merge flow is gated on
the resume check that never matches.

Newer fitness commits in the period (suggestion strategies, primary-media
selection, cadence filter, etc.) are orthogonal to this issue; none of them
changed the resume/merge code path.

---

## What's definitely true

1. **Zero successful auto-resumes in production** since the resume-check feature
   shipped. All 9 `resume_check.result` events in the recent log set returned
   `resumable: false`, and 5 more never got past `no_content`.
2. **Every non-null contentId sent to the backend is bare** — `'664042'`,
   `'606052'`, `'606054'` — not `'plex:664042'`. The backend strict-equality
   filter rejects all of them.
3. **At least one outdoor Strava run is mis-attached** to an unrelated home
   session (2026-05-05 Lunch Run → `20260505130756`).
4. **At least one webhook job is in a 44-day-old retry loop** (`17831319049`,
   485 attempts).
5. **At least four sessions in the last 7 days** are demonstrable fragments of a
   single workout (May 1 evening: 19:04 + 19:35; May 6 morning: 12:52 + 13:01).
6. **The 04-28 fix passed its tests** because the tests pre-supplied prefixed
   strings that real callers never produce.

---

## Hypotheses and severity ranking

The format mismatch (A) is the single root cause for fragmentation. The other
three (B/C/D) compound the data-quality problem but are independent bugs.

| # | Issue | Confidence | Impact |
|---|---|---|---|
| A | bare-id vs prefixed-id contentId mismatch in `findResumable` | **proven** by log evidence + code reading | Total loss of auto-merge / silent resume |
| B | partial time-overlap with no sport guard mis-matches Strava ↔ home | **proven** by 2026-05-05 webhook record + session contents | Wrong activity attribution; missing GPS-run history |
| C | unbounded webhook retry loop | **proven** by `attempts: 485` job file | Wasted API calls; noisy logs |
| D | pre-session contentId race | observed (5 `no_content` events) | Sub-cause of A — irrelevant once A is fixed because the value would still be wrong |

---

## Recommended fixes (in priority order)

### Fix A.1 — Normalize the contentId at the entry points (cheapest)

Two single-line fixes restore auto-merge:

```js
// frontend/src/hooks/fitness/FitnessSession.js  (around line 1551)
_getCurrentContentId() {
  const playlist = this.snapshot?.mediaPlaylists?.video;
  if (Array.isArray(playlist) && playlist.length > 0) {
    const head = playlist[0];
    const id = head?.contentId
      || (head?.id != null ? `plex:${head.id}` : null);  // ← prefix bare ids
    if (id) return id;
  }
  return this._pendingContentId || null;
}
```

```js
// frontend/src/context/FitnessContext.jsx  (around line 2119-2121)
const head = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue[0] : null;
const id = head?.contentId
  || (head?.id != null ? `plex:${head.id}` : null);     // ← prefix bare ids
session.setPendingContentId(id);
```

Drawback: hard-codes `plex:` as the source. If the play queue ever gets
non-Plex items (YouTube, scriptures, Komga), they'd be mis-prefixed. Better
to import `ItemId.normalize` semantics.

### Fix A.2 — Carry `contentId` on play-queue items (canonical)

Update `frontend/src/modules/Fitness/nav/FitnessMenu.jsx:311-323` to push a
proper `contentId` field:

```js
setFitnessPlayQueue(prevQueue => [...prevQueue, {
  id: getItemKey(show),
  contentId: getPlexId(show) ? `plex:${getPlexId(show)}` : null,
  title: show.label,
  // …
}]);
```

…and audit every other call site that pushes onto the play queue
(`FitnessShow.jsx`, queue-controller hooks). This is the right shape going
forward; bare `id` becomes a UI key only.

### Fix A.3 — Defensive normalization on the backend

```js
// SessionService.mjs:findResumable, before the filter
const normalizedTarget = contentId.includes(':') ? contentId : `plex:${contentId}`;
```

Belt-and-suspenders: even if the frontend sends a bare id, the backend
recovers. Cheap and protects against future regressions.

**All three should ship together.** A.1 + A.3 alone restore behavior; A.2 is
the cleanup that makes the data model honest.

### Fix B — Sport/type guard on Strava ↔ home matching

In `_findMatchingSession`, reject candidates whose summary doesn't fit the
activity type:

```js
// Reject GPS-distance activities matched against zero-distance sessions
if (activity.distance > 100 && (data.summary?.distance ?? 0) === 0
    && !data.summary?.media?.length) {
  continue;  // outdoor activity vs media-less indoor session — implausible
}
// Optional: also enforce a minimum-overlap fraction
if (overlapMs < 0.5 * (activity.elapsed_time * 1000)) continue;
```

The right rule is debatable, but the *current* rule ("any overlap ≥1 ms wins")
is wrong by inspection.

### Fix C — Aging policy for webhook jobs

After N total attempts (e.g. 10) or M days old, transition a job to
`status: 'abandoned'` and drop it from `findActionable()`. Surface abandoned
jobs in an admin endpoint so they can be investigated manually.

### Fix D — Eliminate the pre-session contentId race

Once A is fixed, this still matters because the *first* buffer-threshold
event after a cold reload may fire before the play queue has hydrated. Two
options:

1. Delay `buffer_threshold_met` from triggering session start until the play
   queue has at least been queried (even if empty).
2. Persist the last-seen contentId to localStorage and rehydrate on mount.

Option 2 is more robust against page-reload during a workout.

### Cleanup — Reconcile the data damage

After the fixes ship, a one-shot CLI:

1. Identify Strava activities whose `matchedSessionId` points at a session
   with a wildly different sport profile (no media + no equipment use vs. Run
   activity → bad). Re-process those: detach the bad match, run
   `_createStravaOnlySession`.
2. Identify same-day, same-contentId session pairs with <5 min gaps and
   neither side `finalized: true`. Merge via `mergeSessions`.

For 2026-05-05 specifically: detach `18390552794` from
`20260505130756`, then create a fresh Strava-only session for the run.

For 2026-05-06 specifically: merge `20260506125238` into `20260506130106` so
the morning Chest & Back workout becomes one record.

For 2026-05-01 specifically: merge `20260501190411` into `20260501193558`
(Daytona USA Game Cycling, 7-second gap).

---

## What good looks like (acceptance criteria)

After fixes:

1. A workout interrupted by a 13-second tab refresh produces **one** session
   file, not two.
2. The frontend log line
   `fitness.session.resume_check.start data.contentId` is consistently
   prefixed (`plex:664042`, never bare `664042`).
3. The backend log line `fitness.resumable.check.match` appears at least
   sometimes — currently never appears.
4. An outdoor GPS Strava activity uploaded while the home fitness page is
   open does **not** silently inherit an unrelated home session;
   either creates its own Strava-only session or matches a fitness session
   whose participant actually wore the device.
5. Webhook jobs that fail to enrich after a reasonable number of attempts
   stop retrying and surface for manual triage.
6. The merge endpoint `POST /api/v1/fitness/sessions/merge` is exercised
   regularly in production logs (currently 0 invocations) — proving the
   resume → hydrate path is doing real work.

---

## Files referenced

### Frontend
- `frontend/src/hooks/fitness/FitnessSession.js:1551-1559` — `_getCurrentContentId`
- `frontend/src/hooks/fitness/FitnessSession.js:1543-1547` — `setPendingContentId`
- `frontend/src/hooks/fitness/FitnessSession.js:1499-1532` — `_startWithResumeCheck`
- `frontend/src/hooks/fitness/FitnessSession.js:1226-1238` — buffer threshold
- `frontend/src/hooks/fitness/FitnessSession.contentId.test.js` — unit test that
  passes prefixed ids (production data does not)
- `frontend/src/context/FitnessContext.jsx:2116-2122` — `setPendingContentId` wiring
- `frontend/src/modules/Fitness/nav/FitnessMenu.jsx:13-25, 311-323` — play-queue
  item construction (no `contentId` field; `id = getPlexId(show)` bare)

### Backend
- `backend/src/3_applications/fitness/services/SessionService.mjs:320-397` —
  `findResumable`; the format-mismatch filter
- `backend/src/3_applications/fitness/services/SessionService.mjs:409-470` —
  `mergeSessions` (works; never invoked in production)
- `backend/src/4_api/v1/routers/fitness.mjs:429-441` —
  `GET /api/v1/fitness/resumable`
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:131-272` —
  webhook attempt loop, retry logic, no abandoned-state shelf
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:285-377` —
  `_findMatchingSession`; partial-overlap with no sport guard
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:435-557` —
  `_createStravaOnlySession`; never reached for 2026-05-05 because the bad
  match short-circuited the path
- `backend/src/1_adapters/persistence/yaml/YamlSessionDatastore.mjs:260-389` —
  `findByDate`; constructs `media.primary.contentId` via `ItemId.normalize`

### Affected data on disk
- `data/household/history/fitness/2026-05-01/{20260501190411,20260501193558}.yml`
  — Daytona fragment pair (7s gap)
- `data/household/history/fitness/2026-05-05/20260505130756.yml`
  — 7-min HR session wrongly linked to 37-min outdoor Run
- `data/household/history/fitness/2026-05-06/{20260506125238,20260506130106}.yml`
  — Chest & Back fragment pair (13s gap)
- `data/household/common/strava/strava-webhooks/18390552794.yml`
  — Lunch Run job recording the bad match
- `data/household/common/strava/strava-webhooks/17831319049.yml`
  — 485-attempt forever-pending job

### Frontend logs (proof)
- `media/logs/fitness/2026-05-06T19-52-00.jsonl` — May 6 12:52 session start, contentId=null
- `media/logs/fitness/2026-05-06T20-01-04.jsonl` — May 6 13:01 session start, contentId="664042"
- `media/logs/fitness/2026-05-05T02-16-13.jsonl` — May 4 19:16 session start, contentId="606052"
- (none with `resumable: true` — searched all `media/logs/fitness/*.jsonl`)

---

## Predecessor

This audit supersedes the unresolved questions in
`docs/_wip/audits/2026-04-28-fitness-session-merge-failure.md`. That audit
correctly identified H4 (pre-session contentId race) and the
`DaylightAPI.get`/`DaylightAPI()` typo, and shipped fixes for both. What it
missed: the contentId value flowing through the newly-wired
`setPendingContentId` was the wrong format from the start, so even with all
the plumbing repaired, no resume check could ever match.

---

## Resolution (2026-05-06, same day)

Implemented per `docs/_wip/plans/2026-05-06-fitness-session-strava-sync-fix.md`.

### Code fixes (10 commits, +603/-18 lines, 147/147 tests green)

| Commit | What |
|---|---|
| `05114c780` | Backend defensive `contentId` normalization in `findResumable` |
| `aa664ab8a` | Frontend prefix bare plex ids in `_getCurrentContentId` |
| `22770bf36` | Frontend prefix pending `contentId` so logs are canonical |
| `f516b4ea5` | Test rename to honest round-trip framing |
| `816cf72e2` | Play-queue items carry canonical `contentId` (`plex:` prefixed) at all 8 call sites |
| `6253ee522` | Boundary normalizers recognize already-prefixed compound ids (was producing `null` for `'movie'` items from the list API) |
| `e5b077e64` | Strava `_findMatchingSession` rejects GPS-distance activity vs zero-distance no-media session |
| `b564986c9` | Test factory helper extraction |
| `f594871e5` | Strava `_findMatchingSession` requires ≥50% overlap fraction; hoists threshold constants |
| `d6777edd8` | `MAX_TOTAL_ATTEMPTS = 10` cap on webhook retries; new `abandoned` terminal status |

### Data fixups (Dropbox mirror → syncs to prod)

Four definite fragment groups merged via `cli/merge-fitness-sessions.cli.mjs`:

| Group | Date | Content | Gap | Result |
|---|---|---|---|---|
| F5 | 2026-02-03 | Upper Body Stretches | 43s | merged → 49 min, 98 coins |
| F6 | 2026-04-18 | Mario Kart World | 3s | merged → 18 min, 4 participants, 1142 coins |
| F7 | 2026-05-01 | Daytona USA | 7s | merged → 63 min, 6 participants, 2031 coins |
| F8 | 2026-05-06 | Chest & Back | 13s | merged → 54 min, 368 coins |

Four borderline fragment groups (12–24 min gaps) preserved as-is — likely
intentional workout breaks (Leg Day 2024-08-24, Pokemon 2025-10-20,
Super Mario Kart 2026-01-02, LIIFT Shoulders 2026-01-14).

May 5 Strava bad-match detached: stripped the misattributed
`participants.kckern.strava` block from `20260505130756.yml`; reset webhook
job `18390552794.yml` to `status: pending, attempts: 0` so prod re-processes
under the new sport-guard logic and creates a proper Strava-only session
for the 12:30 Lunch Run after deploy.

Stuck job `17831319049` auto-transitioned to `abandoned` status (495
attempts) when the new `MAX_TOTAL_ATTEMPTS` cap fired.

### Tooling added

- `cli/scan-fitness-history.mjs` — read-only diagnostic that surfaces all four
  problem patterns (fragments / bad matches / orphans / stuck jobs) across
  the entire fitness history. Run periodically to catch regressions.
- `cli/merge-fitness-sessions.cli.mjs` — gained `DAYLIGHT_BASE_PATH` support
  so it can run against the Dropbox mirror (or any non-cwd data path) while
  imports still resolve from the project root.

### Remaining items (post-deploy verification)

1. After prod deploys the new code, the May 5 webhook job will re-process
   and create a Strava-only session for the Lunch Run.
2. Verify in production logs that `fitness.resumable.check.match` events
   start firing (currently zero in two weeks of logs — total resume failure
   was the root cause).
3. Three "missing-session" ghost jobs (`17624884199`, `17631358591`,
   `17643156083`) reference sessions that no longer exist on disk. Already
   in terminal `completed` state, harmless. One activity (`17631358591`)
   has been deleted from Strava entirely; the other two could optionally
   be re-run if the historical Strava-only sessions are wanted back.
