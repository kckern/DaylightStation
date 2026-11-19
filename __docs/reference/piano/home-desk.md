# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **one card per child** with recent work.

## Cards

Each card shows the child's avatar, how long ago they last practiced, and one of two
things. A piece in progress (at least one step earned; the most recent such piece) always
wins. Otherwise the card shows the course. Pieces only opened or tried do not count:

- **Piece:** the sheet-music piece title on one line, a passage map in score order (a
  tomato, a flower, a silver coin or a gold coin; the next passage ringed; up to
  eight icons in one row, a longer piece in two equal rows, `mapColumns`), and the
  passage board's counters: a silver coin with `3/12` and, once
  there is some Gold, a gold coin with `1/12`. No sentence. Tapping opens that
  child's next passage in Learn.
- **Course:** the video course poster, title, a bar filled to the lessons done and
  the count as `7/113`. No sentence. Tapping opens the course.

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
It spans the row and its cards share the width (up to 18rem each), so four children
fit side by side at 1280px: the strip never scrolls and no card is cut off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card. An owed lesson replaces the strip and tiles with that lesson: one card that fills the body and is one button, showing the lesson's picture, its title and **Start**. It carries no description, course or unit line.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
