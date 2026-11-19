# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **up to two cards per child**: the piece they are learning and
their video course.

## Cards

Each child is headed once, by their avatar (36px) and name; their cards sit under it
(`stripGroups`). Every card (193x152) has a small 2:3 poster (56x84) beside its title,
and its progress in a band underneath. A child gets a piece card when they have a piece
in progress (at least one step earned; the most recent such piece; pieces only opened or
tried do not count), and a course card when they have a course. Children are ordered by
their latest activity.

- **Piece:** the score's poster (the same-name picture beside the score, `cover`; none
  shows when the library has none), the printed title, a passage map in score order (a
  tomato, a flower, a silver coin or a gold coin; the next passage ringed; up to eight
  icons in one row, a longer piece in two equal rows, `mapColumns`), and the passage
  board's counters: a silver coin with `3/12` and, once there is some Gold, a gold coin
  with `1/12`. A tomato nobody has started sits back at 30% opacity; a started tomato
  and the one up next are full colour (`passageFaded`). Tapping opens that child's next
  passage in Learn.
- **Course:** the video course poster, title, and a 44px ring filled to the share of
  lessons done, with the percent inside. No sentence. Tapping opens the course.

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
It is 194px tall. Three children with two cards each fit the 1216px row; a crowded row
shrinks its cards rather than scrolling or cutting one off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card. An owed video lesson replaces the tiles, but not the strip, with that lesson and a 224px column beside it: the child's latest piece (`LatestPieceCard`: poster, play disc, Silver count, title; one tap opens it at its next passage) over the Sheet Music tile (browse every score): sheet music is the one mode an owed lesson leaves open (owner, 2026-11-19), through that tile or a piece card on the strip. A PianoChallenge still takes the whole screen. The lesson is one card that is one button: the course poster on the left, then the lesson title over the lesson's still, which fills its area (cropping slightly rather than leaving a band), with a small play disc on it. There is no separate Start button, and no description, course or unit line.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
