# Result-receipt "Next up" — design

**Date:** 2026-08-25
**Status:** approved, not yet implemented
**Surfaces:** `backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs`, `backend/src/2_domains/school/documents/receipts.mjs`

---

## Problem

`CloseSessionOutcome.#nextUnlocked({ state, unit, nowIso })` opens with
`if (!unit?.courseId) return null` (`CloseSessionOutcome.mjs:592-593`) and then searches for the
next unit **inside that one course**. So the "Next up" card on a result receipt means exactly one
thing: *the next lesson in the course you just finished*. It has no knowledge of the learner's day.

A child finishes a civilization worksheet and the receipt hands them a QR and a live panel code for
the next civilization lesson — while scripture, typing, and anything else sits untouched.

Two consequences, the second being the real cost:

1. **It is factually misleading.** "Next up" reads as *the next thing you should do*. It actually
   means *the next thing in this course*. Those coincide only when the rest of the day is done.
2. **It competes with the agenda.** The agenda card (printed on a personal-card scan) is the surface
   that knows the whole day. The result receipt quietly offers a narrower, different answer — with a
   scannable token attached, making it the path of least resistance. A child following receipts can
   do six civilization lessons and never touch scripture.

The structural flaw is **two surfaces independently deciding "what's next."**

## Non-goals

- Changing the agenda card. It is already correct.
- Changing how work is prioritized. This spec adopts the existing ordering; it does not invent one.
- Attempt caps, per-subject daily limits, or any new teacher configuration.

---

## Key insight

The ordering already exists as a **pure domain function**, and `BuildAgenda` already uses it.

`planLearnerWork` (`backend/src/2_domains/school/planner.mjs:82`) returns, at line 384:

```js
next: [...inProgress, ...available].sort(byEffectivePriority)[0] ?? null,
```

`byEffectivePriority` (`planner.mjs:369-371`) is `timingPriority`, then `timingRank`, then plan
position. `BuildAgenda` calls the same function at `BuildAgenda.mjs:212`.

So the fix is not to build a better "next" — it is to **stop computing a second one**. Both surfaces
read `plan.next` from the same pure function and cannot drift.

The function takes data and returns data: no token minting, no session opening, no I/O.
`#nextUnlocked` already loads `assignment`, `units`, and session `history`
(`CloseSessionOutcome.mjs:594-599`) — exactly `planLearnerWork`'s inputs. The data-fetching is
already in place.

Plan entry shape (`planner.mjs:337-340`): `{ unitId, title, subject, courseId, status, … }`.

---

## Design

> **SUPERSEDED (2026-08-25, structural hardening task 2).** The ordering step below reads
> `plan.next`, which has since been DELETED from `planLearnerWork` — see
> *What `plan.next` was not* in `2026-08-25-agenda-integrity-design.md`. It has no served-today
> suppression, no program done-today status, no focus displacement and no paused-content
> exception, so a receipt built on it would promise work the panel then refuses: the exact
> 12:15 failure. The receipt's "next up" must come from the same `PlanProjection` sections the
> agenda and the panel read. The rest of this document (terminal states, dedupe rule, token
> behaviour, copy) stands.

### Ordering

Delete `#nextUnlocked`. In `CloseSessionOutcome`, call `planLearnerWork` with the already-loaded
inputs and read `plan.next`. `byEffectivePriority` becomes the single ordering rule in the system.

### The four terminal states

| State | Bottom of the receipt |
|---|---|
| Passed, work remains | One card for `plan.next`, **with** QR + panel code (actionable) |
| Passed, nothing remains | Done-for-the-day card — see *Relationship to Task 13* |
| Failed, `plan.next.unitId !== unit.unitId` | Retry card **with QR** (primary) + `plan.next` card as **text only** |
| Failed, `plan.next.unitId === unit.unitId` | Retry card alone |

**Dedupe rule.** A failed lesson is not completed, so it typically remains `in_progress` or
`available` and `plan.next` resolves to the very unit just failed. Printing it twice on one slip is
noise. Compare `plan.next.unitId` to the closed session's `unitId`; if equal, omit the secondary
card. This is a correctness rule, not a preference.

### Token behavior — unchanged in volume

- **Passing receipt:** mints one `subject_next` token, exactly as today
  (`CloseSessionOutcome.mjs:282-290`). Only the *unit it points at* changes.
- **Failing receipt:** mints only the `remediation` token it already mints. A `remediation` token
  cannot carry a panel code — `tokens.mjs`'s `createTokenRecord` whitelists `subject_next` only
  (see the comment at `CloseSessionOutcome.mjs:275-280`).
- **The secondary "Also today" card mints nothing.** It is text.

This is deliberate. The point of retry-primary is that the child should retry; giving the
alternative a scannable key would make the de-emphasized option the easiest thing on the page. It
also keeps the visual hierarchy honest: **a failed receipt carries exactly one QR, and it is the
retry.**

Net minting is identical to today's. No new live access codes enter the pool.

### Copy

- Passing card keeps the existing `Next up` eyebrow.
- Failed secondary card uses **`Also today`** — the lesson title and subject, no verb, no QR, no
  digits. It must not read as an instruction or as an alternative to the retry.

---

## Components and boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `planLearnerWork` (domain, pure) | **Owns ordering.** Unchanged by this work. | nothing (data in, data out) |
| `CloseSessionOutcome` (application) | Decides which terminal state applies; mints the passing token; passes a resolved next-entry to the document builder | `planLearnerWork`, token registry |
| `resultDocument` (domain, pure) | Renders blocks. Gains one optional informational block. Makes no decisions. | nothing |

The decision lives in the application layer; the domain stays pure on both sides. `resultDocument`
receives an already-resolved value and never asks "what's next" itself.

### `resultDocument` signature change

Add one optional argument, defaulting so every existing caller is unaffected:

```js
alsoToday = null   // { title, subject } | null — informational, never tokened
```

Rendered after the actions loop and **before** the existing dead-end fallback at
`receipts.mjs:519-521` (`'Scan your card to see what is next.'`), so a receipt that names remaining
work does not also tell the child to go find some.

Text blocks are `{ type: 'rich_text', md }` — the field is **`md`**, not `value`
(`receipts.mjs:40`). Tests asserting on rendered text must read `b.md`.

### Call sites

`resultDocument` has exactly two callers:

- `CloseSessionOutcome.mjs:349` — **changes.** Passes `alsoToday` and the agenda-derived next.
- `IssueCorrectedResultReceipt.mjs:28` — **unchanged.** A teacher reprint of an earlier result must
  not re-derive a day that has since moved on. Add a one-line comment there so the omission reads as
  a decision rather than an oversight.

---

## Relationship to Task 13 (done-for-the-day card)

`docs/_wip/plans/2026-08-25-school-scan-print-incident-fixes.md` Task 13 already adds a
`dayComplete` card to `resultDocument` for the "passed, nothing remains" row above. The two are
complementary and must be sequenced:

- Task 13 supplies `dayComplete` and suppresses the dead-end fallback when the day is finished.
- This spec supplies `alsoToday` for the day that is **not** finished.

They are mutually exclusive by construction: if `plan.next` is null the day is complete and Task
13's card applies; if it is non-null there is remaining work and `alsoToday` may apply. **A receipt
must never print both.** Whichever lands second must add the test that pins that exclusivity.

---

## Error handling

- **`plan.errors` non-empty** (e.g. a course assigned with no publishable units): render nothing
  extra. A receipt is not the place to surface a curriculum fault, and `school.agenda.plan-errors`
  already logs it. The receipt degrades to today's behavior.
- **`plan.next` is null on a failing worksheet:** retry card alone. Correct — the only thing left is
  the retry.
- **`planLearnerWork` throws:** must not fail the settle. A worksheet that graded correctly must
  never report failure because the *next* hint could not be computed. Wrap the call, log at `warn`,
  and fall through to a receipt with no next-card. The existing dead-end fallback then applies, so
  the child still holds something actionable.

---

## Known limitation (accepted)

The receipt reflects the **live agenda at close time**. If the plan changes between printing and
scanning, the minted token still resolves — tokens are independent of the plan — but the
`Also today` text can go stale. Accepted: it is an informational line, and the alternative
(re-deriving on scan) would mean the paper and the panel disagree, which is worse.

---

## Testing

`planLearnerWork` is pure, so the ordering is unit-testable with plain data and no fixtures.

1. **Ordering (the actual bug):** a learner with civilization complete and scripture outstanding
   yields scripture — **not** civilization lesson 2. This test fails against today's
   `#nextUnlocked` and is the regression net for the whole spec.
2. **Passed, work remains:** one next card, carries a token and a panel code.
3. **Passed, nothing remains:** no `alsoToday`; the day-complete path applies (Task 13).
4. **Failed, different next:** retry card present with QR; `Also today` present as text; assert **no
   second QR and no six-digit code** in the rendered blocks.
5. **Failed, same next (dedupe):** exactly one card.
6. **Mutual exclusivity:** never both `dayComplete` and `alsoToday`.
7. **Planner throws:** settle still succeeds, receipt still prints, warn logged.

Assert on `b.md`, not `b.value`.

---

## Out of scope, tracked elsewhere

- **Learner1 has no assignment plan** (`plans/learners/` holds only `learner4.yml` and `learner3.yml`), so his
  scans produce `offers: 0`. Tracked as L-4 in
  `docs/_wip/bugs/2026-08-25-school-morning-scan-and-print-incident.md`.
- **Empty-agenda print guardrail** and the HA error-sound fallback — separate work.
- **Scripture never offering a lesson** — frozen enrollment snapshot; see the ledger's BLOCKING
  FINDING.
