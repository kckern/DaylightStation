# Agenda integrity — every named piece of work must be obtainable

**Date:** 2026-08-25
**Status:** approved in conversation, not yet implemented
**Supersedes:** `2026-08-25-result-receipt-next-up-design.md` (its central premise was disproved — see *What the earlier spec got wrong*)
**Sibling spec:** `2026-08-25-weekly-pacing-design.md` — independent; either can ship first

---

## The principle

> **A surface that names work must hand over the means to do it, and must agree with what a scan
> would actually resolve to.**

Two live defects violate this. They look unrelated and are the same bug.

---

## Defect 1 — the agenda names a worksheet it does not offer

Printed on the thermal receipt at 2026-08-25 11:12 local:

```
 MILO
Tue 25 Aug, 11:12 am
CIVILIZATION — done today
SCRIPTURE — Unit 1 of 85
Finish "Monday · Psalms 49, 50, 51, 61" first
```

That last line is a dead end. There is no worksheet for it, no QR, no panel code. The child is told
to finish something they were never given.

### Why it happens

The planner builds a **structured, actionable remedy** (`planner.mjs:317-322`):

```js
status = 'locked';
lockReason = `Finish “${blocker.title}” first`;
remedy = {
  unitId: blocker.unitId,
  title: blocker.title,
  action: openByUnit.has(blocker.unitId) ? 'resume' : 'start',
};
```

It knows the blocking unit, its title, and whether the child should *start* or *resume* it.

`agenda.mjs:192-194` then throws the structured value away and keeps only the prose:

```js
const lockedRemedy = (!servedToday && !next && list.some((e) => e.status === 'locked'))
  ? (list.find((e) => e.status === 'locked')?.lockReason ?? null)
  : null;
```

`lockedRemedy` is a **string**. The renderer prints it as an instruction.

The original intent was right — `receipts.mjs:258-261` states it explicitly:

> *"printing it WITH its remedy (or the 'not answering' line) is what turns a stall into an
> instruction — `planDailyAgenda` guarantees a remedy exists whenever a section is locked."*

The section carries `lockReason` where it meant to carry `remedy`. One field, prose instead of data.

### Fix

Thread `remedy` (the object) through `planDailyAgenda` alongside — not instead of — `lockReason`,
and treat a locked section's remedy as **the section's offer**: mint its token, print its QR and
panel code, render it as `next`.

The lock is an implementation detail of sequencing. The child needs the outcome, not the reasoning.

**`lockReason` keeps a consumer — the teacher console — and must become unprintable on a child's
receipt.** Leaving it renderable is how the dead-end line creeps back later.

**Progress labels describe the offer, not the horizon.** `Unit 1 of 85` attached to a lesson the
child cannot start is a countdown to nothing. It belongs on the unit being handed over.

### Current status of this instance

Re-materializing both learners' enrollments (2026-08-25 ~18:40Z) populated `lessonOrder`, so
`cfm-w35-d1-psalms-49-61` is now first with nothing before it to block it. Both learners report
`state: "incomplete", excused: []` — scripture is offering a real unit, where it previously reported
`excused: [{ reason: "blocked_no_offer" }]`.

**The CFM instance is resolved; the code path is not.** Any course whose next-in-line unit is
blocked still prints prose. This spec fixes the path, and its regression test is what stops the
observed receipt from ever printing again.

---

## Defect 2 — the result receipt names a lesson the agenda would not choose

`CloseSessionOutcome.#nextUnlocked` (`:592-593`) opens with `if (!unit?.courseId) return null` and
resolves a successor **within that one course**. So the card after a worksheet means *the next lesson
in the course you just finished* — regardless of what else the day holds. A child following receipts
can do six civilization lessons and never touch scripture.

The receipt offers a *scannable token*, so it is the path of least resistance — a second, narrower
answer competing with the agenda.

### Fix — compute what a scan would resolve to

Not "a better next." The receipt must resolve **the same way a scan resolves**, so the two cannot
disagree.

`ResolveSubjectNext.mjs:125-128` already does exactly this at scan time: it runs `planDailyAgenda`
and picks from its sections. `CloseSessionOutcome` must do the same — run `planDailyAgenda` over the
same inputs and select the winning `section.next` across sections.

**The inputs must match, or this reintroduces drift by construction.** `BuildAgenda` plans over
wrapped history (`BuildAgenda.mjs:206-209`):

```js
withCurriculumExceptions(withAttestedPasses(rawHistory, …), …)
```

`CloseSessionOutcome` currently uses raw `listForLearner` (`:594-604`) and has no `attestations` or
`curriculumExceptions` dependencies. Both must be injected. An attested pass unlocks a successor on
the agenda that an unwrapped plan still shows locked.

### What `plan.next` is not

`planLearnerWork` exposes `next` (`planner.mjs:384`) as
`[...inProgress, ...available].sort(byEffectivePriority)[0]`. **Nothing in the codebase reads it**
(grep-verified across backend and frontend). It is not the agenda's answer, and it must not become
one — it lacks served-today suppression, program done-today status, focus displacement, and
paused-content exceptions, and it cannot name flashcard or language-reel entries appended after it
is computed (`BuildAgenda.mjs:213-237`).

---

## Receipt behaviour

| State | Bottom of receipt |
|---|---|
| Passed, work remains | One card: the agenda-resolved next, **with** QR + panel code |
| Passed, nothing remains | Done-for-the-day card |
| Failed, next ≠ this unit | Retry card **with QR** (primary) + next as **text only** |
| Failed, next == this unit | Retry card alone (dedupe by `unitId`) |

**A failed receipt carries exactly one QR, and it is the retry.** The secondary card is text —
`Also today`, the title and subject, no verb, no digits. Giving the de-emphasized option a scannable
key would make it the easiest thing on the page.

### Corrections to carry forward

- **Copy.** The current passing card's eyebrow is **`'One more?'`** with *"Today is already complete.
  Scan only if you want one more."* (`CloseSessionOutcome.mjs:302-306`). `'Next up'` is only
  `receipts.mjs:506`'s fallback. The existing card is framed as an optional extra; under this spec it
  becomes the actual next obligation, so the copy must change to match — it is no longer "one more."
- **Minting volume increases.** Today no token is minted when the passed unit is course-final,
  standalone (`:593`), or its successor is locked (`:610`). Under this spec a token is minted whenever
  *any* work remains. That is the intended behaviour, but "net minting is unchanged" would be false.
- **`#nextUnlocked` is not hand-rolled.** It already calls `planLearnerWork` (`:602-604`) and builds
  the card's **taxonomy** (`:615-625`). Deleting it must re-home that taxonomy construction for a
  cross-course next, not drop it.
- **Token payload.** A `subject_next` token names `{ learnerId, subject, continueToday }`
  (`:291-297`), not a unit. The mint must carry the **chosen entry's subject**, and `continueToday`
  is true only when that subject equals the one just finished.

---

## Interaction with the done-for-the-day card

The two are **not** mutually exclusive by construction, and assuming so prints contradictory paper.

Day-completion comes from `resolveDayCompletion` over section obligations
(`GetLearnerDayCompletion.mjs:56`). "Nothing available" is a different predicate — a learner can be
`complete` while entries remain (as Milo was this morning: `complete` with scripture
`excused: blocked_no_offer`), and can be `incomplete` while nothing is currently offerable.

**Rule: completion state wins.** If the day is complete, print the done-for-the-day card and **no
tokened next card**. Minting a live code for work the child is not expected to do, directly beneath
"you're done for the day," is the exact contradiction this spec exists to prevent.

---

## Error handling

- **Planner or agenda throws:** must not fail the settle. A worksheet that graded correctly must never
  report failure because the *next* hint could not be computed. Log at `warn`, print without a next
  card; the existing dead-end fallback (`receipts.mjs:521`) then applies.
- **`plan.errors` non-empty:** match `BuildAgenda`, which logs and still offers (`:238`). Suppressing
  the next card on any error — including one from an unrelated course — would let a single draft
  course silently disable the feature and would make the surfaces disagree again.
- **A locked section with no remedy:** `planDailyAgenda` is documented to guarantee one, so treat its
  absence as a defect: log at `warn` and fall back to today's `lockedRemedy` prose rather than
  printing nothing.

---

## Testing

1. **The observed receipt cannot recur:** a locked section with a remedy renders an *offer* — token
   present, no "Finish … first" prose anywhere in the blocks.
2. `lockReason` is never rendered on a child-facing receipt.
3. Progress label attaches to the offered unit.
4. **The motivating case:** a learner who just passed a civilization lesson with scripture
   outstanding gets **scripture**, not the next civilization lesson. Fails against `#nextUnlocked`.
5. Receipt next equals what `ResolveSubjectNext` resolves for the same learner and moment.
6. Wrapped inputs: an attested pass changes the receipt's next exactly as it changes the agenda's.
7. Failed + different next: retry has a QR; `Also today` has **no** QR and **no** six-digit code.
8. Failed + same next: exactly one card.
9. Day complete: done-card only, **no** tokened next card, no mint.
10. Planner throws: settle succeeds, receipt still prints, warn logged.

Assert on `b.md` — text blocks are `{ type: 'rich_text', md }` (`receipts.mjs:40`), not `value`.

---

## What the earlier spec got wrong

`2026-08-25-result-receipt-next-up-design.md` proposed both surfaces read `plan.next`, claiming they
"cannot drift." An adversarial review disproved it and the findings were independently verified:

- **Nothing reads `plan.next`.** The agenda's answer is `planDailyAgenda` → `sections`.
- Its Task-13 exclusivity claim was false in the everyday direction, printing a done-for-the-day card
  and a QR'd next together.
- It stated the eyebrow was `Next up` (it is `One more?`) and that minting volume was unchanged (it
  increases).

The error is instructive: it would have replaced one private second answer with a *different* private
second answer. The fix is not a better independent computation — it is **resolving through the same
path a scan resolves through.**

---

## Out of scope

- Weekly pacing — `2026-08-25-weekly-pacing-design.md`.
- The empty-agenda print guardrail and its HA error-sound fallback.
- `IssueCorrectedResultReceipt.mjs:28`, the second `resultDocument` caller, keeps today's behaviour: a
  teacher reprint of an earlier result must not re-derive a day that has since moved on. Add a
  one-line comment there so the omission reads as a decision.
