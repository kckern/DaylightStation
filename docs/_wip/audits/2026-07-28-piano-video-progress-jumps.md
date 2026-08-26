# Audit: Piano Videos Progress "Jumps" — Two Systems, One Cache, No Data Loss

**Date:** 2026-07-28
**Symptom:** On `/piano/videos`, progress indicators visibly jump from one value to
another. Suspicion: two competing progress systems, one cached, possible data loss.
**Verdict:** Yes — two progress systems by design plus one stale-while-revalidate
cache produce three distinct visible "jumps." **No data loss** — every per-user
progress file is intact and current.

---

## The two systems

| | System A: device-level | System B: per-user |
|---|---|---|
| Store | Plex/media-memory signals (`watchProgress`, `playCount`) via `GET /api/v1/fitness/show/:id/playable` | `data/users/{id}/apps/piano/video-progress.yml` via `GET /api/v1/piano/courses/:id/playable?userId=` (`UserVideoProgressStore`) |
| Scope | One value per lecture for the whole household/device | Per player: playhead, percent, engaged, completedAt |
| Written by | Plex watch state / legacy media memory | `POST /api/v1/play/log` with `userId` (every 10s while playing) |
| UI selector | `lectureStatus(item)` — fallback | `lectureUserStatus(item)` — preferred when `userPercent`/`userWatched` present (`lectureMeta.js:49-56`) |

**Which one renders depends on which endpoint served the playable list**, and that
depends on `currentUser` at fetch time (`usePianoCoursePlayable.js:23`): a real
roster id → System B; `null` (roster still loading) or `guest` → System A.

**Key measurement (Hoffman Academy, 344 lectures):** System A is *empty* — 0
`playCount` / 0 `watchProgress` on all 344 items — while System B holds 64
completions across three kids. So any frame rendered from System A shows **zero
progress**, and the flip to System B makes every checkmark "pop in."

## The three jumps

1. **Identity-resolve flip (detail + player screens).** On a cold tab,
   `currentUser` is `null` until the roster fetch lands. The playable hook fires
   immediately with the device endpoint, then refires with the per-user endpoint
   when the user restores: spinner → zero-progress list → spinner → real
   per-user list (`usePianoCoursePlayable` sets `loading: true` on each refetch;
   `CourseDetail.jsx:315/328` swaps render on it). The window is normally
   sub-second but stretches after deploys (roster retry backoff) — which is
   exactly when kiosks reload.
2. **Poster-wall cache (grid screen).** The roster chips come from
   `GET /api/v1/piano/courses/progress?ids=…` through `usePianoList` — an
   in-memory + **IndexedDB** stale-while-revalidate cache (5-min TTL,
   `pianoListCache.js`). A reload paints the *previous session's* chips
   instantly, then revalidates and repaints. (The course list itself is cached
   the same way.)
3. **Recency filter ≠ data loss (grid vs detail disagreement).** The poster
   endpoint applies `progress_overlay` rules from `piano.yml`
   (`recency_days: 7`, `min_completed: 1`). Today Hoffman's poster shows ONLY
   learner1 (3/344) — learner2's 32 and learner3's 29 completions are hidden because
   their last activity (7/16) is 12 days old. Opening the course then shows the
   full checkmark history. The chips silently "losing" a student's progress
   after a quiet week is the strongest "data loss" illusion in the flow.

## Data integrity check (files on disk, 2026-07-28)

Per-user stores are healthy — six files, parseable, recent writes (latest
2026-07-25). Full inventory in the tables below. One anomaly: **learner4 and kckern
both hold 37% on the same Hoffman lecture from the same day (7/10)** — the
signature of a mid-video player switch (`usePianoWatchLog` re-subscribes on
`userId` change: the close post credits the old user, subsequent ticks the new
one). The Who's-Playing auto-close fixes (audit F7/F8, shipped 7/27) close the
main path that caused surprise mid-video identity flips.

## Progress inventory — Music Lessons tab

Courses (collections `plex:675686`, `plex:676074`): How to Play Piano (36),
Music Theory (18), AM Vocal Studios (47), The Classical Piano Collection (57),
Hoffman Academy (344), Piano University (173), Piano With Jonny (2434), The
Better Piano System (~316).

| Student | Course | Completed | Touched | Last active |
|---|---|---|---|---|
| learner2 | AM Vocal Studios | **47/47** ✔ course complete | 47 | 2026-07-17 |
| learner2 | Hoffman Academy | 32 | 32 | 2026-07-16 |
| learner2 | Classical Piano Collection | 13 | 13 | 2026-07-23 |
| learner3 | Hoffman Academy | 29 | 29 | 2026-07-16 |
| learner3 | Classical Piano Collection | 5 | 5 | 2026-07-21 |
| learner3 | Piano With Jonny | 1 | 3 | 2026-07-10 |
| learner3 | AM Vocal Studios | 1 | 2 | 2026-07-14 |
| learner1 | Hoffman Academy | 3 | 4 (one at 5%) | 2026-07-22 |
| learner1 | How to Play Piano | 0 | 3 | 2026-07-11 |
| kckern | Piano University | 1 | 1 | 2026-07-25 |
| kckern | How to Play Piano | 1 | 1 | 2026-07-11 |
| kckern | Better Piano System | 1 | 2 | 2026-07-03 |
| learner4 | Hoffman (First Piano Lesson, 37%) | 0 | 1 | 2026-07-10 |
| parent-two | Music Theory + AM Vocal (samples) | 0 | 2 | 2026-07-13 |

(Entries not matching any lesson course — 9–24 per adult/kid — are Music
Appreciation tab lectures and other video content logged through the same store.)

**Hoffman co-progress (learner3↔learner2, buffer 3):** learner2 32 vs learner3 29 — aheadBy
exactly the buffer; learner2's `coProgressLock` is currently null (lock engages
beyond the buffer), so learner2 has one lecture of headroom before waiting on learner3.

## Implemented 2026-07-28 (recommendations 3 + chip redesign)

- `progress_overlay.recency_days` 7 → **90** (piano.yml, data volume).
- Chips idle >7 days now **dim** ("resting", grayscale + reduced opacity)
  instead of vanishing; tooltip carries the full count + resting marker.
- Chip shows an avatar **completion ring + percent** (the repetitive `n/NNN`
  denominator moved to the tooltip).
- Found & fixed en route: `ConfigService.reloadHouseholdAppConfig` never wrote
  the fresh config back into the served snapshot, so `POST /system/reload` was
  a no-op for every `getHouseholdAppConfig` consumer; `GetCourseProgress`
  labeled chips `undefined` (`p.name` vs `display_name`/`username`).

## Recommendations (not yet implemented)

1. **Don't render System A for a resolving identity.** In `CourseDetail`/grid,
   treat "roster not yet resolved" as loading (skeleton) instead of painting
   device-level (usually zero) status that the per-user refetch immediately
   contradicts. Guests keep the device view (intended, F5).
2. **Key the poster-chip cache by data, not just path — or skip IDB for
   progress.** Course *lists* barely change (cache is right); progress changes
   every session. Cheapest fix: bypass the IDB layer for the `courses/progress`
   path (memory-only), so chips never render from a previous session.
3. **Soften the recency cliff.** Either raise `recency_days` (e.g. 30), or keep
   chips but dim them when stale — hiding a kid's 32-lesson streak after a
   quiet week reads as data loss.
4. Optional: capture the watch-log owner at playback start (mirrors the Studio
   record-start recommendation) so a mid-video identity change can't split
   credit across two users.
