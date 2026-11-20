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

A child with both switches between them with a **sideways swipe on the card**: left
shows the next card, right the one before, wrapping like a carousel (`swipeTarget`;
works for any number of cards, two today). The swipe uses pointer events
(`useCardSwipe.js`): a drag counts once it is mostly sideways (horizontal travel over
1.5 times the vertical) and past 12px; while it drags the card follows the finger at
half its travel, at most 32px (`--piano-desk-drag` on the `.piano-desk__deck` wrapper,
`touch-action: pan-y` so vertical moves still scroll), and springs back on release. A
release 40px or more sideways switches the card, which slides in from that side
(`data-enter`). A swipe, or a sideways drag of 20px or more, swallows the click the
browser may send after it, so a swipe never also opens the card; the next pointerdown
disarms that (the Android WebView sends no click after a drag), so a tap straight after
a swipe opens. Vertical gestures and wobbles under 12px are ignored, so a jittery tap
still opens. Only the first finger counts: a second pointer, or a new one during a
gesture, is ignored, and the deck losing its pointer capture ends the drag like a cancel
(the card losing touch's implicit capture to the deck does not). The follow
offset is written straight to the CSS variable, so a drag does not re-render the card. A swipe logs `piano.desk.swipe` (debug,
`{ userId, from, to }`). With `prefers-reduced-motion` the card neither follows nor
slides; it swaps in place. Closed (curfew, a pending lesson) there is no swiping.

The header keeps two tabs at its right as indicators: ♪ **Sheet music** (the piece) and
▶ **Video lesson** (the course), 32px round buttons with an 18px icon (their hit area
reaches a few px past the circle), labelled with the child's name (`Ada: Video lesson`), with `aria-pressed`. They are
light: no ring, the shown one a soft accent tint. Tapping one still swaps the card and
never opens anything (logs `piano.desk.tab`, debug, `{ userId, kind }`). The card shown
is the most recent of the two (piece `practicedAt`, course `lastPlayedAt`; a tie keeps
the piece) until the child swipes or taps (`shownCard`). The choice is kept per child
while the strip is mounted (component state, no storage). A child with only one of the
two has no tabs and no swipe. One card per child keeps the row to four wide cards for
today's four children (two preschoolers only have a course) rather than six narrow ones
(owner, 2026-11-19).

Both kinds put the poster the card's **full height** on the left, in a 2:3 frame (88x132,
or about 103x154 on a tall card), with a small play disc in its corner; the right column
(176px wide at four children) holds the rest, with the progress pinned to its bottom
(owner, 2026-11-20). The poster is the picture cropped to fit only when its own shape
differs. With no picture, or one that fails to load, a tinted stand-in shows a ♪ and
the title. Titles wrap to two lines, then end in an ellipsis.
Pictures are asked for at about 1.5 times their drawn size for the tablet's screen
(`?w=180&h=270` for posters, `?w=192&h=108` for episode stills), and cannot be dragged
or long-pressed out of the card.

- **Piece:** top to bottom beside the score's `cover` (the same-name picture beside the
  score): the badge, the printed title, the next step (the next passage's bars, `Bars
  6–9`, or **Whole piece** once every passage is Gold, `piecePolishing`), then what to do
  in them: the coach's next skill, `piece.next.label` ("Settle into a beat"; `nextSkill`),
  left out when the desk gives none and while polishing. The badge is **Silver next** while
  any passage lacks Silver, **Gold next** once every passage has it, then the Polish
  goal once the piece is all Gold: **Polish next** (gold) until the piece's Polish gem,
  **Diamond next** (pale diamond colour) after the gem, and **Diamond** once the diamond
  is earned (`cardBadge`). Pinned at the bottom of the column: the passage map in score
  order (a tomato, a flower, a silver coin or a gold coin; the next passage ringed) with
  the Silver count (and the Gold count once there is one, `PieceCount`). The coins'
  arrangement (`coinLayout`): one row with the count stacked beside it (at least 40px),
  filling the 128px left, up to 36px (1–5 passages: 2–3 get 36px, 4 get 30px); one row
  under the count line across the whole 176px column, up to 24px (6–8 passages); two
  rows under the count, up to 22px (9–24 passages); or three rows, up to 14px (25 and
  more). Among one-row arrangements the biggest coin wins; more rows win only when their
  coin is at least 3px bigger, since they make every card tall. A coin is never bigger
  than a piece with one passage fewer gets, so a longer piece never gets bigger coins
  (nine passages on two rows keep eight's 20px). Three rows keep coins at 12px or more up
  to 36 passages; a longer piece shrinks them further rather than hiding passages behind
  a "+N" (no piece in the library comes close, and every passage stays visible and
  counted). A narrower card shrinks the coins further.
  A tomato nobody has started sits back at
  30% opacity; a started tomato and the one up next are full colour (`passageFaded`).
  A piece holding its Polish gem ends the coin row with
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
  course furthest along. The poster is the course art. At the top of the column is the
  next episode's own still (`course.next.thumbnail`, 16:9, 96px wide), so the child knows
  the lesson by its picture; with none, or one that fails to load, a tinted frame with a
  play icon. Beside it, "LESSON" over the number: the number printed in a "Lesson 51 |"
  prefix, else the lesson's `position`, else lessons done plus one (`lessonNumber`). Under
  them the lesson's title without that prefix (`lessonTitle`), and at the bottom a thin
  bar with the percent of lessons done. There is no badge: the still says which lesson
  is next. Tapping plays that lesson.

Tapping a card also makes that child the current player (owner-requested 2026-07-28).
Choosing a player otherwise stays in the "Who's playing" modal. A child with neither
a piece nor a course has no card.

## Data

`GET /api/v1/piano/activity/desk` returns each roster child's current piece, with its `cover` when the library has one, and
`polish: { gem, diamond }`: the piece's Polish awards, read from the piece log
(`polish-gem` / `polish-diamond` entries; an unreadable log answers both false and
logs `piano.desk.polish_unreadable`). Each piece is
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
It is 208px tall: the 32px header, a 6px gap and a card. A card is 150px: 2px of
border, 16px of padding and 132px of content (the poster, and the right column: badge,
two title lines, bars, skill, and one row of coins with the count beside it). When any child's piece
needs two or three coin rows, every card grows to 170px together (`data-tall`; the
posters grow with it at 2:3) so the row stays even. A piece behind a child's other card
counts too, so switching a card never changes the row's height. `PianoHomeDesk.layout.test.jsx` renders the strip in Chromium at
1280x800 (two and four children, short and long titles (two-line piece titles with a skill line at 150px), 2, 3, 4, 7 and 20 passages, a missing
episode still, a 10/10 count, closed), checks that nothing spills out of a card, swipes a
card with a real mouse and with real touch (CDP touch events: a tap straight after a
swipe opens, a vertical pan is ignored), and saves screenshots (to `DESK_SHOTS`, else the OS temp folder). The children's
panels share the row (`flex: 1 1 0`, at most 300px each, 16px apart): four children in
the 1216px row get about 292px each. A crowded row shrinks its cards rather than
scrolling or cutting one off.
Curfew applies only on the piano's own tablet (the client whose kiosk device id matches
`screensaver.deviceId`); an ordinary browser stays usable. Curfew and a pending lesson
check disable every card and tab. An owed video lesson replaces the tiles, but not the strip, with that lesson and a 224px column beside it: the child's latest piece (`LatestPieceCard`: poster, play disc, Silver count, title; one tap opens it at its next passage) over the Sheet Music tile (browse every score): sheet music is the one mode an owed lesson leaves open (owner, 2026-11-19), through that tile or a piece card on the strip. A PianoChallenge still takes the whole screen. The lesson is one card that is one button: the course poster on the left, then the lesson title over the lesson's still, which fills its area (cropping slightly rather than leaving a band), with a small play disc on it. There is no separate Start button, and no description, course or unit line.

Logs: `piano.desk.view` (the cards shown), `piano.desk.tab`, `piano.desk.swipe`, `piano.desk.open-passage`, `piano.desk.open-polish`, `piano.desk.open-course`, server
`piano.desk.record_skipped`, `piano.desk.player_skipped`.
