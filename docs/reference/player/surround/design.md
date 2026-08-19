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
| `--velvet` | `#4a1018` | Seat velvet. Accent only — active movement fill, never large areas. |
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
| Composer name | `1.7rem` | 600 |
| Movement name (active) | `1.05rem` | 600, italic for the tempo term |
| Ticker body | `1.15rem` | 500 |
| Labels / data | `0.72rem`, `0.14em` tracking | 600, uppercase |

## Layout

```text
┌────────────────────────────────┬────────┐
│                                │ RAIL   │  portrait (plate-framed)
│      VIDEO — locked 16:9       │ 20%    │  COMPOSER · dates
│      letterboxed on ink        │ full   │  ── brass hairline ──
│                                │ height │  Piece title
├────────────────────────────────┤        │  Opus · composed · city
│ movement map            60px   │        │  Premiered …
├────────────────────────────────┤        │
│ fact ticker            ~156px  │        │
└────────────────────────────────┴────────┘
```

The footer spans exactly the video's width so it reads as that video's timeline,
not as page furniture. The rail runs full height because it carries identity, not
progress.

## Signature: the movement map as engraved score

**This is the one memorable element. Spend the boldness here and keep everything
else quiet.**

The movement map is not a progress bar. It is set as the barline grammar of
engraved music: a single hairline staff rule, with movements separated by **double
barlines** — which is what actually marks a movement end in notation. Each
movement is a segment proportional to its real duration.

```text
 ╷                    ╷╷              ╷╷        ╷╷                    ╷
 │  I. Allegro con brio││ II. Marcia funebre││ III. Scherzo││ IV. Finale     │
 ╵────────────────────╵╵──────▮───────╵╵──────────────╵╵────────────────────╵
                              ▲ brass playhead
```

- Elapsed movements: `--ink-soft` rule, name at 60% opacity.
- Active movement: `--velvet` fill beneath the rule, name in `--ink` at full weight.
- Future movements: `--programme-edge` rule.
- The playhead is a slender brass vertical rule with a lit leading edge — a
  barline in motion, not a dot or a thumb.
- Movement names sit **above** the rule, tempo term in italic.
- No clef, no notes, no staff of five lines. One rule and the barline grammar.
  The restraint is what keeps it from reading as fussy pastiche.

**The last movement's bar must end where the music ends, not at `duration`.** The
Eroica has ~4½ minutes of applause after the final chord; a bar running to the end
of file would tell the viewer the piece is still going.

## Motion

Sparse and slow. This plays behind music; anything busy competes with it.

- Movement change: the active fill crossfades over `600ms ease-out`. No slide.
- Fact/cue change: fade out `280ms`, swap, fade in `280ms` — the same
  choreography as `ArtPlacards`, so a label change never hard-cuts.
- The playhead moves continuously at the clock's 10 Hz. No easing, no trail.
- Nothing pulses, bounces, or shimmers. Respect `prefers-reduced-motion` by
  dropping the crossfades to instant swaps.

## Materials, used with restraint

Borrow ArtMode's physical realism, but one plate, not a gallery:

- Programme panels get a **paper** ground: `--programme` with a very low-contrast
  fibre texture and a `1px` `--programme-edge` inner rule. No drop shadows on
  every element.
- The portrait sits in a single plate frame with a brass hairline — echoing
  ArtMode's brass nameplate without reproducing the screwed-down plaque.
- Hairlines are `1px` and `--programme-edge`; no heavy borders anywhere.

## Quality floor

- 16:9 is inviolable — letterbox, never distort.
- Legible at 10 feet: nothing below `0.72rem`, no thin weights on the dark ground.
- Everything degrades to an empty slot: a missing portrait, a piece with no
  movements, a sidecar with no facts. The frame must still look composed.
- `prefers-reduced-motion` honored.
