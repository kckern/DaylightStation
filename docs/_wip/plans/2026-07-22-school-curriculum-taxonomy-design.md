# School: curriculum taxonomy and Plex-bound chapter quizzes

**Date:** 2026-07-22
**Status:** design validated; data/config landed, code not started

## Problem

379 chapter quizzes were authored for two Plex audiobook series (an "I Survived"
history series and a Shakespeare retelling collection). Each quiz corresponds to
exactly one Plex track. None of them could be reached:

1. **Bank `id` did not match its file path.** `YamlSchoolDatastore.listBankIds()`
   returns file paths, but `SchoolService.listBanks()` emits each bank's YAML
   `id:` field, and `getBank()` resolves that value back through
   `readBankRaw()` as a *path*. The authored ids omitted their top two folder
   levels, so every bank listed correctly and 404'd on open. This contract is
   implicit and untested — the service test fixture stubs `listBankIds` as
   `Object.keys(BANKS)`, which bakes the assumption in and never exercises a
   mismatch.
2. **`unit:` held a folder slug, not a Plex key.** `GetMaterialUnits` builds its
   bank index keyed on `plex:<trackRatingKey>` (the unit ids emitted by
   `PlexAlbumSource`). A slug never matches, so no quiz ever attached to a unit.
   The correct value was already present in each file as `source.plex_track`.
3. **One configured Plex root was a dead ratingKey**, so that entire series
   produced no materials at all.

Separately, the config declared a `subject:` key and a "subject wall" that **no
code has ever read** — `grep subject` across the School backend and frontend
returns nothing. Home tiles are derived from `category`
(`course`/`reference`/`listening`).

## What already worked

Worth stating, because it shaped the design: the play→quiz→gate→unlock chain is
fully built. `SchoolMaterialPlayer` plays a unit, and on natural end reads
`unit.quiz.bankId`, fetches the bank, and swaps in `QuizRunner`. A passing score
satisfies the gate, which completes the unit and unlocks the next.

None of that needed changing. The three problems above were data misalignment,
not missing features — so the fix was a data rewrite, not new code.

## Decisions

**Entry point: audio-first only.** Chapter quizzes are never browsable
standalone. They fire after their track. This also sidesteps the flat
`BankBrowser` grid, which would otherwise have to render 379 items.

**`school.yml` is the source of truth** for organisation — taxonomy, pedagogy,
and enrolment. Per-work detail drills down into
`{dataDir}/household/config/curriculum/{slug}.yml` rather than bloating it.

**Two-tier taxonomy: subject → strand.** A third tier stops being navigable on a
kiosk used by a five-year-old.

**Enrolment lives in `school.yml`, not in profiles.** Levels list their
students, rather than each `profile.yml` naming its level. The whole roster is
legible in one place and promoting a child is a one-line edit.

**Home shows a subject wall; strands live inside it.** Category stops being a
navigation concept and reverts to what it is for: gating and credit.

**Out-of-level works are hidden, not shown locked.** A young student's wall
stays short. Filtering is logged so a parent can find out why something is
missing.

**Quizzes are not enumerated in config.** A quiz binds itself to its audio by
carrying `unit: plex:<trackRatingKey>`. Listing them in config too would be a
second source of truth, free to drift.

## Config model

`school.yml` gains three blocks alongside the existing `materials`:

- `subjects:` — the taxonomy. Each subject has a `label` and optional `strands`.
  Defining it in config means adding a subject is not a code change. A source
  naming an undeclared subject or strand falls back to the Library and logs a
  warning naming the source — the same fail-closed-but-loudly rule as `category`.
- `levels:` — each level has a `label` and a `students` list of user ids.
- `materials.sources[]` gains `subject`, `strand`, and `curriculum` (the
  drill-down file slug).

Drill-down files carry `label` and an ordered `works` list. Each work has a Plex
album id, a title, its authored quiz count, and an optional `levels` list.

**Absence never hides.** A source or work with no `levels` is open to every
level; a student in no level sees everything unrestricted.

## Code changes required

Three roughly independent pieces. None are started.

1. **Read the taxonomy.** `GetMaterialCatalog.execute()` currently returns
   `sections` filtered from a category-ordered constant. It must instead emit
   subject sections with nested strands, validating each source's `subject`/
   `strand` against the declared taxonomy and failing closed to the Library.
   `home/sections.js` and `SchoolApp.jsx`'s section-id parsing follow.
2. **Read the drill-down.** Load `curriculum/{slug}.yml` for sources that name
   one; use it to order works and to carry per-work `levels`.
3. **Enforce levels.** Resolve a student's level by searching `levels[].students`
   for their user id, then filter catalog and works. Log every exclusion.

## Risks and follow-ups

- **The path-vs-`id` contract remains implicit.** The data now satisfies it, but
  nothing enforces it. A validation step that rejects a bank whose `id` is not
  its path would prevent silent recurrence, and the service test fixture should
  stop stubbing the two as identical.
- **Promoting a series from `listening` to `course` turns on sequential
  locking.** Safe here only because the dead root meant no listening history
  exists. Doing this to a series with history would retroactively lock units a
  student had already played out of order.
- **`GetMaterialUnits` rebuilds the entire bank index on every `byUnit()` call**,
  re-reading every bank YAML. Deliberate, to inherit `listBanks()`'s no-cache
  freshness. At 379 banks this is worth measuring before it becomes 1000.
- Level assignments are all commented out, so nothing is narrowed yet.
