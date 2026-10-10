# Baptism Path Worksheets — Design

**Date:** 2026-10-09
**Status:** content authored; print documents under `catalog/documents/scripture/baptism-path/`

## Purpose

A one-off scripture packet for a child preparing for baptism at eight. Fifty
multiple-choice look-up questions across the Bible (NIrV), Book of Mormon,
Doctrine and Covenants and Pearl of Great Price, filling exactly one OMR
answer card.

## Angle

Baptism as **starting on the path and learning to walk the way Jesus walked**.
It is not framed as cleansing. An eight-year-old is "alive in Christ"
(Moroni 8:12) and has nothing to be rescued from yet. The angle draws on
John Pontius's *Following the Light of Christ into His Presence* and *The
Triumph of Zion* (reviews in the BoMOnlineWorkspace `theology/lit/reviews/`):

- Christ is a Person to follow, and the questions ask what *he* did and said.
  Institutional requirements are not the focus.
- Change comes by **yielding** (Hel 3:35), not self-conquest. Several decoys
  are deliberately the "try harder alone" answer.
- The **gift** of the Holy Ghost conferred at confirmation is a right. Receiving
  it is ongoing (2 Ne 32:5 "if ye will… receive"; Acts 8:16; 3 Ne 19:9; D&C
  50:24 "brighter and brighter"). Part 4 is built on this distinction.
- **Repentance** appears as turning back to the path whenever you wander
  (Luke 15:20; Moroni 6:8; D&C 58:42) and as the weekly sacrament. It is part
  of walking (Part 5), not the reason for baptism.

The upper-rung apparatus (calling and election, the Second Comforter) is out
of scope.

## Shape

Five `school.document-source/v1` worksheets, 10 questions each:

| Part | Title | Card rows |
|---|---|---|
| 1 | Jesus Showed the Way | 1–10 |
| 2 | Following Him Into the Water | 11–20 |
| 3 | A Promise to Walk With Him | 21–30 |
| 4 | Receiving His Spirit | 31–40 |
| 5 | Walking the Path, and Coming Back to It | 41–50 |

Print-documents (not a `school.course/v2` package) because the packet must
print and grade **without enrollment**. Part 1 renders with a fresh card; parts
2–5 attach to the same card at `startRow` 11/21/31/41
(see `docs/reference/school/print-documents.md` §5–6).

## Page references

Every prompt opens with the book, printed page and verse, e.g.
`Book of Mormon p. 113 · 2 Nephi 31:7`.

- **Bible:** the inferred NIrV Adventure Bible for Early Readers (2014) index,
  resolved with `cli/bible-lesson-pages.mjs` and `PAGE_INDEX` pointed at the
  course's `media/.../mapping/2014-inferred/page-index.yml`.
- **Triple combination:** the 2013 English triple combination PDF. Its running
  heads (`1 Nephi 8 : 1–15 … 14`) were parsed into a ref→page index. The Book
  of Mormon, D&C and Pearl of Great Price are paginated separately, so prompts
  name the section ("D&C p. 66", "Pearl of Great Price p. 20"). Book-opening
  pages carry no running head; Articles of Faith 1:4 sits on such a page (p. 60)
  and was confirmed against the page text.

Verse text was checked against the scripture DB (`NIRV` and `LDS` versions)
when the items were written.

The triple-combination index is saved for reuse at
`media/school/scripture/triple-combination/english-2013/page-index.yml`
(`scripture.page-index/v1`, 859 headed pages, `section: bom|dc|pgp`). The
parser (`pageidx.py`) and lookup (`find.py`) sit beside it.

## Files

- Sources: `data/content/school/catalog/documents/scripture/baptism-path/part-{1..5}.yml`.
  These were generated from one table so pages, refs and answer letters stay
  consistent. Answer letters are a seeded shuffle of a balanced pool (12–13 per
  letter).
- Published: `scripture/baptism-path/part-1@ef415483c` … `part-5@e90148bf9`.
- Layout: `flow` at `standard` type scale, two pages per part.

## Printing on one card

1. `POST /api/v1/school/print/render` with
   `{ id: "scripture/baptism-path/part-1", freshCard: true, learnerName }`
   mints the card (rows 1–10). Read the card number off the sheet or the
   `X-School-Print-Allocation` header.
2. Parts 2–5: same call with `{ card: "<id>", startRow: 11 | 21 | 31 | 41 }`.
   The planner numbers each sheet's questions with its card rows.
3. Scanning the card grades all five allocations.

## Renderer fix made alongside

Proofing showed long choice labels in a 4-column OMR row wrapping at the full
cell width, so text ran flush into the next column. Both OMR themes now carry
`omr.choiceColumnGutterPt: 8`, and `measure.mjs` wraps normal-density labels
at `cellWidthPt - gutter`. `tests/isolated/rendering/school/measure.test.mjs`
now asserts the gutter.
