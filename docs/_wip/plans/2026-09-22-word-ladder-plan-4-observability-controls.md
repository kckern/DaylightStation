# Word Ladder Plan 4 — Observability, Trace, Grown-up Word Controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sitting can be read back from logs as a timeline (`school word-ladder trace`), and a grown-up can see and correct each word from the teacher console.

**Architecture:** A frontend trace context stamps every word-ladder event with `traceId/sittingId/seq/t/learnerId/deckId/package/mode`; the engine reports word transitions so the backend logs `graded` and `transition` events; a pure `formatTrace` turns events into a timeline; admin use cases on the sitting service mutate status under the teacher gate and are surfaced in a per-learner **Words** view.

**Tech Stack:** as Plan 1; VictoriaLogs LogsQL over HTTP.

**Spec:** rev 4 §6 "Grown-up word controls", §8 "Events" and "`school word-ladder trace`". **Depends on Plans 1–2.**

## Global Constraints

- Event names and payloads exactly as spec §8 Events (frontend) and `school.word-ladder.{opened,graded,transition,folded,closed,tuning,admin}` (backend), each with `mode`. `debug` never ships: all listed events are `info` unless the spec marks `warn`.
- Stall thresholds: `item.stalled` at 45 s and again at 120 s of no input on one item (once each per item).
- Trace reads `$DAYLIGHT_LOGSTORE` (default `http://localhost:9428`); order by `seq` within `traceId`, never by `_time` (the store's `_time` is local time mislabelled UTC); fallback source: the day file.
- Admin actions require the teacher gate (`teacherGate.assert({ userId: actorId, pin, action: 'word-ladder.admin', context: { learnerId } })`) and log `school.word-ladder.admin` with `{ actorId, learnerId, package, wordId, action }`.
- No learner names, hosts or ports in code or docs.

## Tasks

### Task 1: Engine transitions + backend `graded`/`transition` events

**Files:** `backend/src/2_domains/school/wordLadder/engine.mjs` (+ test), `backend/src/3_applications/school/WordLadderSittingService.mjs` (+ test)

- `respond(...)` additionally returns `transitions: [{ wordId, from:{state,stage}, to:{state,stage}, source:'sort'|'verify'|'recheck'|'practice'|'intro' }]` computed by diffing `status.words` before/after for every word whose `state` or `stage` changed; and `graded: { wordId, task, source, correct, score?, judge? } | null` for graded items.
- Service logs `school.word-ladder.graded` (one per graded answer) and `school.word-ladder.transition` (one per transition) with `{ learnerId, sittingId, mode, … }`; keeps `answered` at info.
- [ ] Failing tests: a verify pass yields a `familiar|claimed → mastered` transition and a `graded` record; a sort yields `introduced → notYet`; the service logger receives `graded` and `transition`. Implement; `npx vitest run backend/src/2_domains/school/wordLadder/engine.test.mjs backend/src/3_applications/school/WordLadderSittingService.test.mjs`; commit with a pathspec.

### Task 2: Frontend trace context and the spec §8 event set

**Files:** `frontend/src/modules/School/Programs/Flashcards/WordLadder/wordLadderLog.js` (+ `wordLadderLog.test.js`), `useItemStall.js` (new, + test), `WordLadderProgram.jsx`, item components (flip/sort/undo/keypad/audio hooks)

**Interfaces:**
- `createTrace({ learnerId, deckId, mode }) → { id, setSitting(id), setPackage(pkg), event(name, data, level='info') }` — `id` = random 12-hex `traceId` minted at mount; each `event` adds `{ traceId, sittingId, seq: ++n, t: ms since mount, learnerId, deckId, package, mode }` and emits `school.word-ladder.<name>` through the existing logger child.
- Events to emit (names verbatim from spec §8): `sitting.opened`, `item.shown` {task, wordId, layout, media, fontPx}, `item.answered` {response kind, correct?, score?, judge?, ms}, `card.flipped` {ms}, `card.sorted` {pile}, `card.undone`, `round.started`/`round.ended` {quizzed, notYet} (derived when `progress.round.index` changes / a round's quiz finishes), `drill.offered` {accepted}, `audio.played` {kind, outcome: ended|error|blocked} (`playClip` resolves to an outcome string — change it to resolve `'ended'|'error'|'blocked'` and log in one place), `media.failed` (warn), `item.prompt-fallback` (warn), `keypad.toggled` {auto}, `item.stalled` (warn) {ms: 45000|120000}, `notice.shown` (warn), `visibility` {state}, `layout.clamped` (warn), `sitting.closed` {reason, activeMs, remaining}.
- `useItemStall(itemId, onStall)` — timers at 45 s and 120 s, reset on any keydown/pointerdown, cleared on item change.
- Layout name for `item.shown`: the item component reports its layout string (`flashcard-front`, `flashcard-back-picture`, …, spec §6 Layouts) via an `onLayout` callback; `fontPx` from `FitText` via the same callback.
- [ ] Failing tests: `createTrace` increments `seq` and stamps fields; `useItemStall` fires at 45 s and 120 s with fake timers and not after a keydown; `playClip` outcome strings. Implement; run the WordLadder frontend suite; commit.

### Task 3: `formatTrace` + `school word-ladder trace`

**Files:** `backend/src/2_domains/school/wordLadder/trace.mjs` (+ test), `cli/school/wordLadder.mjs` (`trace` subcommand + HELP)

**Interfaces:**
- `formatTrace(events: object[], { dayFile? }) → string` — groups by `traceId` (fallback `sittingId`), sorts by `seq`, merges backend `transition`/`graded` events after the frontend `item.answered` with the same `itemId`; one header line per trace: `<learner> · <package> · <day> · <mode> · trace <id> · <duration> · <ending>`; one line per item: `m:ss  <kind> <term> <task/layout> <response> <correct/score> (<ms>)`, transitions appended `→ <state>`; `⚠ stalled <duration>` lines from `item.stalled` and from any gap ≥ 30 s between events on one item; the item the sitting ended on is marked `✗ left here` when `sitting.closed.reason` ≠ `goal|cap`.
- CLI: `node cli/school.mjs word-ladder trace --learner <id> [--day YYYY-MM-DD | --sitting ID] [--mode live|test|all]` → LogsQL `query=_msg:~"school.word-ladder" AND data.learnerId:<id> AND _time:<window>` with `limit=5000` against `$DAYLIGHT_LOGSTORE/select/logsql/query`; JSON lines parsed; `formatTrace` printed. If the store is unreachable or returns nothing, read the day file (`users/<id>/apps/school/word-ladder/<pkg>/days/<day>.yml`) and print its `items` in order with a `(from day file — no timing detail)` header.
- [ ] Failing tests for `formatTrace` using a fixture event list (intro → copy → sorts → verify miss → stall → leave): exact expected output string. CLI test with an injected `fetch` returning JSON lines. Implement; run; commit.

### Task 4: Admin use cases (reset, mark mastered, exclude, drop deck, re-grade)

**Files:** `backend/src/2_domains/school/wordLadder/mastery.mjs` (`excluded` flag honoured), `rounds.mjs`/`engine.mjs`/`practice.mjs` (skip `excluded` words), `WordLadderSittingService.mjs` (+ test), `school.wordLadder.mjs` routes (+ test)

**Interfaces:**
- Word record gains `excluded: false` (default in `emptyWordV3`; migration leaves it false).
- Service methods, each `({ learnerId, deckId, wordId?, actorId, pin, … })`, gate-checked, live service only:
  - `adminWords({ learnerId, deckId })` → `{ words: [{ wordId, term, gloss, state, stage, dueDay, missStreak, tricky, excluded, lastGraded, recentTyped: [{ day, typed, score, judge, reason }] }] }` (recentTyped from the last 14 day files' graded 3.3 items).
  - `adminReset` → `emptyWordV3()` (clears `notYetCarry`, keeps nothing).
  - `adminMarkMastered({ stage })` → `mastered`, `stage`, `dueDay` = today + GAPS[min(stage,5)].
  - `adminExclude({ excluded })`.
  - `adminDropDeck({ dropDeckId })` → removes from `status.decksSeen`.
  - `adminRegrade({ day, itemId, pass })` → reads the day file's item; if it was a typed 3.3 answer, overwrites the judge cache entry for `(pkg, wordId, normalizeAnswer(typed))` with `{ score: pass ? passScore : 1, judge: 'grown-up', reason: 'Re-graded by a grown-up' }`; records `{ at, actorId, pass }` on the item. It does **not** rewrite word state — the grown-up uses reset / mark mastered for that; the UI says so.
- Routes (live only): `GET /word-ladder/admin/words?learnerId&deckId`, `POST /word-ladder/admin/{reset|mastered|exclude|drop-deck|regrade}` body includes `actorId`, `pin`.
- [ ] Failing tests per method (gate refusal → error; each mutation's resulting word; excluded words never appear in rounds/rechecks/practice; regrade writes the cache and leaves state). Implement; run; commit.

### Task 5: Teacher console **Words** view

**Files:** `frontend/src/modules/School/teacher/panels/WordLadderWordsPanel.jsx` (+ test), `frontend/src/modules/School/teacher/WorkspaceViews.jsx` (`WordsView`), the per-learner tab list (find where `ReadingView` is routed — `teacherUrl.js` + the learner tab strip — and add `words` next to `reading`), `frontend/src/modules/School/teacher/README.md` (screen → file row), `Teacher.scss`.

- `WordsView({ learnerId, learnerName })` → for each of the learner's word-ladder enrollments, `WordLadderWordsPanel` (uses `PanelFrame`, `usePanelFetch` for `admin/words`, `useTeacherWrite({ panel: 'word-ladder-words' })` for actions): a table — term, gloss, state chip, stage, due, streak, tricky, excluded, last typed answers (score + reason, hover) — and per-row actions **Reset**, **Mark mastered (stage)**, **Exclude/Include**, **Re-grade** (on a typed answer row: Pass / Fail); a deck list with **Drop from pool**.
- [ ] Failing test (RTL): renders rows from a fake fetch; Reset calls the write with `{ learnerId, wordId }`. Implement; run `npx vitest run frontend/src/modules/School/teacher/`; commit.

### Task 6: Verify, document, ship

- [ ] `npm run test:unit:vitest` → exit 0.
- [ ] Deploy through the gate (Plan 1 Task 19 Step 4).
- [ ] Run a test sitting via the stage Playwright spec, then `node cli/school.mjs word-ladder trace --learner <enrolled id> --mode test` inside the container; confirm the printed timeline matches what the screenshots show (items, answers, the stall if any). Open `/school/teacher` → the learner → **Words**; confirm the list matches `status.yml`.
- [ ] Docs: `docs/reference/school/word-ladder.md` (Events, Trace, Grown-up controls), `docs/reference/school/teacher.md` (Words view), teacher `README.md` screen→file row. Commit with a pathspec.
