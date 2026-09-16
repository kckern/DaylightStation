# A lesson shorter than the reporting floor can never be completed

**Found:** 2026-09-15 — a learner assigned "Singing lesson" (`piano-course`, `plex:694718`).
**Symptom:** the child played their music lesson several times and it never marked done; the
piano kiosk stayed gated (`piano.lesson-gate.change {gated:true, reason:"owed"}`)
and their School `arts` section stayed `obligated` all day.

## What actually happened

The assigned course's last episode, `plex:694748`, is titled **"Coming Soon!"** and
runs **9.45 seconds** — a placeholder at the end of the Singing season, not a lesson.

The learner had completed all 29 real lessons (`694719`–`694747`). `GetPlayableUnits`
picks the next lesson as `credit.find((item) => !item.userWatched)`, so the
placeholder was the next unwatched creditable item, and the kiosk handed it to them
every single time.

They could never finish it, because **three independent guards rejected it**, each
an absolute 10-second floor:

| Layer | Guard | Effect on a 9.45s item |
|---|---|---|
| `4_api/v1/routers/play.mjs` | `if (seconds < 10) → 400` | every progress post rejected |
| `Piano/.../usePianoWatchLog.js` | `if (!(currentTime >= 10)) return` | never posted at all — and this is the only path carrying `userId`/`engaged` |
| `Player/hooks/useCommonMediaController.js` | `if (pos < 10) return` | position never saved on unmount |

Their `video-progress.yml` therefore had **no entry for `plex:694748` at all**, so
`userWatched` stayed false, `doneToday` stayed false, and the day stayed owed.

### The second half: engagement could never be demonstrated

Completion is `percent >= completion_threshold_percent (90) && engaged`, and
`engaged` means *played along*. The anti-AFK gate that demands a play-along
(`useEngagementGate`) only opens after **90 seconds idle** — it can never fire
inside a 9.45s lecture. So even once the post got through, `engaged:false` would
have recorded the *absence of a question* as a refusal, leaving the lesson
uncompletable for a second, independent reason.

## The rule now

The floor's real subject is "was this a scrub-through?", which `percent` already
answers at any length. All three guards keep the 10s floor **and** admit a
near-complete watch (>= 90%, matching `completion_threshold_percent`):

- `play.mjs` — `if (seconds < 10 && !(Number(percent) >= 90))`
- `usePianoWatchLog.js` — `currentTime >= 10 || currentTime >= duration * 0.9`
- `useCommonMediaController.js` — `if (pos < 10 && parseFloat(pct) < 90) return`

And a lecture too short for the gate to ever ask counts as engaged
(`duration > 0 && duration < 10`), the same reading Singalong already takes for a
karaoke song.

Browsing is still filtered: three seconds into a 523s lecture is 1% and is still
refused, which each layer has a test for.

## Tests

- `backend/src/4_api/v1/routers/play.shortMedia.test.mjs`
- `frontend/src/modules/Piano/PianoKiosk/modes/Videos/usePianoWatchLog.shortMedia.test.jsx`
- `frontend/src/modules/Player/hooks/useCommonMediaController.shortMedia.test.jsx`

Repaired while here: `piano.economyHook.test.mjs` had been failing 4/4 with 500s
(it built `RecordPlaybackProgress` with a bare `registry` instead of a
`contentCatalog` gateway), so the economy earn-hook on lesson completion — the
path this change feeds — had no live coverage at all.

## Still true after the fix

"Coming Soon!" remains a placeholder being handed to a child as assigned
coursework. It is now completable, so it credits once and the course then reads
complete — but a zero-content episode is arguably not creditable work. Note that
`videos.reference_units` **cannot** express this: `GetPlayableUnits` matches those
rules against the **parent/season** title, so a rule aimed at this episode would
exclude the entire Singing season.
