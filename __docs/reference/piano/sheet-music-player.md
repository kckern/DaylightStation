# Sheet Music Player

The piano kiosk's engraved-score mode: browse a folder of scores, open a MusicXML
file, and practice it through a four-mode learning progression with per-notehead
light-up. Lives in `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`,
engraving through the shared OSMD renderer in
`frontend/src/modules/MusicNotation/renderers/`.

Listen is the only mode that sends demonstration MIDI. Learn uses the engraved
score as an open passage roadmap and launches focused `ExerciseRun` training
modules from it. Polish remains transport-driven and timing-aware; Perform
remains presentation-only.

## Chrome layout

- **Top:** the standard always-on breadcrumb (`PianoChrome`) — `🎹 › Sheet
  Music › [thumb] {title} › ⦿ {Mode}`. The mode publishes two crumbs via
  `usePianoBreadcrumb`: a title crumb carrying a small square score thumbnail,
  and a trailing **mode crumb** (icon + the current mode's name — Listen,
  Learn, Polish, or Perform). The mode crumb is tappable even though it's the
  last (current) segment: it opens a centered **Mode** sheet listing all four
  modes with their icons; picking one switches modes and closes the sheet.
  This is how **every** mode — including Perform — changes mode; there is no
  in-bar mode selector. Back = the breadcrumb's parent crumb. Score titles
  come from the score's own metadata (an explicit title, then the MusicXML's
  embedded work title); a score with neither falls back to a title derived
  from its filename rather than showing a bare "Score".
- **Bottom:** a pinned transport bar with a **stable three-zone grid**: an
  empty left zone (keeps the center cluster truly centered) · metronome,
  restart, play/pause, the **loop group** (Learn only), position readout
  (center) · hand toggles, Key, Tempo, View menu, Volume (right). The
  geography never reshuffles — modes **disable/dim controls in place** instead
  of unmounting them, so Play is always where Play was; the loop group is the
  one deliberate exception (it doesn't exist outside Learn, so it unmounts
  rather than lying with disabled chrome), and **Perform** is the other (bar
  strips to zero chrome — see "Perform" below). One button grammar throughout:
  shared inline-SVG icons (no text glyphs/emoji), ≥48px touch targets, one
  radius, **blue = a setting is on** (metronome armed, loop active), **green =
  the transport is running**. Buttons that open a sheet cue it with a small
  icon rather than a uniform affordance — Key and View show a chevron, while
  Tempo shows the quarter-note glyph it always carries. **Key and Tempo are
  modal sheets**, not popovers: tapping the button opens a centered modal
  sheet with its own scrim, a direct-pick ladder of steps, and a close
  affordance — one tap commits and dismisses, so there's no separate "confirm"
  step. The **View** menu is the same sheet shell — size and
  keyboard-visibility controls only, no metadata list and no layout choice (see
  "The page" below); keyboard visibility is
  a switch (`ToggleSwitch` — a real `role="switch"` track, not a checkbox);
  size is a discrete tap-commit stepper, so the score repaints once per step.
  **Volume** opens the same volume sheet every player in the kiosk uses —
  Media and MIDI levels as five-step ladders, with a Log/Linear curve toggle —
  so turning the piano or the media down works identically here as in
  Karaoke, Music, or a video course.
- **Key abbreviations:** the Key sheet's grid cells show the short form —
  `DM` / `F#m` (`M` = major, `m` = minor) — with the semitone offset as a
  sub-label; the transport bar's own readouts keep the long form ("D major").
- **Tempo ladder:** percent steps `60 · 70 · 80 · 90 / 100 / 110 · 125 · 150 ·
  175`, deliberately centered so 100% sits dead-center of the grid rather than
  at an edge.

## Browsing scores

The score grid is a Courses-style browser: `sheetmusic.collections` in
`piano.yml` names an ordered set of `{label, ref}` folders/collections, each
becoming a tab (`Video Games`, `TV Shows`, …) above the grid; a household with
a single collection gets the tabless grid unchanged. The last tab a player
picked is remembered per device, so returning to Sheet Music opens where they
left off.

## Modes — a learning progression

Four modes, **Listen · Learn · Polish · Perform**, selected from the header's
Mode sheet (see "Chrome layout" above). Each has one job and the chrome tells
the truth about what that job is:

| Mode | Identity | Transport chrome |
|------|----------|-------------------|
| **Listen** | Pure playback — a jukebox that performs the score | Restart/Play · metronome (session-local, off by default) · hand toggles · Key/Tempo/View/Volume. No looping. |
| **Learn** | Open passage roadmap with a config-defined hand/timing ladder | Score roadmap plus passage ladder; a selected rung opens a dedicated `ExerciseRun` |
| **Polish** | Real-time scored runs, always whole-piece | Play + count-in · metronome (on by default, persisted) · hand toggles · settings. No looping. |
| **Perform** | The music stand | No transport bar; the pedals, the page turner, a swipe or a tap turn pages |

**Which mode a score opens in.** With Learn's roadmap on (`sheetmusic.learn.roadmap`,
the default), a score opened from the library opens in **Learn**, so the passage rail
is on screen from the first moment. A `?play=` launch opens the mode it names and starts
it; a `?mode=` link opens the mode it names without starting anything (the home strip
sends an all-Gold piece to `?mode=polish`); a `learnPassage` link opens Learn. When the household names `sheetmusic.defaultMode`,
or the roadmap is off, a score opens in the mode it was last left in on this device,
then in `defaultMode` (`listen` unless configured).

A practice **loop/range is Learn-only state**: leaving Learn for Listen or
Polish clears it, and re-entering Learn re-derives a fresh one from practice
history (see "Learn: landing and the state matrix" below) rather than
restoring whatever was there before. Listen always plays the whole piece;
Polish always grades the whole piece — a range they can't hold would be a lie
the chrome tells.

### One hands model

A single "active hands" concept applies in all four modes — `HandsControl`'s
two icon-only toggles (left-/right-hand glyphs, no text label) on a standard
two-staff (grand-staff) score:

- **Listen** — which hands the kiosk *performs*. An inactive staff is engraved
  but silent, not just dimmed. Playing along shows what you are holding (see
  "Live input" below), but nothing in Listen gates, advances or grades on it.
  Both hands on is the
  default; either or both can be off (an all-off Listen is a valid "just
  watch the page" state, since the kiosk is doing the playing either way — the
  only floor is Learn/Polish's own).
- **Learn / Polish** — which hands *the user* is responsible for: advancement,
  grading, and the keyboard's lit target set all read the same active-hands
  value. At least one hand always stays on here — an empty selection would
  deadlock advancement.
- The on-screen keyboard defaults hidden in Listen (nothing is "yours" to
  play along with) and shown in Learn/Polish; the View sheet's keyboard
  switch always overrides, remembered per mode for the session.

**Non-grand-staff scores** (a single staff, or three or more) keep the older
labeled-chip control instead of the two hand icons — one chip per staff.
Learn/Polish toggle a chip on/off the same way; Listen cycles a chip through
Play/You/Mute. For these scores the hands preference and practice-history
buckets always collapse to a single "both" bucket; per-staff dimming still
applies to whichever chip staff is deselected.

**Staff dimming** (Listen/Learn/Polish, grand-staff scores): a deselected
staff is faded rather than hidden, so the shape of what you aren't playing
stays visible for context. The fade is applied to the engraving itself — the
staff's own group in the rendered notation — not to an overlay laid on top of
it. Everything on that staff fades together, including the stems, beams and
ledger lines that reach outside the staff, and the fade has no edges of its
own to notice. Because the ink itself is dimmed, live overlays — the cursor,
wet ink, note chips — are unaffected and need no stacking order to stay clear
of it.

The current-step notehead itself is recolored directly on the engraved SVG
rather than drawn as an overlay: it takes a subtle near-black ink, the same
fixed shade in every mode (only the cursor band keeps the per-mode accent
color). A note struck correctly takes a warm dark brown with a soft
drop-shadow — a fixed color, independent of mode or the current-step ink, so
"hit" always reads the same regardless of what's playing. It reads as ink
rather than as the kiosk's accent green, which keeps the page looking engraved
instead of lit up like a game.

## The page: whole systems in every mode

The score never scrolls, in Listen, Learn, Polish or Perform. A window shorter
than the piece would always slice a staff at its edge, so the score is shown as
**pages of whole systems** (`systemPaging.js`, `useSystemPaging.js`).

- **What a page holds.** As many whole systems as fit the window, fitted to their
  ink (with a 10px margin) and centred. Everything above and below the page is cut
  away between systems, in the widest strip that carries no ink, so a page never
  shows a sliver of its neighbour. The last page is always a full one, so it may
  repeat a system of the page before it.
- **The page turner** (`ScorePager`) stands in the paper's right margin in every
  mode: a tall up button, a tall down button and one pip per page, with no words.
  A swipe up or left turns forward, down or right turns back.
- **The page follows the cursor** (Listen, Polish, and Learn's direct practice).
  A cursor that is off the page is turned to, with its system at the top. While
  the music runs the page also turns **ahead** of the cursor, like a page-turner
  at a music stand: when the cursor reaches the last system showing and more
  follow, that system slides to the top and the next ones come into view, so they
  can be read before they are needed and the cursor never leaves the screen. A
  turn that would bring nothing new into view waits. With one system to a page the
  turn comes as the cursor crosses to the next system. Stopped, a tap on the last
  system seeks there and the page stays.
- **A page turned by hand** stays until the cursor next moves, so the piece can be
  browsed while stopped; while it plays, the page returns to the cursor on its
  next note.
- **A turn is view state only.** It moves and clips the engraving and touches no
  clock: the transport, the count-in, the metronome grid and its click lead, and
  Polish's grading all run exactly as they do without one. The slide of a cursor
  turn is a 260ms transform of the already-painted notation (no repaint per
  frame; none at all under `prefers-reduced-motion`); for that moment the cut is
  the union of both pages. Turns by button, swipe, pedal, tap or passage are
  immediate.
- **Size.** The View sheet's size steps re-engrave and re-page. A size at which a
  single system is taller than the window cannot show a whole system, so the
  largest size is the largest at which one still fits, read off the engraving on
  screen: larger steps are disabled in place, and a size that stops fitting
  (the keyboard switched on) steps down to it (`score.size.fit`, with `from`
  and `to`).
- **Many pages.** Past twelve pages the pips give way to one track with a marker.
- **No "Across" layout.** The one-line layout could only be read by scrolling and
  cut bars at both edges of the screen, so the layout choice is retired and the
  score is always engraved down the page. It was a per-visit toggle and was never
  saved, so no stored choice is lost.
- **Before the systems are known** (the moment between the first paint and the
  geometry walk) the sheet is not yet paged.

Logs: `score.page.turn` (`mode`, `from`, `to` as system indexes,
`by: button|swipe|passage|cursor|pedal|tap`).

Scanned page-image scores (`ScoreViewer`) are a different viewer and still
scroll their page images.

## Listen

The kiosk performs the active hands at a settable tempo and key; the other
hands, if any are deselected, sit silent and dimmed rather than disappearing.
A **session-local metronome** (off by default, never persisted) is available
as a free-running click at the practice tempo — offered only when the score's
tempo map has a single entry, since a free-running click has no one BPM to
lock to across a mid-piece tempo change; scores with tempo changes keep the
metronome disabled-in-place rather than ticking against a ritardando.

## Live input

In Listen, Learn and Polish, the score answers what you are **currently
holding**. A pitch written where the cursor is turns that printed note green —
the engraved notehead itself is recoloured, so the answer can never appear
beside the note it is answering. A pitch that is *not* on the page has no
printed note to recolour, so it is drawn instead: at the pitch you played, in
the cursor column, spelled from the sounding key so a transposed score still
reads correctly. Outside Learn's gate it sits recessed rather than hidden, so
you can see what you actually played; inside the gate a non-match is answered by
the red wrong-note ink instead (see below). Releasing the key restores the page.

A note you land also flashes briefly. Without that, a note that *completes* a
step would show nothing at all: the cursor advances the instant you satisfy it,
before the screen can paint, which in a passage of single notes is every correct
note you play.

Outside Learn's gate, the rule deliberately ignores which hands are active: it
answers "is this on the page right now?", not "is this your job right now?" —
the only question that still means something in Listen, where the hand toggles
pick what the kiosk performs rather than what you owe. Inside Learn's active
gate, the rule narrows to the hands the player is responsible for, so the page
cannot call a note green while the gate is calling it wrong.

While Learn's gate is grading, a note that isn't written at the cursor draws
nothing here, because the gate already answers it with the red wrong-note ink.
That division is what keeps one glyph per keypress instead of two.

Perform has no live input, as it has no chrome of any kind.

## What each colour on the staff means

One rule holds the page together: **a colour belongs to exactly one channel.**

The **engraving** carries the score's own state, in value rather than hue — the
printed black, a near-black once the cursor reaches it, a pulse toward brown
while a note is still owed, and brown once it is struck. Keeping this channel
free of saturated colour is what keeps the page looking engraved rather than lit
up like a game.

**Your playing** is reported as it happens, and is the only place saturated
colour appears: green the instant you play a note correctly, red the instant you
play a wrong one. Both are marks about an EVENT — what you just did — never
about which keys happen to be down. That distinction matters: the cursor
advances in the same instant you satisfy a note, so held state is only ever read
against the note *after* the one you played, and on a repeated note a key still
held from before would otherwise be called correct while the gate waits for a
press that never came. A held pitch that isn't written where you are draws a
recessed grey ghost — the one thing held state can honestly say.

**Regions** carry place, and recede. The cursor band is one neutral slate in
every mode, because "you are here" means the same thing in all of them and the
mode is already named in the breadcrumb. The practice loop — its band and its
two handles — is a muted orange, deliberately not the green a correctly played
note wears: a loop marks where you are working, it does not judge how you are
doing. Its band reaches out to the barlines rather than stopping on the first
and last noteheads, so the range never appears to slice through the notes it is
asking you to play. Polish's
per-measure washes keep their green, amber and red — they cover a whole bar and
never sit on a notehead, so they read as scoring rather than as note state.

Green means one thing only: you are playing the right note, right now.

## Learn: landing and the state matrix

### Guided passage learning

The score remains the map. Rehearsal regions are never crossed; within each
region the planner balances passages targeting four bars (normally three to
five). The [passage rail](#passage-rail-and-board) under the score names the next
passage and shows every passage of the piece. A stale passage URL shows an
explanation and the available choices.

A child uses two screens in Learn: the score with its rail and board, and the
**drill screen**. There is no preparation page and no result page.

#### The drill screen

Opening a passage lands on the Exercises run surface (`ExerciseRun` inside
`LearnLab`), on the passage's current step, ready to play. `LearnCoach` is glue:
it chooses the step, hands the passage to the drill as sets and reps, records each
take with the coach, and stacks the [passage rail](#passage-rail-and-board) under
the drill. It draws no practice screen of its own.

- **Sets and reps.** Every Silver and Gold step of the passage is one set in the
  drill's progress row, and the clean takes it needs are its reps. A set is named
  by a picture, not a word: the two hands with the resting one unlit (right hand,
  left hand, together), the **silver coin** over the Silver check, a metronome,
  `50%`, `60%`, `75%`, and the **gold coin** over the step at score tempo. So the row
  reads as the way to each coin. A step with no picture (an authored ladder)
  keeps its words. The words stay as each set's accessible name. A Gold step
  with no fixed count (two good takes out of the last three) shows two reps.
  `passageDrill()` in `LearnCoach.jsx` builds this projection; `DrillProgress`
  draws `display.icon` when a set carries one.
- **Starting.** Nothing is pressed. A free take arms on its first correct note and
  a timed take counts in on any key, exactly as in Exercises. The coach hears that
  a step was chosen (`selection`) when the take begins, not when the passage opens.
- **Choosing a step.** Tapping a set runs that step, and it is the only chooser:
  each set is a full touch target. This is how a child goes straight to "together"
  or the Silver check (the silver coin), and after Silver to the full passage at
  score tempo (the gold coin). There is no separate "change practice" screen.
  Which sets can be tapped depends on the [skipping mode](#skipping-steps); a set
  that cannot be started yet is a disabled button, and outside `strict` its picture
  is dimmed under a small lock (the piano `lock` icon).
- **Chrome.** One toolbar row: Back (to the score), the printed bars, the step's
  instruction (`Join the hands`), then for a timed step its tempo (`40 BPM`) and
  click loudness, and **Listen**, **Pause** and **Start over**. A drill on part of the passage
  is named by the bars it covers (`Bar 2`). Saving is mentioned only when it
  failed (**Progress not saved**, **Retry saving**). A lost piano is announced once,
  by the app's banner.
- **A pass** shows the drill's own rep card (`RepInterstitial`): `Set 3 of 8
  clear`, the score, `Next: On your own`. The next step is already mounted under it.
- **Silver and Gold.** The take that certifies the passage closes the drill's
  curtain (`GateCeremony`, the game gate's) over the stage. On the closed curtain
  the passage's icon turns over into its silver or gold coin above `Silver!` or
  `Gold!`, a short chime sounds and the passage's rail tile turns at the same
  moment. The curtain then parts onto what is next (`Next`, the next passage's
  icon and bars) and the screen moves there. It lasts five seconds
  (`PASSAGE_CEREMONY_MS`), with the verdict held for about two.
- **The whole piece.** When that take finishes the piece, the curtain carries
  every passage instead: one coin per passage, turning in a wave above
  `All Silver!` or `All Gold!`, with the longer chime, while every rail tile
  turns with it. It lasts 7.6 seconds (`PIECE_CEREMONY_MS`). Silver parts onto
  `Next: Go for Gold`; Gold parts onto the piece's title. The screen then returns
  to the score, which celebrates nothing itself.
- **A miss** opens the drill's result as a card over the run
  (`ExerciseRun resultPresentation="overlay"`). The run's rows never change
  when a take ends, so the score does not move or resize under the child. The
  card holds the coach's short verdict (`Almost on your own`,
  `Bar 2 is the tricky spot`), the take's numbers, and the next moves. The
  primary button is large (at least 7rem tall) and is the smaller practice the
  coach recommends after two misses (`Practice bar 2`, `Practice the left hand`,
  `Try a little slower · 75%`), otherwise **Try again**. **Come back to this
  later** follows when it is on offer. **Releasing the keys and playing any key
  takes the primary button** (`onResultContinue`), and the card says so
  ("play any key to practice bar 2"), so a child never has to reach for the
  glass to take the help. `piano.exercise-retry` logs `via: 'piano'` with
  `action: 'host'` (the coach's primary) or `'repeat'` (a run with no host
  action).
- **Listen** demonstrates the step's bars and parts in the same chrome with one
  control, **Stop listening**, and records nothing.
- **Rail and board.** The same rail as the score view sits under the drill, with
  this passage outlined and no practice button. A tile opens that passage; the
  count opens the board over the drill, and a card opens its passage.

**Verdict marks** (✓ ◂ ▸ ○ ×) hang off the noteheads, on the side away from
the stem: under a stem-up note, above a stem-down one (`verdictAnchor` in
`Exercises/ScorePassage.jsx`). Placed under the whole stavenote group they sat
under the stem tip, and the passage's ink-fitted viewBox cut off the ones under
low notes. The viewBox keeps two staff spaces of air above and below the ink
(`passageLayout.js`) so a mark beside the highest or lowest notehead fits.

**Timing on the slowed steps.** The 50 / 60 / 75% timed steps grade with
`placementFullCreditShare: 0.6` (`learnPracticeRequirement` in `LearnLab.jsx`):
full placement credit reaches 60% of each note's window instead of 40%. The
pass bar (placement 0.8) and the window itself do not change, and a note
outside its window still earns nothing. Score tempo (Gold), test-out and
untimed steps keep the 0.4 curve. See `performance-assessment.md`.

The engraved passage is contained in the stage at every size: the passage,
renderer, the engraver's own wrapper around its SVG, and the SVG each hold one
definite grid cell, so a two-system grand staff can never grow past the paper.
(The engraver's wrapper once sized itself to the page, and a two-system grand
staff was cropped top and bottom on the tablet.) A passage that takes two systems
is engraved once more with its last system justified (`stretchLastSystem`), so
the second line runs the width of the first and never stops halfway across blank
paper; a one-system passage is left alone and scaled up to the stage. The stage frames the **measured ink**, not
the engraver's page: `ScorePassage` reads the engraving's bounding box and
`passageLayout.js` shows it with one and a half staff spaces of air on every
side, so a passage is as large as its stage allows (a two-system grand staff is
about a fifth larger than on the engraver's page). Staves and bars are always
inside the frame, whatever was measured. Without a measurement the page is used,
trimmed where every system stops short. This applies to every `ScorePassage`, in
Exercises too.

Stems and noteheads were checked in the drill at 1280x800 and 1280x748 across all
twelve passages of a real score, through the ready, playing, resolve and result
states: every stem touches a notehead. The drill puts no CSS transform on an
engraved note, which is what keeps them together.

Logs (`piano-learn-coach`): `piano.learn.coach.step`, `piano.learn.coach.take`
(`reason`, `passed`, `tempoPercent`, and the result's `placement`,
`completeness` and `cleanliness` to 3 decimals; `placement` is null on an
unpaced take), `piano.learn.coach.pick`, `piano.learn.coach.skip` (see
[Skipping steps](#skipping-steps)), `piano.learn.coach.certified`
(`level`, `piece`, `next`), `piano.learn.coach.set-aside`,
`piano.learn.coach.unavailable`, `piano.learn.celebrate` (`scope: passage|piece`,
`level`, `passages`, `sounded`; logged as the verdict lands), and `piano.learn.rail.select` with
`source: learn-rail|learn-board`.

### Silver and Gold

Each passage has two separate certifications. **Silver** certifies the notes and
moves the learner on. **Gold** certifies playing with the metronome at score tempo.
Gold is optional and never changes the recommended next step. Passing Gold also
grants Silver.

The recommendation is the first unfinished Silver step in the earliest passage
without Silver. A Silver drill in progress comes first. Gold work and reviews keep
their own resume slot. When every passage has Silver, the score offers Gold.

**Play it on your own** is the Silver check: all playable parts, the learner's own
pace, no metronome, no lit keys and no stuck-ladder note names. It can be attempted
at any time. Two straight misses on a Silver step or drill offer **Come back to this
later**, which skips that passage until the next household day. If every remaining
passage is set aside, the earliest returns. The check ends as a miss after
`stallSeconds` with no newly matched note, including when the first note is never found.

Policy comes from `sheetmusic.learn.certification` and resolves through the same
household, category, piece, user and user-piece layers as other Learn settings:

```yaml
sheetmusic:
  learn:
    certification:
      silver:
        stepPasses: 1      # clean takes per step before the check
        checkPasses: 1     # passing Silver checks required
        cleanliness: 0.8   # share of played notes that must be correct
        stallSeconds: 30   # time without a new correct note
      flower:
        after: both-hands  # when a passage is partway: both-hands | together | first-step
```

Invalid values use these defaults. Policy changes never remove earned credit.

Hands-together free grading reads newly pressed keys only. Releases and keys still
down from earlier notes are never wrong. A position across both hands completes when
all its notes, each struck since the cursor arrived, are down at the same moment.

Each saved coaching event stores `learnCoach.summary` in the practice record:
`total`, `silver`, `gold`, `nextPassageId`, `setAside`, `updatedAt` and `passages[]`
with `id`, `start`, `end`, `silver` and `gold`. Certification values are timestamps,
`legacy`, or null. Logs: `piano.learn.silver-check`, `piano.learn.certified`,
`piano.learn.set-aside`.

### Skipping steps

The generated ladder runs right hand, left hand, together, the Silver check, the
beat (50%, metronome), cued 50%, 60%, 75%, then score tempo (Gold). The current step
is the first one not yet ready. `sheetmusic.learn.skipping` says which other steps a
child may start:

- `strict`: only the current step. A step already ready can be played again.
- `open-to-silver` (the default): any Silver-track step (each hand, together, the
  Silver check) in any order. The beat and tempo steps are locked until the passage
  has Silver; then any of them may be started.
- `open`: any step, Gold included, from the start.

```yaml
sheetmusic:
  learn:
    skipping:
      default: open-to-silver        # strict | open-to-silver | open
      learners:
        learner-a: open
      pieces:
        "files:docs/sheet-music/carol-of-the-bells.mxl": strict
```

The mode is resolved per child and passage: the piece's entry, then the learner's,
then `default`. A value that is not one of the three modes is ignored and the next
level applies. A passage with an **authored ladder** is `strict` unless the piece
has an entry (a learner entry does not open it). The policy is household-only: it is
read from the household piano config and does not resolve through the category or
piece Learn layers, so the kiosk and the server agree. `resolveSkipMode`,
`stepAccess` and `passageAccess` in `shared/music/learnSkipping.mjs` are used by both.

**Higher passes cover lower steps.** When a step becomes ready, the lower steps it
covers show ready too. This is worked out when progress is projected; no stored
achievement is rewritten.

| Ready step | Also ready |
|---|---|
| Together | Right hand and left hand (`carrySilver`) |
| Silver check | Every note step of the passage (Silver certifies them) |
| A cued tempo (say 75%) | The slower cued steps and the beat (`carryGold`) |
| Score tempo (mastery) | Every Gold step |

Certificates do not change: Silver comes only from the Silver check (or Gold, or
legacy completion), Gold only from score tempo. One hand alone covers nothing above
it. Authored ladders do not carry over.

Recovery drills (slower beat, one hand, focus bars) work as before on whichever step
was chosen.

**The kiosk enforces locks; the server records and reports.** The kiosk never offers a
locked step. `PianoLearnCoachService` still accepts a `selection` or `outcome` for a
step the child's mode locks, applies it as normal, and logs a warn
`piano.learn.coach.locked` (`userId`, `scoreId`, `passageId`, `skill`, `type`,
`mode`), judged on the progress before the event. It does not refuse it, for two
reasons: the server reads `skipping` live while an open kiosk read it when the piece
opened (or a queued take came from an older bundle), so the two can disagree; and the
kiosk's save queue sends takes strictly in order, so one refused item would hold every
later take for that child and piece behind it. A recovery drill is judged by the step
it came from, and a review of a mastered passage is never locked. A task that is no
step of the plan (an old saved tempo) only meets the Silver gate on Gold work. Every
other check (task identity, plan, assessment) still refuses with a 4xx.

**Save-queue quarantine.** When the server refuses a queued item with a 4xx that will
fail the same way on retry, the kiosk outbox (`learnCoachClient.js`) moves it out of
the queue into a `quarantined` list in the same localStorage entry
(`piano.learn.coach.outbox.v1`, last 20 kept), logs a warn
`piano.learn.coach.quarantined` (`learnerId`, `scoreId`, `eventId`, `write`
(`attempt` or `coach`), `status`, `type`, `passageId`, `skill`, `error`) and keeps
draining the takes behind it. Network errors, 5xx, 408, 429 and 401 stay at the head
and retry as before; on the assessment write a 403 (the kiosk's write role) retries
too. Quarantined items show the recovery notice and can be exported like unreadable
queued items.

**Log.** `piano.learn.coach.skip` (info, kiosk) when a child starts a step that is
not the current one and is not already ready: `{ userId, scoreId, passageId, from,
to, mode }`, where `from` and `to` are step skills (`right`, `together`, `timed-75`).

### Passage rail and board

Learn is a game played over the whole piece: turn every passage Silver, then go
round again for Gold. The score stays the main thing on screen.

**The score is pages of whole systems** (see [The page](#the-page-whole-systems-in-every-mode)),
so a staff is never sliced at the rail. The score opens on the page that holds the
passage the rail's button names, and turns to the next one when that changes after
a drill or when Learn is entered from another mode.

**The rail** is one 64px row under the score:

`[Practice bars 1–5] | passage tiles | 3/12`

- **Tiles.** Every passage of the piece, always, with no scrolling. Widths follow
  bar counts and each tile shows the passage's state icon and the printed number
  of its first bar. The icons are a crowd answering a stage act
  (`PassageCoin.jsx`): a **tomato** (not started), a **flower** (partway), a
  **silver coin** and a **gold coin**. The coins are the household `CoinIcon`;
  `TomatoIcon` and `FlowerIcon` sit beside it in `frontend/src/lib/icons/`.
  Opacity never shows state.
- **Flower.** An uncertified passage becomes a flower by
  `certification.flower.after`: `both-hands` (the default: each hand alone is
  earned, or the hands together; a one-part passage when its notes step is
  earned), `together` (the hands together only) or `first-step` (any note step).
  Invalid values use the default. `projectCoach` computes it (`segment.flower`,
  and `passageProgress().state === 'learning'`), so the home strip, the rail, the
  board and the drill agree.
- **Tapping a tile selects it.** The score turns to the page that holds those bars
  whole and boxes them: the page it is on when they are already there, else a fixed
  page that holds them all, else the page that starts at their first system. It
  does not open practice. Tapping a passage on the score itself still opens it.
- **The button** opens the selected passage in Learn (`Practice bars 14–17`). With
  nothing selected it opens the recommended passage. When every passage is Silver
  it reads `Go for Gold: bars 1–5`. Opening Learn clears the selection, so on
  return the button names the next recommended passage again.
- **The count** shows `silver/total` until the piece is all Silver, then
  `gold/total`, and opens the board.
- **Long pieces.** A tile is never narrower than 44px. When the passages cannot all
  fit at that width the tiles become a plain map of the piece (still every
  passage, no numbers) and a tap on it opens the board at that passage's card.

**The board** slides up from the rail and covers the whole stage above it, without
moving the music underneath; no staff is left sliced behind it. Its cards fill
it: they are shared evenly between the rows (`boardColumns`: twelve passages are
six and six), the rows share the height, and each card's icon is half the card.
It is the table of contents and the trophy board: the piece's title, the two goals as
counters (a silver coin with `3/12` and a gold coin with `1/12`, ticked when
reached), and one card per passage with its state icon, its bars and, while it is
under way, one mark per Silver step. Tapping a card selects that passage as a tile does and closes the
board. Otherwise it closes with **Close** (or Escape). **Review a passage** appears
in its header when a review is due.

A counter adds `earn a gem` only when a gem is really on offer: the Gem
Board (`GET /api/v1/earnings/gems`, asked when the board first opens) reports
`mode: live`, lists this player as a learner, and carries a `piano-piece` rule that
is not switched off for them. A guest, an unreadable Gem Board or a missing rule
gets the plain counter.

After the two counters, the board shows the piece's **Polish gem** once it is
earned, and the **diamond** in its place after that (one `GemIcon`, the same
colours as the run summary: `polishStone` in `polishAwards.js`). It comes from the
practice record read: `GET /api/v1/piano/users/:userId/practice/:scoreKey`
answers `polishAwards: { gem, diamond }` beside any saved record, read from the
piece log (`PianoPolishReward.holdings`, matched on the score key). It is never
stored in the record: `usePracticeRecord` keeps it apart from `record` (as
`polishAwards`) and a PUT carrying it drops it. A Polish run that earns a stone
updates it at once from the run's `polishReward`, so the board shows a new gem
without reopening the score. The score view's board and Learn's board both take
it (`polish` prop).

The home strip above the piano menu draws the same icons and counters: one icon
per passage of the child's piece in progress, with the next passage ringed.

**Celebration.** Silver and Gold are celebrated on the drill screen, where they
are earned (see [the drill screen](#the-drill-screen)). The score view shows the
result and celebrates nothing: no banner, no sentence and no second chime. The
chime is synthesized on the player's WebAudio context (`passageChime.js`), best
effort. A tile's turn is held until the ceremony's verdict (`flipDelayMs`) and a
finished piece turns its tiles as a wave (`wave`).

Logs (`piano-score-player`, `piano-passage-board`):
`piano.learn.rail.select` (`passageId`, `source: rail|board`),
`piano.learn.rail.practice` (`passageId`, `target: selected|next|gold|again`),
`piano.learn.board.open`, `piano.learn.board.close`, `piano.learn.gem-offer`.
A page turn logs `score.page.turn` (see [The page](#the-page-whole-systems-in-every-mode)).

### Piece log and the piece gems

Finishing a piece pays one gem the first time it is all Silver and one the first
time it is all Gold, through the economy's `milestone` earn rule for the activity
`piano-piece` (see [economy](../economy/economy.md#earn-rules)).

Passage certification is re-derived on every read and has no whole-piece date, so
the coach service appends to a dated log when a piece is finished:

```yaml
# users/{id}/apps/piano/piece-log.yml
schema: piano.piece-log/v1
entries:
  - { at: "2026-11-18T20:00:00.000Z", scoreId: "files:…", level: silver, passages: 12, fingerprint: "…" }
  - { at: "2026-11-20T18:00:00.000Z", scoreId: "files:…", level: polish-gem, passages: null, fingerprint: "…", tempoPercent: 60, score: 96 }
```

Levels are `silver`, `gold`, `polish-gem` and `polish-diamond`. The last two are
written by [Polish rewards](#polish-rewards-the-piece-gem-and-the-diamond), not by
the coach service, and are read only by their own milestones: `piano-piece` pays
for `silver` and `gold` alone.

- It is written only when **one saved take** moves the piece from "not all" to
  "all". Before and after are projected with the same plan and the same legacy
  record, so legacy credit, a plan edit or a policy change never writes an entry.
  A selection, a set-aside, a failed take and a replayed receipt never do either.
- A piece and level are noted once. The achievement key is `{level}:{scoreId}` and
  only its earliest entry ever counts, so a piece earned again after its file
  changed does not pay again.
- It is append-only and best effort: a failed append never fails the take. A lost
  append loses that gem and can never pay twice. Guests have no log.
- A take that earns Gold on the last passage of a piece with no Silver yet notes
  both levels.

Logs: `piano.learn.piece-certified` (`level`, `passages`), `piano.piece-log.appended`,
`piano.piece-log.already-noted`, `piano.piece-log.append-failed`.

The standard path is:

| Skill | Assessment | Recommended tempo |
|---|---|---|
| Find the right-hand notes | Pitch, RH | Unpaced |
| Find the left-hand notes | Pitch, LH | Unpaced |
| Join the hands / Find the notes | Pitch, all playable parts | Unpaced |
| Play it on your own (Silver) | Pitch, all playable parts, no hints | Unpaced |
| Settle into a beat | Pitch with a guide click; timing is not graded | 50% |
| Play with the beat | Pitch and placement | 50%, then 60%, then 75% |
| Play at score tempo | Pitch and placement, full passage and every playable part | 100% |

Single-part passages omit separate-hand and coordination tasks. Silver steps need
`stepPasses` clean takes, one by default. Gold-path readiness requires two successful
valid equivalent completed takes among the latest three. Default criteria are completeness 1 and cleanliness at least 0.8;
timed work also requires placement at least 0.8. Below full tempo the timing
window grows with the slowdown (cap `400 ms × 100 / tempoPercent`), and the first
off-beat note in a take earns half placement credit instead of none (see
performance-assessment.md, "Fraction"). An explicitly authored ladder
retains its order, criteria, repetition quota and consecutive-pass requirements.
Authored per-set tempos remain distinct ordered requirements; repeating a slower set cannot finish a faster one. Its terminal achievement is **Practice plan complete** unless the work establishes
the full timed achievement, labeled **Played at score tempo**.

A stronger timed demonstration can establish easier skills without redundant
practice. Equivalent custom takes contribute regardless of their launch source.
Shortened, slower or single-hand work never proves a stronger full-passage skill.
Earned readiness and mastery are permanent. A failed review or easier practice
cannot remove them. A change to the generated Gold tempos cannot remove them either:
a Gold beat or cued step is ready when a later, faster step of the same passage is
ready, or when an earned achievement covers the same bars and parts in cued work at
an equal or faster tempo (a beat step also accepts earned beat work). So a child who
earned the old 60% and 80% steps resumes at score tempo, and one who earned only 60%
resumes at 75%. Authored ladders do not carry over this way
(`carryGold` in `shared/music/learnCoach.mjs`). On the Silver track "together"
covers each hand (`carrySilver`; see [Skipping steps](#skipping-steps)). A saved Gold resume from the
old ladder (say `timed-80`) is dropped when no step of the passage's current
ladder has its mode and tempo, so the coach falls through to the next unready
Gold step; recovery drills (they carry a `parent`), explicit reviews and
authored ladders still resume as saved (`offLadderGoldStep`). One mastered passage can be offered for review on a later
household-local day, alongside continuing the unfinished work.

Each deliberate start installs one take in the existing LearnLab/ExerciseRun.
Free practice waits for and counts the first expected note. Timed practice starts
its visible, audible count-in without a sacrificial arming note. During the
count-in, input is excluded from grading. Timed assessment receives individual
fresh MIDI attacks with original timestamps; held-set observations remain
limited to the cursor/held contracts. Malformed timed input is an operational
failure, never an extra wrong note.

Notation, the assessment cursor and verdicts remain dominant in the lab. Wrong
pitches reveal the still-owed keyboard notes until the cursor advances. **Pause**,
**Start over** and **Back** remain visible (a lab outside the coached drill also
keeps **Change practice**). Pause freezes the
clock, miss windows and click; resume supplies a short count-in. Restart and
setup changes affect the current take, preserving achievements. Save responses
cannot replace the material of an active take or interrupt its verdict hold.

After the final verdict hold, every completed take reaches a result and a choice.
Feedback leads with a musical accomplishment or focus. **Play again** repeats the
same task directly. The primary recommendation names the actual next skill,
focused recovery task or next passage; no take advances automatically. Operational
failures have their own explanation, and metronome results never claim to have
graded timing.

After two equivalent valid failures, offer a smaller task deliberately. Prioritize
missing/extra notes in the measure with the greatest normalized burden, breaking
ties by earlier score order; without spans use the first half. Continued
coordination difficulty can narrow to a hand. Timing-only difficulty steps down a
named tempo stage (100, 75, 60, 50, 40), with an automatic floor of 40%, then shortens the range. There
are at most two recovery levels. Two successful recovery takes recommend the
parent again without completing its quota. Manual tempo choices under Change
practice remain available at 15, 25, 40, 60, 80 and 100 percent. Preparation shows
the starting effective BPM as well as its percentage of score tempo.

Progress is scoped to profile, score and content fingerprint. Unreadable queued items are retained separately and can be exported for recovery; valid queued work and new practice continue. Each pending take replays against its captured plan, including after configuration changes. Coaching uses a
bounded browser outbox, posting the immutable assessment first and its coaching
event second. Retry and reconnect retain the same event IDs. The server reads the
saved assessment, applies the shared policy in order, and acknowledges a revision
using durable receipts and atomic YAML summaries. Duplicate delivery cannot award
credit twice, including after restart or eviction from recent evidence. A profile
switch disposes the old run; delayed writes retain their captured profile.

Musical success remains visible while saving is pending. **Progress not saved**
offers **Retry saving**. Browser-storage failures ask the learner to keep the page
open until saved. Guests receive session-only coaching and a visible reminder to
choose a name for durable progress, with no guest writes.

The additive `learnCoach` summary preserves existing `learn`, `measures`, and
`polish`. Compatible legacy earned skills are grandfathered with explicit
provenance, including six banked passes under weaker old rubrics. Earlier counts
remain visible separately when score identity changes. Partial legacy counts do
not manufacture current equivalent evidence. Silent takes never count toward readiness or difficulty. Historical version-2 two-part timed
failures without the corrected `onsets-v1` contract never drive adaptation, and
historical attempts are never rewritten as passes. Content versions of coaching
state are archived rather than overwritten.

The coaching API is `GET/POST /api/v1/piano/users/:userId/practice/:scoreKey/coach`.
The shared policy is `shared/music/learnCoach.mjs`. Aggregate events include
`piano.learn.saved`, `piano.learn.save-failed`, `piano.learn.queue-failed`,
`piano.learn.listen`, and existing exercise terminal/timing summaries. Runtime
provider `exercise-runtime-v5-onsets` identifies the corrected attack contract.
Raw note streams are not added to ordinary coaching logs.

Timed and metronome Learn rungs show **Soft**, **Medium**, **Loud**, and **Max**
click controls, with Loud selected initially. Their base gains are 0.08, 0.18,
0.36, and 0.60; the existing downbeat accent scales from that base. The selected
level is stored under `piano.learn.click-level`; unavailable browser storage
still permits a selection for the current lab visit. Changing loudness updates
future scheduled clicks without recreating the scheduler, restarting the take,
or moving its anchored beat grid. Callers outside Learn keep the default gain.

The timed run counts at most four pulses on the ask's selected musical grid,
then displays a brief **PLAY** cue at the first graded beat. The stage-bounded
countdown descends **4, 3, 2, 1** for a four-pulse plan, with a bar draining over
the whole lead-in; a shorter plan starts at its actual pulse count. Gray music,
hidden cursors, and excluded held keys preserve the count-in's listening phase.
PLAY sits above notation ink. Running beats produce a short, pointer-transparent
stage-edge halo with a stronger measure downbeat; reduced motion replaces it
with a static numbered corner marker and disables the numeral pop. Countdown,
PLAY, cursor, and beat treatment all project the existing run clock, with no
second animation timer. The score and bottom keyboard retain their space throughout.

Bar accents use the engraver's actual measure start and duration, carried in the
compiled assessment's `measureMap`. This preserves 3/4, compound meter, pickups,
rests at bar starts, and changes of measure length. The marker counts quarter
positions within each bar (not compound-meter conducting beats); absent measure
metadata leaves a generic quarter pulse with no claimed downbeat. The existing
count-in pulse and audio scheduler remain on their anchored grid.

`piano.exercise-countdown-started` includes `pulseCount`, `pulseBpm`, `leadInMs`,
`tempoStage`, and `clickLevel`. Actual preference transitions emit
`piano.learn-tempo-stage-changed` (previous/current stage and percentage) and
`piano.learn-click-level-changed` (previous/current level and gain), with score,
passage, and rung ids. Unchanged selections and rerenders do not emit changes.
Legacy ScorePlayer count-ins still announce elapsed `Count in, beat N`; only
the remaining-count API announces `Starting in N`.

Selection lives in `learnPassage` and `learnRung` query parameters. The run
receives the original MusicXML, printed passage boundaries, active parts, the
configured rubric, and the selected coaching task. `ExerciseRun` is therefore the one
assessment and feedback surface rather than a second Learn-only judge.

Learn configuration is deep-merged in order: built-in defaults, category,
piece, user, then user-plus-piece. An explicitly supplied ladder overrides the standard skill policy. Ladder behavior is configurable under
`sheetmusic.learn`; the following is
the shape, not a second source of defaults:

```yaml
sheetmusic:
  learn:
    roadmap: true
    passages: { targetMeasures: 4, minMeasures: 3, maxMeasures: 5 }
    feedback: { successReturnMs: 900 }
    ladder:
      - id: right
        label: Right hand
        parts: [rh]
        mode: free              # free | metronome | cued
        sets: 2
        reps: 3
        availability: sequential # sequential | always
        consecutive: false
        criteria: { completeness: 1, cleanliness: 1 }
        completes: rung          # rung | passage
        completion: standard     # standard | tested-out
        legacySeed: rh           # optional: rh | lh | both
```

`scope: all-parts` is available for together/timed rungs and expands their
effective parts to every playable staff, including staves beyond a grand staff.
`legacySeed` is opt-in migration metadata; custom free rungs are not inferred to
be compatible with old per-measure history. The legacy planner hashes normalized passage sizing and the complete ladder into a plan revision. Each segment also stores a
fingerprint of its boundaries and effective ladder. A harmless label change
retains progress; changing one segment's boundaries or ladder invalidates only
that segment while compatible siblings survive the new plan revision. Invalid
ladder entries fall back to the complete default ladder and emit
`score.learn.config-fallback`.

### Legacy direct score practice (`roadmap: false`)

Setting `sheetmusic.learn.roadmap: false` keeps the older in-score range
workflow as a compatibility escape hatch. It does not use the score-native
segment labs described above.

Opening Learn on a score already lands you somewhere useful: an **auto-range**
heuristic picks a loop range the moment Learn is entered with no range set,
in priority order —

1. **History frontier** — the first ~4-measure window, anchored at the first
   playable measure whose pass count (for the active hands) is under the
   learned threshold.
2. **First rehearsal section**, if the score has any.
3. **First 4-measure window** every measure of which the active hands can
   actually play (skips rest-heavy intros for a one-handed selection).
4. **First four non-empty measures**, or the whole piece if the score is that
   short.

The pick is always loop-on, so Learn opens already inside its gated practice
state — landing directly in guided repetition instead of a blank slate.

**The state matrix.** Learn has exactly three states, and the chrome always
tells you which one you're in:

| State | Play button | Cursor driver | Kiosk audio | Gate / ink |
|---|---|---|---|---|
| **No range** | Enabled | Transport, same as Listen | Performs active hands | No gate; wet ink is neutral, never red |
| **Range + loop ON** | Disabled — "Learn advances as you play" | You (canonical cursor attempt) | Silent | Gate active: wrong notes shake + red ink |
| **Range + loop OFF** | Enabled | Transport, whole piece | Performs active hands | No gate; neutral wet ink |

Play is enabled exactly when the loop is off — the assessment projection and the
machine transport are never driving the cursor at the same time. Moving
between any two matrix states (toggling the loop, setting or clearing a
range) always stops whatever was driving the cursor and silences the kiosk;
it never auto-plays into the new state. Toggling the loop ON snaps the cursor
to the range's in-point; toggling it OFF, or clearing the range, leaves the
cursor exactly where it was.

**The gate only ever waits on notes you are responsible for.** Plenty of
onsets belong entirely to the hand you aren't practicing — a tie held across a
barline vacates one staff while the other re-attacks, and any single-hand
passage does the same. Those steps are on the page and the cursor passes over
them, but they ask nothing of the active hands, so the gate steps straight
over them rather than waiting on a key that is never coming. This applies both
to advancing (the next stop is the next step these hands actually play) and to
arriving — a range whose in-point lands on the other hand's onset, or a hand
toggled off mid-passage, moves the cursor on by itself. A wrap crossed that
way doesn't count as a lap: a practice pass has to be played, not skipped
into. If a range holds nothing at all for the active hands, the cursor stays
put instead of spinning.

**Finishing Learn.** When a clean pass wraps a range that spans the *whole*
piece, that pass is the end of the piece: Learn shows a completion card
offering another pass or the next rung ("Polish it"). A pass over a partial
range is a lap of a passage — it feeds the practice record and nothing more.

**Wrong-note feedback (kid-UX, deliberately light-touch):** a wrong note gets
a shake and a red notehead drawn **at the pitch you actually played** — wet
ink, rendered right beside the note that was expected, spelled from the
score's sounding key so a transposed piece still reads correctly. That's the
whole punishment. The on-screen keyboard doesn't reveal the expected key on
every miss — it arms only after **three consecutive wrong attempts on the
same step**, as stuck-support rather than a correction on every slip.

**Notes the step is still waiting on.** Learn advances only once every
active-staff note of a step has been struck, so a note that is expected but
hasn't arrived yet pulses — between the engraved ink and the struck-note brown,
at full strength. The pulse previews the reward: this is the note, and this is
what it becomes once you play it. It is never drawn hollow (a hollow notehead
means a half or whole note, so outlining a quarter note would state the wrong
duration) and never drawn faint, because faintness is what tells you a note is
*not* the one being asked for.

## The loop group and range handles (Learn only)

The loop cluster — mark-in, mark-out, toggle, clear — lives in the bar's
center zone and only renders in Learn; there's nothing for it to control
anywhere else. Marking is **tap-to-arm**: tapping "mark in" arms the in-point,
and the *next* tap on the score names that measure — anywhere within a
system's vertical band resolves to its nearest measure (no need to land near a
note); a tap in the dead margin outside every system rejects with a shake and
a hint rather than snapping to a wrong measure. Mark-out is symmetric; if the
two ever cross, they swap. Setting either endpoint when no range exists
creates a one-measure range at that measure with the loop off — there is no
half-marked in-between state, so the brackets, handles, and loop toggle always
describe either a complete range or nothing.

The range's two endpoints also live as **draggable handles** directly on the
score (≥48px touch targets, replacing the older bracket-only markers as the
range's visual boundary — the range tint band stays). A press that barely
moves is a tap (arms the edge, same as the bar button); a press that moves is
a drag, tracked sub-measure under the finger and committed to the nearest
whole measure on release. A drag stays on the page it started on (the score does
not scroll); a range that runs past the page is set by turning the page and
tapping the other end. Section starts render as snap markers
while an endpoint is being armed or dragged, and rehearsal sections in the
Loop sheet still offer a one-tap "loop this section" shortcut.

**In Learn, the in/out buttons show their measure numbers** (`m5` / `m8`)
once a range exists.

## Practice history

Progress is tracked per user, per score, and read back to drive the Learn
roadmap/direct-practice frontier and the Polish tier bests:

- A **guest / no selected user** gets full session-local roadmap progress but
  no server reads or writes. Persistent roster users keep the same progress
  across sessions.
- Roadmap progress is keyed by plan revision, stable segment id, a per-segment
  boundary/ladder fingerprint, and rung id. A harmless segment rename retains
  progress. When a plan changes, unchanged segment fingerprints retain their
  progress while changed boundaries or ladder meaning invalidate only the
  incompatible segments. Revision-only records migrate when first written
  against a compatible plan. Each
  rung stores attempts and banked passes; passage completion records the rung
  that completed it. PUTs merge at passage/rung depth so one take cannot erase
  sibling progress.
- Existing per-measure history can seed compatible free rungs when every bar
  in the passage was already learned for that hands bucket. It never seeds a
  timed rung or Test Out.
- **Attempts and passes** are tallied per measure, per hands bucket
  (`both`/`rh`/`lh`; non-grand-staff scores always use `both`). One trip
  through a loop (in → out, with the gate active) is an **attempt** for every
  measure inside it. Any seek, tap, hand-toggle change, range change,
  transpose change, or leaving the mode mid-cycle **voids** that cycle
  entirely — no attempt is recorded. A completed cycle earns a **pass** on a
  measure only if no wrong note occurred within that specific measure during
  the cycle — a single slip on measure 9 of a 12-measure loop costs only
  measure 9 its pass, so broad practice keeps advancing the frontier
  elsewhere. A measure counts as "learned" (and drops out of the auto-range
  frontier) once it has accumulated **two passes** for the relevant hands
  bucket.
- **Polish best scores** are also kept per hands bucket, one best per tempo
  tier (see "Polish" below) — an RH-only run is never compared against a
  both-hands best.
- The record is invalidated wholesale if the score's engraving has changed
  shape since the record was written (a different measure count or file
  size) — a stale per-measure record describing measures that no longer exist
  is discarded rather than silently misapplied.

## Polish: real-time scoring with tempo tiers

Polish always grades the whole piece — never a range — which is what makes
the tier bests below comparable run to run. The metronome is on by default
(persisted) and a count-in leads into the run. Each measure is graded live on
notes-and-timing (the same measure wash used elsewhere) and folded into a
running score; the transport bar's center readout shows the live tally as the
run progresses (e.g. `82% · m 12/24`).

Polish compiles the score through the same canonical expectation as Learn and
closes measure spans on one timed attempt under `polish-canonical-span-v2`.
Measure washes read canonical completeness, cleanliness, placement, part, and
diagnostic evidence. The established Polish combined score remains a local
display projection so existing tempo-tier bests stay comparable. Missed notes
are explicit omissions in the attempt rather than disappearing when playback
crosses a measure boundary. Polish keeps its forgiving timing policy: 80ms
free, falling to zero by 400ms — so polish and beat-relative grading are one
formula with different numbers rather than two implementations.
See [performance-assessment.md](./performance-assessment.md).

Polish and Piano Hero own separate attempts over the same renderer-independent
score expectation contract. Repeated pitches remain separate attacks,
simultaneous pitches accumulate as a chord, early/late drift is retained per
logical note, and unmatched notes reduce cleanliness. Polish projects measure
spans into its existing washes and summaries; Hero projects attempt events into
points and combos.

**Tempo tiers.** A run is bucketed by the tempo it was played at, decided the
instant the run starts: **slow** (under 80%), **medium** (80–99%), **full**
(exactly 100%), **overclocked** (over 100%). Changing the tempo mid-run voids
that run's tier — the summary labels it "mixed tempo" and it competes for no
best, though the live grading still shows. **Overclocked runs earn extra
credit**: the displayed/stored score is the base score scaled up, and can
exceed 100 — that's the reward for playing faster than written.

> The multiplier is under review. The
> rubric design (ops:docs/_wip/plans/2026-08-12-assessment-rubric-design.md)
> argues speed should be a **gate** against the item's target tempo rather than a
> score multiplier: weighting speed teaches a child to rush, and a multiplier
> makes scores incomparable across runs, which is the one thing tier bests
> depend on. Nothing has changed here yet.

At the end of a run, the summary shows this run's score and tier alongside
the four tier bests **for the current hands bucket**, so a right-hand-only
run compares itself only against other right-hand-only bests. A best only
updates on a completed, non-voided, whole-piece run — an aborted or
mixed-tempo run can't quietly overwrite a real personal best.

**"Whole piece" means started at the top and played through**, at one tempo on
one pair of hands. A run that begins from a tap-seek into the middle, or whose
tempo or hands changed anywhere along the way — including while it was paused
or waiting on a zoom/key re-engrave — reaches the end of the piece but
banks nothing; the summary still shows its score. Pausing itself is fine:
picking the same run back up at the same tempo on the same hands is still one
whole-piece run. Because a best only ever improves, an inflated one would be
permanent, so the gate errs toward withholding — and every withheld bank names
its reason in the log.

### Polish rewards: the piece gem and the diamond

Once a piece is **all Gold** for a player, Polish pays for playing it well at speed:

| Reward | A qualifying run at | Milestone activity |
|---|---|---|
| Piece gem | 50% tempo or faster | `piano-polish-gem` |
| Diamond | 90% tempo or faster | `piano-polish-diamond` |

A run qualifies only when **all** of these hold:

- it is a completed whole-piece run (started at the top, one tempo, one pair of
  hands, not voided: the same rule that lets a run bank a tier best);
- the metronome was on for the whole run: on when it started from the top, and not
  toggled while it played or sat paused (a resume cannot turn it back on);
- every staff was active (a one-hand run never qualifies; a single-staff piece
  has one part, and playing it counts);
- its **base** score is 95 or more (the plain run score, never the overclocked
  display score);
- the player is a real learner, not a guest.

Tempo is the tempo at run start, as a whole percent (`round(tempoMult × 100)`):
49% earns nothing, 50% earns the gem, 89% the gem only, 90% the diamond. A
diamond run also earns the gem when the piece does not have one yet. Each is
paid once per piece, ever. Before the piece is all Gold, Polish plays and scores
as always and earns nothing.

**How a run reaches the server.** Every completed whole-piece run that is not
voided (banked or `not-better`) is reported with the practice record write,
`PUT /users/:id/practice/:scoreKey`, as `polishRun`:

```json
{ "fingerprint": { "...": "..." },
  "polishRun": { "scoreId": "files:…", "tempoMult": 0.9, "metronome": true,
                 "completed": true, "mixed": false, "parts": [0, 1],
                 "activeParts": [0, 1], "base": 97 } }
```

**What protects the reward.** The server decides, from run facts the kiosk
reports (base score, tempo at start, metronome, active hands, completed, mixed).
The server's own checks are that the piece is all Gold, that each stone is paid
once per piece, and the economy's weekly `cap` on the milestone rule. The run
facts themselves are self-reported by the kiosk: they are trusted because the kiosk
is a household device, not a hostile client, and nothing on the server replays the
run to confirm them. The kiosk keeps them honest by voiding a run whose tempo or
hands change, or that did not start from the top, and by clearing the metronome
fact when the click is toggled while a run is in flight or paused; a resume never
turns it back on.

`PianoPolishReward` judges the facts after the record is saved and answers `polishReward:
{gem, diamond, newGem, newDiamond, reason}` in the response; neither field is
stored in the practice record. "All Gold" is read from the piece log's dated
`gold` entry (the one the `piano-piece` milestone pays from) or, for a piece
finished before the log existed, the saved coach summary showing every passage
Gold. When the score has admin-approved Learn segments for the XML the child
practised, that second check projects the record onto them instead of trusting
the saved summary (the same projection as the [home strip](home-desk.md#data)):
a passage the admin cut differently must be earned again. A piece Gold already
recorded in the piece log survives re-segmentation: earned credit is never taken
back. What was earned is appended to the
[piece log](#piece-log-and-the-piece-gems) as `polish-gem` / `polish-diamond`,
which is how the economy's milestones date it.
`reason` names the verdict: `qualified`, `guest`, `invalid-run`, `wrong-score`,
`incomplete`, `metronome-off`, `one-hand`, `low-score`, `slow-tempo`,
`not-all-gold` or `log-unavailable`. The check never fails the write it rides on.

**What the player sees.** The run summary announces **Diamond earned!** and/or
**Gem earned!**, each led by a `GemIcon`, only when the server says it is new.
The passage board (from the practice record read's `polishAwards`) and the home
strip (from the desk endpoint's `polish`) show the stone the piece holds; see
[the passage board](#passage-rail-and-board) and [home-desk.md](home-desk.md).

The rewards pay nothing until the household adds the two milestone rules (see
[economy](../economy/economy.md#earn-rules)).

Logs: `piano.polish.reward` (server, info: `userId, scoreId, tier, tempoPercent,
score, reason, gem, diamond, newGem, newDiamond`), `piano.polish.reward-failed`
(warn), `score.polish.reward-shown` (client, info: `tempoPercent, metronome, base,
reason, newGem, newDiamond`), `score.polish.reward-failed` (client, warn: `scoreId,
tempoMult, metronome, status, error`) when the PUT carrying `polishRun` fails; the
run summary then shows no reward line, and the next qualifying run reports again.

## Perform

Nothing on screen but the page and its turner: no transport bar, no cursor, no
keyboard. The pedals turn one whole page: `advancePedalCC` forward and
`backPedalCC` back (config-driven CC numbers, rising-edge detected so a held or
continuous pedal turns once). The page turner's buttons and a swipe work as in
every mode, and a tap on the lower half of the page turns forward, on the upper
half back. Mode-switching still works through the header's mode crumb. Logs:
`score.perform.pageturn` (`dir: fwd|back`, `by: pedal|tap`).

## Key transpose (Listen · Learn · Polish)

The Key sheet's grid cells speak **sounding key names** — each cell's primary
label is the key that offset produces (e.g. "D major"), with the semitone
offset (`+2`, `0`, `−6`, …) as a sub-label; a score with no written key falls
back to offset-only cells. Picking a step sets `osmd.TransposeCalculator` +
`osmd.Sheet.Transpose` and re-engraves on the paint-first path (transpose is
part of the renderer `cacheKey`, so a change re-parses cleanly and re-extracts
pitches — notation **and** playback move to the new key). Returning to 0
restores the written key; transpose resets on a new document. The control is
live in all three practice modes — Learn and Polish transpose the engrave
their advancement and grading read from, and Learn's wrong-note wet ink
spells its pitches from the sounding key too, so practice stays consistent
with what's sounding — and is unavailable only in Perform (no chrome at all).

## Load pipeline (paint-first, non-blocking)

The freeze users saw came from doing OSMD load + render + full geometry extraction
in one main-thread block. The pipeline now decouples paint from extraction:

1. **Prefetch** — `prefetchOsmd()` warms the lazy `opensheetmusicdisplay` chunk
   when the score **grid** mounts, so the engine is loaded before a score opens.
2. **Fetch** the MusicXML (`SheetMusic.jsx`).
3. **`osmdEngrave`** — load + `render()` only → returns dims. The sheet **paints
   here** and Manual mode is immediately usable.
4. **`extractLayoutSliced`** — the geometry walk (cursor → per-notehead boxes,
   plus per-staff bounds for the dim layer), run in **yielded ~256-step
   slices** (`runSliced`/`scheduleYield`) so the main thread stays responsive;
   a determinate `.musicxml-renderer__progress` bar covers it. On completion,
   `onLayout(...)` + `onReady()` arm Follow/Play.
5. **Zoom/resize** takes the cheap path: `osmdRepaint` (paint-only, no extract) +
   one sliced extract — no blocking double-walk.

`extractEvents` (sync) and `extractLayoutSliced` (yielded) share one `processStep`
closure, so their output can't diverge.

### events / steps alignment

`extractEvents` returns both `events` (the cursor track) and `steps` (per-onset,
all-staff notehead geometry). `events` is **derived from `steps`** — one entry per
onset, index-aligned — so a single `step` integer indexes the cursor and the
light-up interchangeably, **including left-hand-only onsets** (which have no
top-staff melody note but must still be cursor stops). `events[i].midi` is the
representative pitch: top-staff highest, else overall highest.

## Telemetry (logs-only)

Timed Learn input is dispatched as individual note attacks with the original MIDI
timestamp, including when both hands are selected. Held-key snapshots belong to
the cursor/chord matchers. A malformed timed observation ends as an operational
error (`piano.exercise-input-integrity`), never as a wrong pitch. Corrected
assessment evidence uses provider `exercise-runtime-v5-onsets`.

All timing goes through the logging framework (`component: 'piano-score-player'`;
geometry counts under `osmd-render`), measured with `performance.now()` and
stamped to wall-clock by the framework. Math is in `scoreTelemetry.js`; collection
+ emit in `useScoreTelemetry.js`.

| Event | Level | Fields |
|-------|-------|--------|
| `score.load` | info | `id, fetchMs, openToReadyMs, steps, …` (phase totals) |
| `piano.score-open-failed` | warn | `id, error` — the score's XML fetch failed. Emitted from `SheetMusic.jsx` (`NotationScore`), not this hook: a failed fetch renders `PianoEmpty` and never mounts `ScorePlayer`. It carries `app: 'piano-sheetmusic', sessionLog: true` on its own context so it still lands in the run's session file without creating a second one. |
| `score.playback.stall` | debug | `step, driftMs, gapMs, effectiveBpm, stallMs` (drift past a tempo-scaled budget, or a tick gap that skipped whole ticks) |
| `score.playback.stats` | info | `mode, events, meanDriftMs, p95DriftMs, maxDriftMs, stalls, maxFrameGapMs` (at pause/stop/done/unmount) |
| `score.follow.timing` | sampled | `step, sinceAdvanceMs` (how long the player took to answer the cursor — no pitch and no verdict) |
| `score.follow.stats` | info | `hits, wrongs, count, medianStepMs, p95StepMs` (on leaving Learn) |
| `score.learn.auto-range` | info | `inMeasure, outMeasure, reason` — the landing heuristic's pick and which rule produced it |
| `score.learn.cycle` | info | `in, out` — a canonical range lap completed; its finalized span results feed the practice frontier |
| `score.learn.assessment` | info on saved/skipped; warn on rejected/failed | common terminal evidence summary: identity, matcher/mode, criteria and rubric, part weights, failure reasons and gate evidence, terminal status, score/pass, note-count/response diagnostics, persistence outcome/status/duration; never prompts or raw MIDI |
| `score.learn.stuck-prompt` / `-resolved` / `-dismissed` | info | the 3-wrong reveal-keys assist arming and clearing |
| `score.learn.complete` | info | the wait-for-correct cursor covered the whole piece — the completion card is offered (Learn handing off to Polish) |
| `score.loop.arm` / `score.loop.arm-expire` | info | an endpoint armed for the next tap, or the arm expiring unused |
| `score.loop.set` | info | `edge, measure, via, snapped` — an endpoint committed, by tap or drag |
| `score.loop.on` | info | the loop toggled on/off |
| `score.focus.set` | info | `kind, inMeasure, outMeasure, origin` — a range established (auto-range, section pick, or handle/tap) |
| `score.focus.clear` | info | the range cleared |
| `score.polish.measure` | info | `measure, grade, noteScore, timingScore` (per graded measure) |
| `score.polish.silent-stop` | info | the run auto-stopped after N silent measures |
| `score.polish.summary` | info | `greens, yellows, reds, overall` (at run end) |
| `score.polish.reward-shown` | info | `tempoPercent, metronome, base, reason, newGem, newDiamond` — the server's Polish reward verdict for a reported run (see [Polish rewards](#polish-rewards-the-piece-gem-and-the-diamond)) |
| `score.polish.reward-failed` | warn | `scoreId, tempoMult, metronome, status, error` — the practice PUT carrying a `polishRun` failed, so no verdict came back |
| `score.polish.tier-best` | info | `bucket, tier, score, banked, reason` — the bank decision for a completed run, named either way: `banked`, or withheld as `nothing-graded` / `mixed` (tempo moved mid-run) / `partial` (not a whole-piece run) / `guest` / `not-better` |
| `piano.practice.save` | info | (backend) a practice record PUT was persisted |
| `score.transpose` | info | `semitones` |
| `score.mode` | info | `mode` |
| `notation.geometry` | debug | `total, graphical, fallback` (per-notehead vs cursor-box fallback counts) |
| `session-log.start` | info | `scoreId` — opens the per-session JSONL |

**Reading "on beat":** transport jitter is `driftMs` = actual fire time − scheduled
`t`; single-digit ms = tight, a `score.playback.stall` = a stutter.

**Learn timing is descriptive, not graded.** Learn is SELF-PACED — the cursor waits
for the player and advances only once every active-staff note of the step is struck
— so there is nothing to be late for. `score.follow.timing.sinceAdvanceMs` is simply
how long the player took to answer, and `score.follow.stats` reports the median and
p95 of those intervals. It passes no rush/tight/drag verdict. `classifyFollowHit`
still exists in `scoreTelemetry.js` for Polish, which IS graded at tempo, but the
Learn path no longer calls it.

**`score.playback.stall` is debug-level** — on a bad run it fires per tick, so
the count you want is `stalls` in `score.playback.stats`. Raise the level with
`window.DAYLIGHT_LOG_LEVEL='debug'` only while investigating a specific run.
Its `effectiveBpm` is the tempo the music is actually playing at (written bpm ×
`tempoMult`), so it will NOT match the `bpm` on `score.transport.play`, which
logs the written tempo and `tempoMult` as separate fields.

**Per-session practice log.** The telemetry child logger carries
`app: 'piano-sheetmusic'` + `sessionLog: true`, and `startSession(scoreId)` emits
`session-log.start` on score open. The backend `sessionFile` transport then writes
the whole run — load phases, every `follow.timing`/`polish.measure` with its ms
drift, stalls, and the summary — to one ordered, wall-clock-stamped
`media/logs/piano-sheetmusic/{ts}.jsonl`: the beat-by-beat record of a practice
attempt. Level is dialable via `config/logging.yml` (`loggers: { piano-sheetmusic }`,
gitignored/deployment-managed) or `LOG_LEVEL_*`.

**Full-fidelity input diagnostics are a separate, explicit channel.** The
zero-allocation input recorder keeps a bounded in-memory ring for latency work,
but ships nothing unless `inputTelemetry.enabled` or
`sheetmusic.inputTelemetry.enabled` is set, or an operator explicitly invokes
`window.__INPUT_REC__.start()`. Its `input.header`/`input.batch` records go to
`channel: input`, not the practice session or assessment events. Stop it with
`window.__INPUT_REC__.stop()`. This opt-in diagnostic stream is the only place
raw MIDI input is intentionally retained; ordinary telemetry logs counts,
timings, classifications, and persistence evidence without pitches.

## Metronome click: anchored grid and click lead

`clickScheduler.js` schedules every click on the AudioContext clock ahead of
time, so main-thread jank cannot move it. It has two ways to place beat 0:

- **Free (default, every existing caller).** `start(bpm)` puts the first beat
  80 ms after "now" (or `firstBeatDelayS`) and counts from there. Nothing ties
  it to any other clock.
- **Anchored.** `start(bpm, { anchorEpochMs, leadMs })` puts beat *n* at the
  epoch time `anchorEpochMs + n·period − leadMs`. The anchor is the grading
  clock's beat 0 on the `Date.now()` clock, so the click and the judge share one
  grid. Beats already in the past are skipped but *n* keeps counting, so phase
  and the bar accent stay on the grid; `setBpm` retunes from the next beat as
  before. `useMetronomeClick` exposes this as the optional `anchorMs` / `leadMs`
  props; changing either restarts the grid, and `startDelayMs` is ignored.

**Epoch → audio clock.** Taken once at start (`epochToContextMap`):
`ac.getOutputTimestamp()` when it returns a sane pair (the sample leaving the
speaker, and when) — this already includes the browser's own output latency;
else `ac.currentTime` paired with `Date.now()`, minus `outputLatency +
baseLatency` when the context has `getOutputTimestamp` but has not rendered yet
(so both paths mean "audible, as far as the browser knows"). `start` returns
`{ anchored, mapping, skipped, leadMs, firstBeatContextTime }` for diagnostics.

**Click lead** (`clickLead.js` → `resolveClickLead(pianoConfig, audioContext)`)
is the latency the browser does not know about — on the piano tablet the click
goes out over Bluetooth A2DP (~190–320 ms measured), and the key presses come
back over BLE-MIDI:

| Source | When | leadMs |
|---|---|---|
| `config` | `timing.clickLeadMs` is set (per piano `pianos.{id}.timing.clickLeadMs` over shared `timing.clickLeadMs`; resolved by `resolvePianoConfig`, default `null`) | the configured value (0 counts) |
| `browser` | no config, and the context has **no** `getOutputTimestamp` (the mapping could not fold latency in) | `(outputLatency + baseLatency) × 1000`, when > 0 |
| `none` | otherwise | 0 |

The browser figure is deliberately not added on a context that has
`getOutputTimestamp`: the mapping already applied it, and adding it again would
play the click early by twice the browser latency. A run that anchors its click
calls `logClickAnchored(lead, { anchorMs, ... })`, which emits
`piano.click.anchored` with `leadMs`, `source`, `outputLatencyMs`,
`baseLatencyMs`, `anchorMs`.

**Calibration** (grown-up): Piano maintenance (long-press the sound chip) →
**Click timing**. It plays 24 anchored clicks at 60 BPM with `leadMs: 0`; the
grown-up plays any key on each click they hear. Each note-on timestamp from the
live-note store is matched to its nearest click (presses more than half a
period from every click are dropped; two presses on one click keep the closer).
The screen shows the **median offset** (press − click) and the **spread as the
interquartile range** (Q3 − Q1). Save is offered only with **≥ 16 matched
presses and IQR ≤ 60 ms**; it writes the rounded median to
`timing.clickLeadMs` — under `pianos.{id}` when the file has that piano's
block, else on the shared top level — by editing the raw YAML (comments kept)
and `PUT api/v1/admin/apps/piano/config`, then reloads the kiosk's config.
Because the press timestamps travel the same input path the grader reads, the
measured value covers output latency and input lag together. Math:
`PianoKiosk/clickCalibrationMath.js`; screen: `PianoKiosk/ClickCalibration.jsx`;
write: `PianoKiosk/pianoConfigWrite.js`. Logs:
`piano.click.calibration.start` / `.result` (matched, presses, medianMs,
spreadMs, spreadKind, canSave, reason) / `.save` / `.save-failed`.

```yaml
# data/household/piano/config.yml
pianos:
  {pianoId}:
    timing:
      clickLeadMs: 280   # written by Click timing; null/absent = not measured
```

## Config (`piano.yml` → `sheetmusic:`)

Resolved (with defaults) by `sheetMusicConfig.resolveSheetMusicConfig`:
```yaml
sheetmusic:
  defaultMode: listen   # optional; naming it turns off "open in Learn" (see Modes)
  perform: { advancePedalCC: 67, backPedalCC: 66 }
  scoring:
    silentMeasuresToStop: 4     # Polish auto-stop
    timingToleranceMs: 80       # inside this = on-beat
    thresholds: { green: 0.9, yellow: 0.6 }   # combined note+timing score
  learn:
    defaultHands: both          # both|rh|lh — household default; per-user overrides in preferences
```

The hand preference resolves user → household → `both`; if the preferred
hand's staff has no notes anywhere in the piece, the resolver falls back to
whichever hand(s) actually have content rather than landing the player on a
silent, undeadlockable staff.

## Practice record (`users/{id}/apps/piano/practice/`)

`GET`/`PUT` (merge-on-write, same pattern as preferences) at
`api/v1/piano/users/{user}/practice/{scoreKey}`, one YAML file per user per
score:

```yaml
fingerprint:                                # invalidation: content mismatch → discard record
  version: 2
  measureCount: 24
  xmlBytes: 48213
  contentSha256: "…"                       # SHA-256 of the exact MusicXML
measures:            # keys are measure INDICES (0-based) — never XML numbers
  "4": { rh: {attempts: 3, passes: 2}, lh: {attempts: 1, passes: 0}, both: {attempts: 0, passes: 0} }
polish:               # tier bests keyed by hands bucket — an RH-only run never overwrites a both-hands best
  both: { slow: 78, medium: 84, full: 61, overclocked: null }
  rh: { slow: null, medium: null, full: 95, overclocked: null }
  lh: { slow: null, medium: null, full: null, overclocked: null }
updatedAt: …
```

A guest or walk-up with no selected user never reads or writes this endpoint —
the frontend gate skips the call entirely, and the backend rejects a
non-roster user with 400 if it were ever called anyway.

## Note geometry fallback

Per-notehead boxes come from `osmd.EngravingRules.GNote(note).getSVGGElement()`
measured relative to the cursor's `offsetParent` (same coordinate space as the
cursor). If that's unavailable for a note it falls back to the cursor-band box
(coarser, per-step). `notation.geometry` logs the hit/fallback split — if
`graphical` is ~0, per-notehead precision isn't working and the light-up is
running on the per-step fallback (keyboard stays note-precise regardless).

## Key files

Piano Hero is a separate MusicXML consumer under
`frontend/src/modules/Piano/PianoHeroGame/`. Its score picker reuses the
configured `sheetmusic.collections` tabs without repeating the route-level
title. The selected collection is the single game-owned URL segment after
`/piano/games/hero`; changing tabs replaces that segment rather than appending
another game id. During play, completed targets burst and vanish; expired targets pulse
bright red before fading so success and failure cannot be confused at a
glance. Reduced-motion clients keep the same semantic distinction with a
short dissolve and a persistent red miss state. An audio-clock metronome is on
by default during Hero play and can be toggled in the HUD; its beat grid is
phase-aligned to the score lead-in and uses the MusicXML time signature to
accent each measure's downbeat. A household may default it off with
`games.hero.metronomeDefault: false`. The HUD BPM opens the shared Producer
`TempoSheet` between runs; choosing a BPM rescales Hero target onsets and note
durations while preserving the fixed lead-in. Tempo is intentionally locked
during an active run so the judge and falling highway cannot jump timelines.

| File | Role |
|------|------|
| `SheetMusic.jsx` | routing (grid ↔ viewer), MusicXML fetch + load timing |
| `Piano/performance/assessmentSession.js` | Public canonical expectation, immutable attempt lifecycle, runtime, criteria, verdict, part, and span API |
| `Piano/performance/assessmentAttempt.js` | Pure cursor/timed/held implementation used by Learn and Polish |
| `Piano/performance/assessmentRuntime.js` | MIDI/clock external-store binding; never renders or persists |
| `Piano/performance/attemptEvidence.js` | Shared evidence builder, attempt client, and persistence telemetry projection used by Learn, Exercises, and Gaming |
| [performance-assessment.md](./performance-assessment.md) | Overview of the shared performance service (grading, matching, spans) |
| `ScoreGrid.jsx` / `scoreGroups.js` | score browser grid + `sheetmusic.collections` → tab strip |
| `scoreTitle.js` | filename → title fallback shared by the grid and the player |
| `ScorePlayer.jsx` | orchestrator: modes, the Learn state matrix, transport, overlays, telemetry wiring |
| `ScoreTransportBar.jsx` | pinned bottom bar (presentational, three-zone grid) |
| `ModeSheet.jsx` | header mode crumb's Listen/Learn/Polish/Perform picker |
| `HandsControl.jsx` | icon-only left/right-hand toggle, one semantic in every mode (grand-staff scores) |
| `StaffDimLayer.jsx` | fades deselected staves by classing the engraving's own per-staff group |
| `learnRange.js` | pure auto-range heuristic for the Learn landing (frontier → section → density → fallback) |
| `passageRail.js` | pure rules for the passage rail and board: tiles, the button's target, the count, the goal counters, the gem offer |
| `PassageRail.jsx` / `PassageBoard.jsx` / `PassageRail.scss` | the rail under the score and the board that slides over it |
| `passageChime.js` | the chime for a passage or a whole piece turning Silver or Gold, played by the drill's ceremony |
| `usePieceGemOffer.js` | asks the Gem Board whether a piece gem is on offer |
| `server/application/PianoPieceLog.mjs` | dated whole-piece Silver and Gold, and the Polish gem and diamond, read by the `piano-piece`, `piano-polish-gem` and `piano-polish-diamond` milestones |
| `server/application/PianoPolishReward.mjs` | judges a reported Polish run for the piece gem and diamond and notes them in the piece log |
| `usePracticeRecord.js` / `practiceKey.js` | per-user practice-history hook + score-key/hands-bucket helpers |
| `assessmentProjections.js` | Sheet-only Polish tally and worst-range display projections |
| `LearnInkLayer.jsx` | wrong-note wet ink drawn at the played pitch, on the score |
| `LiveInputLayer.jsx` | the notes being held right now, drawn in the cursor column |
| `inputKind.js` | whether a held pitch reads as a match, a ghost, or nothing |
| `measureAtPoint.js` | armed-tap → nearest-measure hit-testing |
| `polishTiers.js` | pure tempo-tier math: bucket, run score, overclocked extra credit |
| `RangeHandleLayer.jsx` | draggable in/out range handles on the score (tap-to-arm or drag) |
| `../../transport/LoopGroup.jsx` | shared mark-in/mark-out/toggle/clear loop cluster (also used by the video chrome) |
| `../../transport/ToggleSwitch.jsx` | shared switch primitive (View sheet's keyboard row) |
| `ViewSheet.jsx` | size/keyboard-visibility sheet (controls only, no metadata) |
| `systemPaging.js` / `useSystemPaging.js` / `ScorePager.jsx` | the score as pages of whole systems: the cuts, the page that follows the cursor, and the turner |
| `../../transport/` | shared transport primitives: the button, sheet shell, direct-pick step ladder, and the Key/Tempo/Volume sheets themselves |
| `../../icons/Icon.jsx` | shared inline-SVG icon set for all chrome buttons |
| `nearestEvent.js` | tap→note mapping used for cursor seek |
| `scoreSettings.js` | per-score localStorage persistence |
| `NoteHighlightLayer.jsx` / `MeasureGradeLayer.jsx` | per-notehead chips / per-measure R/Y/G washes |
| `FocusRangeLayer.jsx` | loop range's per-system tint band |
| `countIn.js` / `useCountIn.js` | count-in beats before a run |
| `clickScheduler.js` | look-ahead scheduling for the metronome click; anchored grid (`anchorEpochMs`/`leadMs`) + `epochToContextMap` |
| `clickLead.js` | `resolveClickLead` (config › browser › none) and the `piano.click.anchored` log helper |
| `RunSummary.jsx` | Polish end-of-run summary, extended with run score/tier + tier-best strip |
| `activeParts.js` / `focusRange.js` | staff-responsibility model / practice-range math, including the next step the active hands actually play |
| `useLearnAssessmentProjection.js` | Binds Learn MIDI to the canonical runtime and projects classified events into range-aware cursor movement; owns no matcher state |
| `useScoreEvaluator.js` | Polish timed-attempt lifecycle and canonical measure-span closure |
| `assessmentProjections.js` | Sheet-only Polish tally and worst-range projections |
| `useMetronomeClick.js` / `click.js` | click scheduler hook (optional `anchorMs`/`leadMs`) / WebAudio blip |
| `pedalEdge.js` | Perform pedal rising-edge |
| `sheetMusicConfig.js` | `sheetmusic:` config resolver (modes, pedals, scoring, hand preference) |
| `useScoreTransport.js` | rAF playback engine (+ `onFire` jitter) |
| `useScoreTelemetry.js` / `scoreTelemetry.js` | logs-only telemetry + session log / math |
| `playParts.js` | Listen's active-hands performance timeline |
| `../../MusicNotation/parseMusicXml.js` | parser + `extractSections` (rehearsal marks) |
| `../../MusicNotation/model/spellMidi.js` | key-aware MIDI → notated-pitch spelling, used by the wet-ink layer |
| `../../MusicNotation/renderers/osmdRender.js` | OSMD adapter: engrave, sliced extract, per-staff geometry, transpose, measure model |
| `../../MusicNotation/renderers/MusicXmlRenderer.jsx` | React wrapper: paint-first + progress + transpose |

Design/history: `ops:docs/plans/2026-07-03-sheet-music-overhaul.md` (infra),
`ops:docs/plans/2026-07-03-sheet-music-modes-design.md` + `-modes.md` (four modes,
original design), `ops:docs/_wip/plans/2026-07-29-sheetmusic-wave3-design.md`
(wave-3: hands model, Learn state matrix, practice history, wet ink, loop
handles, Polish tiers, Perform cleanup).
