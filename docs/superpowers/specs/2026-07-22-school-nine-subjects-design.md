# School home: nine paired subject shelves (3×3)

**Date:** 2026-07-22 (amended same day: shelves became pairs, Scripture and
Arts added, Literature/Geography merged away)
**Supersedes:** the six-shelf wall from `2026-07-22-school-home-topics-redesign-design.md`

## What changes

The subject wall grows from six shelves to nine, rendered as a 3×3 grid.
Every shelf is a **pair** — one tile, two allied strands ("X & Y"), with
Math & Money as the pattern-setter.

| Row | Tiles |
|-----|-------|
| 1 | English & Literature · Writing & Typing · Language & Culture |
| 2 | Math & Money · Science & Nature · Life & Skills |
| 3 | History & Geography · Scripture & Gospel · Art & Music |

The full list (ids are code-level, fixed in `frontend/src/modules/School/home/subjects.js`):

| id | Label | Hint | Notes |
|----|-------|------|-------|
| `english` | English & Literature | Reading, grammar, and great books | replaces `reading`; the skill AND the canon |
| `writing` | Writing & Typing | Put it in your own words | composition + the portal's typing rungs |
| `language` | Language & Culture | Hear it, say it, write it | foreign languages (Glossika) |
| `math` | Math & Money | Numbers, patterns, and money | econ + finance content shelves here |
| `science` | Science & Nature | How the world and nature work | |
| `skills` | Life & Skills | Hands-on — cooking, making, life | practical life, not fine arts |
| `history` | History & Geography | People, places, and the past | absorbs both halves of old Civilization |
| `scripture` | Scripture & Gospel | Scriptures, stories, and faith | new — spiritual education |
| `arts` | Art & Music | Draw, paint, sing, and play | new — fine arts (distinct from Skills) |

`civilization`, `reading`, `literature`, and `geography` ids do not exist.
Anything stamped with an unknown subject routes to the Library via the
existing rule — no migration shim.

## Why these boundaries

- **Pairs, not singletons:** each tile names two allied strands so the nine
  tiles cover a wide curriculum without a sprawling taxonomy.
- **`english` vs `writing` vs `language`:** English & Literature is our
  language and its works (vocab, grammar, fluency, canon — an audiobook of
  Shakespeare shelves here); Writing & Typing is composition plus keyboard
  skill; Language & Culture is foreign languages.
- **`arts` vs `skills`:** fine arts (draw/sing/play) versus hands-on
  practical life (cook/make/do).
- The shelf list stays FIXED IN CODE (a new shelf is a curriculum decision,
  not a config edit).

## Icons

Each tile carries an inline-SVG icon, PianoKiosk pattern
(`home/icons/Icon.jsx`, raw SVG via `import.meta.glob`, `currentColor`,
`1em`). The set is user-curated from SVG Repo (ingested from `media/tmp/`),
normalized on ingest; filenames are subject ids. See `home/icons/MANIFEST.md`.

## Layout

`.school-home2__subjects` is a 3×3 grid; same tile component, empty shelves
render greyed, the meta rail (student panel + Library) keeps the right third.

## Data stamps (prod `data/household/config/school.yml`)

| Source | `subject:` | Rationale |
|--------|-----------|-----------|
| I Survived | `history` | in the curriculum for the historical events |
| Shakespeare Tales | `english` | the canon lives on English & Literature |
| Art Lessons | `arts` | fine-arts instruction, not practical skills |

`school.yml` is boot-cached — the container needs a restart after edits. The
file's header comment names the nine ids.

## Backend

No code changes: `subject` is a free-form pass-through in
`GetMaterialCatalog.mjs` / `SchoolService.mjs`; shelving is a frontend
concern.

## Docs

- `docs/reference/school/README.md` — shelf list and icon-set note.

## Tests

- `subjects.test.js` — nine ids in grid order, grouping rules (unknown →
  Library still).
- `SchoolApp.test.jsx` — full paired labels ("Science & Nature", …).
- `icons/Icon.test.jsx` — every subject id has an inline SVG; unknown name
  renders nothing.
