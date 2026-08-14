# School Lifecycle Telemetry Audit

**Date:** 2026-08-13
**Scope:** Diagnostic and post-hoc-review coverage across the School subsystem — curriculum load, assignment and enrollment, session lifecycle, document issuance and printing, submission, grading, review/repair, and the frontend surfaces.
**Question asked:** can we diagnose a School problem while it is happening, and reconstruct what happened afterwards?

**Short answer:** during — mostly yes. Afterwards — no, and three specific defects are why.

---

## 1. Method

- Census of `logger.*` calls across `3_applications/school`, `2_domains/school`, and the School YAML adapters.
- Static extraction of every `new X({...})` construction in the School composition module, checking whether a logger is threaded in.
- Extraction of every `school.*` event name and its payload keys.
- Static scan for `catch` blocks containing no log, no rethrow, and no error accumulation.
- Frontend facade inventory (`schoolLog`, `teacherLog`).

Counts below are from that extraction, not estimates.

---

## 2. What is already healthy

**Event naming is consistent and needs no rework.** Roughly 60 distinct events, uniformly `school.<area>.<event>`: `school.issue.printed`, `school.submit.omr-decode-failed`, `school.grade.recorded`, `school.teacher-gate.refused`, `school.retention.swept`. Areas are stable and readable. This is the part of the system that is done well, and any work below should preserve it.

**The lifecycle receives the real framework logger.** `app.mjs` builds `rootLogger.child({ module: 'school-lifecycle' })` and threads it through composition. The `logger = console` default present in 24 use cases is a fallback, not what runs in production — *except* where composition forgets to pass it, which is Gap A.

**The domain layer is correctly silent.** `2_domains/school` is pure by design — no I/O, no clock, no logging. That is not a gap and should not be "fixed"; policy modules return errors in their result shape (`planLearnerWork`'s `errors[]`, `validateUnit`'s `errors[]`) and their callers decide what to report.

**The richest paths are genuinely well covered.** `IssueDocument` (11 log sites), `CloseSessionOutcome` (8), `GetLearnerRecord` (6), `ResolveScanAction` (5). The issuance and scan-resolution paths — the ones a child stands in front of — can be followed live.

---

## 3. Gap A — twelve constructions get no logger, and fall back to bare `console`

Every School YAML store resolves its logger as `config.logger || console`. Twelve constructions in the composition module omit it:

```
CreateLostAnswerSheetTicket   ListLearnerSessions          RenderPrintDocument
VirtualThermalPrinterAdapter  YamlAllocationStore          YamlAssignmentStore
YamlCurriculumDatastore       YamlFormMapStore             YamlPrintDocumentRepository
YamlReviewQueue               YamlWorkSessionDatastore     YamlWorksheetInstanceStore
```

The clearest instance:

```js
// 5_composition/modules/schoolLifecycle.mjs
assignments: new YamlAssignmentStore({ configService }),   // no logger

// 1_adapters/persistence/yaml/YamlAssignmentStore.mjs
this.#logger = config.logger || console;
…
this.#logger.warn?.('school.assignments.file-corrupt',   { learnerId, file });
this.#logger.warn?.('school.assignments.history-corrupt', { learnerId, file });
```

So *"this child's assignment file is unreadable"* — one of the highest-signal events the subsystem can emit, and the one that makes a save refuse — is written to stdout as an unstructured console line. It never reaches a transport, carries no module context, and cannot be filtered, aggregated, or found later.

The same applies to corrupt work-session shards, unreadable curriculum, and review-queue failures.

**Severity: high, cost: trivial.** These are one-word additions at twelve call sites.

---

## 4. Gap B — state-changing operations that log nothing

Fourteen use cases emit no logs at all. Read-only ones (`GetTranscript`, `GetProgressReport`, `GetMilestoneStatuses`, `ListLearnerSessions`) are defensible. The **mutating** ones are not:

| Use case | What it changes, unrecorded |
|---|---|
| `SetAcademicPeriods` | The academic calendar every report card is scoped by |
| `SetMilestones` | A learner's pacing targets |
| `SetPassOverride` | The bar at which work counts as passed |
| `RecordEnrichment` | Credit that excuses pacing lateness |
| `RecordTeacherNote` | Teacher-authored record on a learner |
| `RetractTeacherRecord` | Withdrawal of such a record |
| `CreateLostAnswerSheetTicket` | Issues a replacement-sheet ticket |

A grown-up can move a child's pass bar or rewrite the academic calendar and leave no trace in the logs. Several of these *do* write append-only history to disk, so the change is recoverable from data — but it is invisible to operational diagnostics, and the two are not the same thing.

Thin-but-present, worth enriching for the newest mutation path: `EnrollLearner` and `UnenrollLearner` emit one event each.

**Severity: medium-high.** These are exactly the events an after-the-fact review of "why did this child's grade change" needs.

---

## 5. Gap C — the correlation key is split, so a learner's history cannot be joined

Payload keys across School events:

```
sessionId   32 events
learnerId   18 events
userId      12 events      ← same concept as learnerId: a roster id
unitId       8 events
bankId       3 events
```

`learnerId` and `userId` denote the same thing — a household roster id — and are used interchangeably depending on which use case emitted the event. `school.print.printed` carries `userId`; `school.assignments.updated` carries `learnerId`. Reconstructing one child's day therefore requires knowing which events use which key, and any naive query silently returns a partial history.

A further 15-odd events carry neither, only `{ error: err.message }` — for example `school.progress.follow-up-source-failed` and `school.progress.expectation-source-failed`. When those fire you learn that something failed, but not for whom.

**Severity: high for post-hoc review specifically.** This is the defect that most directly defeats the stated goal, and unlike Gap A it cannot be fixed by threading an argument — it needs a convention and a pass over existing call sites.

**Recommended convention:** `learnerId` everywhere (it is the majority and matches the domain vocabulary — `IAssignmentStore`, `planLearnerWork`, `GetReportCard` all say learner), `sessionId` wherever a session exists, and never a bare `{ error }` payload in a learner-scoped code path.

---

## 6. Gap D — nothing is persisted, so "after the fact" has a short horizon

The logging framework already has file-backed transports — `transports/sessionFile.mjs` and `transports/sessionEventsFile.mjs` — and they are wired for Fitness and Piano, which write per-session JSONL that survives redeploys.

**School routes to console and Loggly only.** There is no per-day or per-session School log on disk. A container restart ends the record, and a redeploy is the normal response to any fix — so the evidence for diagnosing a problem is routinely destroyed by the act of responding to it.

This is the architectural gap behind the request. Gaps A–C improve what is emitted; this one decides whether any of it still exists tomorrow.

**Options, cheapest first:**
1. Route the `school-lifecycle` child logger to a dated file transport (`media/logs/school/YYYY-MM-DD.jsonl`), mirroring the Fitness pattern. Nothing else changes.
2. As above, plus a per-work-session stream keyed on `sessionId`, so one child's quiz — issue → submit → grade → outcome → reward — is a single greppable file.
3. Persist a narrow, curated audit stream of state-changing events only (the Gap B list plus enrollment and grading), separate from diagnostic noise.

Option 1 is a small change and unblocks the stated goal. Option 3 is what a term-end review actually wants to read. They are complementary, not alternatives.

---

## 7. Gap E — swallowed errors in the adapter layer

`catch` blocks with no log, no rethrow, and no error accumulation:

```
YamlSchoolDatastore 4   YamlReviewQueue 4   YamlWorksheetInstanceStore 3
YamlWorkSessionDatastore 3   YamlAssignmentStore 3   YamlTokenRegistry 2
YamlSyllabusStore 2   YamlSessionDatastore 2   YamlCurriculumDatastore 2
```

**Not all of these are defects.** Several are deliberate: the stores distinguish "missing" from "corrupt" by catching `ENOENT` and returning `null`/`[]`, and the corrupt branch *does* log. That pattern is correct and should stay.

The ones worth reviewing individually are those that catch a parse or write failure and return a neutral value without recording anything — a corrupt file that reads as empty is indistinguishable from a legitimately empty one, and downstream that becomes "this learner has no work" rather than "we could not read this learner's work."

**Severity: medium.** Needs a per-site judgement, not a blanket change.

---

## 8. Frontend coverage

`schoolLog` exposes 14 categories — `profile, session, answer, bank, nav, home, materials, surface, feedback, standing, print, typing, player` — and `teacherLog` exposes 3: `nav, claim, fetch`.

The student surface is reasonably instrumented. The **teacher console is not**: with only `nav`, `claim` and `fetch`, the console can report that a write was refused but not what a teacher was doing when it happened. The enrollment drawer added in the current branch logs its outcomes through `teacherLog.fetch`, which is the closest available category rather than an accurate one.

Worth adding: a `write` or `mutation` category carrying `{ learnerId, action, outcome }`, so teacher-initiated state changes are visible from the client side too — which also cross-checks Gap B from the other end.

---

## 9. Prioritized recommendations

| # | Work | Severity | Cost |
|---|---|---|---|
| 1 | Thread loggers into the 12 constructions in Gap A | High | Trivial |
| 2 | Standardize on `learnerId`; never emit a bare `{ error }` in a learner-scoped path (Gap C) | High | Small, mechanical, wide |
| 3 | Route the school-lifecycle logger to a dated JSONL file transport (Gap D, option 1) | High | Small |
| 4 | Add structured events to the seven mutating use cases in Gap B; enrich enroll/unenroll | Medium-high | Small |
| 5 | Add a `write` category to `teacherLog` and use it from the console's mutation paths | Medium | Small |
| 6 | Review the swallowed catches in Gap E individually | Medium | Medium |
| 7 | Curated audit stream of state-changing events (Gap D, option 3) | Medium | Medium |

Items 1–4 together are what turns "we can watch it happen" into "we can reconstruct what happened", and none of them is large.

---

## 10. Caveats on this audit

- Counts come from static extraction. A dynamic-name log call (none were observed, but the scan would not catch one) would be missed.
- "Zero logs" means zero `logger.*` calls in the use case file itself; a use case may still be observable through events emitted by its collaborators.
- The swallowed-catch scan is deliberately naive — it reports catch blocks without a log, rethrow, or error push, and several of those are intentional missing-vs-corrupt discrimination. The number is a starting list, not a defect count.
- Log *levels* were not audited for correctness; several `warn` calls describe conditions that read as `error`, and that deserves its own pass.
