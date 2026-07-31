# BoM comprehensive mapping — implementation plan

Companion to `2026-07-30-bom-curriculum-verse-id-mapping.md` (the reference).
This is the executable task list.

**Decisions locked (2026-07-30):**
1. `bom_prd` is the authoring source; export a flat verse_id-keyed **YAML mirror**
   into DaylightStation. School reads YAML only — no runtime DB coupling.
2. Store **both orderings and all segmentations as data**. A program config
   picks at runtime. No pedagogy call is baked into the mapping.
3. **Map every album**, compute coverage as a derived report. Gaps are data,
   not blockers. Levels resolve as an ordered fallback across albums.

**Output root:** `data/content/school/curriculum/bom/`

---

## Task 1 — Export the spine

Build `spine.yml` from `bom_prd` using the ordinal-pairing query
(reference §7 — pair `bom_text` to `bom_narration` by `ROW_NUMBER()` within
section, NOT by `weight`, NOT by guid).

Per row: `verse_id`, `heading`, `narration`, `section`, `page`, `division`,
`textual_seq`, `chrono_seq`.

- `textual_seq` — rank by `verse_id` ascending
- `chrono_seq` — rank by bomonline's own division/page/weight order, which is
  chronological (Jaredite Era first)

**Verify:** row count 2998; verse span 31103–37706; 479 sections; 49 pages;
every row has non-empty narration; both seq columns are dense 1..N with no gaps.

## Task 2 — Export the reading plans

Build `plans.yml` from `bom_readingplan_seg` (plan `cfm2024`) and
`bom_readingplan_program` (4 pacing programs).

Per segment: `start`, `end`, `ref`, `title`, `period`, `duedate`,
`section_guids`. Per program: `slug`, `title`, and the `config` block
(`scope`/`credit`/`pacing`/`segmentation`) verbatim.

**Verify:** 49 segments; contiguous with zero gaps; union == 31103–37706
(6604 verses); 4 programs each with a parseable config.

## Task 3 — Compute the arc-158 segmentation

Pack sections into units by reading volume, cutting only at page seams
(reference §2). Emit as one more entry in `segmentations`, alongside `cfm2024`
— not as a replacement.

**Verify:** ~158 lessons in ~16 units; unit spread ≤ 2.0x on rows; every lesson
maps to a contiguous verse range; union covers 31103–37706.

## Task 4 — Map Illustrated Stories (deterministic)

Resolve each track's title tag through `lookupReference`. 468 of 488 map;
record the 20 that don't with a reason (`empty-file` × 8, `out-of-canon` × 12 —
Moses/Isaiah/Luke/John intro refs).

**Verify:** 468 mapped; every range inside 31103–37706; unmapped rows each carry
a reason; no track maps to a range that inverts album order.

## Task 5 — Map the remaining albums (text matching)

For Hallowed Journey, Golden Plates, BoM Stories, Learning to Read, Storybook
for Little Saints: score each transcript against the 2998 spine narrations.
Constrain to a contiguous run, and to monotonic album order. Emit
`verse_start`, `verse_end`, `method`, `confidence`.

**Blocked on:** wave 3 transcription (Illustrated Stories) finishing.

**Verify:** every track has a range or an explicit `unmapped` reason; ranges are
monotonic within each album; spot-check 10 by hand against the audio's title.

## Task 6 — Coverage matrix

Derive `coverage.yml`: for each (album × lesson), covered / partial / gap.
Report per-album verse coverage and per-lesson album availability.

**Verify:** Illustrated Stories ≈ 43%; every lesson lists at least one covering
album, or is flagged as a hole in every album.

## Task 7 — Wire into School

Register a `curriculum-spine` source in `school.yml` pointing at the exported
YAML. Category `course`, subject `scripture`.

**Verify:** School boots; the Scripture shelf renders the curriculum; one lesson
resolves end-to-end to playable segments.

---

## Batching

- **Batch 1:** tasks 1–3 (export + segmentations) — no dependency on transcription
- **Batch 2:** tasks 4–6 (rendition mapping + coverage)
- **Batch 3:** task 7 (integration)
