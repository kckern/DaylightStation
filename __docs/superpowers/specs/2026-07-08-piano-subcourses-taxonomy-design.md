# Piano Kiosk — "Subcourses" multi-course show taxonomy

**Date:** 2026-07-08
**Area:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/`
**Status:** Design approved — ready for implementation plan

---

## Problem

The piano kiosk Videos mode has exactly two shapes of "course", both ending on a single
lecture-list landing page:

- A **single-season course** (`type: 'season'`) → one flat lecture list.
- A **multi-unit show** (`type: 'show'`, e.g. Hoffman Academy) → several units that are
  *levels of one progressive curriculum*; `CourseDetail` treats each Plex season as a **unit**
  and gates them linearly (finish Unit 1 → Unit 2 unlocks).

Some Plex shows don't fit either shape. **"Piano With Jonny" (`plex:676490`)** is a `show`
whose seasons are **containers of multiple independent courses**, not levels of one curriculum:

| Season | Episodes | Reality |
|--------|----------|---------|
| Specials (`676540`) | 3 | one course (Practice Essentials) |
| Season 1 (`676507`) | 32 | ~7 distinct courses |
| Season 2 (`676491`) | 47 | ~8 distinct courses |
| Season 3 (`676576`) | 91 | 9 courses, **untitled** (`Episode 101`…) |

Today `GetPlayableUnits` flattens all 82+ episodes of such a show onto one page with the
seasons as "units". That dumps dozens of unrelated lessons in one scroll and would mis-gate
courses as if they were one linear sequence. There is no way to surface each real course as a
first-class, browsable, individually-gated unit.

## The structure inside a subcourses show

Episodes encode a two-level structure via their Plex episode number (`itemIndex`), the
"hotel-floors" model:

```
itemIndex = CNN   →   floor (C) = COURSE within the season
                      room  (NN) = LESSON within the course
```

Example (Season 1, `676507`):

```
[101] Pop Soloing with Chord Tone Targets – Pop Chords          course 1, lesson 1
[102] Pop Soloing with Chord Tone Targets – Chord Tone Targets  course 1, lesson 2
[201] Pop Soloing With 3rds and 6ths – Pop Chords               course 2, lesson 1
[202] Pop Soloing With 3rds and 6ths – What are 6ths and 3rds?  course 2, lesson 2
[301] Pop Soloing with Slip Notes – Pop chords                  course 3, lesson 1
```

The **title prefix** (text before the ` – `, U+2013 en dash) names the course; the suffix is
the lesson name. The prefix is used **only for the label** — the numbering is the reliable
partition. Season 3 proves why: it has no prefixes (`Episode 101`, `Episode 201`…) yet its
`CNN` numbering is intact, so grouping-by-prefix alone would blob it into one course while
grouping-by-floor still produces 9 correct courses.

## Detection

A show is a subcourses show iff its Plex **`subcourses` label** is present. Read from
`info.labels` (lower-cased), the exact field `sequential_labels` already uses. This is opt-in
per show: tagging any show `subcourses` in Plex invokes the alternative UX. No `piano.yml`
config list is required.

Confirmed: `/api/v1/piano/courses/676490/playable` returns `info.labels: ['subcourses']`, so
the frontend detects it from the single `/playable` call it already makes.

## Taxonomy & UX

```
Piano With Jonny            Program   (grid tile — a subcourses show)
├─ Specials                 Season    → collapses (1 course) → straight to its lessons
├─ Season 1                 Season    → course list
│  ├─ Pop Soloing w/ Chord Tone Targets   Course (floor 1)
│  │  ├─ Pop Chords                        Lesson (101)
│  │  └─ Chord Tone Targets                Lesson (102)
│  └─ Pop Soloing With 3rds and 6ths      Course (floor 2)
├─ Season 2                 Season    → course list
└─ Season 3                 Season    → "Course 1".."Course 9" (untitled)
```

Navigation (a **4-level drill**, deeper than today's 3):

1. **Grid** — the Program appears as a normal tile (unchanged).
2. **Season submenu** — tapping a subcourses Program shows its seasons (instead of a flat
   lesson list). A season with exactly **one** course is collapsed: tapping it goes straight
   to that course's lessons (no dead middle click).
3. **Course list** — tapping a multi-course season shows its courses.
4. **Lessons** — tapping a course shows its lessons; tapping a lesson plays it.

Breadcrumbs (`usePianoBreadcrumb`) reflect the path: Program › Season › Course.

**Non-subcourses shows are completely unaffected** — they keep today's flat/multi-unit
`CourseDetail` behavior.

## Sequential gating & progress

- The **course (floor)** is the sequential unit. Within a course, lessons lock until the
  previous lesson is watched — the same linear-gate logic `CourseDetail` uses today, scoped to
  a floor. Seasons and courses themselves are freely browsable (no cross-course/cross-season
  gate).
- **Progress overlays are derived client-side** from the per-user `userWatched`/`userPercent`
  fields already enriched onto every item in `/playable`. Season tile → lessons-watched / total
  in season; course tile → watched / total in floor. No new backend endpoint.

## Architecture — Approach A (frontend-derived, no backend change)

All inputs the grouping needs are already in the flat `/playable` response: `parentId`
(season), `itemIndex` (CNN), `title`, and per-user watched fields. So the whole feature is a
frontend addition.

### Pure helpers (unit-tested, no React)

New module, e.g. `subcourses.js`:

- `isSubcourseShow(info)` → `boolean` — `(info.labels ?? []).map(l => l.toLowerCase()).includes('subcourses')`.
- `floorOf(item)` → `number|null` — `Math.floor(itemIndex / 100)` (null when `itemIndex` < 100 or missing).
- `partitionSeasons(items, parents)` → ordered seasons, each with its episode subset (reuses
  the existing `parents` map + `parentId`, sorted by season `index`).
- `partitionCourses(seasonItems)` → ordered courses `[{ floor, label, lessons }]`:
  - group `seasonItems` by `floorOf`;
  - `label` = shared title prefix of the group (text before the first ` – `; robustly, the
    longest common prefix trimmed of trailing separators/space); fallback `` `Course ${floor}` ``
    when no meaningful common prefix exists (e.g. Season 3);
  - `lessons` sorted by `itemIndex % 100`.
- Progress derivers: `seasonProgress(seasonItems)`, `courseProgress(lessons)` → `{ watched, total }`
  from the per-user watched flags.

### Views & routing

The Videos router currently declares `index`, `:courseId`, `:courseId/:lectureId`. The branch
between flat vs subcourses can't be known at route-declaration time (it depends on the fetched
label), so centralize the fetch:

- Introduce a **show shell** owning a single `usePianoCoursePlayable` call and a nested router.
  - If `!isSubcourseShow(info)` → render today's `CourseDetail` + existing player route
    (behavior identical to now).
  - If subcourses → render the new **SubcourseNavigator** with nested routes:
    - season submenu (default),
    - `:seasonId` → course list (collapse single-course seasons to their lessons),
    - `:seasonId/:floor` → lesson list,
    - lesson player addressed under the course path, reusing `PianoVideoPlayer` and
      `lectureContentId` for the URL segment so warm and cold deep-links both resolve.
  - The shell fetches once; every level reads from the same in-memory items (no refetch per
    drill level).

Exact route strings and the shell's shape are for the implementation plan; the constraint is:
one `/playable` fetch per show, non-subcourses path byte-for-byte unchanged, lesson deep-links
resolve cold.

### Components (indicative)

- `SubcourseNavigator.jsx` — nested router + level wiring; consumes the shared playable data.
- `SeasonMenu.jsx` — season tiles with derived progress; collapse rule.
- `CourseList.jsx` — course (floor) tiles with derived progress.
- `CourseLessons.jsx` — lesson list with per-course sequential gating (reuse existing lock/
  current/`renderEpisode` logic, scoped to one floor).

Reuse existing tile/lesson presentation (`CourseTile`, `piano-episode` markup) where possible.

## Out of scope (YAGNI)

- No backend nesting endpoint (Approach C) — revisit only if server-driven per-course progress
  overlays on the main grid become a requirement.
- No cross-course or cross-season sequential gating.
- No `piano.yml` config for subcourses (the Plex label is the sole switch).
- No changes to non-subcourses course behavior.
- No renaming of existing `Course*` files/routes; "Program/Season/Course/Lesson" are UX terms.

## Testing

- Unit-test the pure helpers against real fixtures captured from `/playable` for `676490`
  (all four seasons, including untitled Season 3 and single-course Specials): floor grouping,
  label derivation + fallback, lesson ordering, collapse rule, progress derivation.
- Component tests: subcourses show renders season submenu (not flat list); single-course season
  collapses; a non-subcourses show still renders the flat `CourseDetail` unchanged; within-course
  gating locks lesson 2 until lesson 1 is watched.

## Reference data (captured 2026-07-08)

- `676490` "Piano With Jonny" — `info.type: show`, `info.labels: ['subcourses']`,
  collections `['Piano Courses']`.
- Seasons via `parents`: `676540` Specials (idx 0), `676507` Season 1 (idx 1),
  `676491` Season 2 (idx 2), `676576` Season 3 (idx 3).
- `/api/v1/piano/courses/676490/playable?userId=<id>` returns flat `items` with top-level
  `parentId`, `itemIndex`, `title`, and per-user `userWatched`/`userPercent`.
