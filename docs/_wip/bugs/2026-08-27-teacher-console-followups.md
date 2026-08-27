# Teacher console — follow-ups after the coverage remediation

**Date:** 2026-08-27
**Source:** the final whole-branch review of `school/teacher-coverage`, merged as `045e618c2` and deployed.
**Reference model:** [`docs/reference/school/teacher.md`](../../reference/school/teacher.md)
**Audit that started it:** [`2026-08-26-teacher-flow-coverage.md`](../audits/2026-08-26-teacher-flow-coverage.md)

The remediation closed 14 gaps and 4 merge blockers. This file is what it deliberately
did NOT close, so none of it dies with the scratch directory. Nothing here is a
regression from that work; the items in §3 predate it and were verified as such.

## 2. Should fix soon — NOT part of this fix wave

Everything in this section is real but does not block the merge. **Do not fix these
now.** They are recorded so they are not rediscovered from scratch.

**2.1 `SettleByHand` announces a settlement that did not settle.**
`frontend/.../WorkspaceViews.jsx:596-600` and `:612`. The success test is
`SETTLED_OUTCOMES.has(closed.data?.status)` where that set is
`{'settled', 'already_settled'}` — it never checks the session actually became
terminal. A session at `outcome_recorded` whose reward is `awaiting_signoff`
(`CloseSessionOutcome.mjs:571-574` returns without appending `rewarded`, leaving the
session non-terminal) re-settles forever: grade returns `duplicate`, close returns
`already_settled`, success is reported, and the session stays open and stays on the
stale list. Worse, `onSuccess` resets `deliveredRef.current = null` (`:612`), so every
retry **sends the child another note** about a settlement that keeps not happening.
Deferred minor #8 describes the remount case and understates this one. Fix: check
`state.terminal` after the close before reporting success.

Related: `SETTLEABLE_STATES` includes `outcome_recorded`, but a launch- or
program-dispatched session at `outcome_recorded` has no `graded` event, so
`GradeSubmission` returns `unavailable` and the settle refuses outright. That refusal
is at least honest; the `awaiting_signoff` case is the one that lies.

**2.2 `SyllabiPanel`'s create-collision check fails open on infrastructure errors.**
`frontend/.../panels/SyllabiPanel.jsx:108-113`. `if (existing.ok)` treats a 500 or a
network blip as "id is free". The PUT is an unconditional upsert seeded from an empty
create-mode `original`, so a colliding id would destroy an existing syllabus's
`timingTemplate` and `schedule` with no confirmation and no preview. Requires two
things to coincide (a transient failure *and* a colliding id), which is why it is not
blocking, but the consequence is destroying published curriculum. Fix: refuse unless
the GET returned a definite 404. This is deferred minor #13, elevated.

**2.3 A voided question breaks the result receipt's numbered score boxes.**
`CloseSessionOutcome.mjs:409-411` computes `marks` only when
`worksheet.questions.length === state.gradedTotalCount`. A void makes those differ by
one, so `marks` is null, and `DocumentReceiptRenderer.mjs:1017-1022` falls back to
positional fill: it draws `totalCount` boxes numbered `questionStart + index` and
fills the first `correctCount`. On a 9-question sheet with one void the child gets 8
numbered boxes, filled left to right — the exact "specific false claim about which
question was wrong" the `marks` code was written to prevent. The `hints` array
immediately above is correctly indexed against the full printed roster, so the receipt
disagrees with itself. Newly reachable via wave 1's void, same as Blocker 1, but this
one only mis-renders a receipt rather than corrupting a grade.

**2.4 `useRemediationTerminal` caches per `newSessionId` with no refresh path.**
`WorkspaceViews.jsx:686`. Moot if Blocker 2 is fixed by deleting the hook, which is
the recommendation. Listed only so the deletion is not mistaken for a regression.

**2.5 `PendingReviewCount` fans out one uncancelled request per row over a list that
only grows.** `frontend/.../panels/StaleSessions.jsx:38`. `listStale` has no cap, and
`sweepUntouched` skips exactly the non-abandonable rows that render this component, so
the population cannot shrink automatically. Deferred minor #3, with the extra
observation that the list is unbounded. Note `StaleSessions.test.jsx` is outside the
gate-vitest population (deferred #4, pre-existing for all sibling panel specs).

**2.6 `useQuotaByUser` never refreshes after the approval that spends the quota.**
`frontend/.../panels/PrintPendingView.jsx:50`, keyed on `userIds.join(',')`. Approving
one of a child's two pending jobs leaves the pre-approval page count on screen.

**2.7 `sessions.reassign` requires no step-up** while `sessions.grade-adjust` and
`sessions.settle` both do. Wave 4 widened `reassigned` to be legal at terminal states,
so this verb now moves settled, rewarded work on the capability cookie alone.
`TeacherGate.assert` has no action allowlist — `action` is used only for the audit log
and for capability authorization — so nothing flags the omission, and
`requiresTeacherStepUp('sessions.reassign')` is `false`, so `authorize()` returns true
at `TeacherCapabilitySessions.mjs:104`. Worth a policy decision, not obviously a bug.

**2.8 `state.voidedItemIds` has zero consumers** and goes stale after a correction.
See Blocker 1's optional cleanup. Inert today; it becomes a lying field the moment
anything reads it.

---

## 3. Deferred-minor triage
## 3. Deferred-minor triage

The 43 logged minors are at
`.superpowers/sdd/2026-08-26-teacher-coverage-remediation/deferred-minors.md`.

**Ruling: none of the 43 must be blocked on. None of them individually must not ship.**

Two are more than polish and are promoted into §2 above, where they are described in
full — **#13** (fail-open create check, destructive to published curriculum) and
**#8** (note re-delivery, which in combination with §2.1 means a child hears a false
sentence repeatedly).

Three more are worth a cheap fix whenever this area is next touched:

- **#1** — the void-refusal message names
  `/lifecycle/sessions/:id/review/:itemId` without the `/api/v1/school` prefix
  (`GradeSubmission.mjs:185`). A grown-up copying it literally gets a 404. One-line fix.
- **#19** — `crypto.randomUUID` spy never restored; `afterEach` only calls
  `useRealTimers`. Can leak across files sharing a vitest worker.
- **#22** — `NEEDS_GROWN_UP` in `learnerDay.js` is a hand-copy of `agenda.mjs`'s excuse
  ladder with no runtime tether. The frontend genuinely cannot import backend domains,
  so the copy is defensible, but a *test* can import both and assert the four names
  still exist in the source ladder. Without that guard a future fourteenth reason
  classifies as `false` silently — the same failure shape as Blocker 3.

The remaining 38 are genuine polish: docstring length, wording voice, unreachable
fallbacks, telemetry precision, test-runner population, a unicode arrow that a sibling
component already ships identically. Ship them as they are.

---

## 4. Cross-task observations
## 6. Pre-existing, NOT this branch — for a separate change

**Do not fix any of this in the fix wave.** It is documented here because it was found
during review, it is a live bug on a production household server, and Blocker 4d
requires the new reference doc to stop certifying it as working.

**Three console buttons are dead: Print another copy, Apply exception, Retract exception.**

The chain, verifiable end to end:

1. `frontend/.../WorkspaceViews.jsx:641` requests
   `stepUp: { action: 'artifact.reprint', resource: artifactId }`. `:291` and `:296`
   request `curriculum-exception.apply` and `curriculum-exception.retract`.
2. None of the three is in `STEP_UP_ACTIONS`
   (`backend/src/3_applications/school/TeacherCapabilitySessions.mjs:11-15`), so
   `stepUp()` throws `GuestForbiddenError('A valid step-up action and resource are
   required.')` at `:89-91` and the route returns 403.
3. `TeacherProfileContext.jsx:113-118` skips its "already authorized" early return
   whenever `action` is non-null, so the PIN dialog **always** opens for these three.
4. `submitPin`'s 403 branch (`:180-190`) re-checks `authStatus`, sets the error
   "Fresh confirmation was not accepted.", and `return`s **without calling
   `settlePending`**. The promise `useTeacherWrite` is awaiting never resolves. The
   dialog stays open showing an error that no correct PIN can clear, and `setBusy(key)`
   at `useTeacherWrite.js:37` is never reached so the row never even looks busy.

The irony worth recording: `teacherResource()` has no branch for these names, so
`requiresTeacherStepUp` returns `false` and the server's `authorize()` would have
accepted the capability cookie alone at `TeacherCapabilitySessions.mjs:104`. The three
strings are TeacherGate **audit-action** names (`ReprintIssuedArtifact.mjs:29`,
`ManageCurriculumException.mjs:19,43`), not grant names — they were never meant to be
passed to `stepUp`. Every test mocks `requestAuthorization` to `{ok: true}`
(`WorkspaceViews.exceptions.test.jsx:30-36`,
`WorkspaceViews.sessionDetail.test.jsx:25-31`), which is where this has been hiding.

**Evidence they predate the branch point:**

```bash
git show 1320b4639:frontend/src/modules/School/teacher/WorkspaceViews.jsx \
  | grep -n "artifact.reprint\|curriculum-exception"
# 296:    stepUp: apply ? () => ({ action: 'curriculum-exception.apply', resource: form.targetId }) : null });
# 301:      stepUp: () => ({ action: 'curriculum-exception.retract', resource: exception.exceptionId }) });
# 510:    stepUp: { action: 'artifact.reprint', resource: artifactId },

git show 1320b4639:backend/src/3_applications/school/TeacherCapabilitySessions.mjs | sed -n '11,15p'
# const STEP_UP_ACTIONS = new Set([
#   'agenda.dispatch', 'attempts.regrade', 'sessions.grade-adjust',
#   'sessions.grade-adjustment.retract', 'artifact.postview', 'report-card.close',
# ]);
```

All three call sites present at the branch point; none of the three names in the Set at
the branch point. This branch's only change to that file adds `sessions.settle` to both
the Set **and** `teacherResource` — correctly, and with a comment documenting exactly
the pairing invariant these three violate.

**When it is fixed separately**, two things need doing together: add the three names
with matching `teacherResource` branches (or drop the `stepUp` requests entirely, since
the server already accepts the capability cookie for them), **and** close the
`settlePending` leak at `TeacherProfileContext.jsx:190` so a step-up failure reports to
the caller instead of hanging it forever. The second half is the more dangerous of the
two — any future mis-named action will hang rather than error.

## Known reopened / unscheduled gaps

- **A10 — a retake abandoned mid-flight strands the parent session.** Reopened
  deliberately at merge: the client gate that read terminality was reverted because
  `OpenRemediation` refuses a second `remediation_opened` and the server is the
  authority. Recorded in `teacher.md` §16. Closing it needs a `TRANSITIONS` change
  plus a decision about cycling `variant`.
- **A3 — no console path to an artifact postview.** A plan omission, not cruft: the
  route, its own step-up action, and the client wrapper all exist and nothing calls
  them. The wrapper was deliberately left in place rather than trimmed.
- **An all-voided session cannot be settled.** `graded` requires `totalCount >= 1`.
  The UI refuses honestly; closing it needs a domain change.
