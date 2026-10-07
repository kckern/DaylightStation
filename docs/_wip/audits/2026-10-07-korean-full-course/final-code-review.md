# Independent final code review — Korean 3-2 expansion

Reviewed the staged patch against base 098e220cc and the approved sixteen-unit plan. Read the assembler, CLI, guide, changed services/tests, and unchanged assessment, assignment, planner, launcher, persistence and daily-completion integration seams. This review made no checkout edits, live writes, service starts, paid calls, or physical prints. Existing targeted tests were not rerun.

## Strengths

- Assembly uses the real lexicon/deck/unit/document validators and immutable publisher. Canonical cards, explicit question mappings, two pinned forms, and the cumulative final reuse existing application behavior.
- The daily projection now excludes locked/completed linked decks from obligations while retaining full-plan entries, and the new regressions cover both selecting the current lesson and completing its daily goal.
- Initial live sitting opens fail before writes when readiness is locked or unavailable; shadow previews remain separate. Teacher progression overlays are retained in the planner. Paper correction aggregation and unresolved-only retry remain the existing authoritative paths.
- Install checks existing card identity and media bytes; enrollment includes stale-read checks and explicit preservation assertions. Source review reports document concrete corrections and scoped re-review.

## Critical

None found.

## Important

1. **Enrollment cannot preserve several supported unrelated programs because it validates them against an incomplete catalog/service set.** `cli/korean-course.cli.mjs:126–135` constructs a deck lookup containing only this course's sixteen decks; the existing-record wrapper calls the normal validator before recognizing the unchanged record. Any existing `flashcards` enrollment for e.g. `biology/cells` consequently fails with “deck ... was not found.” Existing `language-reels` or `rubiks-cube` enrollments also fail because their validators are not installed and the wrapper invokes `undefined`. Existing linked decks from another course additionally need their real units in the curriculum passed at line 143. This blocks an otherwise authorized add-only enrollment without any actual conflict. I reproduced the unrelated-deck error and missing validator entries through a small in-memory invocation of `createSchoolProgramEnrollmentValidators` (no tests/live data mutated). Resolve existing programs using the complete runtime catalog/services, or use a deliberately scoped exact-existing-record preservation path that still validates every newly added Korean enrollment. Add an isolated mixed-enrollment CLI regression.

2. **The new course lock is enforced only on open; an existing sitting survives a subsequent course lock.** `backend/src/3_applications/school/CardLadderSittingService.mjs:543–548` checks readiness, but `respond` (601–602), `get`, `practice`, and `learnMore` go through `#context` (364–380), which does not check current enrollment/readiness. A learner can open Lesson 2 while eligible, then continue introducing/answering Lesson 2 cards after a teacher pauses it or corrects Lesson 1 so Lesson 2 becomes locked. Reloading with the sitting ID can also reopen an idle-closed sitting. Moreover, `#deckGroups` (201–208) keeps all previously seen decks in the new-card pool, so returning to an allowed earlier deck can still introduce previously unseen cards from the now-locked later deck. Preserve learned-card evidence and optional review, but gate new introductions/mutations against current linked readiness and exclude locked decks' unseen cards from the new-card pool. Cover a transition from allowed to locked, not only an initially locked open. This is a code-path finding, not a claim that already printed paper must be invalidated; the planner intentionally permits finishing an issued sheet.

## Minor

- `cli/lib/korean-course-guide.mjs:31` derives grammar teaching notes only from `manifest.inventory`, whose entries begin at Lesson 2. The otherwise complete guide has a Lesson 1 overview row but no Lesson 1 grammar/source/register notes. Include the pilot's two patterns or link explicitly to its retained teacher instructions.

## Plan assessment and limits

The implementation substantially matches the approved architecture and content inventory. The local Yuna/Samantha speech substitution is documented and justified by the external-transfer rejection. English cue images are locally rendered text cues; this is consistent with their meaning-cue function. Media generation, final audio validation, installation, and live sequential verification were still pending when this review began, so this report does not certify rollout completion.

I read the source-authoring review evidence and inspected assembly/mapping behavior; I did not independently re-audit all Korean options against every original PDF or provide native-speaker pronunciation certification. I did not listen to the pending generated audio. Full proof rendering and the 106 targeted tests are reported executor evidence, not tests rerun by this reviewer. Broader suite results remain the executor's responsibility.

## Declined to judge

- Native-speaker/speech-specialist pronunciation quality: no specialist verification or complete listening pass available in this review.
- Physical scanning/printing performance: explicitly excluded; no hardware operation performed.
- Final installation/deployment state: still pending and live writes prohibited for this reviewer.
- Historical daily-completion overlay policy: the pre-existing GetLearnerDayCompletion flags intentionally omit attestations/exceptions; changing this established reward policy is outside the expansion. The current-deck projection and day-bypass collection themselves remain in its active path.

## Verdict

**Ready to merge: with fixes.** Address the add-only enrollment compatibility failure and correction/pause lock gap before treating the expansion as fully ready. Existing completed-course history, canonical identity, and the normal current-lesson daily-goal behavior are otherwise supported by the inspected code and regression coverage.

## Implementation follow-up

Implemented both Important findings at the coordinator's request. Exact unchanged enrollment records are preserved through `cli/lib/preserve-existing-enrollments.mjs`; changed/new records still use registered validators. The CLI loads the real YAML curriculum for existing linked units, so unrelated valid links survive and broken links still fail. Course access now gates the shared sitting-context path as well as opening; the new-card pool excludes relocked seen decks while retaining introduced-word status and spaced-review evidence.

RED evidence: `/tmp/korean-full-review-red.log` (actual CLI rejects the unrelated deck; live respond incorrectly succeeds after relock), `/tmp/korean-full-pool-red.log` (preview offers two unseen cards from locked deck).
GREEN evidence: `/tmp/korean-full-review-green.log`: 3 files, 92 tests passed (sitting service, course assembly, CLI enrollment). The CLI test uses actual subprocesses and an isolated temporary catalog/assignment tree; live learner files are untouched. It also proves old broken linkage rejection and unchanged assignment bytes on preview. A SetAssignments test rejects changed unrelated and new unknown programs. `git diff --check` passed.

Broader verification and independent re-review are being handled by the coordinator. No further implementation edits after that verification started. Guide correction and speech generation were coordinator-owned.

## Residual touched-round repair

The independent re-review identified a remaining package-level queue: `openDay` retains touched rounds, so switching from a relocked later deck to an allowed earlier one could continue introducing its still-new cards. Reproduced with an actual engine-driven sitting: answer the first later-deck flashcard, relock that deck, open the earlier deck, and observe the second never-introduced card being offered. RED evidence: `/tmp/korean-full-switch-red.log`.

The service now reconciles only active introduction queues before opening or resuming an allowed sitting. Still-new cards outside the current eligible pool leave the pending round's intro/stream/word rosters; the intro cursor and phase are adjusted. Already introduced cards, word state, answered items, prior rounds, and paper evidence stay intact. The shared context path also covers resuming an older allowed sitting. Regression variants walk the retained introduced card to completion and confirm the blocked card never appears or enters status, while its sibling's original answered evidence survives.

GREEN evidence: `/tmp/korean-full-switch-green.log`: 88 sitting-service tests passed. `git diff --check` passed. The independent reviewer has been notified to inspect this repair; broad suite execution remains coordinator-owned.
