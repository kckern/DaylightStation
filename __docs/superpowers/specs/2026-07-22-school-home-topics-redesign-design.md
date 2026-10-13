# School Home — Subjects + Student Rail Redesign

**Date:** 2026-07-22
**Status:** Approved (brainstormed with KC)

## Problem

The School home's browse area is a flat shelf of whatever the registries
produce — practice banks, catalog categories, language courses — organized by
system nouns, not by how a family thinks about school. The learner's own
status (who am I, what's next, how am I doing) is spread between a primary
card and a separate Progress section.

## Decisions (from brainstorm)

- **Six subjects** are the organizing principle: **Reading, Civilization,
  Language, Math, Science, Writing** (renames during review: Literature →
  Reading, History → Civilization; Writing added).
- **Layout:** left ⅔ = subject tile grid (2×3, fills exactly). Right ⅓ = meta
  rail: **Student panel** (top) and **Library** (bottom).
- **Student panel** absorbs the old primary/secondary "up next" cards: avatar +
  name, up-next action (tap = launch), most recent activity, latest score,
  today's progress; flips to "Done for today" when the day's work is cleared.
  Unclaimed → "Who's learning?" → profile picker. Tapping the panel body opens
  the full progress board (existing `ReportPanel`).
- **Library** = reference-category material plus anything untagged — content
  for looking things up, never part of a curriculum. Untagged generic quiz
  banks appear here as a Practice group.
- **Mapping is config-driven** via a `subject:` field (NOT `topics`, which
  banks already use for free-form tags): materials sources in `school.yml`
  and bank YAMLs declare `subject: reading|civilization|language|math|science|writing`.
  Glossika language courses are always subject `language` (no config needed).
  Unknown/missing subject → Library. Parents re-shelve by editing YAML.

## Backend (pass-through only, no new endpoints)

- `SchoolService.listBanks` summaries gain `subject` (from bank YAML, null if
  absent).
- `GetMaterialCatalog` stamps `subject` from the `materials.sources[]` entry
  onto each material (null if absent).

## Frontend

| File | Role |
|------|------|
| `home/subjects.js` | `SUBJECTS` registry + `groupBySubject({materials, banks, courses})` → `{ bySubject, library }` (pure, tested) |
| `home/SchoolHome.jsx` | The home layout: subject grid left, meta rail right |
| `home/StudentPanel.jsx` | Report-driven learner status (claimed) / claim prompt (unclaimed) |
| `home/SubjectPage.jsx` | One subject's content: materials (via `MaterialsSection`), practice banks, language course tiles |
| `home/LibraryPage.jsx` | Reference + untagged materials, untagged banks as Practice |
| `SchoolApp.jsx` | Routes `subject:<id>`, `library`; home renders `SchoolHome` for claimed AND unclaimed |
| `browse/BankBrowser.jsx` | Optional `subjectFilter` prop: undefined = all (today's behavior), `'<id>'` = that subject, `null` = untagged only |

`LearnerHome` is superseded by `SchoolHome` + `StudentPanel` and removed.
Empty subjects (e.g. Writing until content ships) render greyed, same
convention as unbuilt programs in the registry.

### Grouping rules (`groupBySubject`)

1. Material with `category: 'reference'` → Library, always.
2. Material with a known `subject` → that subject; unknown/missing → Library.
3. Bank with known `subject` → that subject; else → Library (Practice group).
4. Language courses → subject `language`, unconditionally.

### Student panel data

All from existing endpoints: up-next = first actionable report
(`state ∉ {satisfied, complete}` with a `next`), today metric
(`kind: progress, scope: today`), last-activity = max `lastActivity` across
reports, latest score from `GET /users/:id/results` (lane with newest
`lastAt`, shown as accuracy). No goals — not in the data model yet; the panel
leaves room.

## Testing

- `subjects.test.js` — grouping rules incl. reference-always-library and
  language-course default.
- `StudentPanel` state selection (up-next choice, done-state flip).
- `SchoolApp.test.jsx` updated for the new home shape.

## The framework principle (KC, during build)

Subjects are the TOP level; the second level inside a subject is instances of
**reusable content frameworks** — fully custom programs (Glossika), reusable
classes (Plex materials with quiz gates, video or audio; quiz/flashcard
banks) — and one framework class may appear under any number of subjects.
Example: Shakespeare quizzes shelve under Civilization purely by
`subject: civilization` in their bank YAML. New frameworks plug into shelves
the same way; the wall itself never changes shape.

## Out of scope

Learning goals, parent editing UI for subjects, per-subject theming.
