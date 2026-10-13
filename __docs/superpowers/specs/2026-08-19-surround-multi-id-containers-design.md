# Surround enrichment across multiple media items — design

**Date:** 2026-08-19
**Status:** approved for planning

## 1. The problem

Surround enrichment assumes one work lives inside one media file. Every timing concept
depends on it: `match.contentId` is a single id, `starts[i]` is an offset from the top of
that file, `musicEndsAt` is a second in the same file, and the movement rail's geometry is
a fraction of one `duration` driven by one media clock.

Two authored programmes break that assumption.

**A recital spanning items.** A Plex season of seven Chopin polonaises: seven files, seven
ratingKeys, seven different pianists, 59 minutes. Each polonaise is already a corpus work
in its own right. There are no offsets to author, because each part starts at zero in its
own file.

**A set of sets.** A Plex season of the complete Chopin études: one container, three
episodes, and **27 études** — twelve in Op. 10, twelve in Op. 25, three in the Trois
nouvelles. Each opus is a genuine authored work with its own summary and facts; each étude
is a chapter with its own name and sometimes its own note. Two addressing modes stack: an
episode boundary between opus sets, a time offset within one. Episodes also carry dead time
— bumpers, applause at either end, and applause *between* études.

## 2. Concepts

`work` / `movement` generalise to **container** / **chapter**.

A **chapter** is a span of the programme. It is addressed either as an offset inside a media
item or as a whole media item. The rail, bond, accordion, NOW panel and type fit all consume
"chapters, an active index, and a fraction," so none of them needs to know which.

A **group** is a run of consecutive chapters that share a parent work. Groups exist for
presentation only: the data is a tree, the rail is a flat list.

A **span** is `[start, end]` in seconds within one media item. Spans replace implicit
"runs until the next start" boundaries, because a gap between two chapters is real content
(applause) that belongs to neither. Time not covered by any span is **dead time**.

### Sidecar shapes

- **timed** — one media item, chapters are spans within it. Today's Eroica.
- **sequenced** — a container item, each chapter is a whole media item. The polonaises.
- **sequenced-timed** — a container item whose parts are media items, each carrying its own
  spans. The études. This is the general case; the other two are degenerate forms of it.

## 3. Data model

### Corpus (`data/content/library/...`)

A work gains `chapters:`. Each entry is either inline — `name`, `translation`, `listen`,
`note`, as movements are today — or a **reference**:

```yaml
chapters:
  - work: chopin/polonaise-op-53
```

A reference resolves to the target work *and its own chapters*, so referencing
`chopin/etudes-op-10` brings its twelve études with it. `movements:` remains an accepted
alias for `chapters:`; all existing corpus files keep working untouched.

### Performance sidecar (`data/content/surround/...`)

```yaml
work: chopin/etudes                 # the container work
surround: concert-hall
match:
  contentId: plex:<season>          # a container id
parts:
  - work: chopin/etudes-op-10       # which corpus work this episode performs
    contentId: plex:<episode-1>
    spans: [[12.4, 121.0], [128.6, 275.2]]   # one per chapter, in chapter order
    performance: "..."              # optional, per part
  - work: chopin/etudes-op-25
    contentId: plex:<episode-2>
    spans: [...]
```

`starts: [...]` plus `musicEndsAt:` remains supported for a single-item work and desugars to
contiguous spans, so the Eroica and Spring sidecars need no edit.

A part with no `spans` whose referenced work has exactly one chapter is a single-chapter part:
the whole item is that chapter, and no timing needs authoring. That is the polonaise case. A
part with no `spans` whose referenced work has more than one chapter is an authoring omission,
not a shorthand — it warns and that part contributes one unsegmented chapter, so the rail stays
truthful rather than inventing boundaries.

Per-part `performance` is required for the polonaises, where every part has a different
pianist, stage and year.

## 4. Resolution

**The store stays pure YAML and synchronous.** It resolves chapter references against the
corpus, reusing the visited-real-path cycle guard added in `ab7c7d9b5`, and flattens the tree
into an ordered chapter list where each chapter carries its group and its addressing.

**The queue path does container expansion.** Building a queue from a container already lists
that container's children; it stamps each queue item with the container payload, the item's
part index, and the sibling durations it already holds. No new call to Plex.

**Standalone playback is unchanged.** Playing one polonaise directly never enters the queue
path, so `lookup(item.id)` finds that work's own sidecar and renders the standalone frame.
The same media item reads as a whole work or as part 6 depending on how you arrived.

## 5. Ordering

**An enriched container imposes its authored chapter order.** When the backend resolves
surround metadata for a container, that order overrides shuffle — a programme is a programme,
and playing the Revolutionary étude third would be wrong in a way no rail can rescue.

A config key (`surround.enforceOrder`, default true) opts out. When ordering is *not*
enforced and the queue order does not match the authored order, the frame **renders no rail
at all** rather than a rail that lies about position. That degradation must have a test that
can fail.

## 6. Presentation

**One flat rail.** Segment widths come from span durations for timed parts and item durations
for untimed ones. The rail's length is the sum of *sounding* time; dead time is excluded from
widths.

**Global position** = sounding time in parts before this one, plus completed spans within this
part, plus the offset inside the current span.

**Dead time renders as the nothing-sounding state** already shipped in wave 9: no segment lit,
NOW panel blank, band height unchanged. What was a twice-per-piece edge case becomes routine.

**Groups** are labelled runs. With 27 segments at 1280px (~47px each) no chapter name fits in a
segment, so: segments carry numerals only, the group label spans its run, the accordion widens
the active segment to render its name in full, and the NOW panel carries the current chapter's
name and note. The accordion is therefore load-bearing here, not a refinement.

**The placard** headlines the current chapter with the set beneath — "Polonaise in A-flat major,
Op. 53" over "Chopin Polonaises · 6 of 7".

**Facts** fall back chapter note → parent work facts → container facts. The pool swaps at a
chapter boundary through the existing dissolve.

## 7. Transport

One rule — "go to the next chapter" — with two implementations, chosen per boundary: a seek
within a timed part, a queue advance across parts. At the ends it falls through to today's
queue behaviour, per the wave-10 design. This supersedes wave 10's assumption that chapters
live in one item.

## 8. Authoring

Spans are authored, not inferred. Preferred sources in order:

1. **Existing chapter markers** — a YouTube source often carries them, and an ingest can read
   them directly.
2. **Spectrogram plus silence detection** — the standard method. Applause is broadband noise
   with no harmonic structure and is unmistakable in a spectrogram; a concert hall's noise
   floor (−55 to −62 dBFS observed) is too high for silence detection alone to find movement
   boundaries, so the image localises and the RMS profile pins.

Derived spectrograms are filed under `media/img/library/<domain>/<composer>/` beside the other
non-Plex assets, so a timing can be re-checked later without re-deriving it.

## 9. Failure modes

| Condition | Behaviour |
|---|---|
| Queue order ≠ authored order, enforcement off | No rail; frame otherwise intact |
| A part's `contentId` missing from the container | Warn naming the part; that part's chapters unrendered, rest of rail intact |
| Chapter reference does not resolve | Existing `surround.work.missing` warn; container still resolves with that chapter inline-less |
| Reference cycle | Broken by the visited-set guard; warn |
| `spans` count ≠ referenced work's chapter count | Warn naming both counts; unpaired chapters get no timing, as `starts.mismatch` does today |
| Span overlaps its neighbour | Warn; later span wins, so the rail stays monotonic |
| Plex rescan remints ratingKeys | The existing title-rebind lane applies to the container id |

## 10. Testing

- Chapter reference resolution, including a subtree reference and a cycle.
- Span desugaring from `starts` + `musicEndsAt` — the Eroica payload must be byte-identical
  before and after.
- Global position mapping across parts, inside a span, and inside a gap.
- Order-mismatch degradation — must fail if the rail renders anyway.
- 27-chapter rail geometry in the committed Chromium measurement spec at all three fleet
  roots: group labels legible, active segment's name whole, no chapter name clipped.
- Standalone versus in-container resolution for the same media id.

## 11. Out of scope

Four levels of nesting. Playlists spanning libraries. An authoring UI. Automatic span
derivation (the analysis skill is a separate spec; this one consumes its output).
