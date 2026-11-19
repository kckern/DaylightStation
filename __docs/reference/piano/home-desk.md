# Piano home desk

The kiosk home screen is a compact launcher row above the **desk**: the active
player's current piece, resting directly above the live keyboard.

## What it shows

- The title and composer printed in the score, with the next passage in real notation.
- The next step and one primary action: **Continue**, **Start** or, when the whole
  piece is Silver, **Go for Gold**.
- A count such as `3 of 12 passages Silver, 1 Gold`.
- A passage map in score order. Widths follow bar counts. A passage is not started,
  learning (with one mark per Silver step), Silver or Gold. Tapping one opens it in Learn.
  The sheet-music player's [passage rail](./sheet-music-player.md#passage-rail-and-board)
  draws the same states from the same rule (`passageProgress` in `shared/music/learnCoach.mjs`).
- The household's avatars. This is the one place on the desk that changes the player.
- The player's video course, with real `completed of total` lesson counts.

A player with no planned piece gets blank manuscript paper and **Find a piece**.

## Data

`GET /api/v1/piano/activity/desk` returns one entry per roster player with `piece` or
`null`. `GetPianoDesk` scans that player's practice records, picks the most recent one
with a known score and passage plan, and projects it through
`shared/music/learnCoach.mjs`, so the desk and Learn share one set of rules. Passage ids
come from `learnCoach.summary`, else `learn.segments`. Courses still come from
`GET /api/v1/piano/activity/recent`, which can be slower, so they fill their own slot later.

A passage link is `{basePath}/sheetmusic/view/{scoreId}?learnPassage={id}`. The
`learnPassage` parameter opens the score in Learn.

## Layout rules

Every region has a fixed size, so loading data, notation, the lesson-check caption or the
connection banner never moves the screen. Curfew and lesson-check captions float over the
page. On the home screen the connection banner floats over the keyboard. Notation is
loaded in its own bundle so the launcher paints first.

Curfew and a pending lesson check disable every door on the desk. An owed lesson replaces
the launcher and desk with that lesson.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`,
`piano.desk.switch-player`, `piano.desk.score-failed`, server `piano.desk.record_skipped`.
