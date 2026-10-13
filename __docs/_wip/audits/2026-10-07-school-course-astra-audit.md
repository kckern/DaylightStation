# Independent Astra audit: Korean 3-2 and the six-question atlas enrollment

Date: 2026-10-07. Reviewed local main `d372abb4f`, including Korean course implementation `15a5dbb6f` / integration `8213fbb1f` and atlas profile `76e710020`. This was a read-only audit of implementation and synchronized household content; this report is the only authored repository change. No production changes, learner mutations, physical prints, scans, or second backend were performed.

**Verdict: corrections required.** The course inventory and atlas profile are present and internally consistent, but five findings remain. Two affect assessment validity or progression, two affect the screen/print and historical-projection contracts, and one is an event integration gap with a polling fallback.

## 1. P1 — Ten deployed Korean quiz forms have an all-A answer key

Both forms of Lessons 2–6 place every correct answer first. The authoring assembler copies the choice arrays unchanged into inline questions (`cli/lib/korean-course.mjs:75`); publishing retains that order. `RenderPrintDocument.mjs:159` shuffles wordbanks and matching lists, but does not shuffle inline question choices. `DocumentPdfRenderer.mjs:144` prints the bank's choices in their existing order, and `ResolveCardScan.mjs:264` interprets a bubble using that same order.

Example source: `tests/_fixtures/school/korean-3-2/full-course/lessons/02.json:303` has `간다` first and keyed; Form B does the same with `읽는다` at line 313. This repeats throughout the affected lessons.

I read the **published `answers.yml` banks selected by each live unit's pinned references**, not just the source JSON:

| Lesson | Form A key | Form B key |
|---|---|---|
| 2 | AAAAAA | AAAAAA |
| 3 | AAAAAAAA | AAAAAAAA |
| 4 | AAAAAA | AAAAAA |
| 5 | AAAAAA | AAAAAA |
| 6 | AAAAAAAA | AAAAAAAA |

**Trigger/impact:** once card practice unlocks paper, filling A throughout passes these grammar assessments without demonstrating grammar application. A failed subset retry has the same defect because it retains the same choice order. This defeats the purpose of the paper gate even though the grading implementation follows its answer key correctly.

**Correction:** deterministically permute choices before publication and audit the complete printed key for long runs, dominant letters, and short repeating cycles. Publish new immutable revisions and update future unit references; retain already-issued allocation/snapshot identities and their original keys. Add a course-wide assessment-quality assertion that exercises the published bank and prepared print path. Do not assume a document's `seed` shuffles inline answers.

Related quality issue: later units use repeated patterns rather than independent-looking keys. Lessons 7, 8, 10, and 11 share `ADCDCB / DCBCBA`; Lesson 16 is `ADCBADCBADCBADCBADCB / DCBADCBADCBADCBADCBA`. Repair the all-A forms first, but run the same key-quality check over all 32 forms.

## 2. P1 — Pausing an issued lesson can permanently record a perfect quiz as failed

`PracticeAssessmentService.mjs:36–38` overwrites the academic stage with `locked` whenever a pause is active, including when all questions are correct. `CloseSessionOutcome.mjs:270–272` treats every stage other than `completed` as unresolved questions and records `needs_remediation`. Its existing-outcome path at lines 202–220 subsequently retains that result.

**Reproduced with real service/domain code and in-memory repositories:**

1. Create, prepare, issue, submit, and grade a one-target linked assessment at 100%.
2. Keep a global curriculum pause active while closing the graded session.
3. Close records `needs_remediation` with reason `course_questions_unresolved`.
4. Remove the pause. The assessment now says `completed`, but its successor remains `locked`.
5. Close the same session again: it still returns `needs_remediation`.

The reproduction output was:

```text
before close graded locked
close while paused needs_remediation
after unpause completed locked
close again needs_remediation
```

**Impact:** the learner has no unresolved target to retry, while the course planner has no passed outcome to unlock the successor. Ordinary retry, review, and resettlement cannot repair it. A teacher intervention is required.

**Correction:** separate academic completion from permission to begin/print/study, for example `assessmentStage` plus `access`. Settlement should use the immutable graded evidence and cumulative unresolved-target count, independent of a pause that blocks new work. Define and test the policy for finishing already-issued sheets. Add a narrow recovery path for an already-recorded `course_questions_unresolved` outcome whose targets are all resolved, preserving reward idempotency.

## 3. P2 — Historical plan replay incorporates current assessment/access state

`PlanProjection.mjs:318–326` calls `practiceAssessments.get({ learnerId, unitId })` while projecting both current and historical plans. It passes neither `historyUntil` nor the requested day. `PracticeAssessmentService.mjs:19–34` reads all current sessions, card evidence, current exceptions and the current clock; `PlanProjection` then uses that current stage to rewrite passed rows inside an already date-filtered historical history.

**Reproduced:** with an unchanged passed October 1 history row, projecting October 2 gives Lesson 1 completed and Lesson 2 available when the current assessment says completed. Changing only the current assessment to review gives Lesson 1 available and Lesson 2 locked for the same October 2 query. A pause applied today can produce the same contamination because it turns current assessment stage into locked without changing the old session row.

**Impact:** past term-grid/day-completion projections can change because of a later pause or correction. The outer projection's `activeAsOf` and `historyBefore` safeguards are bypassed by the nested current-state service. This also duplicates planner/overlay assembly across services, making the inconsistency easy to reintroduce.

**Correction:** derive the academic assessment projection from the same already-loaded, time-scoped evidence as the enclosing plan. Thread the as-of boundary through event reduction, card evidence, and exception/attestation reads if a nested service remains necessary. Keep current access restrictions separate from historical academic results. Add replay tests with a later pause, later correction, and later review completion.

## 4. P2 — A scanned paper result does not refresh the open card screen

`CardLadderProgram.jsx:442–447` refreshes assessment state only on learner/deck changes, `started`, or the current item's **type/source**. Its visibility listener only logs visibility. The component has no subscription or polling for paper grading/correction events.

**Trigger/impact:** print from the start card or completed daily summary, leave that screen open, and scan the quiz. The server changes to review or completed, but the panel remains “Your printed quiz is waiting to be graded” with “Reprint quiz.” The feedback and “Review missed skills” action are not discovered until a separate navigation/item transition or an attempted reprint triggers another fetch. This breaks the immediate paper-to-screen handoff.

The backend does emit the internal outcome fact (`CloseSessionOutcome.mjs:339`). However `EventBusSchoolRealtimeAdapter.mjs:105` publishes it on the internal bus; it is not itself a browser broadcast. The existing grade-change browser notification is also a separate path. A frontend fix therefore needs an explicit supported invalidation contract, not merely a listener for an internal event name.

**Correction:** publish/consume a learner- and unit-scoped assessment-change notification after persisted grading/correction, and re-fetch the authoritative projection. Refresh on focus/reconnect as a recovery path. Include item identity or a response revision in local refresh triggers rather than relying only on type/source. Test printing → external scan → review button on the same mounted component, plus pass and teacher correction.

This is a confirmed code-path finding; no live browser or physical scanner was used in this audit.

## 5. P3 — Completing card practice does not emit a completion-input event

`CardLadderSittingService.mjs:682–709` persists the response and logs state changes, including day completion, but has no semantic realtime gateway or event emission. The router simply returns that response. `EventBusSchoolRealtimeAdapter.mjs:87–92` subscribes completion recomputation to session outcomes, piano completion, assignments, story reads, and day bypasses; it has no card-ladder input.

**Trigger/impact:** if Korean card practice is the last daily obligation, the API's on-demand completion truth becomes correct immediately, but the completion bridge receives no input from that action. Event-only subscribers remain stale until another supported input occurs. The current State Gates producer mitigates its own gate with a 15-second reconciliation loop (`SchoolStateGatesProducer.mjs:19,47–48`), so this is **not** a claim that games stay permanently locked.

**Correction:** emit a semantic live card-practice completion/input-change fact after the durable transition and subscribe the completion bridge to it. Include learner, package/deck, study day and stable evidence identity; suppress test-mode emissions and duplicate-answer emissions. Cover other supported writes that can newly settle a day, such as teacher exclusions, using the same domain transition detector.

## Verified strengths and scope

- **Inventory and source organization:** deterministic assembly produced 16 units, 284 canonical cards, 32 forms and 120 paper targets. All 16 live unit objects and the live lexicon matched the committed assembly exactly. The order follows the textbook's ten new-grammar units, reviews at 3/6/9/12/15, and a cumulative final. The final covers all twenty patterns and reuses existing cards. I checked the source curriculum roster and the vocabulary/model inventory for every unit, plus source-transcript grounding and sampled grammar questions in Units 2, 7, 10, 13, 14 and 16. No additional clear keyed Korean-language error was found in that sample. The answer-position defect above is independent of semantic correctness.
- **Normal hybrid loop:** the real integration test passes 6 → 2 → 1 questions, preserving correct target credits, requiring fresh two-direction recognition after each miss, alternating pinned forms, using the actual subset allocation for scan reconstruction, and reopening only a corrected target. The pure projection keeps voided targets unresolved and does not revoke paper completion for a later ordinary spaced-review miss.
- **Authority and sequence:** linked enrollment is checked server-side, initial and resumed sittings enforce current course access, unavailable unseen cards are removed from introduction queues, and future/completed linked decks are excluded from current daily obligations. Printing is explicitly requested. Same learner/unit print calls are coalesced in process; existing issued sessions are reused. The first-issue service enforces readiness independently of the button.
- **Persistence and identity:** session events contain a frozen practice/form/question snapshot, printed documents use pinned revisions, and allocations preserve exact row/item ownership for grading. Existing printed worksheets should continue using their issued snapshots. No code path was found that intentionally regenerates old atlas sheets from the new profile. This audit did not perform a process-crash or multi-process race test; in-process coalescing should not be described as a distributed lock.
- **Atlas integration:** The learner's actual `YamlAssignmentStore.get()` returns `upper-6` at both the course and embedded enrollment levels, with the existing enrollment ID and lesson order. The planner preserves arbitrary profile IDs; solo `IssueDocument.mjs:737` and composed `IssueComposedWorksheet.mjs:154` use the same course/embedded-profile resolution. Rendering and grading use the instance, not an upper/lower special case. I independently created **580 in-memory instances over all 58 real atlas banks**, each with six questions, five options per question and one or two multi-select questions. The old upper profile and explicit remediation subsets remain supported. Five out of six meets the existing 80% threshold. I found no new atlas-profile defect.

## Verification and limitations

**142 focused tests passed across 8 files** during this audit:

- `PracticeAssessmentService.test.mjs`, `PracticeAssessment.loop.test.mjs`, `practiceAssessment.test.mjs`, `PlanProjection.test.mjs`, and `questionBankV2.test.mjs`: 44 tests.
- `CardLadderSittingService.test.mjs`, `PracticeAssessmentPanel.test.jsx`, and `IssueComposedWorksheet.test.mjs`: 98 tests.

Additional read-only checks: complete live/assembled unit and lexicon comparison; all 32 published answer-key patterns; 580 real-bank atlas instances through the real YAML assignment projection; in-memory pause/settlement deadlock and historical-projection demonstrations. Existing green tests do not cover the reported failures.

No fresh production container introspection, live browser run, physical print/scan, complete PDF page-by-page reinspection, or full audio listening pass was performed. Source transcripts contain some OCR/layout artifacts, so absence of an exact model sentence was not treated as an unsupported-content defect; models can be valid completed or adapted source exercises. Earlier independent source reviews were read as supporting evidence, not counted as new native-speaker certification. Workbook conversation, listening, extended writing and cultural tasks remain teacher-led as documented; the cards and multiple-choice forms do not independently assess those skills.

Architecturally, the pure progress reducer and immutable assessment snapshot are sound foundations. The main SSoT repair is to avoid mixing academic progress with current access and to reuse one time-scoped projection context instead of making nested planners read a new present-day world. Worksheet profile metadata/spec/validation also remain separate declarations; no divergence for `upper-6` was observed, but a shared profile descriptor would reduce future drift.
