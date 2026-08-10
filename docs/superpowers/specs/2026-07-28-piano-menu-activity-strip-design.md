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

**Loading state:** the strip reserves its own silhouette instead of collapsing
— an unreserved strip pushed the tile grid down when the fetch landed. The
kiosk remembers the shape of the last strip it drew (the course count of each
card, in order) in `localStorage`, so the skeleton is available on the first
paint and is the exact geometry the data will fill. A device that has never
shown the strip reserves a modest default; a device whose last visit was empty
reserves nothing. Poster boxes carry a min-width equal to a standard poster at
the frame height, so an undecoded image never collapses its box either.

Strip data goes through the shared stale-while-revalidate list cache, so a warm
kiosk paints the previous strip immediately and repaints only when the server
disagrees.

**Future room (explicit non-goals now):** the card layout reserves a trailing
slot where trophy-case / completion-certificate badges can later sit; the data
to power them (per-lecture `completedAt`, 100% courses) already exists.

## Card content selection (added 2026-07-28, second iteration)

Each card shows up to **2 course poster thumbnails** with the percent under
each (replacing the single-course text line). The percent (and the tooltip's
completed/total) is **module-scoped**: progress through the unit containing
the player's most recently played lecture — not the whole program, which
reads as discouraging on multi-hundred-lecture courses. Course-level
completion (`courseCompleted`) still governs the incomplete-course filter.
Which items fill a card is **config-driven** via `piano.yml`:

```yaml
menu_activity:
  slots: [top-incomplete-courses]   # default
```

Slot types (applied in order until the card is full, deduped):

- `top-incomplete-courses` (default): the player's courses ranked by highest
  percent, **excluding 100%-complete ones** — surfaces the course they're
  closest to finishing (completion motivation).
- `recent-courses`: newest activity first, completed included.
- `recent-sheet-music`, `top-polish`: recognized **placeholders** for future
  non-course sources (sheet-music history, polish scores); contribute nothing
  until implemented.

A player whose slots yield nothing (e.g. everything at 100%) falls back to
their recent courses — the card never vanishes for someone with history.
Player-level recency/staleness still keys off their newest activity overall.

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
  completed/total; the loading skeleton reserves the remembered shape (and
  nothing when the last visit was empty) and the rendered shape is recorded.
