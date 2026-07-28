# School — Composition, Feedback, and Parent-Controlled Delivery

**Status:** Design spec

**Date:** 2026-07-26

**Supersedes:** [`2026-07-21-school-writing-assignments-design.md`](2026-07-21-school-writing-assignments-design.md)

**Depends on:** School identity and attributable records; curriculum catalog and
learning-document design

**Enables:** keyboard-first writing, submitted essays, rubric feedback, letters,
postcards, print-ready stories, email drafts, and later handwritten-work intake

---

## 1. Goal

Composition is a deliberately on-screen School activity. A learner uses a
Bluetooth keyboard and a calm, lightweight WYSIWYG editor to write an essay,
creative work, response, letter, postcard, or notes. School autosaves the mutable
draft, snapshots an immutable submission, then follows the assignment's
curriculum-defined outcome: feedback, parent review, print, or a parent-approved
external delivery.

The learner may prepare a real letter or postcard, but cannot send email or buy
postal delivery. Those are **outbox requests**, always reviewed and dispatched
by a parent. A printer is a delivery target too, governed by the assignment's
allowed outputs and the existing School print policy.

This design gives AI a bounded role: feedback and presentation assistance. It
does not silently change a learner's words, submit on their behalf, make a final
grade, or send anything externally.

---

## 2. Current state and implementation boundary

The bare typing tutor already ships as a keyboard-first drill. The planned
writing surface does not yet ship: the prior document selected TipTap but no
School writing frontend, API, datastore methods, or TipTap dependency currently
exist.

Before implementation, run the existing required spike on the real Portal with
the paired Bluetooth keyboard. Validate sustained typing, caret/backspace,
selection, keyboard shortcuts, touch selection, IME behaviour, input latency,
and the soft keyboard. If TipTap/contenteditable is unreliable, use a styled
plain textarea and limit v1 formatting to paragraphs and line breaks. Preserving
the child's work matters more than rich formatting.

---

## 3. Assignment contract

Composition assignments live as cataloged content at
`data/content/school/composition/{assignmentId}.yml`. They are referenced by a
curriculum unit `composition` activity; they are not standalone arbitrary
editor documents.

```yaml
id: history.ap-dbq-01
revision: 1
title: AP History — Document-Based Question
audience: assigned
kind: essay                         # essay | creative | response | letter | postcard | notes
prompt: |
  Evaluate the most important cause of the change described in the sources.

format:
  template: essay                   # essay | letter | postcard | notes
  min_words: 600                    # advisory only
  allowed_marks: [paragraph, bold, italic, heading, bullet_list]

submission:
  required: true
  completion: submitted             # submitted | parent-approved
  resubmission: allowed             # allowed | replace-pending-review | prohibited

feedback:
  rubric: ap-dbq-01
  ai: advisory                      # none | advisory

delivery:
  allowed: [print-laser]
  print_profile: essay-letter
  parent_review_required: false

provenance:
  source_refs: [source.ap-history.unit-1]
```

The validator rejects unknown fields and normalizes a whitelist. IDs/revisions
are immutable published identities and require an approval-manifest digest, as
defined by the curriculum catalog design.

Rules:

- `kind`, `format.template`, `submission.completion`, `resubmission`, and
  `feedback.ai` are closed values shown above.
- `min_words` is a non-negative advisory integer. It never blocks submit.
- `allowed_marks` is a closed formatting subset; links, raw HTML, embedded
  images, arbitrary fonts, and custom colours are absent from v1.
- `feedback.rubric` is required iff `feedback.ai` is `advisory` and resolves to
  a reviewed rubric revision.
- `delivery.allowed` is a subset of `print-laser`, `print-thermal`,
  `email-draft`, and `postal-outbox`. `print-thermal` is limited to short notes,
  receipt-style letters, or explicit thermal layouts; it is never an automatic
  rendering of a multi-page essay.
- `email-draft` and `postal-outbox` always require parent review, regardless of
  the YAML value. The validator rejects an attempt to turn that off.
- `submission.completion: parent-approved` is the only composition gate allowed
  by this spec. It is a deliberate assignment completion condition, not a
  generic lock on unrelated work.

### 3.1 Rubrics

Rubrics are reviewed data, not model prompts hidden in code:

```yaml
id: ap-dbq-01
revision: 1
title: AP DBQ response rubric
criteria:
  - id: thesis
    label: Thesis and argument
    descriptors:
      developing: States a topic without a defensible claim.
      proficient: States and supports a defensible claim.
  - id: evidence
    label: Evidence
    descriptors:
      developing: Uses limited or unconnected evidence.
      proficient: Uses specific evidence to support the argument.
```

The rubric describes feedback dimensions; it does not give the AI authority to
assign a final grade. Curriculum may show a rubric to the learner before they
write. A parent remains the final reviewer when an outcome needs approval.

---

## 4. Drafting experience

The writing screen is a full composition surface, not a tiny Portal modal.

- A minimal toolbar offers only the assignment's allowed formatting; standard
  keyboard shortcuts work when their matching mark is allowed.
- The prompt, optional rubric, word count, and save state remain visible without
  crowding the editor.
- Autosave is local-first: save locally after roughly two seconds idle and on
  blur, then sync to the backend. An unsynced indicator stays visible until the
  server acknowledges it.
- Typing counts as identity activity. If identity lapses, flush the local draft;
  re-claiming restores the draft without exposing it to another learner.
- The learner can preview a delivery layout before requesting print or outbox.
  Preview is not a submission and creates no external side effect.

The canonical editor value is a validated restricted ProseMirror/TipTap JSON
document. The application derives sanitized HTML and plain text for display,
search, rendering, accessibility, and AI feedback. The server never trusts
client HTML. A textarea fallback stores normalized paragraphs as the same
canonical restricted document shape.

Drafts are mutable, one per learner/assignment/revision:

```text
data/users/{userId}/apps/school/composition/drafts/{assignmentId}.yml
```

They store assignment ID/revision, canonical document JSON, word count,
updated-at time, and local/server revision token. Draft history is not a
curriculum record and may be compacted after a successful immutable submission;
it must not overwrite a newer server revision during recovery.

---

## 5. Submission, feedback, and review

Submitting validates the assignment/revision and snapshots the canonical
document. It never deletes the draft. A later submission is a new immutable
event unless `resubmission: replace-pending-review`, which may supersede an
unreviewed submission while retaining its audit lineage.

```text
data/users/{userId}/apps/school/composition/submissions/{YYYY-MM-DD}.yml
```

Each entry includes a submission ID, assignment ID/revision, attributable user,
submitted time, canonical document snapshot/hash, derived plain-text hash, word
count, and any source work-session ID. It is append-only and therefore follows
the same reassignment rule as School attempts.

### 5.1 AI feedback

For `feedback.ai: advisory`, the application sends the submission snapshot plus
the reviewed rubric revision to the AI gateway. It asks for structured,
criterion-by-criterion feedback, strengths, concrete revision suggestions, and
an uncertainty note—never a grade or pass/fail decision.

Feedback records the submission hash, rubric revision/hash, model/provider,
prompt template version, generation time, and result. It is attached to that
submission and becomes stale if the learner submits a revision. Gateway failure
shows “feedback unavailable”; it never blocks submission, printing, or parent
review. The learner may request feedback only at a bounded assignment-defined
rate to prevent an unbounded cost loop.

### 5.2 Parent review

The parent queue shows the frozen learner submission, requested delivery,
optional AI feedback, and any prior review history. Parent actions are:

- approve as submitted;
- return for revision with a comment;
- decline/cancel an external delivery request;
- approve a specific delivery artifact;
- record a final parent assessment/sign-off when the assignment requires it.

Parent actions are append-only review events. They never mutate the child’s
submission or rewrite AI feedback. A parent-approved completion may satisfy only
the composition assignment that declares it; it cannot be generalized into a
second gate.

---

## 6. Delivery outbox

Delivery begins from an immutable submission snapshot and produces a frozen
artifact. No destination receives a mutable draft.

### 6.1 Local print

The learner can request an assignment-permitted print. Rendering applies a
deterministic reviewed print profile—page size, margins, font stack, header,
title/byline, and optional curated decoration. It must preserve the learner’s
text and never let AI silently rewrite or embellish it.

The existing document renderer creates a Letter PDF or thermal `PrintJob`; the
existing School print quota/approval flow sends it. The request persists the
submission hash, profile revision, rendered artifact hash, target, and printer
result. Reprints use the same frozen artifact and do not create a new
submission or consume a second external-delivery approval.

AI-assisted presentation is optional and must be explicit: it may suggest a
reviewable layout/profile or choose from curated approved clip-art assets. Any
generated visual becomes a separately reviewed asset with provenance before
printing; AI never fetches arbitrary web imagery or adds it invisibly.

### 6.2 Email draft

An `email-draft` request produces a parent-queue artifact with recipient,
subject, sanitized plain-text/HTML body, and attachment references. It does not
call Gmail or another provider while in learner-created or pending-review state.

After parent approval, a future configured mail adapter may create a draft in
the parent-managed authenticated mailbox. It still does **not** send email;
sending remains in the mail provider or a separate explicit parent action. If no
mail adapter is configured, the parent can copy/export the approved artifact.

### 6.3 Postal outbox

A postcard/letter request renders a delivery preview and enters the parent
queue with cost estimate, recipient/address, provider/template selection, and
frozen front/back artwork. Child-entered addresses are treated as sensitive and
remain hidden from other learners.

No postal provider integration belongs in the child-facing surface. A future
parent-managed adapter may submit only a parent-approved immutable artifact,
with the provider job ID and charged amount recorded as a parent delivery event.
The adapter must require an explicit household spending policy; it cannot infer
permission from the curriculum assignment.

---

## 7. Handwritten-work convergence

Typed and handwritten composition share the same eventual submission/review
model. A later handwritten-ingestion service creates an immutable original scan
or PDF, then attaches OCR/handwriting transcription as a derived, confidence-
annotated artifact. The original is authoritative; the transcription may be
corrected by a parent and then receive the same rubric-feedback/review flow.

Printed assignment/form IDs associate pages to the correct learner and work
session. The service never treats a guessed handwriting identity or low-
confidence OCR as a final answer. Diagrams and math notation are separate
extraction modes, not assumed to work through prose OCR.

---

## 8. Architecture and API inventory

| Layer | New responsibility |
|---|---|
| Domain | Assignment/rubric validation; restricted composition document validation; review and delivery state transitions |
| Application | Draft save/conflict handling, submission snapshot, feedback orchestration, parent review, frozen delivery issuance |
| Persistence | Mutable draft store; append-only submissions, reviews, feedback, and delivery-outbox records |
| Rendering | Composition document → print-profile PDF/thermal `PrintJob` |
| API | Learner draft/submission/feedback routes; parent review/outbox routes |
| Frontend | Assignment browser, keyboard editor, preview, submission/feedback view, parent queue |
| Adapter | Optional parent-managed email-draft and postal-delivery ports; no direct child-facing provider calls |

The exact HTTP paths and provider port names belong in the implementation plan.
The mail/postal adapters are optional composition-root integrations and are
absent unless configured; their absence must leave writing and local printing
fully usable.

---

## 9. Test and acceptance criteria

- Real-Portal editor spike passes, or the textarea fallback is selected before
  any composition persistence/UI work begins.
- Validation rejects unknown formatting, an unreviewed rubric, unsafe editor
  JSON/HTML, direct-send policy, and a delivery disallowed by the assignment.
- Draft autosave survives reload, backend failure, identity lapse, and a
  same-assignment concurrent-revision conflict without losing text.
- Submission is immutable; reprint, feedback, review, or delivery cannot alter
  its document hash.
- AI feedback is rubric/version-bound, advisory, rate-limited, visibly fails
  closed, and never creates a final grade/completion by itself.
- Parent review is required for all email and postal delivery, and external
  provider calls cannot occur before review approval.
- Laser and thermal outputs use frozen artifacts; full essays cannot silently
  truncate onto a thermal receipt.
- One creative-writing assignment can be drafted, restored, submitted, receive
  advisory feedback, be printed to Letter PDF, and appear in parent review.

---

## 10. Deferrals

- Collaborative editing, comments, revision diff UI, spell/grammar correction,
  plagiarism detection, automatic final grades, and arbitrary rich embeds.
- Direct email sending, postal-provider selection, charges, and address-book
  management in the learner UI.
- Handwriting scanner/OCR implementation, although its data convergence is set
  in §7.
- A general document/graphic design assistant or arbitrary AI-generated clip art.
