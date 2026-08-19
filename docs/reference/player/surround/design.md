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

Two families only. A third is one accessory too many.

- **Cormorant Garamond** (already loaded by ArtMode) — display. Piece title,
  composer name, movement names. *Italic for tempo markings*, because that is how
  engraved scores actually set them.
- **EB Garamond** — body. Fact ticker, programme notes.
- **Labels** are letterspaced small caps of the display face (`0.14em`), the way
  concert programmes set section headers. Not a third typeface.

Scale, tuned for a 10-foot living-room read at 1920×1080:

| Role | Size | Weight |
|---|---|---|
| Piece title | `2.05rem` | 600, italic — the headline of the screen |
| Piece provenance (under it) | `0.85rem` | 600, small caps, one line |
| Composer name (brass plate) | `1.75rem` | 600, measure capped at `12ch`, up to 3 lines |
| Movement name (active) | `1.05rem` | 600, italic for the tempo term |
| Ticker body | `clamp(0.95rem, 19cqh, 1.5rem)` | 500, 2 lines reserved |
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
│  ⇄ city map, 5:3  │  movement map — rule on top, names below  │
│                   ├───────────────────────────────────────────┤
│                   │  cue / fact ticker                        │
└───────────────────┴───────────────────────────────────────────┘
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
  right) and, centred in the height the header leaves, the rotating composer
  fact. The name is set to a capped MEASURE and breaks at word boundaries —
  "Antonio" over "Vivaldi" — because an engraved plate uses the vertical rather
  than shrinking its type to one line.
- **place carousel** — three slides in one 5:3 slot, dissolving in turn: the city
  photograph, the country at regional zoom, then the same map zoomed so the
  country's own shape fills the frame around the city's star. Two questions,
  asked in order — where is that country, and where in it. The card owns the
  person, the carousel owns the place.

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

**The band's regions are sized to their contents.** The movement map claims only
the rule lane plus two lines of name; ALL the band's remaining height belongs to
the ticker, which centres its note in it. A floor larger than the names need would
be dead black between them and the note, not breathing room.

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
- Movement names sit **below** the rule, tempo term in italic, wrapping to at
  most two lines.
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
