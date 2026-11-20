# Piano home progress strip

The kiosk home screen keeps its two-row tile menu. Above it, in the space the old
activity strip used, a progress strip shows **up to two cards per child**: the piece they are learning and
their video course.

## Cards

The strip is for the child choosing what to play: each card says what is next and
resumes it in one tap. Each child gets one panel, headed by their avatar (32px) and
name, over **one card** (`stripGroups`); children are ordered by their latest activity.
A child has a piece when they have one in progress (at least one step earned; the most
recent such piece; pieces only opened or tried do not count), and a course when they
have one.

A child with both gets two small tabs at the right of their header: ♪ **Sheet music**
(the piece) and ▶ **Video lesson** (the course), each a 32px round button with that
`aria-label` and `aria-pressed`. The shown one is filled with the accent, the other
outlined. The card shown is the most recent of the two (piece `practicedAt`, course
`lastPlayedAt`; a tie keeps the piece) until a tab is pressed (`shownCard`). Pressing a
tab only swaps the card; it never opens anything. The choice is kept per child while
the strip is mounted (component state, no storage), and logs `piano.desk.tab` (debug,
`{ userId, kind }`). A child with only one of the two has no tabs. One card per child
keeps the row to four wide cards for today's four children (two preschoolers only have
a course) rather than six narrow ones (owner, 2026-11-19).

Both kinds share one layout (the panel's width by 150): a 64x96 poster on the left with a small play
disc in its corner; beside it a badge (one line), the title (up to three lines) and the next step;
the progress in a row along the bottom. The poster is the picture in a 2:3 frame
(cropped to fit only when its own shape differs), never squeezed into a wide band. With no picture, or one that fails to load, a tinted
stand-in shows a ♪ and the title.

- **Piece:** the score's `cover` (the same-name picture beside the score: a raster scan, else a
  generated `.svg` poster, see [Posters](sheet-music-player.md#posters)), the printed
  title, and the next step: the next passage's bars (`Bars 6–9`), or **Whole piece** once
  every passage is Gold (`piecePolishing`). The badge is **Silver next** while
  any passage lacks Silver, **Gold next** once every passage has it, then the Polish
  goal once the piece is all Gold: **Polish next** (gold) until the piece's Polish gem,
  **Diamond next** (pale diamond colour) after the gem, and **Diamond** once the diamond
  is earned (`cardBadge`). The progress row is the passage map in score order (a tomato, a
  flower, a silver coin or a gold coin; the next passage ringed), one row of coins up
  to 22px sized to fill a 276px row (`coinSize`; a narrower card shrinks them further);
  a piece with more than 14 passages takes two equal
  rows (`mapColumns`, `mapRows`, `coinSize`). A tomato nobody has started sits back at
  30% opacity; a started tomato and the one up next are full colour (`passageFaded`).
  No count: the coins show it. A piece holding its Polish gem ends the coin row with
  a coin-sized gem (`#f2c94c`); once the diamond is earned, the diamond (`#cfe8f7`)
  takes its place (`polishStone` in `modes/SheetMusic/polishAwards.js`). The stone
  takes one more column of the row, so the coins size for it (`coinSize(count, 1)`)
  and the card never grows; on a two-row map it stands centred beside both rows. The
  card's accessible name adds ", Polish gem" or ", Polish diamond" (`pieceLabel`).
  Tapping opens that child's next passage in Learn; an all-Gold piece opens in Polish
  instead (`?mode=polish`: the mode is chosen, nothing starts), with no passage ringed
  (log `piano.desk.open-polish`).
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

`GET /api/v1/piano/activity/desk` returns each roster child's current piece, with its `cover` when the library has one, and
`polish: { gem, diamond }`: the piece's Polish awards, read from the piece log
(`polish-gem` / `polish-diamond` entries; an unreadable log answers both false and
logs `piano.desk.polish_unreadable`). Each piece is
projected through `shared/music/learnCoach.mjs`, so the strip and Learn agree. Its
passages are the score's admin-approved Learn segments when it has them (the
per-score Learn file, matched on the content sha the child practised, so a file cut
against different XML is ignored); otherwise the passages saved in the record's
`learnCoach.summary`. Progress is keyed by bar range, so after an admin re-cuts a
piece the strip shows it straight away: unchanged ranges keep their Silver and
Gold, changed ones start over, without waiting for the child's next take. An
A segment's hands are the `parts` the admin set on it; else those of the saved
passage on the same range; else the hands every saved passage agrees on (a
one-hand piece stays one-hand); else both. An unreadable Learn file, or one whose
segments do not validate, falls back to the saved passages and logs
`piano.sheetmusic.learn-read-failed` or `piano.sheetmusic.learn-invalid` (warn,
once per score per process). The Polish reward reads the same projection
(`application/coachRecordProjection.mjs`). Courses
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
It is 208px tall: the 32px header, a 6px gap and a card. A card is 150px: 2px of
border, 16px of padding, the 96px poster row, a 10px gap and a 26px progress row. When
any piece shown on the strip needs two coin rows, every card grows to 170px together
(`data-tall`; the progress row becomes 46px, two 22px coins and a 2px gap) so the row
stays even; a long piece behind a child's other tab does not count. The children's
panels share the row (`flex: 1 1 0`, at most 300px each, 16px apart): four children in
the 1216px row get about 292px each. A crowded row shrinks its cards rather than
scrolling or cutting one off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card and tab. An owed video lesson replaces the tiles, but not the strip, with that lesson and a 224px column beside it: the child's latest piece (`LatestPieceCard`: poster, play disc, Silver count, title; one tap opens it at its next passage) over the Sheet Music tile (browse every score): sheet music is the one mode an owed lesson leaves open (owner, 2026-11-19), through that tile or a piece card on the strip. A PianoChallenge still takes the whole screen. The lesson is one card that is one button: the course poster on the left, then the lesson title over the lesson's still, which fills its area (cropping slightly rather than leaving a band), with a small play disc on it. There is no separate Start button, and no description, course or unit line.

Logs: `piano.desk.view` (the cards shown), `piano.desk.tab`, `piano.desk.open-passage`, `piano.desk.open-polish`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`, `piano.sheetmusic.learn-read-failed`, `piano.sheetmusic.learn-invalid`.
