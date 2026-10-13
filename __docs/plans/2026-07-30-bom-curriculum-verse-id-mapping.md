# Book of Mormon curriculum — master mapping

**Status:** mapping reference, in progress. The spine is built; the audio side is
partially mapped and partially blocked on text matching.

Three independent taxonomies describe the same book. This document defines how
they join, records what is mapped today, and specifies the method for the rest.

---

## 1. The join key

`verse_id` — a global integer over the whole standard works, from
`scripture-guide` (`lookupReference`, offline, no DB).

| | verse_id |
|---|---|
| 1 Nephi 1:1 | 31103 |
| Alma 17:25 | 34098 |
| Moroni 10:34 | 37706 |
| **Book of Mormon span** | **31103 – 37706** (6,604 verses) |

Every layer below reduces to a verse_id range. Nothing else is shared between
them — not chapter numbers, not track numbers, not titles.

All three layers already speak it natively, which is why this works:

- bomonline rows carry a `heading` that resolves to verse_ids
- CFM watchlists already use `contentId: "scriptures:<verse_id>"`
- Illustrated Stories puts the reference in its ID3 `TIT2` / MP4 `©nam`

---

## 2. Layer A — bomonline narrative taxonomy

Source: `bookofmormon.online` GraphQL (`BoMOnlineWorkspace/cli/bom-client.mjs`,
read-only, no credentials). Built by `_spine_build.mjs` → `_spine.json`.

```
division   12    narrative era        "Zarahemla Under Judicial Rule"
  page     49    narrative arc        "Korihor the Anti-Christ"
    section 480  scene                (the LESSON atom)
      row  2998  one verse-range + a plain-language narration
```

**Built:** 2,998 rows, **6,600 / 6,604 verses (100%)**, span 31106–37672 plus the
patched Moroni tail.

Each row carries:

| field | use |
|---|---|
| `heading` | its own scripture range → `verseStart` / `verseEnd` |
| `narration` | one-line plain-language retelling — **the grounding text** |
| `people`, `places` | entity anchors, useful as matching features |
| `division`/`page`/`section` | the arc hierarchy |

**Trap:** a row's `refs[]` are **cross-references** to the wider standard works
(`10221:2kgs 24:18`), spanning verse_id 40–41952. They are *not* the row's own
range. Use `heading`. This cost an hour the first time.

**Known defect:** the `moroni` page throws server-side on
`textParent.heading` for 3 rows. `_moroni_patch.mjs` re-fetches tolerantly and
merges; 104 of ~121 rows recovered, 4 verses still uncovered.

### Balancing (already computed)

Packing sections into units by **reading volume (rows)**, cutting only at page
seams, yields **158 lessons in 16 units** at 164–257 rows per unit — a 1.6×
spread, versus 5.1× for book divisions and 30× for raw pages. Balance on rows,
not sections: section sizes vary 1–52 rows, so section-count balancing produces
units that differ 7× in actual reading load.

**Ordering caveat:** bomonline sequences **chronologically**, so the Jaredite Era
comes first, not as book 14. Fine for a narrative curriculum; confusing for a
child following in a printed copy. Unresolved.

---

## 3. Layer B — reading plans (already exists in `bom_prd`)

**This layer did not need authoring.** It is already built, verse_id-keyed, and
covers the Book of Mormon completely. Access via
`BoMOnlineWorkspace/cli/db.mjs` (read-only MySQL).

### `bom_readingplan_seg` — the segments

`plan = 'cfm2024'`: **49 segments, 6,604 / 6,604 verses (100%), zero gaps.**

| column | meaning |
|---|---|
| `start` / `end` | **verse_id range** — the join key |
| `ref` | `1 Nephi 1–5` |
| `title` | `"I Will Go and Do"` |
| `period` / `duedate` | `January 8–14` / `2024-01-14` |
| `sectionGuids` | JSON array of `bom_section.guid` — **direct join to Layer A**, no range-overlap needed |

### `bom_readingplan_program` — pacing policy

Four programs, each with a `config` JSON that already models the metered layer:

```json
{ "scope":        { "type": "range", "start": 31103, "end": 37706 },
  "credit":       "fresh",
  "pacing":       { "type": "cadence", "unit": "week", "count": 52 },
  "segmentation": { "type": "even", "parts": 52 } }
```

- `bom-in-a-year` — 52 weeks, even
- `90-day-challenge` — 90 days, even
- `one-page-at-a-time` — self-paced, page-segmented, `credit: alltime`
- `mosiah-in-30-days` — scoped to `32793..33577`

### This is our taxonomy, already implemented

| `bom_prd` | our design |
|---|---|
| `bom_readingplan_program` (scope / pacing / segmentation / credit) | **curriculum** — static, repeatable, carries the metering policy |
| `bom_readingplan` (owner, startdate, duedate, status `active\|completed\|abandoned`) | **enrollment + cycle** |
| `bom_readingplan_seg` (verse range, duedate, sectionGuids) | **lesson** |
| `credit: fresh \| alltime` | per-cycle vs cumulative — the **repeat semantics** |
| `scope.start/end` | level- or age-narrowed subsets |

`credit: fresh` is precisely the "each pass starts clean" behaviour a repeatable
curriculum needs; `alltime` is the cumulative variant. **Align to this schema
rather than inventing a parallel one.**

Caveat: the single `bom_readingplan` row (`cfm2024`) has an empty `owner` and
`status` — it is a *template*, not a live enrolment. Per-student instances do not
exist yet.

The 52-week cadence and the 158-lesson spine are **different meterings of the
same spine**, not competing plans — exactly what `segmentation` + `pacing`
already express.

---

## 4. Layer C — Plex audio

| Album | ratingKey | tracks | mapped from metadata | method for the rest |
|---|---|---:|---:|---|
| Illustrated Stories | 158739 | 488 | **468 (96%)** | 20 unmapped: 8 are zero-byte files, 12 are OT/NT intro refs (Moses, Isaiah, Luke, John) correctly outside the BoM span |
| Hallowed Journey | 158563 | 175 | **1** | text matching |
| Dramatized Golden Plates | 472935 | 46 | **0** | text matching |
| BoM Stories (church) | 469568 | 54 | — | text matching |
| Learning to Read | 469461 | 35 | — | text matching |
| Storybook for Little Saints | 469410 | 50 | — | text matching |
| Scripture Scouts — BoM | 468450 | 30 | — | thematic, may not map to ranges |

**Illustrated Stories reaches only 2,870 / 6,604 verses (43%)** even at 96% track
mapping — the album is selective, and ~61% of its manifest is missing from disk
anyway. It cannot carry a level on its own.

### Why the others need text matching

Dramatized transcripts **paraphrase**; they never cite. `scripture.mjs detect`
returns **0 matches** on a Hallowed Journey transcript even where the narration
is near-verbatim, because detection looks for reference *strings* ("1 Nephi 1:1")
and the audio only ever contains the *words*.

Full-text search against scripture works but is brittle:

- `"born of goodly parents"` → `31103` (1 Ne 1:1) — correct
- `"fountain of living waters"` → `31356` (1 Ne 11:25) — **wrong**; in the Golden
  Plates audio that line is Lehi quoting Jeremiah 2:13

---

## 5. Method for the unmapped tracks

Match against **Layer A's `narration`, not scripture text.** Both the narration
and a dramatized transcript are plain-language retellings of the same events, so
they share register and vocabulary. Scripture text does not.

```
Lehi runs home to recover from his experience.        <- narration, 1 Ne 1:7
"...he returned to his own house... cast himself      <- transcript
 upon his bed, being overcome with the Spirit"
```

Pipeline per track:

1. Take the track's transcript (`.txt` sidecar, already generated).
2. Score it against all 2,998 narration rows.
3. Constrain to a **contiguous run** — a track is one continuous stretch of
   narrative, so the answer is a range, not a scatter. This alone kills most
   false positives.
4. Constrain by **album ordering** — track N's range must start at or after
   track N−1's. Both albums are in narrative order.
5. Emit `verseStart`/`verseEnd` plus a confidence score.
6. **Review anything low-confidence by hand.** Guess-and-check, as expected —
   the ordering constraint makes the guesses cheap to verify because a wrong
   match usually breaks monotonicity visibly.

Entity anchors (`people`, `places` on each row) are strong extra features:
a transcript naming Korihor and Antionum has a very small candidate set.

---

## 6. Output shape

One record per (album, track):

```yaml
- album: 158563            # Hallowed Journey
  segment: plex:<ratingKey>
  file: "15 The Liahona Guides Them. Nephi Breaks His Bow.mp3"
  verseStart: 31533
  verseEnd:   31560
  method: text-match       # metadata | text-match | hand
  confidence: 0.82
  reviewed: false
```

Joined against Layer A, this yields the rendition table the curriculum needs:
`lesson → level → segments`, since a lesson's verse range selects the tracks
whose ranges overlap it.

---

## 7. Building the spine from SQL (preferred over the API)

`cli/db.mjs` beats the GraphQL API: no per-page failures, no dropped rows.

`bom_text` holds `min_verse_id` directly. `bom_narration` links via
`bom_sectionrow` (`type='N'`), but **not by guid and not by `weight`** — pair
them by **ordinal position within the section**:

```sql
WITH t AS (
  SELECT guid, heading, min_verse_id, section, page,
         ROW_NUMBER() OVER (PARTITION BY section ORDER BY weight) rn
  FROM bom_text WHERE min_verse_id BETWEEN 31103 AND 37706
), n AS (
  SELECT sr.parent AS section, nr.description,
         ROW_NUMBER() OVER (PARTITION BY sr.parent ORDER BY sr.weight) rn
  FROM bom_sectionrow sr JOIN bom_narration nr ON nr.parent = sr.guid
  WHERE sr.type='N'
)
SELECT t.min_verse_id AS verse_id, t.heading, t.section, t.page,
       n.description AS narration
FROM t JOIN n ON n.section = t.section AND n.rn = t.rn
ORDER BY t.min_verse_id
```

→ **2,998 rows, span 31103–37706, all 479 sections, 49 pages.**

Traps: joining on `weight` directly yields only 448 rows (weight is not a
consistent per-section ordinal); `bom_narration.parent` is a `bom_sectionrow`
guid, not a `bom_text` guid; `bom_sectionrow.type` is `N` (3002) / `C` (138) /
`O` (28) and only `N` carries narration.

Table sizes: `bom_text` 3,544 · `bom_narration` 3,003 · `bom_sectionrow` 3,168 ·
`bom_section` 481.

---

## 8. Open items

- [x] ~~Author the BoM-year CFM plan~~ — **exists**: `cfm2024`, 49 segments, 100%
- [ ] Decide chronological vs textual ordering
- [ ] Decide lesson-level balance: accept 3–52 row variance, or split sections
- [ ] Run text matching for Hallowed Journey (175), Golden Plates (46), and the
      four wave-2 albums
- [ ] Reconcile our 158-lesson packing against the existing 49 `cfm2024`
      segments — are these two programs, or is ours a `segmentation` variant?
- [ ] Decide whether School reads `bom_prd` directly or mirrors it into YAML
- [ ] Illustrated Stories cannot cover a level alone at 43% — decide whether to
      backfill the missing audio or pair it with BoM Stories for the `early` level

---

## Artifacts

| file | what |
|---|---|
| `BoMOnlineWorkspace/cli/db.mjs` | read-only SQL against `bom_prd` — **the primary access path** |
| `BoMOnlineWorkspace/cli/scripture.mjs` | `lookup` / `search` / `detect`; `lookupReference` from `scripture-guide` resolves refs offline |
| `BoMOnlineWorkspace/cli/bom-client.mjs` | GraphQL client — lossy, prefer SQL |
| `BoMOnlineWorkspace/_spine_sql.json` | 2,998 rows, the join table (SQL-built) |
| `BoMOnlineWorkspace/_spine_build.mjs` / `_moroni_patch.mjs` | API-based build, superseded |
| `.../<album>/*.txt` | transcripts, sidecar per track |
