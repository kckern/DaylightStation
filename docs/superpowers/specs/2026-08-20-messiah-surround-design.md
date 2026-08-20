# Handel's Messiah — a Surround for a 53-number oratorio

**Status:** design, approved in conversation 2026-08-20. Not yet planned or built.

**Item:** `plex:6918` — *Handel's Messiah — Live from the Sydney Opera House (2009)*.
One `movie`-type media item in the **Stage** library (section 7): a single 134-minute
mp4, 3.17 GB, no chapter atoms, no subtitle track, one stereo AAC stream.

---

## The problem

Every surround shipped so far is either a single work of 3–5 movements or a
container of separate media items. Messiah is neither, and it breaks the rail's
central assumption in a way no previous piece has:

| | |
|---|---|
| What the corpus records today | **3** segments (Part I / II / III) |
| What the libretto contains | **53** musical numbers |
| What the rail can draw fleet-wide | **~16** |

That last figure is set by the living room, not the office: at a 960 root the
rule measures ~608px, chips floor at 24px each, and the sounding segment still
needs ~250px for its name — so `(608 − 250) / 24 ≈ 15` inactive plus the sounding
one. The office (~822px) allows ~24; the 1920 root ~42. The largest segment list
anywhere in the corpus today is 24, and that is one work out of 1,138.

Neither existing answer is usable. **Three segments** leaves one box lit and one
note showing for the ~50 minutes of Part One — a third of the sitting during
which the band says nothing new. **Fifty-three** cannot be drawn at any root and
would chip into anonymity even where it fit.

So this is the first work where *what the corpus should record* and *what the
rail can draw* are different questions. Everything below follows from separating
them.

## Assets on disk

The item's folder carries more than the video, and two of the files do real work
here:

```
/media/kckern/Media/Stage/Handel's Messiah—Live from the Sydney Opera House (2009)/
├── …(2009).mp4        3.17 GB   the media Plex plays
├── Libretto.pdf       6 pages   the complete numbered text — the corpus source
├── Program.pdf        17 pages  performers, venue, date — the `performance:` line
├── nfo.json                     summary, studio, country
└── poster.jpg, background.jpg, …png
```

`Libretto.pdf` is authoritative and machine-readable: every number carries its
sequence position, its **form** (Recitative / Air / Chorus / Duet), the voice, the
sung text, and a **scripture citation**. Parts are headed `PART ONE`, `PART TWO`
and `PART Three` — note the mixed case on the third, which defeats a naive
uppercase grep and cost one wrong reading during exploration.

**A numbering trap, recorded so nobody re-derives it wrongly:** the PDF numbers
items **1–54, where №1 is `Play All`** — a DVD menu entry, not music. The corpus
numbers the music **1–53** in performance order.

The text is public domain: Charles Jennens compiled it in 1742 from the 1611
King James Bible. What belongs to the Opera House is the PDF's typography, not
the words.

## The recording is not the score

The libretto is the **work**; the file is a **performance**, and they do not
match. The arithmetic is decisive:

| | |
|---|---|
| File duration | 134.0 min |
| Audible span (music + applause + any interval) | **~118 min** |
| Complete Messiah, music alone | **~140 min** |

**This performance is cut**, by roughly twenty minutes. Both PDFs also carry the
title *"Messiah Download"*, which reads as a generic libretto rather than this
concert's running order — so the printed text cannot be assumed to be the
running order at all.

So reconciling the two is an **alignment** problem, not a selection problem, and
there are four relationships to resolve rather than one:

| | case | how it presents |
|---|---|---|
| **1:1** | a number is one audible span | the common case |
| **n:1** | numbers run *attacca*, with no gap to detect | a span too long for its form |
| **1:0** | the number was cut | duration falls short; no span to assign |
| **1:n** | a break inside a number (da capo, applause) | a span too short for its form |

### Omission is already solved, and needs no new syntax

A `starts:` entry that is not a valid non-negative number is dropped to
`undefined` by the store, which **preserves positions rather than compacting
them** — deliberately, so one bad entry costs one segment's timing instead of
shifting every later segment by one. The segment keeps its name, its text and its
notes; the rail declines to draw it and logs `surround.segments.unplaceable`.

That is exactly the semantics a cut number needs. **A number this performance
omits gets a `null` start.** It stays in the corpus, because the corpus records
the work and the work contains it; it never appears on the rail, because the rail
maps the recording.

This is the load-bearing division of labour for the whole design:

> **The corpus records the work. The sidecar records the performance. The rail
> draws the recording.**

### Merging is what the spectroscopy leg is for

An attacca join has no silence, but it has a texture change — a recitative over
continuo giving way to a full-orchestra air is a different spectral picture.
The sequence is therefore: silence finds the spans; alignment identifies which
spans are *too long for their form* and so contain a hidden join; spectroscopy is
then aimed **inside those specific spans**, where we already know how many joins
to expect. That is a far easier detection problem than sweeping 134 minutes.

Where a join genuinely cannot be recovered, the fallback is the same as omission:
the second number gets no start, is not drawn, and that is logged rather than
guessed.

## Decisions

1. **The corpus records all 53 numbers, grouped by Part; the rail draws the ones
   this recording performs.** Completeness in the corpus, honesty on the rail.
   The legibility problem is solved by collapsing, below.
2. **Silent Parts collapse to one segment each — but only when the flat rail is
   measured undrawable.** The étude season (27 segments, 3 groups) keeps the flat
   rail it has today, unchanged on every screen.
3. **Timings are derived by silence analysis + spectroscopy + relative-duration
   validation against the libretto**, with the validation acting as a publish
   gate rather than a report.
4. **Names, forms, scripture, text and timings are authored in this pass;
   `listen:` notes only for the dozen numbers a listener recognises.** Segments
   without notes already borrow the work's facts, so the band is never blank.
5. **The sung text takes over the side rail when it exists**, replacing the
   composer card and the place carousel, and reverts when nothing is sounding.

## Corpus shape

`messiah.yml` becomes three referenced part-works rather than three inline
segments:

```yaml
# library/classical/0_flagship/handel/messiah.yml
segments:
  - work: handel/messiah-part-1
  - work: handel/messiah-part-2
  - work: handel/messiah-part-3
```

and each part-work carries its own numbers:

```yaml
# library/classical/0_flagship/handel/messiah-part-2.yml
title: "Part Two"
segments:
  - n: 21
    name: "Behold the Lamb of God"
    form: "Chorus"
    scripture: "John 1: 29"
    text: |
      <the number's sung text, lineated as the libretto sets it>
```

**This needs no backend change, and that is the reason to prefer it over
inventing a grouping syntax.** `YamlSurroundStore#resolveSegments` already
expands a `work:` ref inline and stamps every expanded segment with
`{ work, title, index }` — which is exactly the `group` the rail's heading row
reads. It is the mechanism the étude corpus already uses in production. Two
consequences that are easy to get wrong:

- **`starts:` pairs against the FLATTENED list.** The store resolves refs before
  pairing, so the performance sidecar carries **53** start seconds in libretto
  order. A count mismatch logs `surround.starts.mismatch`.
- **Group numbering is already correct for a single work.** `#renumberGroups`
  runs only for containers; here `#resolveSegments`'s own counter assigns Part
  One/Two/Three the indexes 0/1/2 directly.

Segment-level fields are not allowlisted, so `form:`, `scripture:` and `text:`
reach the payload untouched — the same property that let `short:` ship without a
store change.

The three `note:` lines currently on `messiah.yml`'s inline segments move onto
the three part-works, so nothing authored is lost.

The performance sidecar is new — there is no `surround/classical/handel/`
directory at all:

```yaml
# surround/classical/handel/messiah.sydney-2009.yml
work: handel/messiah
surround: concert-hall
match:
  contentId: plex:6918
  title: "Handel's Messiah—Live from the Sydney Opera House"
performance: "<conductor · choir · orchestra · venue · date, from Program.pdf>"
# 53 entries, positional against the flattened segment list. A `null` is a
# number this performance omits: the store keeps the segment and the rail
# declines to draw it.
starts: [ … 53 entries, some null … ]
musicEndsAt: <the final Amen's end, before the closing applause>
```

## The rail: collapsing silent Parts

When the flat rail cannot be drawn at this root, each **silent** Part collapses
to a single segment and the **sounding** Part expands to its numbers:

| sounding | rail draws | vs flat |
|---|---|---|
| Part One (№1–21) | ≤ 21 + 1 + 1 = **≤23** | ≤53 |
| Part Two (№22–44) | 1 + ≤23 + 1 = **≤25** | ≤53 |
| Part Three (№45–53) | 1 + 1 + ≤9 = **≤11** | ≤53 |

These are **ceilings**, not counts: a number this performance omits carries a
`null` start and is not drawn, so the real rail is smaller. Twenty minutes of
cuts is roughly eight to twelve numbers, which makes the worst case comfortably
under the étude season's 27.

Messiah divides **21 / 23 / 9** — Part One ending at *His yoke is easy*, Part Two
at *Hallelujah*, Part Three at the closing *Amen*.

Bounded by the largest Part rather than the whole work, so the worst case is 25
— two fewer than the étude season already draws.

A collapsed Part is a **named** segment, not a chip: it has a real title
(`Part Two`) and a real width (its whole sounding span), so it reads as a closed
section of the map rather than as a mark.

Two properties make this cheap:

- **The payload never changes.** `data.segments` stays 53, so `next`/`previous`
  still walk all 53 numbers. Collapse is purely what is drawn.
- **The playhead stays truthful for free**, because `playheadFraction` already
  reads rendered widths rather than durations — settled when the accordion was
  built.

**The collapse trigger is a measurement, not a count**, in the same shape as the
existing names-vs-chips test. Stated precisely, so the plan does not have to
invent it: *collapse when the flat rail cannot be drawn even as chips* — that is,
when the rule's width minus the sounding segment's own required width, divided
among the remaining segments, falls below the chip floor. It is the same
inequality `railWearsChips` already evaluates, with the chip floor in place of
the name floor. It is per-root by construction, because the rule's width is.

The étude season must come out of that test unchanged: 27 segments against
`(822 − ~250) / 26 ≈ 22px`… which is **below** the 24px chip floor at the office
root, so a naive reading would collapse it. It does not collapse today because it
is drawn flat and chipped, and it must keep being drawn that way. **This is the
one place the trigger needs care**, and the resolution is that collapse is
governed by whether the chips *fit*, not by whether they are comfortable: the
étude rail's chips do fit at every root today, measured. The implementer must
derive the threshold from that measured fact rather than from the formula above,
and the regression test — étude rail byte-for-byte unchanged at three roots — is
what proves it.

**Unverified and must be measured before this ships:** Part Two expanded is 25
boxes, and at the 960 root that is chips at roughly the floor. The étude season
draws 27 there today — two more — so it is expected to hold, but the measurement
harness says so before release, not after.

## The timings

Three legs, of which the third is the acceptance test:

1. **Silence analysis** → candidate boundaries.
2. **Spectroscopy** → the two jobs silence cannot do. Identify applause
   positively (broadband, sustained) so the Part boundaries are anchored; and
   catch *attacca* joins, where a recitative runs straight into its air with no
   gap — those present as a change of texture, not of level.
3. **Relative-duration validation against the libretto** → the gate. The
   libretto fixes the order and the form of all 53 numbers, and forms have
   characteristic lengths (a recitative ~40–90 s, an air ~3–6 min, a chorus
   ~2–4 min). A candidate boundary set is accepted only if it yields 53 spans
   whose durations are plausible for their own forms in the libretto's own
   order.

**The validation gates publication.** If the candidates do not resolve to 53 sane
spans, we do not publish 53 approximate ones — we fall back to the three Parts
and record why. A rail that lies about position is worse than a coarse one, and
that principle is already load-bearing in this subsystem (`enforceOrder`'s
refusal, `segments.unplaceable`).

Precision needed is lower than it first appears: a boundary 2 s off inside a
2.5-minute number is under 2% of its width — invisible on the rail, and
harmless as a seek target.

A first silence pass was run during design and produced nothing, because
`-v error` suppresses `silencedetect`, which logs at info level. Recorded here so
the implementer does not repeat it. Use `-hide_banner -nostats … 2>&1 | grep
silencedetect`, and pass `-vn` so 134 minutes of video are not decoded to find
audio gaps.

### What a real pass over this recording actually produced

Run during design, `silencedetect=noise=-38dB:d=0.6` over the full 134 minutes:

| | |
|---|---|
| Silences detected | **142** |
| Internal boundaries needed | **52** (53 numbers) |
| Implied span lengths | min 1 s · p25 6 s · median 18 s · p75 69 s · max 420 s |
| Spans under 30 s — too short to be a number | **84** |
| Spans over 400 s — a missed join, or one long number | **1** |

**The detector over-triggers by roughly 2.7×, and that is the good outcome.**
Over-triggering is recoverable — the validation selects 52 boundaries from 142
candidates. Under-triggering is not: a boundary the detector never saw cannot be
recovered by any amount of filtering. So the shape of the problem is
constraint satisfaction over a superset, which is exactly what leg 3 is for. The
84 sub-30-second spans are internal rests, fermatas and breaths in recitative,
not number boundaries.

**The Part breaks corroborate independently.** The longest silences fall at
**48.6 min** and around **111 min** — where Part One and Part Two are expected to
end in a 134-minute performance. Two anchors, found without reference to the
libretto, that leg 2's applause detection should confirm positively.

**The one span over 400 s is the item to resolve first**, since it is the single
place the pass may have missed a real boundary rather than invented a false one.

## The side rail: a libretto mode

When the sounding number has `text:`, the right rail shows a **libretto** panel —
the verse, lineated as the libretto sets it, with its scripture citation beneath
— **in place of** the composer card and the place carousel. When no text is
sounding, the rail returns to biography and geography.

**Why not the listening band.** Two of the band's laws forbid it. Its type is
fitted once per piece against every string either register can ever show, so
folding 53 numbers of verse into that pool would size the type to the longest one
and shrink every programme note in the work. And the band never cuts a note — no
ellipsis, at any size, ever — so a six-line air cannot fit a register that
reserves about four lines. The rail has the vertical room the band does not.

**Paging, not cutting.** A text longer than the panel pages on a dwell — the
place carousel's own idiom — so the no-ellipsis principle survives contact with a
long air.

**Hysteresis is required.** The gaps *between* numbers have nothing sounding, and
without a hold the rail would flip to biography and back at every one of 53
boundaries. Hold the libretto across gaps **inside** a Part; revert only when
nothing has sounded for a real stretch — between Parts, before the first number,
after the last.

**Instrumental numbers render nothing** rather than an empty panel: the Sinfonia
and the Pifa have no text, and an empty verse panel is worse than the biography
it replaced.

**This is the one frame change the design needs.** Regions are statically
authored in `_surrounds/*.yml` today; a module claiming its whole region when it
has content is new. It fits the existing pattern of per-region behaviour keys
(`collapse: first` already works this way), and the swap should use the house
dissolve rather than a cut.

## What has to be built

**Backend:** nothing for the corpus shape. The `work:`-ref expansion, the group
stamping, the positional `starts:` pairing and the pass-through of unknown
segment fields all exist and are covered by tests.

**Frontend:**
- a pure collapse function in `band.js`, plus the measured trigger;
- `SegmentMap` consuming it;
- a `libretto` module;
- the frame's region-claim mechanism and its hysteresis.

**Data:** three part-work files, a rewritten `messiah.yml`, a new performance
sidecar, and the 53 timings.

**Tooling:** the boundary-derivation script (silence + spectroscopy +
validation), which is a one-off analysis tool, not shipped code.

### Suggested decomposition

This spans four subsystems and should become **three plans**, each producing
something usable on its own:

1. **The timings.** The derivation tool and the 53 verified boundaries. Ends with
   a sidecar that resolves and a rail that draws — coarse, because the corpus is
   still three Parts. Independently valuable: it proves the recording is timeable
   before any UI is built, and if the gate fails, plans 2 and 3 change shape.
2. **The corpus and the collapse.** The three part-works, the rewritten
   `messiah.yml`, and the rail's collapse behaviour. Ends with all 53 numbers on
   screen, correctly grouped.
3. **The libretto panel.** The module, the frame's region-claim mechanism, and
   the hysteresis. Ends with the sung text on the rail.

**Order matters and is not arbitrary:** plan 1 gates the others, because if the
boundaries cannot be derived the whole design reduces to the three-Part rail that
already exists.

## Risks

1. **Detection does not converge to 53.** Mitigated by the gate: fall back to
   three Parts rather than publish approximate boundaries.
2. **Part Two at 25 boxes may not draw at the 960 root.** Measured before
   release; if it fails, the fallback is to collapse to Parts at that root only —
   the trigger is already per-root because the rule's width is.
3. **The plate reads better with the composed-title work** from
   `2026-08-20-surround-followups.md` Task 1, so it says *Part Two No. 44
   Hallelujah* rather than the bare number name. A soft dependency, not a
   blocker.
4. **Three modules' worth of rail behaviour now depends on one data condition.**
   The hysteresis rule is the mitigation and needs its own tests.

## Testing

- **Pure:** the collapse function in `band.js` — unit tests over group runs.
- **Render:** `SegmentMap` draws at most 23 / 25 / 11 boxes as the sounding Part
  changes — fewer wherever this performance omits a number —
  and the collapsed segments carry the Part titles.
- **Regression, load-bearing:** the étude season's rail is **unchanged** — same
  segment count, same groups, same density, at all three roots.
- **Store:** a Messiah-shaped fixture — three `work:` refs plus 53 `starts:` —
  resolves to 53 segments in 3 groups with correct offsets.
- **Measurement:** the collapsed rail draws at all three fleet roots; the
  libretto panel never cuts a text and pages instead.
- **Libretto module:** pages a long text, renders nothing for an instrumental
  number, holds across an inter-number gap and reverts between Parts.

## Out of scope

- `listen:` notes for all 53 numbers (a later pass; ~12 now).
- Per-line text timing — we have per-number timings, so no karaoke-style
  highlighting.
- Any change to how the étude or polonaise rails draw.
- A second recording of Messiah (the corpus supports it; nothing here assumes
  one).
