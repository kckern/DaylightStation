# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **one card per child** with recent work.

## Cards

Each card shows the child's avatar, how long ago they last practiced, and the more
recent of two things:

- **Piece:** the sheet-music piece title, a passage map in score order (widths follow
  bar counts; not started, learning, Silver or Gold; the next passage outlined), and a
  count such as `3 of 12 Silver, 1 Gold`. Tapping opens that child's next passage in
  Learn.
- **Course:** the video course poster, title and `completed of total` lessons. Tapping
  opens the course.

Tapping a card also makes that child the current player (owner-requested 2026-07-28).
Choosing a player otherwise stays in the "Who's playing" modal. A child with neither
a piece nor a course has no card.

## Data

`GET /api/v1/piano/activity/desk` returns each roster child's current piece. Each piece is
projected through `shared/music/learnCoach.mjs`, so the strip and Learn agree. Courses
come from `GET /api/v1/piano/activity/recent`. The desk list is rechecked every time the
home screen opens.

A passage link is `{basePath}/sheetmusic/view/{scoreId}?learnPassage={id}`; the
`learnPassage` parameter opens the score in Learn.

## Layout and locks

The strip keeps one fixed height whether or not it has cards, so the tiles never move.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card. An owed lesson replaces the strip and tiles with that lesson.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
