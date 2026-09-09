# Status Board Card Redesign — Design

**Date:** 2026-09-09
**Surface:** `frontend/src/modules/School/status/AgendaStatusBoard.jsx`, `School.scss:2760-3020`
**Status:** design agreed, not yet planned or built

## The problem

The card's right half (`__info`) is a vertical stack of three things: the
`0 OF 6` count and the ring number, both `align-self: flex-end`, and the disc
row beneath them at full width. Two right-aligned text lines therefore push the
discs to the floor of the card, where they crowd the bottom border.

A separate rule (`--count`) divides the card's width by the number of discs, so
the learner with the most work also gets the widest, flattest strip — a
six-assignment day runs nearly the full card while a two-assignment day sits in
a corner.

Three decisions fix it.

## 1. Discs pack as a bowling-pin triangle

A pure function beside `summarize` and `dayStatus` in `agendaStatusModel.js`:

```js
export function triangleRows(count) // → number[], top row first
```

The base width is the smallest `b` where `b(b+1)/2 >= count`. The base takes
`b`, the row above takes `b-1`, and so on until the discs run out. Rows are
returned top-first so the component renders them in DOM order.

| N | rows (top → base) |
|---|---|
| 1 | `[1]` |
| 2 | `[2]` |
| 3 | `[1,2]` |
| 4 | `[1,3]` |
| 5 | `[2,3]` |
| 6 | `[1,2,3]` — a clean pyramid |
| 7 | `[3,4]` |
| 8 | `[1,3,4]` |
| 9 | `[2,3,4]` |

**Capped at three rows.** Nine is the subject wall's ceiling
(`home/subjects.js`) and lands exactly on three. Past nine the base widens
rather than a fourth row appearing: a fourth row takes the disc below the
diameter at which its glyph stays readable from across the room.

Segments fill the rows in the order `summarize` already returns them — reading
order, left to right, top row first — so the subject a child sees first today is
the subject they saw first yesterday.

## 2. The card becomes three columns

```
┌────────────────────────────────────────────────────┐
│  ╭────────╮                                        │
│  │  face  │           ●          (░│░│░│░│░│░) 0/6 │
│  │        │          ● ●                           │
│  ╰──name──╯         ● ● ●         (◉ 1422        ) │
└────────────────────────────────────────────────────┘
   rail              cluster            readout
   flex: 0 0 auto    flex: 1 1 auto     flex: 0 0 auto
```

**The rail is untouched** — avatar plus straddling nameplate, same clamps. It
already works, and it is what makes the card belong to a child.

**The cluster** takes the middle and is centred on both axes. This is the fix
for the crowded bottom border: as a sibling column rather than the third item in
a vertical stack, it gets the card's whole inner height and sits in the middle
of it, with the card's own padding the only thing between it and the edge.

**The readout** is a fixed-width right column holding the two pills, vertically
centred.

`--count` goes away. Width is no longer the binding constraint — the triangle is
at most four discs wide where the old row was up to nine.

### Disc size is fixed board-wide

One diameter for every card, set by the three-row worst case rather than by each
learner's own count. A disc is a unit: it means the same thing and measures the
same on all four cards, so a six-assignment day visibly *is* three times a
two-assignment day. A light card carries more air, and that is the correct
reading of a light day.

**Rows nest.** Row pitch is `0.78 × diameter`, so rows overlap by about a fifth
the way stacked pins do, and three rows cost 2.56 diameters of height rather
than 3. Each row is centred on the row below, offset by half a disc.

**The cost, stated plainly.** Today's disc is `8vh` (~64px on the 1280x800
Portal). Three rows inside the card's ~104px of inner height gives ~40px with
the nesting, and ~32px without it. The glyph renders at 58% of the disc, so it
falls from ~37px to ~23px. That is the price of stacking, accepted knowingly;
the nesting pitch exists to keep it at 40 rather than 32.

## 3. The count and the rings become pills

Both are the same object — same height, same radius, right-aligned, stacked with
the card's own gap. The sameness is what makes the right column read as one
readout instead of two loose scraps of text.

**The work pill** is a track of `N` notches, one per assignment, in the same
order as the discs. Each notch carries that assignment's tri-state — green
`passed`, amber `needs-retry` or `in-progress`, grey `pending` — so the pill and
the triangle can never disagree. The fraction sits outside the pill's right
edge, in tabular figures.

Notch sizing: never narrower than **6px**, never wider than **14px**; the pill
sizes to `N × notch + gaps` between those bounds. Nine assignments is a
54–126px pill, which the freed width affords easily. Below six notches the pill
would read as a stub, so it takes a minimum pill width and the notches widen to
fill it — a two-assignment day gets two fat notches, not a tiny stub.

**At 100%** the pill goes solid: one continuous green fill, no dividers, and
`DONE` replaces the fraction. This preserves today's "Done for the day" chip
message, deliberately — green is a convention a child must be taught and a word
is not.

**The rings pill** is the ring glyph plus the count, same height, muted surface,
**no fill**. It is a quantity, not progress toward anything; a fill would imply
a target the board does not have.

**The `+N` extra badge** stays on the disc. It is per-assignment evidence and
belongs on the assignment, not in an aggregate.

## States and loading

The skeleton draws a triangle of three (`[1,2]`) rather than a row of three, so
the card does not reflow when the real count lands. The shimmer keeps its single
`@keyframes` and its `prefers-reduced-motion` kill.

The work pill's skeleton is an empty track with **no notches** — a notch count is
a claim we do not have yet, and a wrong one would flicker to a different one.

**Nothing moves.** The cleared card stays colour-only: no glow, no crawl. The
triangle does not animate in, the pill does not animate its fill. This is the
settled decision the component's header defends (KC, 2026-08-26) and this
redesign does not reopen it.

## Accessibility

Unchanged in substance. Each disc keeps its `Icon` with `labelForSegment`, which
is what makes the day readable. The per-row `<ul>` wrappers take
`role="presentation"` so the discs remain one flat list to a screen reader — the
triangle is a visual arrangement, not a structure. The work pill's notches are
`aria-hidden`; the fraction beside it already carries the number, and
re-announcing six notches is noise.

## Testing

`triangleRows` is a pure function and gets a table test over N = 0…12 in a new
`status/agendaStatusModel.test.js` — the whole packing rule verified without
rendering anything. The model currently has **no colocated spec**; its behaviour
is tested only through `AgendaStatusBoard.test.jsx`.

Board tests assert **structure**: three row elements for six segments, widths
`[1,2,3]`, reading order preserved across rows, the pill's notch count, and each
notch's `data-state`.

jsdom has no layout engine, so disc diameter, nesting pitch, and centring are
verified by a screenshot on the real Portal — not by a test that claims to.

## Out of scope

The rail, the roster fetching, the WebSocket refresh paths (`omr`, `school`,
`state-gates`), the cleared-card colour, the `+N` badge, and the board's
non-interactive contract.
