# Sheet Music Player

The piano kiosk's engraved-score mode: browse a folder of scores, open a MusicXML
file, and practice it through a four-mode learning progression with per-notehead
light-up. Lives in `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`,
engraving through the shared OSMD renderer in
`frontend/src/modules/MusicNotation/renderers/`.

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
  step. The **View** menu is the same sheet shell — layout, size, and
  keyboard-visibility controls only, no metadata list; keyboard visibility is
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
| **Learn** | Untimed practice at the frontier of what's been learned | Listen's chrome **plus** the loop group and range handles on the score |
| **Polish** | Real-time scored runs, always whole-piece | Play + count-in · metronome (on by default, persisted) · hand toggles · settings. No looping. |
| **Perform** | The music stand | Zero chrome; the left pedal turns pages |

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
| **Range + loop ON** | Disabled — "Learn advances as you play" | You (the follow tracker) | Silent | Gate active: wrong notes shake + red ink |
| **Range + loop OFF** | Enabled | Transport, whole piece | Performs active hands | No gate; neutral wet ink |

Play is enabled exactly when the loop is off — the follow tracker and the
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
whole measure on release. Dragging near the top or bottom edge of the score's
scroll container auto-scrolls, so a range can be dragged across a page without
lifting the finger; the drag never hijacks the page scroll itself (pointer
capture is scoped to the handle alone). Section starts render as snap markers
while an endpoint is being armed or dragged, and rehearsal sections in the
Loop sheet still offer a one-tap "loop this section" shortcut.

**In Learn, the in/out buttons show their measure numbers** (`m5` / `m8`)
once a range exists.

## Practice history

Progress is tracked per user, per score, and read back to drive the Learn
auto-range and the Polish tier bests:

- A **guest / no selected user is exempt** — the practice heuristics run
  history-less, and nothing is read or written on their behalf. Only a
  persistent (roster) user's practice is ever recorded.
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
  frontier) once it has accumulated **three passes** for the relevant hands
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

Polish grades through the shared performance service as of
`polish-shared-grading-v1` (`scoreEvaluator.js`). It previously computed the same
dimensions under its own names and combined them multiplicatively, so a polish
score and a lesson-drill score could not be compared even though both claimed to
mean "how well did that go". Adopting the service moved the numbers, which is
why results carry that policy version — records written under the old maths stay
distinguishable. Ordered grading also counts *missed* notes now: a drill advances
only on the correct note and so cannot leave one unplayed, but a timed score can
be played straight past, and a note never struck has to cost something. Polish's
forgiving timing curve moved into the service as `timingQualityFromDrift` — 80ms
free, falling to zero by 400ms — so polish and beat-relative grading are one
formula with different numbers rather than two implementations.
See [performance-assessment.md](./performance-assessment.md).

Polish uses the same renderer-independent performance judge as Piano Hero.
The score is compiled into exact onset targets after the tempo map, tempo
multiplier, and active-staff filter are applied. Repeated pitches remain
separate attacks, simultaneous pitches are judged as a chord, early/late drift
is measured against the expected onset, and unmatched notes reduce accuracy.
Polish then aggregates those target results by measure into its existing
red/yellow/green washes and run summaries; Hero separately adapts them into
points and combos.

**Tempo tiers.** A run is bucketed by the tempo it was played at, decided the
instant the run starts: **slow** (under 80%), **medium** (80–99%), **full**
(exactly 100%), **overclocked** (over 100%). Changing the tempo mid-run voids
that run's tier — the summary labels it "mixed tempo" and it competes for no
best, though the live grading still shows. **Overclocked runs earn extra
credit**: the displayed/stored score is the base score scaled up, and can
exceed 100 — that's the reward for playing faster than written.

> The multiplier is under review. The
> [rubric design](../../_wip/plans/2026-08-12-assessment-rubric-design.md)
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
or waiting on a zoom/flow/key re-engrave — reaches the end of the piece but
banks nothing; the summary still shows its score. Pausing itself is fine:
picking the same run back up at the same tempo on the same hands is still one
whole-piece run. Because a best only ever improves, an inflated one would be
permanent, so the gate errs toward withholding — and every withheld bank names
its reason in the log.

## Perform

Zero chrome, by design — nothing on screen but the engraved page. The left
pedal turns pages forward, the other back (config-driven CC numbers, rising-
edge detected so a held pedal doesn't repeat-page); a tap can also scroll the
page into view. There is no page indicator and no other control surface —
mode-switching still works through the header's mode crumb, the one thing
that's never hidden.

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
| `score.follow.timing` | sampled | `step, note, sinceAdvanceMs` (how long the player took to answer the cursor — no verdict) |
| `score.follow.stats` | info | `hits, wrongs, count, medianStepMs, p95StepMs` (on leaving Learn) |
| `score.learn.auto-range` | info | `inMeasure, outMeasure, reason` — the landing heuristic's pick and which rule produced it |
| `score.learn.cycle` | info | a completed or voided gate cycle, feeding the practice record |
| `score.learn.stuck-prompt` / `-resolved` / `-dismissed` | info | the 3-wrong reveal-keys assist arming and clearing |
| `score.learn.complete` | info | a clean gated pass covered the whole piece — the completion card is offered (Learn handing off to Polish) |
| `score.loop.arm` / `score.loop.arm-expire` | info | an endpoint armed for the next tap, or the arm expiring unused |
| `score.loop.set` | info | `edge, measure, via, snapped` — an endpoint committed, by tap or drag |
| `score.loop.on` | info | the loop toggled on/off |
| `score.focus.set` | info | `kind, inMeasure, outMeasure, origin` — a range established (auto-range, section pick, or handle/tap) |
| `score.focus.clear` | info | the range cleared |
| `score.polish.measure` | info | `measure, grade, noteScore, timingScore` (per graded measure) |
| `score.polish.silent-stop` | info | the run auto-stopped after N silent measures |
| `score.polish.summary` | info | `greens, yellows, reds, overall` (at run end) |
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

## Config (`piano.yml` → `sheetmusic:`)

Resolved (with defaults) by `sheetMusicConfig.resolveSheetMusicConfig`:
```yaml
sheetmusic:
  defaultMode: learn
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
fingerprint: { measureCount: 24, xmlBytes: 48213 }   # invalidation: mismatch → discard record
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
| `Piano/performance/performanceTargets.js` | Shared tempo-resolved target compiler |
| `Piano/performance/performanceJudge.js` | Shared pure note/chord hit and miss matcher |
| [performance-assessment.md](./performance-assessment.md) | Overview of the shared performance service (grading, matching, spans) |
| `ScoreGrid.jsx` / `scoreGroups.js` | score browser grid + `sheetmusic.collections` → tab strip |
| `scoreTitle.js` | filename → title fallback shared by the grid and the player |
| `ScorePlayer.jsx` | orchestrator: modes, the Learn state matrix, transport, overlays, telemetry wiring |
| `ScoreTransportBar.jsx` | pinned bottom bar (presentational, three-zone grid) |
| `ModeSheet.jsx` | header mode crumb's Listen/Learn/Polish/Perform picker |
| `HandsControl.jsx` | icon-only left/right-hand toggle, one semantic in every mode (grand-staff scores) |
| `StaffDimLayer.jsx` | fades deselected staves by classing the engraving's own per-staff group |
| `learnRange.js` | pure auto-range heuristic for the Learn landing (frontier → section → density → fallback) |
| `usePracticeRecord.js` / `practiceKey.js` | per-user practice-history hook + score-key/hands-bucket helpers |
| `LearnInkLayer.jsx` | wrong-note wet ink drawn at the played pitch, on the score |
| `LiveInputLayer.jsx` | the notes being held right now, drawn in the cursor column |
| `inputKind.js` | whether a held pitch reads as a match, a ghost, or nothing |
| `measureAtPoint.js` | armed-tap → nearest-measure hit-testing |
| `polishTiers.js` | pure tempo-tier math: bucket, run score, overclocked extra credit |
| `RangeHandleLayer.jsx` | draggable in/out range handles on the score (tap-to-arm or drag) |
| `../../transport/LoopGroup.jsx` | shared mark-in/mark-out/toggle/clear loop cluster (also used by the video chrome) |
| `../../transport/ToggleSwitch.jsx` | shared switch primitive (View sheet's keyboard row) |
| `ViewSheet.jsx` | layout/size/keyboard-visibility sheet (controls only, no metadata) |
| `../../transport/` | shared transport primitives: the button, sheet shell, direct-pick step ladder, and the Key/Tempo/Volume sheets themselves |
| `../../icons/Icon.jsx` | shared inline-SVG icon set for all chrome buttons |
| `nearestEvent.js` | tap→note mapping used for cursor seek |
| `scoreSettings.js` | per-score localStorage persistence |
| `NoteHighlightLayer.jsx` / `MeasureGradeLayer.jsx` | per-notehead chips / per-measure R/Y/G washes |
| `FocusRangeLayer.jsx` | loop range's per-system tint band |
| `countIn.js` / `useCountIn.js` | count-in beats before a run |
| `clickScheduler.js` | look-ahead scheduling for the metronome click |
| `RunSummary.jsx` | Polish end-of-run summary, extended with run score/tier + tier-best strip |
| `activeParts.js` / `focusRange.js` | staff-responsibility model / practice-range math, including the next step the active hands actually play |
| `useFollowTracker.js` | Learn matching + advancement (range-aware, skips steps the active hands are silent at) |
| `useScoreEvaluator.js` / `scoreEvaluator.js` | Polish per-measure grading hook / math |
| `useMetronomeClick.js` / `click.js` | click scheduler / WebAudio blip |
| `pedalEdge.js` | Perform pedal rising-edge |
| `sheetMusicConfig.js` | `sheetmusic:` config resolver (modes, pedals, scoring, hand preference) |
| `useScoreTransport.js` | rAF playback engine (+ `onFire` jitter) |
| `useScoreTelemetry.js` / `scoreTelemetry.js` | logs-only telemetry + session log / math |
| `playParts.js` | Listen's active-hands performance timeline |
| `../../MusicNotation/parseMusicXml.js` | parser + `extractSections` (rehearsal marks) |
| `../../MusicNotation/model/spellMidi.js` | key-aware MIDI → notated-pitch spelling, used by the wet-ink layer |
| `../../MusicNotation/renderers/osmdRender.js` | OSMD adapter: engrave, sliced extract, per-staff geometry, transpose, measure model |
| `../../MusicNotation/renderers/MusicXmlRenderer.jsx` | React wrapper: paint-first + progress + transpose |

Design/history: `docs/plans/2026-07-03-sheet-music-overhaul.md` (infra),
`docs/plans/2026-07-03-sheet-music-modes-design.md` + `-modes.md` (four modes,
original design), `docs/_wip/plans/2026-07-29-sheetmusic-wave3-design.md`
(wave-3: hands model, Learn state matrix, practice history, wet ink, loop
handles, Polish tiers, Perform cleanup).
