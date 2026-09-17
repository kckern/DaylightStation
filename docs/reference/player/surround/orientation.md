# Which way the band runs

> **Why this is not in `design.md`.** That file is root-owned (an artefact of
> the PII hook) and cannot be written by the user this repo is worked in.
> Rewriting it would have meant deleting and recreating a protected file, which
> is a permission end-run, not a docs update. When someone can write it, this
> page should be folded in and a cross-link left behind.
> One-line fix: `sudo chown ds docs/reference/player/surround/design.md`.

## The media cap — the band is never crushed to make room for the picture

Belongs beside design.md's aspect-ratio quality floor.

A picture taller than 16:9 at the column's width pushes the band off the bottom
of the screen. Measured at **0.4px** on the living-room root before the cap
existed — with the collapse rule then dropping the listening ticker outright,
so both registers vanished while every module went on working and logging
healthily.

The frame measures its own column and publishes `--surround-media-cap-w`: the
widest the picture may be while the band keeps its reserve. The media box takes
`min(100%, cap)`.

**WIDTH is capped, never height.** Clamping height while width stays at `100%`
is exactly how a picture gets stretched, and the quality floor says never
distort. Width follows the declared ratio, so the box pillarboxes into the
velvet the stage already wears.

The reserve defaults to `collapse.footerFloor`; a definition may author more —
or none — as `collapse.mediaReserve`.

## `orientation` on a region

The work-in-time modules — the segment rail and the listening band — take an
`orientation` on their region, beside `width`, `side` and `height`. It is `row`
(the default, and every shipped classical definition) or `column`.

**Nothing in the frame derives it.** A picture narrower than the screen wastes
WIDTH and has no height to spare, so its definition asks for a column — but that
is the definition's decision, and a 16:9 work with a deep hierarchy may ask for
the same thing. No code branches on aspect ratio, domain or corpus.

## The rail-carried layout

`_surrounds/playhouse-rail.yml` is the arrangement that follows from asking:
identity, the timeline and both registers stacked in one wide rail, nothing
under the picture, and `collapse.mediaReserve: 0` so the picture takes the whole
column.

The rail sits on the **right** — the frame's default, and it is `playhouse` that
opts into `side: left`. That puts the video flush left and the timeline's spine
directly against the picture, honouring the same law that keeps the horizontal
rule tight against the video's foot: the timeline is the picture's own edge, not
furniture beside it.

Measured at the living-room root (960x540, 40% rail): picture **576x432**, an
exact 4:3 taking the full column — 27% more picture than the band-under
arrangement, and a rail 67px wider.

### Rows are equal

Duration-proportional rows would give a long segment a tall block and a short
one a sliver too small to set its own name in. The horizontal rail can afford
proportion precisely because a narrow segment still gets a full line of HEIGHT;
a column has no such slack.

Progress therefore lives on the **spine**, in row space: lit from the top down to
the playhead, whose position is `(sounding row + fraction through it) / row
count`. That is the horizontal playhead's own rule, transposed — the same
`playheadFraction`, called with equal shares. `band.js` needed no change.

### The outer group rides in the mark

A heading row per group costs about 100px of a 260px rail — the difference
between eleven legible rows and thirteen-pixel ones. So the mark reads `I.1`,
`II.1`, and the rail prints no heading rows at all. It COUNTS the levels; the
corpus names them, and no name is read.

### What does not exist on this axis

- **Folds.** Folding buys width, and a column is short of height. It also costs
  the thing the column is for: the whole work legible at once, in order.
- **The accordion**, and **group heading rows**.
- **`nowSide` / `NOW_PANEL_SHARE`.** With the registers stacked, the NOW one is
  simply the lower — always. The bond's ground is a fixed half that does not
  travel, so nothing is interpolated and nothing is published.
- **The bond's connector.** Rows sit between the sounding row and the register
  below it, so a weld is geometrically impossible. The shared GROUND binds them
  instead, which is what the connector existed to serve.

## Where this is enforced

- `SegmentMap.test.jsx` — "the timeline on a vertical axis", and "one rail, any
  corpus", which fails if any emitted class or testid names a use case.
- `band.measure.test.jsx` — "the rail-carried layout, measured", at all three
  fleet roots: the picture holds an exact 4:3 and fills its column, no band
  renders where no bottom region is authored, and the rail sits right carrying
  three regions that each have real height.
