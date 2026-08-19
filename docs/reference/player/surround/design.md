# Surround visual design — concert-hall

> Design tokens and rules for the `concert-hall` surround. Implementers follow
> this exactly; it is what keeps four separately-built modules coherent.

## Thesis

**The surround is the printed programme in your hands while the concert plays.**

Not a gallery wall — that is ArtMode's metaphor, and copying it would make the
concert look like a painting. This is a darkened auditorium with a lit programme
held beside the stage. The video is the stage; everything around it is paper,
brass and ink.

The house aesthetic continues (Garamond, brushed brass, deep velvet — see
`screen-framework/widgets/ArtMode.css`), but the ground inverts: ArtMode is a
light matte board in a lit room; this is warm ink dark with lit programme panels.

## Color

| Token | Hex | Role |
|---|---|---|
| `--hall-ink` | `#14100c` | The darkened auditorium. Frame ground behind everything. |
| `--programme` | `#efe6d2` | Printed programme stock. Rail and footer panels. |
| `--programme-edge` | `#ddd0b4` | Paper edge / fold shadow. Hairline rules on stock. |
| `--velvet` | `#4a1018` | Seat velvet. The lit end of the stage's curtain ramp, and the house's accent colour elsewhere. |
| `--brass` | `#c79a3e` | Brushed brass. The playhead, plaque rules. |
| `--brass-lit` | `#f6e3a0` | Lit brass highlight — the leading edge of the playhead. |
| `--ink` | `#2a1d07` | Primary text on programme stock. |
| `--ink-soft` | `#6b6152` | Labels, secondary data, elapsed movements. |
| `--mat` | `#1d0f11` | The mat every picture is mounted on. Near-black warm brown. |
| `--mat-edge` | `rgba(8,5,5,.9)` | The mat's 1px definition line, so an image never bleeds into the panel. |

Velvet and brass are accents. If a screenshot reads as mostly red or mostly gold,
it is wrong.

## Type

Two Garamonds for everything the programme says, and one sans for everything the
programme *glosses*.

- **Cormorant Garamond** (already loaded by ArtMode) — display. Piece title,
  composer name, movement names. *Italic for tempo markings*, because that is how
  engraved scores actually set them.
- **EB Garamond** — body. Fact ticker, programme notes.
- **A condensed system sans** (`--surround-annotation`) — the ANNOTATION voice,
  and only that: the translation of a tempo term, wherever one appears. It is
  the editor speaking rather than the programme, and in an all-serif frame the
  only way to say so is to change the face. A smaller, greyer Garamond reads as
  quieter Garamond. Condensed because a gloss lives in a narrow column.
- **Labels** are letterspaced small caps of the display face (`0.14em`), the way
  concert programmes set section headers. Not a fourth typeface.

**Quotes are typographic, everywhere, without exception.** A straight `'` is a
typewriter mark that no serif face was ever cut for; in Garamond the engine
substitutes a vertical tick that reads as a standing hyphen, and on parchment at
ten feet it is the one thing on the screen that looks unset. Every authored
string the frame prints — the plate's title and provenance, the composer's name,
birthplace, era and facts, movement names and their glosses, listening notes,
cues, captions, the standing label — is curled at its **render seam** by one
shared helper. Not in the corpus: the corpus is data a human edits by hand, and a
migration would have to be re-run after every edit. The transform is idempotent,
it never touches feet-and-inches primes, and it makes no conversion the corpus has
no input for (there are no double hyphens in it, so there is no em-dash rule).

Scale, tuned for a 10-foot living-room read at 1920×1080:

| Role | Size | Weight |
|---|---|---|
| Piece title | `2.05rem` | 600, italic — the headline of the screen |
| Piece provenance (under it) | `0.85rem` | 600, small caps, one line |
| Composer name (brass plate) | `1.75rem` | 600, measure capped at `12ch`, up to 3 lines |
| Movement name (active) | `1.05rem` | 600, italic for the tempo term |
| Movement translation | `0.74rem` | 400, annotation sans, one line, or two wherever the segment can afford it, 0.55 alpha |
| Ticker body (both zones) | `clamp(0.88rem, 16cqh, 1.5rem)` | 500, 1, 3, or 4 lines reserved |
| Listening band now-header | `0.78rem` | 600, display face, one line |
| Composer period | `0.72rem`, `0.12em` tracking | 600, uppercase, up to 2 lines |
| Era timeline names | `0.72rem`, `0.12em` tracking | 500/600, uppercase, dropped not shrunk |
| Era period note | `clamp(0.76rem, 3.6cqw, 0.95rem)` | 500, body face italic, 4 lines max |
| Rail fact | `clamp(0.85rem, 5.4cqh, 1.35rem)` | 500, body face, 3 lines reserved |

**Two runs of type size themselves against the room they are in.** The cue ticker
and the rail fact both sit in panels whose height is decided by the screen, not by
them — the ticker takes all the band's slack, the fact all the card's — and a
fixed size made both of them fine print in a tall frame and an overflow in a short
one. Each is therefore `clamp(floor, Ncqh, ceiling)` against its own panel as a
size container: 15px / 20px / 24px for the note across the 960×540, 1280×720 and
1920×1080 frames the fleet produces. The floors are the ten-foot floor; the
ceilings are the point at which each would start competing with the work title.
The reserves stay in `em`, so they follow the clamp instead of being a second
number to re-derive. Everything else in the table is fixed: a size that adapts is
a decision, not a default.

**Where the band cannot pay, the LAYOUT adapts too, not the type.** The listening
band's two registers need one line of header and up to four of note; the room for
that is not the same screen to screen, so the ticker's own size container carries
two queries. Below 88px of content the reserve is a single line and the
now-header's translation is dropped — the 960×540 screen-root leaves it barely
forty pixels once a movement's name has wrapped and its gloss has been paid for.
At or above 88px both come back, three lines deep — the room the 1280×720 kiosk
actually has. At or above 161px — comfortably clear of 1920×1080's own budget,
nowhere near the fleet's smaller screens — a fourth line joins them: a real
authored fact (the Eroica's Napoleon note, 224 characters) still needed a fourth
line even at three, and a genuinely long fact can still run past four — the
wrap-or-ellipsis law still governs that case, same as everywhere else. Shrinking
the type instead would have broken the ten-foot floor, and budgeting the tall
screen's reserve everywhere would have overflowed the small one.

**The movement map and the ticker share one budget, and the map is the one that
grows.** Where a movement's name and its translation both need two lines on the
same narrow segment, the band's own height grows to hold them — the map has no
ceiling — and every pixel of that growth comes out of the ticker's slack, not out
of thin air. The two modules' thresholds are tuned together against that shared
arithmetic, so the ticker's three-line tier survives the map's worst case at
1280×720 with a couple of pixels to spare, and the smallest screen in the fleet
keeps both modules at their safe, single-line floor rather than let either
overflow the frame.
| Map — subject country | `0.9rem`, `0.2em` tracking | 600, uppercase |
| Labels / data / map neighbours | `0.72rem`, `0.14em` tracking | 600, uppercase |

## Layout

```text
┌───────────────────┬───────────────────────────────────────────┐
│ RAIL 33%          │         ┌────────────┐                    │
│  composer card    │         │WORK PLACARD│ ← floats,          │
│                   ├────────┴────────────┴────────────────────┤
│ [mat] ANTONIO     │                                           │
│       VIVALDI     │     VIDEO — locked 16:9                   │
│       1678–1741   │     letterboxed on ink                    │
│       Venice      │                                           │
│                   │                                           │
│  fun fact,        │                                           │
│  centred          │                                           │
├───────────────────┤                                           │
│  place carousel   │                                           │
│  photo ⇄ country  ├───────────────────────────────────────────┤
│  ⇄ city ⇄ era,    │  movement map — rule on top, names below, │
│  all 5:3          │  each name glossed by its translation     │
│                   ├─────────────────────┬─────────────────────┤
│                   │  the piece:         │  now: II. Largo     │
│                   │  rotating facts     │  what to listen for │
└───────────────────┴─────────────────────┴─────────────────────┘
```

The video is TOP-anchored and the work placard FLOATS out of flow, hung on the
video's top edge as a content-width museum plate — **two thirds on the hall above,
one third over the picture** (`--placard-straddle`). A plate is pinned to the wall
the painting hangs on; it overlaps the frame, not the canvas. The hall strip above
it (`--placard-inset`) is sized to hold that two thirds with ~12px to spare, so
the plate never reads as cropped by the frame's own edge. The bottom band spans exactly
the video's width — so it reads as that video's timeline, not as page furniture —
and rides up over the video's last ~10px so the join is one edge, not two boxes
meeting. The rail runs full height because it carries identity, not progress, and
is placed on the LEFT at 33% (`regions.right[0].side: left`); the region KEY is
still `right`.

The rail holds two regions, neither with a declared height, so they split it and
the geometry follows the viewport:

- **composer card** — a header ROW (portrait in its dark mat at 45% of the rail
  on the left; the brass nameplate carrying the NAME and the dates engraved
  together, with the birthplace in parchment under it, in the column to its
  right, and the PERIOD under that) and, centred in the height the header leaves,
  the rotating composer fact. The name is set to a capped MEASURE and breaks at
  word boundaries — "Antonio" over "Vivaldi" — because an engraved plate uses the
  vertical rather than shrinking its type to one line. The period is
  `piece.period ?? composer.period`: a composer's era and a work's era are not
  always the same claim, and beside the Eroica the work's answer ("Classical to
  Romantic") is the true one. It is rail voice, not engraving — a plate carries
  the record, and an era is an editor's classification.
- **place carousel** — four slides in one 5:3 slot, dissolving in turn: the city
  photograph, the country at regional zoom, the same map zoomed so the country's
  own shape fills the frame around the city's star, and the era timeline. Three
  questions asked in order — where is that country, where in it, and when — with
  the only non-place slide last. The card owns the person, the carousel owns the
  place and the period.

Every picture in the frame is mounted on the same DARK mat (`--mat` with a
`--mat-edge` hairline). A cream mat on the maroon rail reads as a white border —
the brightest, most distracting mark on a screen whose subject is the video.

Pictures are NEVER cropped. `object-fit: cover` is banned in the rail: a portrait
is a picture of a person, and a narrow column is not a reason to guillotine one.

**The hall wears velvet.** Every pixel of the stage the video does not cover — the
strip above it the placard hangs on, and the letterbox slack beside it on a screen
too narrow for a full-width 16:9 — is a deep burgundy drape with vertical fold
stripes: ArtMode's curtain recipe (`ArtMode.css`) taken two registers down, static,
with the ramp's lit end at `--velvet` and a vertical shade towards the video's
edges. It is scenery, not a curtain call: dark enough that the plate and the
picture stay the brightest things in the room. Only the stage wears it — the media
box keeps its black, the rail its oxblood, the band its stone, the plate its
stone.

**And it bleeds into the picture.** The band already dissolves upward into the
video's foot; the drape above it met the picture on a dead-level line, so the
video read as a rectangle cut out of a curtain rather than as something the
curtain hangs in front of. A veil of the SAME cloth — the same fold stripes at
the same phase, the same ramp across the same width — lies on the video's top
edge and is masked to nothing a short way in. Its depth is derived from the
placard's straddle: the plate overlaps the picture by a third of its own height,
and the veil reaches a little over half of that overlap. It is a veil, never a
change to the box: the video keeps its width, its height, its 16:9 lock and every
pixel below the veil's reach, and it cannot intercept a tap.

**The band's regions are sized to their contents.** The movement map claims the
rule lane, one line of name and one line of gloss — a constant height at every
screen and for every piece, because nothing on the rail wraps. ALL the band's
remaining height belongs to the ticker, which centres its notes in it. A floor
larger than that would be dead black between the names and the note, not
breathing room.

**The band's text zone is two registers, divided by a hairline.**

- LEFT, **the piece**: the untimed `facts` pool, rotating slowly. True at 0:00
  and at 53:00; it does not care where the playhead is.
- LEFT also carries the work's **standing label** — `piece.short_title`, the
  work's own alternate name ("Beethoven's Third Symphony"), at the ten-foot
  floor in tracked small caps. Without one the zone read as orphan prose. Where
  the corpus authors no short title the zone renders **no header at all**: a long
  title cut down to fit is a wronger claim about the work than saying nothing.
  The label is fixed — it never takes the bond's ground and never moves with
  progress.
- RIGHT, **now**: that movement's `listen` notes — what to listen for in the next
  three minutes. It does **not** print the movement's heading: the rail six inches
  above already sets it, and the BOND (below) is what says which movement this
  register belongs to. `band.nowHeading` brings the heading back where the rail
  has none of its own. A movement change swaps the pool and restarts it at its
  first note. A **timed cue** interrupts this register, and only this one: a cue
  is the same kind of claim, pinned to a second rather than to a movement. A
  movement with no authored notes borrows the piece pool — never empty paper.
- **Which register sits on which side is configurable** (`band.nowSide`): right
  by default, left, or `dynamic` — dynamic keeps the NOW register on the same
  side of the band as the sounding segment, so the bond stays short. The
  crossover is at half-way with a hysteresis band below it, so a scrub sitting on
  the mark cannot flap the layout. The swap is a considered move: the panel
  slides across the band while the registers' text dissolves — and both halves
  of the bond read the same elapsed fraction, measured from the FIRST MOVEMENT
  rather than from the top of the file, so they can never point at opposite
  sides of the screen.
- The two rotations are **phase-offset by half a period**. Both play the house
  dissolve, and two of those in one instant reads as the whole band blinking.
- A piece with no movements does not split at all: there is no "now" to give a
  register to, so the band stays one full-width zone and cues preempt it.

## The bond: the relationship, drawn

The NOW register used to print the sounding movement's heading directly beneath a
rail that had just printed it. Two surfaces, one sentence, six inches apart.

The relationship is **visual** instead. The sounding segment on the rail carries a
lifted panel ground; the NOW register carries the **same** ground; and a connector
runs along the band's seam from one to the other, so the two read as one
continuous, stepped shape. Where the segment already sits over the register the
two simply touch and there is no connector to draw. The eye follows the bond from
the rule down into the register, and the movement never has to be named twice.

- **One ground, one token.** `--bond-ground` is published by the frame on the
  band's region and read by both modules. Two panels a few percent apart in
  colour stop being one object.
- **The panel is a few points lighter than the band**, in the same warm
  parchment/ink family — enough to separate at ten feet, not so much that the
  band grows a second surface competing with the brass rule.
- **It TRAVELS.** One element that moves to the sounding movement, not a
  per-segment background that lights and unlights: a highlight that travels is
  followed, and being followed is the whole mechanism.
- **It is state, not motion.** Under `prefers-reduced-motion` the bond still
  moves to the sounding movement and to the configured side; it simply arrives
  in one frame. Both halves are guarded — a guard on one half only would tear
  the shape apart for the length of the other half's slide, which is worse than
  no guard at all.
- The panel rounds at its **head** (the top of the rail's segment) and at its
  **foot** (the bottom of the register), and squares off everywhere the shape
  continues. A radius in the middle of one object draws a seam across it.

## Signature: the movement map as engraved score

**This is the one memorable element. Spend the boldness here and keep everything
else quiet.**

The movement map is not a progress bar. It is set as the barline grammar of
engraved music: a single hairline staff rule, with movements separated by **double
barlines** — which is what actually marks a movement end in notation. Each
movement is a segment proportional to its real duration.

```text
 ╷                    ╷              ╷        ╷                    ╷
 │  I. Allegro con brio│ II. Marcia funebre│ III. Scherzo│ IV. Finale     │
 ╵━━━━━━━━━━━━━━━━━━━━╵━━━━━▮─────────╵──────────────╵────────────────────╵
                            ▲ brass playhead
```

- The band is part of the darkened house, not the programme: near-black stone
  with the text in parchment (the region re-maps `--ink` / `--ink-soft`).
- The RULE ROW sits at the **top** of the band, riding inside the footer's own
  upward overlap so it reads as the video's baseline rather than as a bar
  floating in a strip of black. The movement names hang **below** it.
- Progress is read from the FILL, not from the cursor: each movement's bar
  carries its own elapsed fraction. The yet-to-come lane is `--ink-soft` at 2px
  and visible — it is the shape of the whole piece, and a viewer who cannot see
  it is being shown a position with no context. Elapsed = 2px of full parchment
  over that lane, active = 4px brass. The active bar is the loudest mark in the
  frame, because "how far through *this* movement are we" is what the viewer
  actually wants.
- The playhead is a 2px brass hairline in the rule lane. No glow, no lit tip.
  Its lane and the names never meet, box and all.
- One quiet separator between movements, not a double barline.
- A future movement's name is brighter than an elapsed one's: what is coming is
  context the band exists to give, what is gone is not.
- Movement names sit **below** the rule, tempo term in italic, on **one line**.
- Under each name, where one is authored, the **translation** of its tempo term
  — "Allegro con brio" → *Fast, with spirit*. Annotation sans, one line, and it
  recedes with an elapsed movement without ever being brightened for the
  sounding one.
- **The numeral has its own gutter.** `III.` is an index mark, not the first word
  of the title, so it lives in a fixed-width track to the LEFT of the segment's
  text column, right-aligned in it with a constant gap to the name. Heading and
  gloss both start at the text column's edge, so a gloss can never begin under
  the numeral. The track is sized ONCE PER RAIL, from the longest numeral the
  piece has, so every segment on one rail shares a text edge. The mark is set in
  small caps with lining figures at a low opacity — it is an ordinal, not
  content — and comes up only on the sounding movement.
- **THE ACCORDION.** Everything on the rail is one line with an ellipsis while
  it is not sounding. When a movement becomes active its segment **widens** until
  its heading and its gloss each fit whole on one line; its neighbours compress
  in proportion to their own durations, down to a measured floor (enough for the
  numeral, three glyphs and the ellipsis), and keep their ellipses. Where the
  ideal width would starve them the active segment takes what is free and keeps
  its own ellipsis — degrade, don't break.
  The time scale is therefore **not uniform**, and that is accepted: the playhead
  runs faster through a compressed segment and slower through the widened one.
  What it never does is lie about a boundary — the cursor's position inside a
  segment is that segment's own elapsed fraction, derived from the RENDERED
  widths, so it arrives at a segment's right edge exactly when the music crosses
  it. Under `prefers-reduced-motion` the widths snap.
  **There is exactly one clock.** The widths are interpolated in JS, on the
  frame's own easing, and the segment widths, the playhead, the bond and its
  connector are all published from that one array in the same render. The
  stylesheet animates none of it, and that is the point: a CSS `transition:
  width` would be a second timeline, and a cursor derived from the *target*
  widths while the *painted* boundary is still travelling ends up inside the
  elapsed fill. The bond is the one thing that keeps a CSS transition, because
  it does not track a segment — it travels from the old one to the new one, and
  only its endpoints have to agree.
- No clef, no notes, no staff of five lines. One rule and the barline grammar.
  The restraint is what keeps it from reading as fussy pastiche.

**The last movement's bar must end where the music ends, not at `duration`.** The
Eroica has ~4½ minutes of applause after the final chord; a bar running to the end
of file would tell the viewer the piece is still going.

## Motion

Sparse and slow. This plays behind music; anything busy competes with it.

- **One transition in the whole frame: the dissolve THROUGH the dark.** The
  outgoing content fades fully out to the panel's own ground, the ground is held
  empty for a beat, then the incoming content fades in: `320ms` out, `160ms`
  held, `320ms` in — `800ms` end to end. A cross-fade would be a different
  language, and on a dark ground a short cross-flip reads as a blink. This is
  what the cue/fact ticker, the rail's composer fact and the place carousel all
  play; the constants live in ONE file (`Surround/dissolve.js`) so they cannot
  drift apart.
- Nothing may move while a dissolve runs an empty beat, so every dissolving slot
  RESERVES its box: the ticker two lines, the rail fact three, the carousel one
  5:3 plate and a fixed caption box.
- Rotation beats are coprime on purpose — ticker facts `20s`, composer facts
  `27s`, carousel slides `12s` — so two panels almost never swap in one instant.
- The playhead and the movement fills glide on `120ms linear` — one 10 Hz tick.
  No easing, no trail. Both move on a **transform** (the cursor translates, the
  fill scales), never on `left`/`width`: the engine pixel-snaps a painted box's
  position and size, and a cursor advancing half a pixel per second on a
  54-minute piece then stands still and jumps a whole pixel at a time. A
  transform carries sub-pixel offsets and actually glides.
- **The frame ENTERS as one gesture — the enrichment moment.** The surround's
  data arrives about a second after the video, so its arrival is a real event on
  screen and is choreographed as one: the VIDEO SHRINKS out of the whole frame
  and into its box (`520ms`) while the rail slides in from its own side, the band
  rises from below (`+110ms`) and the plate settles down onto the picture
  (`+200ms`) — ~620ms end to end, on one easing. The video's shrink is a single
  uniform `scale()` on the media box, which is the only kind of size animation
  that cannot leave 16:9 at any frame of itself, and the media element is never
  remounted or re-parented by it. The stage un-clips for the length of the
  gesture and re-clips after it. Under `prefers-reduced-motion` nothing moves:
  the chrome fades in together and the video is simply in its box from the first
  painted frame.
- Nothing pulses, bounces, or shimmers. Respect `prefers-reduced-motion` by
  dropping the crossfades to instant swaps.

## The map: regional context, engraved

The map answers **"where is that?"**, not "what shape is that country?". A shape
with a star in it tells a viewer who cannot already place the country nothing at
all, so:

- **Two zooms with two jobs, one component.** `region` (pad `2.2`) is the
  default and answers *where is that country*: the subject spans about a third
  of its frame and the rest is a continental view — measured on the real
  geodata, an Austria frame is 24° wide with six countries inside it whole and
  France, Italy, Germany, Poland and Romania named around them. `city` (pad
  `0.12`) answers *and where in it is the city*: the subject's own shape nearly
  edge to edge. Either way the frame is the subject's own bounding box padded
  and widened to the render aspect, with no per-country configuration anywhere.
- **The star belongs to the city zoom.** The regional slide draws no marker and
  no city label at all: it would give away the next slide's answer and drag the
  eye to a 6px mark on a map whose subject is a country among countries. The
  country's own name carries that slide, and its caption is country-scoped. A
  caller that draws only ONE map (the standalone `country-map` region) asks for
  the marker back explicitly.
- **It names what it draws.** The subject in `--ink` at `0.9rem`, its visible
  neighbours in `--ink-soft` at the `0.72rem` floor. A neighbour is named when
  the part of it inside the frame covers at least `14%` of the frame in BOTH
  axes, at most seven of them are named, and a name whose box would collide with
  one already written is dropped — biggest visible country first, so the loser is
  always the one the viewer needs least.
- **It is engraved, never filled.** Hairline borders and washes faint enough to
  tint rather than fill: the subject `--ink` at `0.16`, context at `0.05`. A
  solid country on the dark rail reads as a sticker, not as print. The colours
  are the frame's own ink family, so the map is restyled by the region holding
  it; the region publishes `--map-halo` (its own ground) for the label halos,
  which is the one colour the ink family does not carry.
- On the zoom that shows it, the city's brass star and label are the one thing on
  the map the programme asserts, and the one label that is never dropped.

## The era timeline: when, engraved

The fourth slide answers **"when was this written?"** the same way the map
answers *where* — by drawing a position inside a fixed extent and naming what is
around it, because "Classical" tells a viewer who cannot place the Classical era
exactly as little as a shape with a star in it does.

- One hairline spanning **1550–1910**, divided into four era bands. The dates are
  DATA and they are contestable — 1600, 1750, 1820 and 1910 are conventions
  rather than events — so they live in one exported constant with the argument
  written beside them, not as percentages scattered through a stylesheet.
- The **subject band is brightened**, in weight and value only: `--ink` at double
  the lane's height, never a colour of its own. A period naming two eras lights
  BOTH, because that is what "Classical to Romantic" means — the work sits across
  the join, which is the one thing a timeline can show and a label cannot.
- A **brass hairline** marks the piece's year, with the year written above it.
  The same mark the movement map's playhead is, at the scale of centuries. A year
  outside the span gets no marker rather than a clamped one that would lie.
- **Era names are dropped, never shrunk.** They are set at the `0.72rem` floor,
  and a non-subject name that cannot roughly fit its own band — or that would
  collide with one already written — is simply not drawn: RENAISSANCE appears on
  a 1080p rail and drops on a 540p one. The SUBJECT's name is never dropped, and
  two crowded subjects are spread apart rather than one being discarded.
- The **period note** (`piece.period_note ?? composer.period_note`) sits inside
  the plate beneath the drawing, in the caption's register. Not in the carousel's
  caption slot: that is a two-line reserve shared with every slide, and its fixed
  size is what makes the swap a dissolve. The slide's caption is the work's
  DATING instead — the one thing the plate cannot show.

## Materials, used with restraint

Borrow ArtMode's physical realism, but one plate, not a gallery:

- The rail and the bottom band are part of the darkened house, not the programme:
  both re-map `--ink` / `--ink-soft` to parchment over a dark ground (the band
  near-black stone, the rail deep oxblood, one register warmer, so the two read
  as one house material). The paper fibre stays, multiplied over the maroon, so
  the rail's stock keeps its tooth.
- `--programme` is the programme STOCK — the panels themselves — and is never a
  border round a picture. Pictures are mounted on `--mat` instead: near-black,
  quiet on the maroon, with a dark `--mat-edge` hairline that separates a lit
  image from the ground without competing with it. The brass nameplate is the one
  bright object on the dark wall. No drop shadows on every element.
- The floating work placard is the one element allowed a drop shadow — it sits
  ON the video, so it casts.
- The portrait sits in a single dark mat with a `--mat-edge` hairline; the brass
  belongs to the nameplate beside it, echoing ArtMode's plaque without
  reproducing the screwed-down original.
- Hairlines are `1px`; `--programme-edge` on the stock, `--mat-edge` on a mat.
  No heavy borders anywhere.

## Quality floor

- 16:9 is inviolable — letterbox, never distort.
- Legible at 10 feet: nothing below `0.72rem`, no thin weights on the dark ground.
- Everything degrades to an empty slot: a missing portrait, a piece with no
  movements, a sidecar with no facts. The frame must still look composed.
- `prefers-reduced-motion` honored.

## Band configuration

Three keys on the surround definition (`_surrounds/<id>.yml`), beside `regions`
and `collapse`. Every one of them is optional; the frame resolves and defaults
each independently, so an unauthored — or misspelled — `band` block is the normal
case rather than an error.

```yaml
band:
  nowSide: right        # right (default) | left | dynamic
  nowHeading: auto      # auto (default) | always | never
  railDensity: names    # names (default) | bars
```

| Key | Meaning |
|---|---|
| `nowSide` | Which half of the band the NOW register occupies. `dynamic` follows the playhead — left under half-way, right at and past it, with hysteresis so a scrub on the mark cannot flap the layout — so the bond stays short. |
| `nowHeading` | Whether the NOW register prints the sounding movement's name. `auto` prints it only where the rail does not, which with the shipped rail means never: the rail names the movement and the bond points at it. |
| `railDensity` | What the movement rail itself prints. `bars` gives the **compact rail**: the rule, its barlines, the fills, the bond and the playhead, with no names, glosses or numerals under them, and a floor sized to that rather than to a named rail's. It is also what makes `nowHeading: auto` resolve the other way — with nothing named on the rule, the listening band is the only surface left that can say what is sounding. A definition that turns the rail compact should lower the region's own declared `height` too: a region floor authored in the definition still wins over the module's. |

The corpus field the band consumes is `piece.short_title` — the work's alternate
name, authored on the work in the library tree, used as the piece register's
standing label. Unauthored is a supported state and renders no header.
