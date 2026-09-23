> Renamed card ladder 2026-09-23 — current reference: `docs/reference/school/card-ladder.md`.

# Word Ladder Plan 5 — Tuning Agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lightweight agent that, once per study day, reads a compact digest of each learner's word-ladder day, writes a short status note, and nudges the engine's thresholds within grown-up bounds — braked so it can never swing a child's schedule.

**Architecture:** Pure domain: `buildTuningDigest` (the model's only input) and `applyTuningProposal` (the brakes). Application: `WordLadderTuner` (a `BaseAgent` with no tools and a structured output schema, run through `MastraAdapter`) and `WordLadderTuningService` (per learner × package: build digest → run agent → apply brakes → persist `tuning.yml` → log → push on `concern`). Composition: a `NodeApplicationScheduler` tick that runs the service for each learner/package whose previous study day has not been tuned. The sitting service reads current values from `tuning.yml` at each day's first open (`atOpen.settings`), so changes never apply mid-day.

**Tech Stack:** as Plan 1; `MastraAdapter` + `AgentExecutionPolicy` (as `nutritionCleanup.mjs` composes them).

**Spec:** rev 4 §7. **Depends on Plans 1, 2, 4** (digest uses Plan 4's transitions/day files; console list uses Plan 4's Words view).

## Global Constraints

- Tunable settings and bounds exactly spec §7: `round.size` 5 (3–7), `drill.afterMisses` 2 (1–3), `batch.newPerDay` 4 (2–6), `batch.workingSet` 7 (4–10), `review.gapScale` 1.0 (0.5–1.5), `review.typedEvery` 2 (1–4). Grown-up only (never tuned): `session.capMinutes`, `drill.perSitting`, `round.maxPasses`, `typing.passScore`.
- Brakes: one step per change (±1 for integers, ±0.1 for `gapScale`); at most one change per setting per 5 study days (by `tuning.yml` `lastChanged[setting]`); clamp to bounds; a proposal violating any brake is dropped and logged.
- Runs once per study day per learner × package, over the day just ended, skipped when that day had no sitting that reached goal or cap; sittings closed only by `idle`/`unmount` never trigger it. Changes take effect at the next day's first open. Test sittings never trigger it.
- Model: `school.yml word_ladder.tuner.model` (null = tuner disabled; status note falls back to a deterministic summary, no changes). Structured output `{status: on-track|stuck|coasting|concern, notes: string[≤3], changes: [{setting, to, reason}]}`.
- Every change logged `school.word-ladder.tuning` `{learnerId, package, day, setting, from, to, reason}`; dropped proposals logged with `dropped: <brake>`; `concern` sends a push per `docs/reference/notifications/push-standard.md`.

## Tasks

### Task 1: Digest and brakes (pure)

**Files:** `backend/src/2_domains/school/wordLadder/tuning.mjs` (+ test)

**Interfaces:**
- `TUNABLE = { 'round.size': { step: 1 }, 'drill.afterMisses': { step: 1 }, 'batch.newPerDay': { step: 1 }, 'batch.workingSet': { step: 1 }, 'review.gapScale': { step: 0.1 }, 'review.typedEvery': { step: 1 } }`
- `buildTuningDigest({ status, days: DayFile[] (last 8, oldest first), settings, lastChanged }) → object` with: `day`, `settings` (tunables only), `lastChanged`, `words: { total, byState:{…}, tricky, excluded }`, `today: { quizzed, passed, failedByPile:{familiar, claimed}, passedByPile:{familiar, claimed}, dontKnow, typedScores:[…], judgeFallbacks, stalls, activeMin, capHit, newIntroduced, drillsRun, reachedGoal }`, `trailing7: same shape averaged`. Deterministic; serialises under ~2k tokens for a 50-word package (test asserts `JSON.stringify(digest).length < 8000`).
- `applyTuningProposal({ current, proposal, bounds, day, lastChanged, dwellDays = 5 }) → { next, applied: [{setting, from, to, reason}], dropped: [{setting, to, reason, brake:'unknown'|'not-tunable'|'step'|'dwell'|'bounds'}] }`.
- [ ] Failing tests: a +2 step is dropped (`step`); a change 3 days after the last is dropped (`dwell`); out-of-bounds clamps then counts as one step or drops (`bounds`); `session.capMinutes` is `not-tunable`; digest contents for a fixture day (pile calibration counts, cap hit, goal). Implement; commit.

### Task 2: `WordLadderTuner` agent

**Files:** `backend/src/3_applications/agents/word-ladder-tuner/WordLadderTuner.mjs`, `prompts/system.mjs`, `index.mjs` (+ test with a fake runtime)

- `class WordLadderTuner extends BaseAgent { static id = 'word-ladder-tuner'; getSystemPrompt(){…}; registerTools(){} }` — no tools. `tune(digest) → { status, notes, changes }` calls `this.runtime.execute({ agent: this, input: JSON.stringify(digest), tools: [], systemPrompt, outputSchema: TUNING_SCHEMA, limits: { maxSteps: 1, timeoutMs: 30000 } })` and returns `result.structured` (validate against the schema; invalid → throw).
- System prompt (in `prompts/system.mjs`): the role (watch a child's vocabulary practice; mostly observe), the meaning of each tunable and its direction (e.g. calibration: Familiar/Got-it words failing verify often → raise `round.size`? no — lower `batch.newPerDay`; cap hit most days → lower `batch.newPerDay` or `round.size`; everything passing first try for 5+ days → raise `batch.newPerDay`; many recheck misses at stage ≥ 2 → lower `review.gapScale`), the brakes (one step, 5-day dwell — "propose at most one change unless the evidence is strong"), and the output schema. Explicitly: never propose changes on a single day's evidence; `concern` only for a pattern a grown-up must see (e.g. days credited with zero quizzed words, or repeated `stuck`).
- [ ] Failing test: a fake runtime returning a structured object → `tune` returns it; invalid structure → throws; the system prompt names every tunable. Implement; commit.

### Task 3: `WordLadderTuningService` + sitting service reads `tuning.yml`

**Files:** `backend/src/3_applications/school/WordLadderTuningService.mjs` (+ test), `backend/src/1_adapters/school/wordLadder/YamlWordLadderStore.mjs` (`readTuning`/`writeTuning` → `tuning.yml` `{ schema: 'school.word-ladder-tuning/v1', values:{}, lastChanged:{}, lastTunedDay, history:[…] }`) (+ test), `WordLadderSittingService.mjs` (`#settings(userId, pkg)` = `resolveSettings(config)` overlaid with `tuning.values`, captured into `atOpen.settings` at the day's first open only).

- `WordLadderTuningService.runFor({ learnerId, pkg, deckId, day })`: skip if `tuning.lastTunedDay >= day` or the day file has no sitting with `reason ∈ {goal, cap}` (or `doneAt` null and no cap hit); build digest from status + last 8 day files; if no tuner (model null) → write a deterministic note (`status` from digest heuristics: `concern` when `quizzed === 0 && reachedGoal`) with no changes; else `tuner.tune(digest)` → `applyTuningProposal` → write `tuning.yml` (values, lastChanged, `lastTunedDay: day`, append `history` `{ day, status, notes, applied, dropped }`, keep last 60) → log → push on `concern`.
- `pending({ now })` → `[{ learnerId, pkg, deckId, day }]` for every learner with a word-ladder enrollment whose previous study day (today − 1) is after `lastTunedDay`.
- [ ] Failing tests: skip rules; applied change persisted and effective only at the next day's `atOpen` (sitting service test: open day D, write tuning, same-day open keeps old settings, next day picks new); `concern` triggers the push port; model failure → no changes, logged. Implement; commit.

### Task 4: Composition, scheduler, console list

**Files:** `backend/src/5_composition/modules/wordLadderTuning.mjs` (new; pattern: `nutritionCleanup.mjs`), `backend/src/app.mjs` (create when `word_ladder.tuner.model` is set; scheduled when `agentSchedulerEnabled(...)`), routes `GET /word-ladder/admin/tuning?learnerId&deckId` + `POST /word-ladder/admin/tuning/undo` (restores the previous value of one setting, gate-checked, logs `tuning` with `reason: 'grown-up undo'`), `WordLadderWordsPanel.jsx` (a **Tuning** section: current values vs defaults, last status + notes, history with **Undo** per applied change).

- Scheduler: `new NodeApplicationScheduler().every(15 * 60000, tick)`; `tick` runs `pending()` sequentially (never parallel), guarded by a `ticking` flag like `nutritionCleanup.mjs`.
- [ ] Failing tests: composition returns a stoppable handle; undo restores and logs; panel renders history and calls undo. Implement; run; commit.

### Task 5: Verify, document, ship

- [ ] `npm run test:unit:vitest` → exit 0. Deploy through the gate.
- [ ] Set `word_ladder.tuner.model` in `school.yml` (the household's small model id — the same family the judge uses), restart via deploy; trigger one run for the enrolled learner (a one-off node script inside the container calling `runFor` for yesterday) and read `tuning.yml` + the `school.word-ladder.tuning` log lines; confirm no change applied mid-day.
- [ ] Docs: `docs/reference/school/word-ladder.md` (Tuning agent section: settings, bounds, brakes, schedule, where to see and undo), `docs/ai-context/agents.md` (the new agent). Commit with a pathspec.
