# School home: nine subject shelves (3×3)

**Date:** 2026-07-22
**Supersedes:** the six-shelf wall from `2026-07-22-school-home-topics-redesign-design.md`

## What changes

The subject wall grows from six shelves to nine, rendered as a 3×3 grid.
Two shelves are reshaped, one is split into three, and one is new:

| Row | Tiles |
|-----|-------|
| 1 | English · Literature · Writing |
| 2 | Math & Money · Science · Skills |
| 3 | History · Geography · Language |

The full list (ids are code-level, fixed in `frontend/src/modules/School/home/subjects.js`):

| id | Label | Hint | Notes |
|----|-------|------|-------|
| `english` | English | Vocabulary, grammar, and reading | renames `reading` — the *skill* of our language |
| `literature` | Literature | Great stories and classics | from the civilization split — the *works* |
| `writing` | Writing | Put it in your own words | unchanged |
| `math` | Math & Money | Numbers, patterns, and money | label/hint only; econ + finance content shelves here |
| `science` | Science | How the world works | unchanged |
| `skills` | Skills | Hands-on — art, cooking, making | new; practical/hands-on content |
| `history` | History | People and the past | from the civilization split |
| `geography` | Geography | Places, maps, and the world | from the civilization split |
| `language` | Language | Hear it, say it, write it | unchanged — foreign languages (Glossika) |

`civilization` is deleted. Anything still stamped `subject: civilization`
routes to the Library via the existing unknown-subject rule — no migration
shim, no special handling.

## Why these boundaries

- **English vs Writing vs Language vs Literature:** English is the mechanics
  of our language (vocab, grammar, spelling, reading skill — "the child reads
  better"). Writing is composition. Language is foreign languages. Literature
  is the canon — works studied for cultural literacy, regardless of medium
  (an audiobook of Shakespeare is Literature, not "reading").
- **Placement test for a book:** if it's on the shelf *because it's at the
  child's level*, it's English; if it's there *because everyone should know
  this work*, it's Literature.
- **Skills, not Art:** the ninth shelf is hands-on practical content — art,
  cooking, making — one shelf, not a fine-arts silo.
- The shelf list stays FIXED IN CODE (a new shelf is a curriculum decision,
  not a config edit), exactly as before — only the list itself changes.

## Layout

`.school-home2__subjects` becomes a 3×3 grid (currently sized for six
tiles). Same tile component, same greyed-empty behaviour, same rail
(student panel + Library) on the right third.

## Data restamps (prod `data/household/config/school.yml`)

| Source | Change | Rationale |
|--------|--------|-----------|
| I Survived | `subject: civilization` → `history` | in the curriculum for the historical events |
| Shakespeare Tales | `subject: civilization` → `literature` | canonical works |
| Art Lessons | add `subject: skills` | currently subject-less → Library |

`school.yml` is boot-cached — the container needs a restart after the edit.
The file's header comment ("six shelves… reading | civilization | …") must be
updated to name the nine.

## Backend

No code changes: `subject` is a free-form pass-through in
`GetMaterialCatalog.mjs` / `SchoolService.mjs`; shelving is a frontend
concern.

## Docs

- `docs/reference/school/README.md` — update shelf list ("six" → nine).

## Tests

- `subjects.test.js` — nine ids, grouping rules (unknown → Library still).
- `SchoolApp.test.jsx` / `StudentPanel.test.js` — update any six-shelf
  expectations.
