# Piano Menu Course-Activity Strip — Design

**Date:** 2026-07-28
**Feature:** The kiosk home screen anchors its tile grid flush-bottom and uses
the freed vertical space for a per-player course-activity strip — a credit
board for course progress, encouraging the courses.

## Layout

`.piano-home__body` becomes a column: the activity strip on top, the tile grid
anchored to the bottom with `--sp-4` padding above the live keyboard. The grid
is bottom-anchored even when the strip is empty.

## The strip (`PianoMenuActivity`)

One card per qualifying player — any roster player with course history, ordered
most-recently-active first, capped at the roster size, horizontally scrollable
on overflow. Each card:

- **Avatar in a completion ring + percent** — the same visual pattern as the
  course poster chips (one visual language for course progress across the
  kiosk). Ring/percent reflect the player's most-recent course.
- **Course title** of that most-recent course.
- **Relative timestamp** ("2h ago", "5d ago").
- Players idle beyond 7 days render dimmed/"resting" — identical rule and
  styling intent as the poster chips. History is never hidden by staleness.
- **Tap → deep-link** to that course's detail route. Opens under the current
  player; it does NOT switch the active player (mis-credit protection).

**Empty state:** no players with course history → the strip renders nothing.

**Future room (explicit non-goals now):** the card layout reserves a trailing
slot where trophy-case / completion-certificate badges can later sit; the data
to power them (per-lecture `completedAt`, 100% courses) already exists.

## Data

New endpoint `GET /api/v1/piano/activity/recent` → per roster user, the
most-recently-played course:

```json
{ "players": [{ "userId", "name", "courseId", "courseTitle", "thumbnail",
                "completed", "total", "percent", "lastPlayedAt" }] }
```

Backing use case `GetRecentCourseActivity`:

- Scope: courses in the configured **Music Lessons** collections only
  (`piano.yml videos.collections` groups whose label matches the lessons tab —
  concretely, the collections the Courses grid's first tab shows). Music
  Appreciation watching does not appear on the board.
- Reads each roster user's `UserVideoProgressStore` entries, maps lecture ids
  to their course via the playable service, picks the course with the newest
  `lastPlayed`, and summarizes completed/total/percent for that course.
- **Cache:** computed result held in-memory, keyed on the progress files'
  mtimes (+ short TTL fallback) — menu loads never trigger a Plex rescan when
  nothing changed.
- Name resolution: `display_name || username || id` (same as the roster
  endpoint — never `p.name`).

## Testing

- Use case: picks the newest course per user; lessons-only scope; skips users
  with no course history; cache hit on unchanged mtimes; recomputes on change.
- Frontend: ordering by recency; dimming past 7 idle days; tap navigates to
  the course route; empty state renders nothing; ring percent matches
  completed/total.
