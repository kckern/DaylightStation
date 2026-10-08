# Independent Astra review: school audit repairs

Date: 2026-10-07

**Review disposition: APPROVED for integration.** No remaining blocking or important implementation defect was confirmed in the reviewed repair scope. This approval covers the implementation and staged content repair; it does not certify deployment or claim that staged content has already been activated. Run the final canonical-environment checks described below before declaring the rollout complete.

Reviewed the isolated school-audit-repairs worktree against `d372abb4f`. Reviewed the approved plan, tracked implementation diff, new tests and repair utilities, and staged content/QA artifacts. This review changed no implementation, enrollment, content, or production records. This report is its sole write.

## Resolution of the original five findings

| Original finding | Review result | Evidence |
| --- | --- | --- |
| P1: answer-position giveaways in Korean printed quizzes | Resolved in staged repair | `cli/lib/korean-course.mjs:6` validates balanced, non-repeating answer keys; `:31` reorders choices without changing answers. `cli/lib/korean-course-repair.mjs:9` bounds the change to choice permutations and corresponding immutable publication pins. Lessons 2–16 receive 30 revised forms; Lesson 1 remains unchanged. Preview/apply tests cover stale-input refusal, retained old publications, and repeat application. |
| P1: access lock overwrites academic completion and deadlocks advancement | Resolved | `PracticeAssessmentService.mjs:17` evaluates academic evidence separately; `PlanProjection.mjs:343` adds access state using the actual global pause model. Printing and card actions enforce access, while settlement consumes academic completion. An independent real-service reproduction produced academic `completed` with `access.allowed=false`, settled the passing paper as `passed`, then offered the successor after unpause. |
| P2: historical projection reads current assessment evidence | Resolved within the approved replay scope | `PlanProjection.mjs:290` scopes practice-session events before reduction; `PracticeAssessmentService.mjs:24` explicitly treats historical card readiness as unknown. Projection calls the pure assessment evaluator rather than recursively asking the current planner. `PracticeAssessmentService.mjs:29` uses the shared projection without collecting launcher program status again. |
| P2: on-screen assessment remains stale after a paper result | Resolved | Settlement and corrections emit learner/unit-scoped `assessment-changed` through `EventBusSchoolRealtimeAdapter.mjs:108`. `CardLadderProgram.jsx` refreshes for that event, focus, visibility and reconnection; its per-identity request handling coalesces refreshes and rejects obsolete responses. Component tests exercise failure, pass, correction and learner/item changes. |
| P3: card-day completion has no semantic completion event | Resolved | `CardLadderSittingService.mjs:113` wraps durable transactions and emits only the first live completion transition after persistence. `EventBusSchoolRealtimeAdapter.mjs:78` supplies that fact to the completion bridge. Tests cover duplicate answers, teacher exclusion, test mode, failed persistence, and immediate bridge recomputation. |

Backend paths in this table are under `backend/src/3_applications/school/` unless otherwise named. The adapter is under `backend/src/1_adapters/eventbus/`; the component is under `frontend/src/modules/School/Programs/Flashcards/CardLadder/`.

## Issues found and corrected during this review

1. **Global pauses initially disappeared from access checks.** Filtering exceptions by learner ID discarded actual global pauses, whose learner ID is null. The final projection passes the active exception collection to `pausedExceptionFor`; a regression now uses the real global-pause shape. Independently rechecked the pause-to-pass-to-unpause flow.
2. **Recovery initially had a check/write race and duplicate-apply exposure.** The final `CloseSessionOutcome.mjs:181` coalesces concurrent recovery for the same session and captures the checked event revision. At `:362`, the recovery outcome append uses the datastore's existing `expectedSeq` guard. Tests reject concurrent correction and invalidation and prevent duplicate outcome application.
3. **Recovery initially reused ordinary receipt generation/printing.** That could reprint the retained original failed receipt while repairing the academic outcome. The final recovery sets `printReceipt:false` at `:215`; `:552` skips receipt document creation, capture and rendering as well as physical printing. Tests assert those downstream operations are absent. Original issued artifacts remain historical evidence.

The last authorization-denial test initially returned 500 because its test composition omitted the domain error class supplied in production. The fixture was corrected; the independently rerun route suite passes all 20 tests. The teacher gate executes before recovery evaluation or mutation (`backend/src/4_api/v1/routers/school.mjs:1234`).

## Authority, state and content checks

- Academic evidence, access permission, and presentation status now have distinct roles. The shared plan projection owns prerequisite/pause access; persisted paper snapshots and event history remain the academic evidence source. No second planner was introduced into the card service.
- Recovery is a narrow preview-first teacher operation for the old `course_questions_unresolved` failure. It requires passing original/current grade and companion gate, complete original/current paper evidence, and a still-eligible session. Invalidated, replaced, already advanced and ordinary failed sessions are refused. It uses normal outcome/reward settlement with receipt output suppressed.
- Frozen issued forms and answer mappings are preserved. Future unissued retries can adopt the current compatible form pins; question IDs and card mappings must still agree with the frozen learning credits. The content repair publishes revised immutable artifacts before repinning units and checks source hashes around application.
- Browser refresh events carry scope rather than becoming authoritative academic state. The component reloads from the service. Completion facts follow successful persistence, and downstream completion is recomputed through the existing bridge.
- The prior atlas audit traced the actual enrollment projection, issuance, snapshot, rendering and grading path and found no profile-ID narrowing defect for `upper-6`. This repair does not alter that profile contract.

## Independent verification

**204 focused tests passed across 12 files**, run by this reviewer against the repaired worktree:

- 35 tests: practice service/loop, recovery, card assessment component, realtime adapter, Korean repair library and actual repair CLI.
- 149 tests: card sitting service, plan projection, completion bridge and school operations CLI.
- 20 tests: teacher workspace routes, including recovery preview/apply and authorization denial. Supertest required permission to bind its temporary local test server; no application backend was started.

Also ran the independent real-service global-pause reproduction described above, without writing real learner records.

Inspected the staged `choice-quality.json`, `print-scan-quality.json`, and the content agent's QA report. They record 32 full forms plus 16 representative targeted retries, actual PDF/allocation/ResolveCardScan checks, all passing with no physical printing. Those 48 render/scan runs were performed by the content agent, not repeated by this reviewer. Repair validation and CLI tests were independently rerun.

## Remaining verification limits

- Staged content is not yet live. Confirm guarded application and actual deployed behavior during rollout. The parent reports zero live Korean sessions, so no historical recovery mutation is currently needed.
- The broad worktree run has three deterministic print PDF byte-snapshot differences. The untouched canonical root passes its 58 print acceptance tests, and the repair does not change generic renderer, measurement or font implementation. A worktree/environment cause is plausible but not proven. The parent should rerun the final broad checks from the canonical root after integration, inspect any remaining differences, and avoid committing generated proof PDFs inadvertently. These differences are not counted as passing tests here.
- This repair review does not repeat a native-speaker review of all Korean prose, physical printer testing, or a deployed browser/scan session. Content changes are deliberately confined to answer-order repair; the original course-content audit remains the source for broader pedagogical coverage observations.
