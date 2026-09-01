# Parked issues: print-lineage bugs, Portal feedback, OMR decode gate

**Date:** 2026-09-01
**Status:** design approved, not yet implemented
**Companion to:** `2026-09-01-school-physical-events-design.md`, which covers the
larger model work. Nothing here depends on that spec landing.

---

## Scope

A heterogeneous set found while investigating a single morning's school
activity. Three fixes are already written and unverified; four are bugs with
known causes; two need design. They are collected in one spec because they were
found together and will be worked together, not because they share a mechanism.

Ordered by risk: the two things actively wrong in production are also the two
cheapest to fix.

## Evidence

All from 2026-09-01 unless noted.

- **A card's lineage is being rewritten on every reuse.** `markDelivered`
  stamped `successorCardId` and `tailSkipped` onto card `8684155` during a plain
  reuse delivery, and logged `rollover-delivered` for a rollover that had
  happened the previous day.
- **Ten consecutive rejected codes.** Between 08:40 and 08:54 a learner entered
  ten codes, every one rejected as `no-live-record`, with no reason shown and no
  route out. Thirteen rejections across the day.
- **Six identical re-entries.** Between 08:56 and 09:01 the same math code was
  entered six times, each resolving to `state: reprinted`,
  `offered: [print, exit]`.
- **A card id was inferred, not read.** `school.scan.card-id-inferred`,
  `pattern: "84?????"` → `cardId: 8424408`. It inferred correctly. A later scan
  the same morning decoded cleanly.
- **story-time reports unreachable for two learners** on every boot, while
  reading sessions demonstrably work (three opened on 2026-09-01).

## Decisions

| Question | Decision |
|---|---|
| What does a rejected code give the child? | A way forward first, reason second — and escalation after repeated failures. |
| What does an already-printed lesson offer? | Its state, with reprint demoted behind a confirm. |
| What happens on a partial card-id decode? | Accept only an unambiguous match; otherwise ask for a rescan. |
| Revive `records/print/jobs.yml`? | Neither — it belongs to another subsystem. Leave it. |

---

## Part 1 — Bugs

### 1.1 `markDelivered` rewrites lineage on ordinary reuse (live)

`markDelivered` treats any truthy `predecessorCardId` as the rollover
succession, rewriting all of the predecessor's records and logging
`rollover-delivered` (`YamlAllocationStore.mjs:352–370`). The **reuse** branch
inherits `predecessorCardId` from the card's first record (line 284), so every
ordinary reuse delivery on a card that once rolled over re-stamps its
predecessor, indefinitely.

**Fix:** carry the allocation decision (`reuse` | `rollover`) on the record and
have `markDelivered` read that, rather than inferring succession from a field
that reuse legitimately inherits.

**Why it matters beyond tidiness:** this is what makes card history
untrustworthy after the fact. It already misled one investigation into treating
a correct rollover as a defect, because the fields it wrote looked like
contemporaneous evidence and were not.

### 1.2 `#sendIpp` discards the parsed `job-id`

`decodeResponse` already parses `job-id` from the Print-Job response;
`#sendIpp` destructures only `{ok, statusCode}` and drops it
(`LaserPrinterAdapter.mjs:505`).

**Fix:** retain and return it. No behaviour change on its own — it is the
precondition for job-state tracking, and it belongs here rather than waiting on
the larger spec.

### 1.3 `records/print/jobs.yml` — not ours, leave it alone

An earlier draft of this spec called this a dead worksheet ledger and proposed
deleting it. **That was wrong.**

It belongs to `PrintService` — the household **printables** subsystem, with
per-user quota and approval — which reads and appends it at
`PrintService.mjs:125, 163, 185, 209`. It is quiet since 2026-07-22 because
nobody has printed a printable, not because it is abandoned. Deleting it would
break that feature's quota accounting.

Worksheet issuance was never meant to write here. The honest finding is
**worksheet printing has no ledger**, not that this one is dead. The companion
spec's impression record is that missing ledger; this file is a different
subsystem's and stays untouched.

### 1.4 story-time reports a false error

`programStatusCollection.mjs:50–54` warns `no-entry-point` when a launcher's
`entryAction` is not among the declared entry actions. story-time declares
`reading-session`, which is not reachable in the declared list, so the program
reports `error: true` for two learners on every boot — and per that module's own
comment, this shape "stops the status board's done chip and the receipt's
done-for-the-day". Reading sessions themselves work.

**Fix:** reconcile the declared entry actions with the launcher. Verify the done
chip returns.

### 1.5 `bus.topic.unknown` noise

`state-gates` (four per assertion) and `shutdown.state` are published to
unregistered topics. Register them or stop publishing. Lowest priority, but warn
noise is what hides real warnings.

---

## Part 2 — Portal feedback

### The identity constraint

The Portal learns who is present **from the code** — `school.profile.claimed`
fires on a successful resolve. On a rejection the learner is therefore often
unknown, so "here is your next lesson" is not always available. The escalation
path below resolves this rather than working around it.

### Reason taxonomy — honest, not exhaustive

`ResolveAccessCode` currently flattens every failure to `unknown_code` /
`not_answering` (lines 96–103). Surface instead what the registry can actually
support: **`spent`**, **`expired`**, **`not_yours`**, **`unknown`**.

`unknown` means *"we do not know this ticket"* — never *"this code never
existed"*. A pruned record and a typo are indistinguishable, and the token
registry's own header already draws exactly this line before the resolver
discards it.

### Every rejection ends with an action

One plain reason line on top; an action below. Identity known → the child's next
lesson, tappable. Identity unknown → a name picker. **Never a bare keypad.**

### Escalation at three

One rejection is a typo; two is a retry; three means the code is not going to
work. At three consecutive rejections the Portal stops asking for a code and
shows the name picker, then that learner's agenda. The counter resets on any
success or on idle timeout.

This is help, not lockout: nothing is denied, the route changes. Ten consecutive
attempts should be structurally impossible.

### Already-printed leads with state

> Math — Place Value to 1,000. Printed 08:30. Do it, then scan it.

Primary action is done/exit. Reprint is secondary, behind a confirm, labelled
with when and how many times it printed. Re-entering a code stops presenting
itself as a print button, which is what produced six identical taps.

### Known dependency — confirmed unmet

Escalation requires a learner name picker on the Portal. **There is not one.**
That surface is `Keypad`, `LaunchCard` and `ScanCeremony` only
(`frontend/src/modules/School/selfService/`), so the picker is new UI and is the
largest single piece of work in this spec.

This is why Part 2 and Part 3's gate are deferred out of the first
implementation plan: everything else here is mechanical, and none of it should
wait behind a new component.

---

## Part 3 — OMR decode gate

### The gate

On a partial decode, match the pattern against all non-retired cards.

- **Exactly one candidate** → accept; record the pattern and confidence.
- **Zero, or more than one** → stop. Do not choose. Ask for a rescan.

Today's case still passes: `84?????` matches `8424408` and not `8684155`, whose
second digit differs. The inference was correct — it simply was never *checked*
for being correct. That is the entire change: the same answer, proven rather
than assumed.

Restricting candidates to cards with unscanned rows was considered and rejected:
it would couple scan resolution to allocation state for a narrowing that
uniqueness already provides.

### Measure before tuning

Record decode confidence and pattern on **every** scan, not only failures.

Two scans is not a sample. The "50% marginal read rate" observed on 2026-09-01
is worth nothing as a number. If the true rate is low the gate costs nothing; if
it is high, the reader or the printed bubble contrast needs attention and no
amount of gating addresses that.

**This half ships first**, ahead of the gate — it is cheap, it changes no
behaviour, and it is what makes the question answerable.

### On repeated rescan failure

Route to a grown-up rather than looping — the same principle as the Portal
escalation.

---

## Part 4 — Already-written work, unverified

Three fixes have sat uncommitted through this session
(`DocumentReceiptRenderer.mjs`, `BuildAgenda.mjs`):

- The agenda preview's per-card footer read `PREVIEW ONLY — ASK A GROWN-UP TO
  START THIS LESSON`, a line the printed agenda never carries, occupying the
  exact slot a reader consults to learn what the child is told to do. It now
  carries the real action label.
- The preview omitted the "Print all sheets" card the print always has, because
  preview offers never carried the `printable` flag the bulk gate counts. Fixed
  with inert placeholders that mint nothing.
- The bulk card stacked heading, subject list and code area full-width. It now
  uses the lesson card's shape — code column left, text right — through a shared
  `drawCodeColumn`, so "the same format" is one code path rather than two that
  agree.

These need rendering, asserting and shipping.

## Testing

- `markDelivered` on a plain reuse leaves the predecessor untouched and logs
  nothing. **Fails today.**
- Three consecutive rejections land on the name picker, not the keypad; any
  success resets the count.
- A rejected code returns a reason from the honest taxonomy, and a pruned record
  returns `unknown` rather than "no such code".
- An already-printed lesson offers done as primary and reprint behind a confirm.
- A partial pattern matching two known cards halts; matching exactly one
  resolves; both record confidence.
- story-time reports reachable for both learners and the done chip returns.
- **The rendered agenda preview contains the bulk card and contains no
  `PREVIEW ONLY` string.**

That last test carries more weight than the fix it guards. Those three changes
sat unverified all session precisely because "render it and look" was never
automated. A test asserting that the preview and the print agree is what stops
this class of defect recurring — the preview exists to be trusted, and an
untested preview is worse than none.

Test discipline follows `CLAUDE.md`: no conditional assertion skipping, no
vacuously-true returns. Gate is `npm run test:unit:vitest` against its baseline.

## Order of work

1. `markDelivered` — live corruption, small and self-contained.
2. Verify and ship the three written fixes (Part 4), with the preview test.
3. story-time declaration; `job-id` retention.
4. Decode confidence recording (measurement only).
5. Portal feedback — taxonomy, way-forward, escalation, already-printed state.
6. Decode gate, once the measurement says what the real rate is.
7. `bus.topic.unknown`.

## Out of scope

- The duplex / `sides` negotiation — not diagnosable until job-state tracking
  lands (companion spec, Phase 1).
- Impressions, scans, and the combined receipt — companion spec.
