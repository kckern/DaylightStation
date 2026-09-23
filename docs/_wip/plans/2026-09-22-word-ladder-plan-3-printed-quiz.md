# Word Ladder Plan 3 — Per-Learner Printed Quiz

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The weekly paper quiz covers only words the learner has been introduced to, is generated per learner, and folds back only into that learner — while quizzes already printed per deck keep folding.

**Architecture:** A pure builder (`buildLearnerQuizSource`) picks the rows from the learner's v3 status; the CLI writes the document source; the fold learns two id shapes (legacy per-deck ids, and a per-package-per-learner prefix) and refuses a per-learner sheet scanned for a different learner.

**Tech Stack:** as Plan 1.

**Spec:** `docs/_wip/plans/2026-09-22-word-ladder-mastery-redesign.md` rev 4 §8 "Printed quiz (per learner)". **Depends on Plan 1.**

## Global Constraints

- Document id: `<deckDir>/<pkg>-quiz-<learner>-<isoWeek>` where `<deckDir>` is the directory part of the package's deck ids (today `language/korean`) and `<isoWeek>` is `YYYY-Www` of the study day.
- Rows: introduced, non-excluded words — this ISO week's introductions first (deck order), then other unsettled words, then a seeded sample of mastered words — up to `rowLimit` (default 20). Each row alternates term→gloss / gloss→term by index, answer + 3 authored decoys (same as `buildWordQuizSource`).
- Fold: accept `quizDocumentIdFor(deck.id)` for every deck sharing the lexicon (legacy) **and** ids starting `<deckDir>/<pkg>-quiz-<learnerId>-`; an id starting `<deckDir>/<pkg>-quiz-` naming a different learner is refused and logged `school.word-ladder.fold-refused` `{learnerId, bankId}`.
- A reprint of the same week after new introductions yields different source text; the CLI refuses to overwrite without `--force` and prints the republish + fresh-card commands (a republish must never pin the old card).

## Tasks

### Task 1: `buildLearnerQuizSource` (pure)

**Files:**
- Modify: `backend/src/2_domains/school/wordLadder/quizSource.mjs` (+ `quizSource.test.mjs`)
- Modify: `backend/src/2_domains/school/wordLadder/quizId.mjs` (+ test) — add `learnerQuizDocumentId({ deckDir, pkg, learnerId, isoWeek })`, `learnerQuizPrefix({ deckDir, pkg, learnerId = '' })`, `deckDirOf(deckId)`, `isoWeekOf(day)`.

**Interfaces:**
- `buildLearnerQuizSource({ status, lexicon, decks, learnerId, day, seed, rowLimit = 20, title })` → `school.document-source/v1` object like `buildWordQuizSource`, `id` from `learnerQuizDocumentId`, `title` default `${lexicon.program.title} — week ${isoWeek}`. Throws `Error('no introduced words to quiz')` when no row qualifies.

- [ ] **Step 1: Failing tests** (`quizId.test.mjs`, `quizSource.test.mjs`):

```js
import { deckDirOf, isoWeekOf, learnerQuizDocumentId, learnerQuizPrefix } from './quizId.mjs';
it('per-learner ids', () => {
  expect(deckDirOf('language/korean/week-01-classroom')).toBe('language/korean');
  expect(isoWeekOf('2026-09-22')).toBe('2026-W39');
  expect(learnerQuizDocumentId({ deckDir: 'language/korean', pkg: 'korean-vocab', learnerId: 'test-learner', isoWeek: '2026-W39' }))
    .toBe('language/korean/korean-vocab-quiz-test-learner-2026-W39');
  expect(learnerQuizPrefix({ deckDir: 'language/korean', pkg: 'korean-vocab' })).toBe('language/korean/korean-vocab-quiz-');
});
```

```js
it('quizzes only introduced words, this week first, never new ones', () => {
  // status: a introduced 2026-09-21 (familiar), b mastered s2 (introduced 2026-09-01), c new
  const src = buildLearnerQuizSource({ status, lexicon, decks: [deck], learnerId: 'test-learner', day: '2026-09-22', seed: 1 });
  expect(src.blocks.map((b) => b.itemId)).toEqual(['a', 'b']);
  expect(src.id).toBe('language/korean/korean-vocab-quiz-test-learner-2026-W39');
});
it('throws with nothing introduced', () => { /* all new */ expect(() => buildLearnerQuizSource({ … })).toThrow(/no introduced words/); });
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement — extract the per-row block construction from `buildWordQuizSource` into a local `questionBlock(entry, index, lexicon, seed)` used by both builders (no duplication); `isoWeekOf` computes ISO-8601 week from the `YYYY-MM-DD` string with UTC arithmetic (pure, no clock).
- [ ] **Step 4:** run → PASS. **Step 5:** commit with a pathspec.

### Task 2: Fold learns per-learner documents

**Files:**
- Modify: `backend/src/2_domains/school/wordLadder/foldPaperAttempts.mjs` (+ test)
- Modify: `backend/src/3_applications/school/WordLadderSittingService.mjs` (`#fold` and `fold`) (+ test)

**Interfaces:**
- `foldPaperAttempts({ status, attempts, quizDocumentIds, acceptPrefixes = [], refusePrefixes = [], dayOf, settings })` → `{ status, folded, refused: [{attemptId, bankId}] }`. An attempt's `bankId` (`<docId>@<rev>`) matches when `quizDocumentIds` contains `docId` **or** `docId` starts with an accept prefix; if it starts with a refuse prefix and matches no accept prefix it is **refused** (recorded in `paperAttemptsFolded` so it is not re-evaluated, and returned in `refused`).
- Service: `acceptPrefixes = [learnerQuizPrefix({deckDir, pkg, learnerId}) ]`, `refusePrefixes = [learnerQuizPrefix({deckDir, pkg})]`, `quizDocumentIds` = legacy ids of every deck sharing the lexicon (`#quizDocumentIds` from the old service, ported). Logs `school.word-ladder.fold-refused` per refused row.

- [ ] Failing tests: legacy id still folds; own per-learner doc folds; sibling's per-learner doc is refused and never demotes; idempotent. Implement; run `npx vitest run backend/src/2_domains/school/wordLadder/ backend/src/3_applications/school/`; commit.

### Task 3: CLI `word-ladder quiz --learner`

**Files:**
- Modify: `cli/school/wordLadder.mjs` (+ `cli/school/wordLadder.test.mjs` if present; else create alongside following the repo's CLI test pattern)

**Interfaces:**
- `school.mjs word-ladder quiz --learner <id> --package <pkg> [--week <YYYY-Www>] [--rows N] [--seed N] [--force] [--data-dir P] [--media-dir P] [--source-root P]` — reads `users/<id>/apps/school/word-ladder/<pkg>/status.yml` (v1 → migrate via `migrateStatusV2`), the package's decks (every deck whose lexicon package matches), builds with `buildLearnerQuizSource`, writes `<source-root>/<id>.yml` (same unchanged / `--force` rule as the deck quiz), and prints:
  `next: node cli/school.mjs docs publish <relative file>` and `then mint a fresh card: POST /api/v1/school/print/render (see docs/reference/school/print-documents.md)`.
- `--deck` form unchanged. HELP text updated.

- [ ] Failing test: a temp data dir with a status file + decks + lexicon → the written file's `blocks` are the introduced words only; second run unchanged; changed status without `--force` → exit 1. Implement; run; commit.

### Task 4: Docs and a real run

- [ ] Update `docs/reference/school/word-ladder.md` (Printed quiz section: per-learner command, id scheme, fold rules, legacy deck quiz still folds) and `docs/reference/school/print-documents.md` (link).
- [ ] Deploy through the gate (Plan 1 Task 19 Step 4). Inside the container: `node cli/school.mjs word-ladder quiz --learner <enrolled id> --package korean-vocab` → confirm the written file lists only introduced words (on a fresh week it may throw "no introduced words" — that is correct behaviour; report it rather than forcing).
- [ ] Commit docs with a pathspec.
