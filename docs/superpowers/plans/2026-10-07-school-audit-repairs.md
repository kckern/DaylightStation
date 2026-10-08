# School audit repairs implementation plan

Goal: Fix all five findings from docs/_wip/audits/2026-10-07-school-course-astra-audit.md. User approved implementation, including deployment and guarded content/recovery activation. Existing worksheets, progress, rewards and atlas upper-6 enrollment must survive.

Architecture: Academic completion is evidence-derived and distinct from access. PlanProjection owns one shared time-scoped projection context; the assessment service evaluates it without nested present-day planners. Semantic events cross the School realtime gateway; clients refetch authoritative state.

Tasks:
- [x] Academic/access separation, historical replay, narrow pause-outcome recovery. Keep pure stage and add access {allowed,reason}; all access guards honor access, paused issued work earns credit. PlanProjection loads linked session events once, filters events before historyUntil and scopes exceptions/attestations. Remove nested get/current planner; standalone assessment get delegates canonical projection and evaluation consumes already-loaded context. Historical card readiness absent means explicitly unknown, never current mastery. Recovery only for course_questions_unresolved with complete cumulative paper evidence at original settlement and still complete now, no invalidation; append corrective outcome via normal idempotent settlement. Preview/apply repair command.
- [x] Content: deterministically reorder Lessons 2–16 choices, all 32-form QA: balanced counts (difference<=1), no three identical consecutive keys, no three consecutive repetitions of period 1–4, A/B differ >=half positions. Keep Lesson 1 forms. Publish immutable new revisions before guarded unit pin changes; refuse anything beyond choices/pins. New unissued attempts/retries select current compatible forms, roster/card links validated, issued snapshot/key unchanged.
- [x] Realtime/screen: assessment-change School browser notification scoped learner/unit/session after settlement and correction. Card screen refetches matching events, item identity changes, focus/visible/reconnect; coalesce and discard stale learner/deck responses. Durable live cardPracticeDayCompleted transition fact includes learner/package/deck/studyDay/doneAt/stable evidence identity. Detect inside transaction, all completion-capable writes incl teacher exclusion, no test/duplicate/failed-write emission. Bridge consumes immediately; retain gate polling fallback.

Verification: RED/GREEN tests each defect; pause credit/resume advancement and recovery idempotency; later correction/pause/review leaves historical replay stable; same mounted screen receives fail/pass/correction; event scoping/deduplication; published print-to-scan alignment and old/new revisions; cumulative retry loop and atlas regressions. Independent Astra final review before rollout. Synchronize deployed source, clean build, guarded deployment; dry-run then activate compatible content revisions and only eligible recovery. No physical printing.

Execution ledger:
- Initial base d372abb4f; deployed runtime contains atlas 76e710020 overlay on fitness 3cbe5f58, already included in local main. Unrelated root CLI changes preserved.

- Screen task: 76 focused tests passed; existing issued state refreshed on external fail/pass/correction, stale requests suppressed.
- Content task: 10 focused tests passed; 30 new revisions and 15 repins staged; all 32 keys and 48 actual rendered/scanned allocations verified.
- Event task: RED three missing-event assertions, GREEN 114 initial tests; reviewer approved with a failed-write test gap now closed by simulating a newly completing transaction that fails persistence.
- Astra re-review found global pauses were accidentally filtered by learner; correcting real global shape. Recovery is being strengthened with compare-and-append and explicit nonprinting settlement.

- Astra-requested fixes completed: real global pauses honored, shared projection launcher loop regression passes, recovery uses exact checked revision/coalescing and suppresses all receipt generation/capture/printing.
- API authorization and completion bridge integration: 36 tests passed; live record inventory contains no Korean sessions needing recovery.
- Broad isolated suite: 4,443 tests passed initially; one concurrent-edit pause fixture corrected; isolated PDF proof byte snapshots differ while untouched canonical checkout passes all 58 print acceptance tests. Final broad verification will run in canonical checkout after reviewed merge; generic rendering code and fonts are unchanged.

- Astra final review approved integration, no remaining blocking or important findings, independently verified 204 tests. All initial review blockers corrected.
- Canonical-root final broad verification: 4,456 tests passed across 352 files, including all print acceptance tests. Worktree-only byte snapshot differences did not reproduce in the canonical checkout; no generated proof PDFs committed.
- Release code commit: 98364c64e423e3302641e4d24ab4745b9e9ed0ab.
- Production rollout completed: clean image built from the release commit, health check passed and build metadata verified; previous container and image retained for rollback.
- Guarded content activation published 30 immutable form revisions and repinned 15 units. Lesson 1 unchanged. A fresh preview reports zero further revisions or repins, and all 48 production source/unit hashes match the activated content.
- Preservation checks: all 18 enrollment, lexicon and lesson-deck hashes unchanged, including civilization upper-6 enrollment. Original published artifacts and issued allocations retained. No Korean sessions required historical recovery; no physical printing or live grading performed.
- Live read-only checks passed: Lesson 1 accessible; Lessons 2 and 16 retain academic practice state with access blocked by predecessor completion. Their live form references match the corrected revisions. Unauthorized recovery preview rejected with HTTP 403.
