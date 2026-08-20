# The Lyric Rail — design

**Status:** design, 2026-08-20. Built dormant: correct from the first commit, and
invisible until a piece's segments carry text at a granularity the rail draws.

**Goal:** When sung text exists for the sounding segment, give it a rail of its
own on the right, and take the programme rail away — one composition, two states,
one move between them.

---

## The two states

The frame has one layout today: a programme rail on the left running full height,
the video to its right, and the band beneath the video at the video's own width.
That stays exactly as it is. The second state replaces the left rail with a lyric
rail on the right, of the same width, and slides the video flush to the left edge
of the screen container.

```
NO TEXT (today, unchanged)              TEXT SOUNDING
┌────────┬──────────────────┐           ┌──────────────┬────────┐
│  left  │                  │           │              │ heading│
│  rail  │      VIDEO       │           │    VIDEO     │        │
│        │                  │           │              │ lyrics │
│ (full  ├──────────────────┤           ├──────────────┤        │
│ height)│  band            │           │  band        │portrait│
└────────┴──────────────────┘           └──────────────┴────────┘
```

**They are never both present.** The lyric rail is not a third column; it is the
left rail's replacement, on the opposite side.

### What does not change, and it is more than it looks

The **band keeps its width**. It is already JS-sized to the media box's measured
width — "the footer is JS-sized to the media box's measured width so it reads as
that video's timeline" — so it travels left with the video at exactly the same
width. **The rail's segment capacity is therefore identical in both states**:
whatever it can draw now, it can draw with lyrics up. No collapse threshold, no
chip decision, and no measurement in `band.measure.test.jsx` moves.

The **left rail is untouched** — composer card, place carousel, era timeline, all
of it. This design adds a sibling; it does not edit that column.

## The corner that keeps the composer

The lyric rail is two stacked pieces whose heights mirror the left side's
proportions:

- **The lyric box**, its height matched to the video's, so their bottom edges
  align and the two read as one block.
- **The composer's portrait and brass nameplate**, in the corner below it, at the
  band's height.

That second piece is the load-bearing part of the design. When the left rail
slides out it takes the composer's face and name with it, and a frame that stops
saying whose music this is has lost something it should never lose. Relocating
the plate to the corner means the screen answers "who wrote this" in both states,
and it fills a corner that would otherwise be dead.

It is a **relocation, not a copy**: the same portrait-plate-and-brass header the
composer card already renders, mounted in a second position. One component, two
homes, so a change to the plate cannot make the two disagree.

## The move

One move, not two. The left rail slides out as the lyric rail slides in, and the
video and band travel left with them. Nothing resizes mid-flight: the video's box
is unchanged in both states, so this is a translation, not a reflow.

It rides the house dissolve (`dissolve.js`) at the frame's existing duration, and
commits in a single frame under `prefers-reduced-motion` — the same contract the
place carousel and the bond already keep.

## When it comes up, and when it goes away

**The trigger is that the sounding segment has non-empty `text`.**

**Hysteresis is required, not optional.** Messiah's 53 numbers have short gaps
between them where nothing is sounding; a naive trigger would slide the whole
composition back and forth all evening. So:

- Coming **in** is immediate: the first segment with text brings the rail on.
- Going **out** waits. The rail holds through any gap shorter than **20 seconds**,
  and reverts only when nothing has sounded for longer than that — a Part break,
  the applause before the first number, or the tail after the last.

An **instrumental number renders no lyric box** rather than an empty one, but does
**not** dismiss the rail: the Pifa sits between two texted numbers, and sliding
the layout out and back for ninety seconds of pastoral symphony is exactly the
flapping the hysteresis exists to prevent. The heading stays, the box shows
nothing, and the composer plate is unaffected.

## How the text is set

**The frame's standing law holds: nothing is ever cut.** No ellipsis, at any
size, on any screen. The lyric box is far more generous than the band — a video's
height rather than four lines — but a long air can still overflow it.

So, in order:

1. **Fit.** Reuse `fit.js`'s ladder — tighten the leading toward its floor, then
   step the size down toward the prose floor. Solved once per piece against every
   text the rail can ever show, so the type cannot resize at a segment boundary.
2. **Page.** Where the text still does not fit at the floor, page it on a dwell,
   using the same dissolve the place carousel uses. Paging preserves the law that
   cutting would break.

Scrolling is not an option: this is a television read from across a room, with no
pointer and no scrollbar a viewer could use.

The **heading** is normally the segment's own title. It is set once and does not
page with the text beneath it, so a viewer glancing up mid-air still knows what
is sounding.

## What it needs from the frame

Regions are statically authored in `_surrounds/*.yml` today. This needs one new
capability: **a region that claims its side when it has content, and suppresses
its opposite number when it does.**

Authored as a sibling slot rather than a special case:

```yaml
regions:
  right:                      # the programme rail, `side: left` — unchanged
    - module: composer-card
    - module: place-carousel
  lyric:                      # the new rail, `side: right`
    module: libretto
```

The frame renders exactly one of `right` and `lyric`, choosing `lyric` whenever
the libretto module reports content (with the hysteresis above). A definition
with no `lyric:` slot behaves precisely as it does today — which is what makes
this dormant rather than conditional.

## Dormancy, and the honest state of it

**Nothing displays until a rail segment carries text.** Today no shipped piece
qualifies. Messiah's 53 numbers *do* carry text — 51 of them, 238 lines, live in
`messiah-part-1/2/3.yml` — but `messiah.yml` still holds three Part-sized
segments, and a Part carries no text of its own. Wiring the part-work references
is blocked on the 53 timings, which remain underived.

So the panel ships correct and asleep. It wakes on whichever comes first: the
Messiah timings landing, or another piece authored with text on segments the rail
already draws.

**This is worth saying plainly rather than burying:** the parse half of that work
is complete and verified — 53 numbers with name, form, voice, scripture and sung
text — and it reaches the corpus but not yet the payload. The gap is the timing
derivation, not the text.

## Testing

- **Layout, measured** (`band.measure.test.jsx`, real Chromium): in the lyric
  state the video's left edge sits on the container's left edge; the lyric box's
  height equals the video's; the plate's height equals the band's; and **the
  band's width is identical in both states** — the regression that matters, since
  the rail's capacity depends on it.
- **Exclusivity:** the left rail and the lyric rail are never both in the tree.
- **Hysteresis:** a 10-second gap between two texted segments does not dismiss
  the rail; a 30-second one does.
- **Instrumental:** a segment with no text keeps the rail up and renders no box.
- **Never cut:** for every text in the piece, the rendered lines' height never
  exceeds the box, at all three fleet roots — the same assertion the band's notes
  already carry.
- **Dormant:** a definition with no `lyric:` slot, and a piece whose segments
  carry no text, produce a frame byte-identical to today's.

## Out of scope

- Per-line timing or karaoke-style highlighting. Timings are per-number at best.
- Translations beneath the text; the corpus has `translation:` on segments but
  the lyric rail shows the sung text only.
- Any change to the left rail, the band, or the rail's density rules.
