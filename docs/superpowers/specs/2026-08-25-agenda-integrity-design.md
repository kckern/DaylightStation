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

### Fix — two rules, in this order

> **Revised 2026-08-25 after adversarial review.** An earlier draft said simply "promote the remedy
> to the section's offer." **That is wrong in every reachable case and would ship a new bug.**
> `agenda.mjs:191-193` computes `lockedRemedy` only when `!next` — only when the section has **no**
> available candidate. If the blocker were available it would already *be* `section.next`. So
> unconditional promotion is either vacuous or promotes work that is **not** available.
>
> Concrete failure it would have caused: on **Saturday 2026-08-29**, a learner who finished week 35
> sees w36-d1 as `upcoming` (its window opens Aug 31) and w36-d2 as `locked` with remedy = w36-d1.
> Promotion would mint a token and **open next Monday's lesson early** — and `ensureSession`
> (`offerSession.mjs:28-48`) has no timing guard, after which "open beats the lock deliberately"
> (`planner.mjs:314-317`) makes the early start permanent.

**Rule 1 — fix locked-vs-upcoming precedence first.** When a section has no candidate and the
blocking entry is `upcoming` or `dormant`, the section must yield its **`timingNotice`**
("Starts <date>"), never lock prose. A child cannot act on either, but the timing notice is *true
and non-actionable by nature*, whereas "Finish X first" is an instruction that cannot be followed.
`agenda.mjs:227-229` has the same wrong precedence in `obligation.reason` and must be fixed with it.

**Rule 2 — promote only when the remedy is genuinely offerable.** Promote the remedy to the
section's offer **only if** it resolves to a plan entry whose own status is `available` or
`in_progress`. Blocker chains must be followed to a fixpoint: `planner.mjs:218-223` returns only the
*nearest* unpassed predecessor, which may itself be locked. If the fixpoint is not offerable, fall
back to Rule 1's notice or today's prose.

When Rule 2 does fire, the lock is an implementation detail of sequencing and the child gets the
outcome, not the reasoning.

### Where the fix lands

**In `planDailyAgenda`, not in `BuildAgenda`.** Four surfaces consume the same locked state:
`ResolveSubjectNext.mjs:131`, `ResolveAccessCode.mjs:320`, the self-service card builder
`offeredActions.mjs:188-201`, and the printed agenda. Fixing only `BuildAgenda` means the printed QR
offers a unit while the panel code still says "Finish … first."

`remedy` is `{ unitId, title, action }` (`planner.mjs:321-325`) — not a plan entry. Promotion must
**materialize it into the blocker's full entry** (status, timing, priority, taxonomy), not synthesize
a partial one.

### The promoted section's obligation state — must be declared

Today a blocked section is `blocked_no_offer` → `excused` (`agenda.mjs:227`), which is why a learner
could read `complete` this morning with scripture excused. If promotion makes the section
`obligated`, completion flips to `incomplete` and the piano games re-lock
(`useSchoolGameAccess.js:6`) **as a side effect of this spec** — territory the pacing spec claims.

**Ruling: a promoted section is `obligated`.** It now carries real, actionable work, and calling it
excused would mean printing a live QR under a day marked complete. This must be stated because it
means Spec A and the pacing spec both move the completion lever, and whichever ships second inherits
the interaction.

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

**`launchers` + program statuses are also required.** `planDailyAgenda` without `programStatuses`
sees every program's `doneToday` as false, so a finished PE or flashcards subject looks unserved and
can win the receipt's next slot — drift by construction. All three deps (`attestations`,
`curriculumExceptionStore`, `launchers`) are already in scope at the construction site,
`schoolLifecycle.mjs:738`.

**`ResolveSubjectNext` picks within ONE subject** (`:119-133`) — the subject its token names. It has
no cross-subject selection rule, and none exists anywhere in the codebase. This spec must define one
or the implementer will invent a new private answer, which is the exact sin being fixed here.

**Ruling: the cross-section winner is the first section in the agenda's own paper order** that has a
non-null `next`. The printed agenda already orders sections; using that order means the receipt names
whatever the child would read first on their own agenda. No new ordering is introduced.

**Known, accepted asymmetry:** `BuildAgenda` appends flashcard and language-reel entries to the plan
after `planLearnerWork` runs (`:213-237`); `ResolveSubjectNext` does not. The receipt follows
`ResolveSubjectNext`'s inputs, so it can never name a flashcard or language-reel as "next." That is
acceptable — those are not tokened worksheet offers — but it must be stated so the two surfaces'
difference is a decision rather than a surprise.

### What `plan.next` was not — now deleted

`planLearnerWork` exposed `next` as
`[...inProgress, ...available].sort(byEffectivePriority)[0]`. Nothing in the codebase read it
(grep-verified across backend and frontend). It was not the agenda's answer and could not become
one — it lacks served-today suppression, program done-today status, focus displacement, and
paused-content exceptions, and it cannot see entries a caller appends after the planner runs.

It has been **removed** from the planner's return value. A plausible-looking unread answer to the
most consequential question in the subsystem is a trap, and the receipt design below was about to
walk into it. The real answer is per SUBJECT, on the sections `PlanProjection` returns; callers that
need ordering read `available`, which is already sorted by `byEffectivePriority`.

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
