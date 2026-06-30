# Piano Co-Progress Lock — Design Spec

**Date:** 2026-06-28
**Status:** Approved, pending implementation

---

## Problem

Two students (Milo and Felix) share a sequential piano course (Hoffman Academy) and are competitive about progress. Without a gate, one student can race ahead indefinitely, demotivating the other. The goal is to keep them within a configurable episode buffer of each other, enforcing turn-taking without hard-stopping either student.

---

## Config Structure

New key in `piano.yml` under `videos`, parallel to `sequential_labels`:

```yaml
videos:
  sequential_labels: [sequential]
  co_progress:
    - courseId: "plex:12345"   # matches compoundId from the playable endpoint
      users: [milo, felix]
      buffer: 5
```

- `courseId` — the `compoundId` of the Plex collection (e.g. `plex:12345`)
- `users` — array of user IDs whose progress must stay within `buffer` of each other
- `buffer` — max completed-episode gap before the ahead user is locked out of their next episode
- Multiple entries supported (different courses or different user pairs)
- **Only fires when the course is also `isSequential`** (Plex label matches `sequential_labels`). Co-progress on a non-sequential course is a no-op.

### Completion Definition

An episode counts as complete when it satisfies the same threshold used for sequential unlocking: watched ≥ `completion_threshold_percent` (default 90%) **and** `engaged === true` (user played along at least once). Episodes are atomic — in-progress does not count.

---

## Backend Changes

**File:** `backend/src/4_api/v1/routers/piano.mjs`
**Route:** `GET /api/v1/piano/courses/{courseId}/playable?userId={userId}`

After the existing `isSequential` computation:

1. Read `videos.co_progress` from piano config.
2. Find any rule where `courseId` matches AND the requesting `userId` is listed AND the course is sequential.
3. If a matching rule exists, load partner progress from `UserVideoProgressStore` for all other listed users.
4. Count completed episodes: `completedCount` = items where `userWatched: true` after enrichment.
5. Compute `aheadBy = myCount - min(partnerCounts)`. If `aheadBy >= buffer`, the user is locked.
6. Append to the response:

```json
{
  "items": [...],
  "isSequential": true,
  "coProgressLock": {
    "locked": true,
    "aheadBy": 6,
    "waitingForId": "felix",
    "buffer": 5
  }
}
```

`waitingForId` is the userId of the slowest partner (the one the requesting user is most ahead of). The frontend resolves it to a display name using the already-loaded user roster.

When not locked or no rule applies: `"coProgressLock": null`.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| `userId=guest` | Skip co-progress entirely — no lock |
| Partner hasn't started | Partner `completedCount = 0`; lock fires normally once ahead user exceeds `buffer` |
| More than two users | Compare against the *minimum* completed count among all partners |
| Non-sequential course | Co-progress rule skipped regardless of config match |

---

## Frontend Changes

**File:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx`

`CourseDetail` already computes `lockedIds` (episodes after the first unwatched). Co-progress adds a second gate:

- If `coProgressLock.locked === true`, find the first episode not already `userWatched` and add it to `lockedIds` with a `coProgress` reason tag.
- Episodes already sequentially locked stay locked for their own reason — co-progress only ever affects the single "next available" episode.
- Co-progress-locked episodes render a **two-person icon** instead of the standard padlock, so the student can visually distinguish "haven't watched previous" from "waiting for partner."
- Tapping a co-progress-locked episode fires a **toast**: `"You're [N] episodes ahead of [name] — let them catch up first."` where `[name]` is resolved from `waitingForId` via the user roster. No modal, no blocking dialog.
- When `coProgressLock` is `null` or `locked: false`, behavior is identical to today.

No changes to `PianoVideoPlayer` or the engagement gate — the lock is purely a navigation gate on the episode list.

---

## Engagement Gate Transport Lock

**Problem:** While the "Still there?" engagement gate overlay is open, the transport controls in `PianoVideoChrome` remain active. The student can press play to resume the video without completing the play-along challenge.

**Fix:**

- `PianoVideoPlayer` already has `gateOpen` in scope — pass it to `PianoVideoChrome` as a prop.
- `PianoVideoChrome` disables ALL transport controls when `gateOpen === true`:
  - Play/pause toggle
  - Restart
  - Skip ±15s
  - Rate cycle
  - A/B loop mark buttons
  - Seek bar (non-interactive)
- This is a purely presentational change — no new state, no new API calls.

---

## Files Touched

| File | Change |
|------|--------|
| `piano.yml` (data volume) | Add `videos.co_progress` array |
| `backend/src/4_api/v1/routers/piano.mjs` | Compute and append `coProgressLock` to playable response |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/CourseDetail.jsx` | Read `coProgressLock`, add to `lockedIds`, render two-person icon + toast |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` | Pass `gateOpen` to `PianoVideoChrome` |
| `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx` | Disable all transport controls when `gateOpen` prop is true |

---

## Out of Scope

- Co-progress for non-sequential courses
- Notifications pushed to the partner's device ("Felix is waiting for you")
- Admin UI for managing co-progress rules
- More than two users per rule (supported by design but not the initial use case)
