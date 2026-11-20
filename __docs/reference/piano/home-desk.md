# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **up to two cards per child**: the piece they are learning and
their video course.

## Cards

The strip is for the child choosing what to play: each card says what is next and
resumes it in one tap. Each child is headed once, by their avatar (32px) and name, with
their cards under it (`stripGroups`); children are ordered by their latest activity. A
child gets a piece card when they have a piece in progress (at least one step earned;
the most recent such piece; pieces only opened or tried do not count), and a course card
when they have a course.

Both kinds share one layout (193x150): a 60x90 poster on the left with a small play
disc in its corner; beside it a badge, the title (up to three lines) and the next step;
the progress in a row along the bottom. The poster is the picture in its own shape,
never cropped into a band. With no picture, or one that fails to load, a tinted
stand-in shows a ♪ and the title.

- **Piece:** the score's `cover` (the same-name picture beside the score), the printed
  title, and the next passage's bars (`Bars 6–9`). The badge is **Silver next** while
  any passage lacks Silver, **Gold next** once every passage has it, **All Gold** when
  done (`cardBadge`). The progress row is the passage map in score order (a tomato, a
  flower, a silver coin or a gold coin; the next passage ringed), one row of coins up
  to 20px sized to fill the card; a piece with more than 14 passages takes two equal
  rows (`mapColumns`, `mapRows`, `coinSize`). A tomato nobody has started sits back at
  30% opacity; a started tomato and the one up next are full colour (`passageFaded`).
  No count: the coins show it. Tapping opens that child's next passage in Learn.
- **Course:** the child's enrolled course leads (School's `piano-course` assignment: the
  first unfinished course in its sequence, marked `enrolled`); otherwise the unfinished
  course furthest along. The poster is the course art. The title is the next lesson's,
  without a leading "Lesson 51 |" or "Lesson 12:" (`lessonTitle`); the next step is
  "Lesson 51": the number printed in that prefix, else the lesson's `position`, else
  lessons done plus one (`nextStep`). The badge is **Next lesson**; the progress row is
  a thin bar with the percent of lessons done. Tapping plays that lesson.

Tapping a card also makes that child the current player (owner-requested 2026-07-28).
Choosing a player otherwise stays in the "Who's playing" modal. A child with neither
a piece nor a course has no card.

## Data

`GET /api/v1/piano/activity/desk` returns each roster child's current piece, with its `cover` when the library has one. Each piece is
projected through `shared/music/learnCoach.mjs`, so the strip and Learn agree. Courses
come from `GET /api/v1/piano/activity/recent`; each course's `next` is its first
unwatched lesson (`id`, `title`, `thumbnail`, and `position`, its 1-based place among
the graded lessons, reference units left out). The desk list is rechecked every time the
home screen opens.

A passage link is `{basePath}/sheetmusic/view/{scoreId}?learnPassage={id}`; the
`learnPassage` parameter opens the score in Learn.

## Layout and locks

The strip keeps one fixed height whether or not it has cards, so the tiles never move.
Nothing on the home screen changes height after load: the strip sits 16px under the
header in every state and draws only once both its lists have arrived; the tile wall (or
the owed lesson) is centred in the rest; the pending and curfew captions float; and the
connection banner floats at the foot of the screen, over the on-screen keyboard.
It is 208px tall: the 32px header, a 6px gap and a card. When any piece on the strip
needs two coin rows, every card grows to 170px together (`data-tall`) so the row stays
even. Three children with two cards each fit the 1216px row; a crowded row
shrinks its cards rather than scrolling or cutting one off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card. An owed video lesson replaces the tiles, but not the strip, with that lesson and a 224px column beside it: the child's latest piece (`LatestPieceCard`: poster, play disc, Silver count, title; one tap opens it at its next passage) over the Sheet Music tile (browse every score): sheet music is the one mode an owed lesson leaves open (owner, 2026-11-19), through that tile or a piece card on the strip. A PianoChallenge still takes the whole screen. The lesson is one card that is one button: the course poster on the left, then the lesson title over the lesson's still, which fills its area (cropping slightly rather than leaving a band), with a small play disc on it. There is no separate Start button, and no description, course or unit line.

Logs: `piano.desk.view`, `piano.desk.open-passage`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
