# Assessment, grading, and feedback

School keeps planning separate from evidence. Assignment and timing decide what
may be attempted; sessions, issued documents, attempts, scans, and review
verdicts record what actually happened.

## Work sessions

A curriculum action opens or reuses a work session. Session state is reduced
from append-only events rather than overwritten in place. Typical progression:

```text
created → issued/started → submitted/scanned → graded
        → outcome_recorded → rewarded/closed
```

Retries and reprints reuse durable identities where appropriate. A GET never
opens a session. Program units such as Sentence Ladder keep their own evidence
and report status through the program interface instead of pretending to be a
worksheet session.

## Issued assessment snapshots

An issued worksheet or quiz stores the learner, work session, enrollment,
curriculum revision, selected items, visible choices, order, answer mapping,
and form identity. Reprints use that snapshot. OMR and on-screen grading never
reconstruct an old answer key from mutable current curriculum.

## Grading and pass decisions

Grading records a percentage and the passing threshold that applied at grading
time. At close, the stamped threshold wins; legacy sessions fall back to a
household pass override and then the unit's authored `passing.percent`.

Machine grades are immutable evidence. A teacher correction appends a grade
adjustment with author, reason, timestamp, and base revision; it never edits the
machine result. The effective grade is the machine grade folded through active
adjustments in order. Retraction is another append-only event, so both the
superseded correction and the reason for undoing it remain visible. Previewing
an adjustment or retraction is side-effect free; applying it requires a
resource-scoped fresh-confirmation grant and rejects stale revisions.

A pass unlocks progression. A needs-remediation outcome preserves the retry.
Unattempted work is not a zero. Reward settlement is separate: a result can
close and unlock correctly even when rewards are disabled, require adult
sign-off, or fail to pay.

Attestations can repair a planning gate but are explicitly not engine grades.
Enrichment is separate attributed evidence and does not inflate graded course
percentages.

## Review and feedback

Work that needs adult judgment enters the review queue. A teacher resolves it
with a verdict and may attach a note of at most 120 characters. Pending review
is never shown to the learner as settled feedback.

Resolved notes reach the learner through:

- the result receipt for the associated session;
- the printed agenda's “Notes for you” section for the current or previous
  study day;
- `GET /review/learner/:learnerId` and the learner Feedback panel.

Delivery surfaces show at most the three most recent notes. Standalone teacher
notes use the same delivery path. Learner reflections travel in the opposite
direction to the teacher's roster/today view and remain distinct from grades.

## Repair

Attribution repair moves the underlying attempt evidence to the correct
learner, preserving provenance, so every derived rollup follows it. Regrading
uses the same grading engine in dry-run-first operations. Abandoning a ghost
session is explicit and reasoned; it does not fabricate a pass.

The teacher workspace exposes systematic regrade under Operations. It requires
a bank id, bounded day range, and reason, shows the checked/corrected/session
impact before doing anything, and requires a fresh resource-scoped PIN
confirmation to append the corrections. The original attempts remain intact
and each corrective row names its source attempt, teacher, and reason.

Teacher session inspection shows machine grade, effective grade, the complete
correction/retraction ledger, session events, and retained print-artifact
lineage together. Grade adjustments and retractions are both preview-first.
Issued PDF opens the exact retained bytes; **Prepare postview PDF** requires a
fresh artifact-scoped confirmation, renders those bytes against the linked
session evidence, and exposes only a temporary browser blob URL. This is the
preferred repair surface because the operator can see the evidence being
preserved before applying a change.

See [progress and reporting](./progress-and-reporting.md) for how this evidence
becomes course grades, milestones, and report cards.
