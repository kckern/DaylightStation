# Piano Kiosk — Balanced Picker + Sequential Progress Overlay

Date: 2026-06-30
Status: Approved, implementing

## Goal

Two kiosk improvements to `/piano/videos` and the "Who's playing?" picker:

1. **Balanced player rows** in the picker (6→3+3, 8→4+4, 7→centered 4+3), max 9 per
   page, paginate beyond that.
2. **Sequential course indicator + per-user progress overlay** on course posters, so
   the wall shows who is where in each sequential course.

## Part A — "Who's playing?" balanced rows + pagination

- File: `frontend/src/modules/Piano/PianoKiosk/WhoIsPlayingPrompt.jsx`, styles in
  `frontend/src/Apps/PianoApp.scss` (`.piano-userpicker__grid`).
- Balancing is CSS-driven via a `data-count` attribute on the grid: a centered
  `flex-wrap` whose `max-width` caps the row at `ceil(n/2)` columns for counts 5–9,
  so 6 wraps 3+3, 8 wraps 4+4, 7 wraps 4+3 (centered orphan). ≤4 stays one row.
- Pagination: when `users.length > 9`, chunk into pages of 9, render page dots,
  switch via tap/arrow keys. A shared `chunk + balance` helper backs both.
- Dismiss/timeout behavior unchanged.

## Part B — Sequential badge + progress overlay (frontend)

- Files: `CourseTile.jsx`, `CourseGrid.jsx` under `modes/Videos/`, styles in
  `PianoApp.scss`.
- `CourseTile` gains optional `progress` prop: `{ isSequential, total, users:[...] }`.
  - **Sequential badge:** top-left corner chip (ladder/steps glyph) when
    `isSequential`, always shown for sequential courses regardless of progress.
  - **Progress overlay:** when ≥1 qualifying user, a bottom gradient scrim over the
    lower ~20% of the cover holds up to `max_avatars` `PianoAvatar` chips, each with
    `completed/total`, sorted most-progressed first. Absolutely positioned inside the
    existing poster box — no height/layout change.
- Guest/anonymous: badges shown, no chips.

## Part C — Backend aggregate + config

- New endpoint: `GET /api/v1/piano/courses/progress` (optional `?collection=`).
  Returns `{ [courseId]: { isSequential, total, users: [{ id, name, completed,
  total, lastPlayedAt }] } }` for every course in `videos.collections`.
- Resolves each course's lecture list via `fitnessPlayableService.getPlayableEpisodes`,
  counts each roster user's `completedAt` entries in their `video-progress.yml`, and
  applies new config:

```yaml
videos:
  progress_overlay:
    recency_days: 7      # only users active within N days
    min_completed: 1     # min completed lectures to qualify
    max_avatars: 4       # cap chips per poster
```

- `isSequential` reuses existing `videos.sequential_labels` matching.
- `CourseGrid` fetches once and passes each course's slice to its `CourseTile`.

## Defaults taken

- Sequential badge: ladder/steps icon, top-left.
- Overlay chips sorted most-progressed first.
- `min_completed` counts completed lectures (not opened), excluding casual browsers.
- Reference units (config `videos.reference_units`) excluded from `total`/`completed`.
