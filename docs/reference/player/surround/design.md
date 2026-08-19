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
| `--hall-ink` | `#14100c` | The darkened auditorium. Frame ground, video letterbox. |
| `--programme` | `#efe6d2` | Printed programme stock. Rail and footer panels. |
| `--programme-edge` | `#ddd0b4` | Paper edge / fold shadow. Hairline rules on stock. |
| `--velvet` | `#4a1018` | Seat velvet. Accent only, never large areas. Declared but currently unused — the map that once painted its subject in it is drawn in ink hairlines now. |
| `--brass` | `#c79a3e` | Brushed brass. The playhead, plaque rules. |
| `--brass-lit` | `#f6e3a0` | Lit brass highlight — the leading edge of the playhead. |
| `--ink` | `#2a1d07` | Primary text on programme stock. |
| `--ink-soft` | `#6b6152` | Labels, secondary data, elapsed movements. |

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
| Piece title | `1.45rem` | 600 |
| Composer name (brass plate) | `1.35rem` | 600, clamped to 2 lines |
| Movement name (active) | `1.05rem` | 600, italic for the tempo term |
| Ticker body | `1.15rem` | 500 |
| Rail fact | `0.95rem` | 500, body face, 3 lines reserved |
| Map — subject country | `0.9rem`, `0.2em` tracking | 600, uppercase |
| Labels / data / map neighbours | `0.72rem`, `0.14em` tracking | 600, uppercase |

## Layout

```text
┌──────────┬─────────────────────────────────────┐
│ RAIL 33% │        ┌──────────────┐             │
│          │        │ WORK PLACARD │  ← floats,  │
│ ┌────┐   ├────────┴──────────────┴─────────────┤
│ │POR-│AN-│                                     │
│ │TRAIT│TONIO│    VIDEO — locked 16:9           │
│ │(mat)│VIVALDI│  letterboxed on ink            │
│ └────┘1678–1741│                               │
│       Venice   │                               │
│                ├─────────────────────────────────┤
│  fun fact,     │ movement map                    │
│  centred       ├─────────────────────────────────┤
│                │ cue / fact ticker               │
├──────────┬─────┴─────────────────────────────────┘
│ PLACE    │
│ CAROUSEL │  city photograph ⇄ regional map
│          │  captioned, 5:3, dissolving
└──────────┘
```

The video is TOP-anchored and the work placard FLOATS out of flow, straddling the
video's top edge as a content-width museum plate. The bottom band spans exactly
the video's width — so it reads as that video's timeline, not as page furniture —
and rides up over the video's last ~10px so the join is one edge, not two boxes
meeting. The rail runs full height because it carries identity, not progress, and
is placed on the LEFT at 33% (`regions.right[0].side: left`); the region KEY is
still `right`.

The rail holds two regions, neither with a declared height, so they split it and
the geometry follows the viewport:

- **composer card** — a header ROW (portrait in its paper mat at 45% of the rail
  on the left; the brass nameplate carrying the NAME, with dates and birthplace
  under it, in the column to its right) and, centred in the height the header
  leaves, the rotating composer fact.
- **place carousel** — the city photograph and the regional map, one at a time,
  in one 5:3 slot. The photograph is matted in paper; the map is engraved
  straight onto the rail. The card owns the person, the carousel owns the place.

Pictures are NEVER cropped. `object-fit: cover` is banned in the rail: a portrait
is a picture of a person, and a narrow column is not a reason to guillotine one.

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
- Progress is read from the FILL, not from the cursor: each movement's bar
  carries its own elapsed fraction. Future = hairline lane, elapsed = 2px,
  active = 4px brass. The active bar is the loudest mark in the frame, because
  "how far through *this* movement are we" is what the viewer actually wants.
- The playhead is a 2px brass hairline in the rule lane. No glow, no lit tip.
- One quiet separator between movements, not a double barline.
- Movement names sit **above** the rule, tempo term in italic, wrapping to at
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
  No easing, no trail.
- The frame ENTERS: rail → band → placard, `400ms` each on one easing, staggered
  `0 / 90 / 180ms`. The video never moves and is in no animated subtree.
- Nothing pulses, bounces, or shimmers. Respect `prefers-reduced-motion` by
  dropping the crossfades to instant swaps.

## The map: regional context, engraved

The map answers **"where is that?"**, not "what shape is that country?". A shape
with a star in it tells a viewer who cannot already place the country nothing at
all, so:

- **Zoom is regional.** The subject country spans about HALF its frame; the other
  half is the countries around it, drawn and named. The frame is the subject's
  own bounding box padded by `0.9` of its span, widened to the render aspect —
  no per-country configuration anywhere.
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
- The city keeps its brass star and label — the one thing on the map the
  programme asserts, and the one label that is never dropped.

## Materials, used with restraint

Borrow ArtMode's physical realism, but one plate, not a gallery:

- The rail and the bottom band are part of the darkened house, not the programme:
  both re-map `--ink` / `--ink-soft` to parchment over a dark ground (the band
  near-black stone, the rail deep oxblood, one register warmer, so the two read
  as one house material). The paper fibre stays, multiplied over the maroon, so
  the rail's stock keeps its tooth.
- `--programme` is deliberately NOT re-mapped by either. Paper survives in the
  frame exactly where a picture is mounted: the portrait's mat and the
  carousel's photograph mat. Those, plus the brass nameplate, are the lit objects
  on a dark wall. No drop shadows on every element.
- The floating work placard is the one element allowed a drop shadow — it sits
  ON the video, so it casts.
- The portrait sits in a single plate frame with a brass hairline — echoing
  ArtMode's brass nameplate without reproducing the screwed-down plaque.
- Hairlines are `1px` and `--programme-edge`; no heavy borders anywhere.

## Quality floor

- 16:9 is inviolable — letterbox, never distort.
- Legible at 10 feet: nothing below `0.72rem`, no thin weights on the dark ground.
- Everything degrades to an empty slot: a missing portrait, a piece with no
  movements, a sidecar with no facts. The frame must still look composed.
- `prefers-reduced-motion` honored.
