# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **up to two cards per child**: the piece they are learning and
their video course.

## Cards

Every card has a poster on the left, then the child's avatar with how long ago they
last practiced, the title and the progress. A child gets a piece card when they have a
piece in progress (at least one step earned; the most recent such piece; pieces only
opened or tried do not count), and a course card when they have a course. A child's
cards sit next to each other, and children are ordered by their latest activity.

- **Piece:** the score's poster (the same-name picture beside the score, `cover`; none
  shows when the library has none), the printed title, a passage map in score order (a
  tomato, a flower, a silver coin or a gold coin; the next passage ringed; up to eight
  icons in one row, a longer piece in two equal rows, `mapColumns`), and the passage
  board's counters: a silver coin with `3/12` and, once there is some Gold, a gold coin
  with `1/12`. A tomato nobody has started sits back at 30% opacity; a started tomato
  and the one up next are full colour (`passageFaded`). Tapping opens that child's next
  passage in Learn.
- **Course:** the video course poster, title, and a ring filled to the share of lessons
  done, with the percent inside. No sentence. Tapping opens the course.

Tapping a card also makes that child the current player (owner-requested 2026-07-28).
Choosing a player otherwise stays in the "Who's playing" modal. A child with neither
a piece nor a course has no card.

## Data

`GET /api/v1/piano/activity/desk` returns each roster child's current piece, with its `cover` when the library has one. Each piece is
projected through `shared/music/learnCoach.mjs`, so the strip and Learn agree. Courses
come from `GET /api/v1/piano/activity/recent`. The desk list is rechecked every time the
home screen opens.

A passage link is `{basePath}/sheetmusic/view/{scoreId}?learnPassage={id}`; the
`learnPassage` parameter opens the score in Learn.

## Layout and locks

The strip keeps one fixed height whether or not it has cards, so the tiles never move.
It spans the row and its cards share the width (up to 13rem each), so six cards fit
side by side at 1280px: the strip never scrolls and no card is cut off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card. An owed video lesson replaces the tiles, but not the strip, with that lesson and a single Sheet Music tile beside it: sheet music is the one mode an owed lesson leaves open (owner, 2026-11-19), through that tile or a piece card on the strip. A PianoChallenge still takes the whole screen. The lesson is one card that is one button: the course poster on the left, then the lesson title over the lesson's still with a small play disc on it. There is no separate Start button, and no description, course or unit line.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
