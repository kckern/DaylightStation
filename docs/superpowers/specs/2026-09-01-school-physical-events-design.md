# School physical events: issues, impressions, scans, cards

**Date:** 2026-09-01
**Status:** design approved in outline; revised after adversarial review
**Extends:** the print/scan lifecycle in `docs/reference/school/print-documents.md`

---

## Problem

The word *artifact* means two different things.

An artifact today is **content**: an issued worksheet, bound to a session,
holding the items and answer key that grading resolves against. That concept is
correct and this design does not change it.

What has no name and no record is **the paper** — the physical sheet that came
out of a printer, carrying one or several worksheets, at a moment in time.
Because that object does not exist in the model:

1. **We cannot tell whether a worksheet printed.** An exact reprint reuses the
   original content record untouched, so nothing marks a second printing. The
   print-jobs ledger at `records/print/jobs.yml` holds one entry, last written
   six weeks before this was found. The last thing observed is
   `laser-printer.job-sent`, which fires when the IPP `Print-Job` response comes
   back `ok` — spooler acceptance, not printing. `decodeResponse` already parses
   the returned `job-id`, but `#sendIpp` destructures only `{ok, statusCode}`
   and drops it (`LaserPrinterAdapter.mjs:505`), and `OPS` defines only
   `PRINT_JOB`, `VALIDATE_JOB`, `GET_PRINTER_ATTRIBUTES` (`ipp.mjs:15–19`) — so
   there is no operation with which to ask what became of a job.
2. **One scan prints several receipts.** `CloseSessionOutcome#settle` prints per
   call (`CloseSessionOutcome.mjs:543–579`), and `SchoolPrintScanConsumer`
   invokes it once per record of a scanned card
   (`SchoolPrintScanConsumer.mjs:434–523`). A card holding two worksheets
   produces two slips with no shared identity.
3. **Reproduction is undefined.** There is no way to ask for "the sheet as it
   printed" as distinct from "this worksheet on its own".

These are one disease: physical events that carry real consequences and leave no
record of what happened.

## Evidence

### Bulk print produced three jobs, not one sheet

A "print all" code resolved three subjects. The self-service path loops
`IssueDocument` per subject rather than calling `IssueComposedWorksheet`, so
three independent one-page jobs went to the printer. All three logged
`job-sent`; the batch reported `{succeeded: 3, failed: 0}`. Not all three
reached paper. Nothing recorded which did.

### One scan printed two receipts

Card `8424408` held scripture on rows 1–3 and civilization on rows 4–9. A single
scan graded both at 100% and produced two result receipts five seconds apart,
sharing no identity. The two worksheets were printed in **different print events
a day apart** — rows 1–3 on 2026-08-31, rows 4–9 on 2026-09-01. A receipt
therefore cannot be keyed to a print; it belongs to the scan.

### The answer-sheet rollover was NOT a defect — incident closed

An earlier draft of this spec treated the 2026-08-31 rollover of card
`8684155` → `8424408`, which left rows 33–50 unused, as a bug. **It was not.**
Recording the correct account, because the wrong one nearly drove a regression
test that guards nothing:

- The rollover happened at 08:30 PDT on 2026-08-31. The code that this spec's
  first draft quoted — `allocateNext`, `monotonicHead`, the `until_full`
  default, the `school.answer-sheet.rollover` event — was introduced in
  `77fe209b2`, committed **18:29 PDT that evening** and not deployed until
  08:57 on 2026-09-01.
- The then-deployed default was **`after_scan`**, not `until_full`
  (`77fe209b2~1:.../IssueDocument.mjs:97`), and no household config overrides
  it. Under `after_scan`, a card holding any live unscanned record is not
  reusable. Card `8684155` held live math rows 22–27. A fresh card was
  therefore correct.
- The math sheet was scanned 15:46–15:49Z; the card settled; at 15:56Z the next
  math sheet correctly reused `8684155` rows 28–32. That is the whole of the
  "two cards live at once" anomaly the first draft could not explain.
- `tailSkipped: {33, 50}`, `generation`, `predecessorCardId` and
  `successorCardId` were **not written at decision time**. The pre-backfill
  backup (`cards.backup-2026-09-01-answer-sheet-lineage/8684155.yml`) contains
  none of them; they were written on 2026-09-01 by a lineage backfill and by
  `markDelivered`. Arithmetic computed from the final state described a state
  that did not exist when the decision was made.
- `school.answer-sheet.rollover` is absent from the log store because **the
  event did not exist in the deployed build**, not because a log was lost.

`until_full` reached production at 08:57 on 2026-09-01. The desired behaviour —
reuse until the next worksheet will not fit — is live.

**The methodological lesson, which is the reason this section stays in the
spec:** every field cited as evidence had been rewritten after the fact by a
card-wide write-back. A record that cannot distinguish "what was true when I
decided" from "what is true now" cannot support forensics. That is an argument
for the point-in-time decision record below, and it is the *only* claim the
rollover incident supports.

### A real defect the incident did surface

`markDelivered` treats any truthy `predecessorCardId` as the rollover
succession, rewriting all of the predecessor's records and logging
`rollover-delivered` (`YamlAllocationStore.mjs:352–370`). But the **reuse**
branch inherits `predecessorCardId` from the card's first record (line 284). So
every ordinary reuse-delivery on a card that once rolled over re-stamps its
predecessor and re-logs `rollover-delivered`, indefinitely. The 2026-09-01
civilization delivery was a plain reuse, and it is what wrote `tailSkipped`
onto `8684155`. `IssueComposedWorksheet.mjs:307–311` is a live caller.

## Decisions

| Question | Decision |
|---|---|
| What does a "print all" code produce? | One composed sheet per composable group, via `IssueComposedWorksheet`. Non-composable refs still print solo. |
| What does "reproduce exactly" mean? | Replay from pinned inputs, verified against a stored hash **of the PDF**. |
| How explicit is the content/presentation split? | Split and rename. Content becomes an *issue*; the paper becomes an *impression*. |
| Is a scan a first-class record? | Yes — a peer of the impression. |
| What happens when a print does not complete? | Record the outcome and tell the child. No automatic reprint. |
| What does replay drift mean? | A reported fact, not a failure. |
| Does `CloseSessionOutcome` stop printing? | **No.** It gains an opt-out used only by the scan lane. See §Receipt ownership. |

## Model

Four entities. Three are physical; one is content. The physical three share one
anatomy: **identity, ordered members, pinned inputs, recorded outcome.**

**Issue** — content. One per session. The immutable snapshot: unit, items,
visible option subset, order, A–E mapping, source locators, `rev`, `seed`,
`variant`, `renderInputSha256`. Grading resolves against it. Substantively
unchanged; it stops sharing a word with the paper.

**Impression** — one print event. Ordered members (issues), pagination, duplex,
target printer, renderer revision, **`pdfSha256`**, IPP `job-id`, terminal job
state. One impression per print, whether it carries one worksheet or four.

**Scan** — one card read. Card, timestamp, decoded test id **with decode
confidence**, resolved row ranges mapped to sessions, per-member outcome, and
the single receipt produced.

**Card** — the long-lived sheet, capacity 50. Gains a **point-in-time decision
record** on each allocation: `policy`, `occupiedThrough`, `rowsNeeded`,
`remaining`, `decision`, `reason`. Written when the decision is made and never
rewritten. `occupiedThrough` here is the **quarantine-inclusive** value that
`canReuse` actually tests (`cardOccupiedThrough`, lines 823–829) — deliberately
named, because `markDelivered`'s `tailSkipped` computes an allocation-only
quantity (line 355) and the two have silently shared a concept.

For the record, `canReuse` has four conjuncts, not one
(`YamlAllocationStore.mjs:271–272`):
`policyAllowsReuse && head && !cardHasIssuedSuccessor(head) && occupiedThrough + rowsNeeded <= capacity`.
The decision record stores which conjunct failed.

Relationships the current model cannot express:

- An issue appears in **many** impressions — the original and every reprint.
- An impression carries **many** issues.
- A card spans **many** impressions and **many** scans.
- A scan's members may come from **different impressions**.

## What the impression hash covers

**`pdfSha256`, not the raster.** The PDF layer is deterministic by design:
`DocumentPdfRenderer.mjs:46` pins `PINNED_CREATION_DATE = new Date(0)`, and the
module's contract is "same document, same seed, same bytes."

The bytes actually sent to the printer are a ghostscript-produced URF raster
(`LaserPrinterAdapter.printPdf` → `rasterizePdf`), whose output depends on the
ghostscript binary and fonts in the container image. Hashing those would make
`drift` the verdict after any routine image rebuild, and a verdict that fires
constantly conveys nothing. The raster is **transport**: its hash is stored as
`transportSha256` for diagnostics, but the replay verdict is computed on the
PDF.

Renderer revision therefore pins the PDF toolchain (pdfkit version, font files),
not ghostscript.

## Receipt ownership

The first draft proposed deleting printing from `CloseSessionOutcome`. That is
wrong: it prints for callers far outside the scan lane — the router's close
endpoint (`4_api/v1/routers/schoolLifecycle.mjs:457`), `ResolveReviewItem`,
`RunSelfServiceAction`, the DoNow bridge, and critically the **deferred-grading
lane**, where an ambiguous row holds a session at `submitted` and a grown-up
later clears it through `GradeSubmission`. The child's result receipt —
including the FAIL **retry ticket** — comes from that later settle, when no scan
exists to own a receipt. `CloseSessionOutcome`'s header states the reason: "a
retry ticket that never leaves the printer is a loop the child cannot close."

**Decision:** `CloseSessionOutcome#settle` keeps printing. It gains an opt-out
(`deferReceiptTo: 'scan'`) passed **only** by the scan consumer. Every other
lane is untouched, and the lane that changes is the one lane with a caller able
to own the paper.

This has a consequence the first draft missed. Retry tokens, access codes and
rewards are minted **inside** `#settle`. So a combined receipt cannot be
composed from grading results alone, and `scan.mjs` cannot be the pure function
the first draft claimed. Ordering is therefore explicit:

```
for each member (sequentially):
    settle(member, deferReceiptTo: 'scan')   -> durable outcome + minted tokens
collect settlement outputs
compose ONE receipt from the collected outputs
print it; record receiptId on the Scan
```

**Settlement is per-member and durable before aggregation begins.** If
aggregation or printing throws, every member's `outcome_recorded` and `rewarded`
events already stand; the scan records `receipt: failed` and the teacher console
reprints. Nothing is rolled back and nothing is re-graded — the reward guard is
per-session (`#applyReward`, line 670) and must not be re-entered.

Per-session receipt artifacts (`receipt/{sessionId}/original`) and their reprint
and correction use cases remain session-keyed and unchanged. The combined slip
is an additional scan-keyed artifact, not a replacement.

## Components

**Domain — `2_domains/school/physical/`** (pure, no I/O):

- `impression.mjs` — validates an impression; returns a replay verdict of
  `match`, `drift` or `incomplete`. Drift is a value, never an exception.
- `scan.mjs` — validates a scan; refuses a card whose members name more than one
  learner; **formats** a receipt from already-collected settlement outputs. It
  does not orchestrate settlement — that is the application's job, above.
- `cardDecision.mjs` — the reuse/rollover fit rule as a pure function returning
  a decision plus the failing conjunct.

**Applications — `3_applications/school/`:**

- `IssueComposedWorksheet` becomes the composable print path (see §Bulk).
- `PrintImpression` — handoff plus polling to terminal job state.
- `RecordCardScan` — orchestrates per-member settlement, composes one receipt.
- `ReplayImpression` and `ReissueWorksheet` — the two reproduction entry points.
- `CloseSessionOutcome` — gains `deferReceiptTo`; otherwise unchanged.

**Adapters:**

- `LaserPrinterAdapter` — add `Get-Jobs`/`Get-Job-Attributes` to `OPS`, retain
  the already-parsed `job-id`, poll to terminal.
- `YamlAllocationStore` — consume `cardDecision.mjs`; write the decision
  point-in-time; **fix `markDelivered` to stamp succession only on a genuine
  rollover**, not on any delivery carrying an inherited `predecessorCardId`.
- New `YamlImpressionStore`, `YamlScanStore`; issued-artifact store renamed.

## Bulk print: partition, not substitution

`IssueComposedWorksheet#prepareSection` throws on non-bank lessons
(`unit.document`, line 122) and on `participation: required` companions
(lines 144–149), and `execute` prepares every section before issuing any. The
current bulk loop guarantees the opposite: "One ref's failure must not stop the
rest" (`RunSelfServiceAction.mjs:343–346`). Routing bulk straight through
composition would make one document unit print nothing at all.

**Decision:** partition the refs first.

```
refs -> composable   (bank-only, no required companion)  -> ONE composed impression
     -> solo         (document units, required companions) -> one impression each
     -> unprintable  -> reported, does not block the others
```

Each group's failure is isolated, preserving today's contract. A partition
yielding fewer than two composable refs simply produces solo prints.

**Chunking stays inside the store's mutex.** Chunking by *remaining* card rows
requires reading occupancy, and reading it outside `#enqueue` is a
plan-then-allocate race. Composition passes ordered members to the store and the
store returns the chunking, inside the same critical section that allocates.
This differs from today's `chunksForCard`, which chunks by full capacity
(`IssueComposedWorksheet.mjs:51–63`).

## Data flow

### Print

```
child enters print-all code
  -> resolve bulk token -> N sessions -> partition
  -> composable group: IssueComposedWorksheet
       - per session: reuse or create Issue (grading ownership unchanged)
       - store allocates AND chunks inside #enqueue; decision recorded
       - compose ONE document
  -> create Impression {members ordered, pagination, duplex,
                        rendererRev, pdfSha256, state: pending}
  -> PrintImpression: send -> retain job-id -> poll to terminal
  -> Impression.outcome = completed | failed | indeterminate
  -> on anything but completed: Portal says so, offers retry
```

### Scan

```
card fed to reader
  -> decode test id (confidence recorded as a field)
  -> resolve row ranges -> sessions
  -> assert a single learner across members
  -> per member, sequentially: settle(deferReceiptTo: 'scan')
  -> compose ONE receipt from collected settlement outputs
  -> create Scan {card, members, outcomes, receiptId}
```

### Reproduction

- **`ReissueWorksheet(issueId)`** — re-render that issue alone, fresh
  pagination, its own rows. Same assessed content, differently shaped page.
- **`ReplayImpression(impressionId)`** — re-render from pinned inputs, compare
  `pdfSha256`, return the sheet plus `match` or `drift {from, to}`.

## Error handling

Governing principle: **an outcome that is already true must not be lost because
reporting it failed.**

- **Print never terminates.** Bounded deadline; the impression records
  `indeterminate` with the last observed state, **not** `failed`.
- **Print fails or is indeterminate.** Portal offers retry. **No automatic
  reprint.** Note the cost: `release()` never reclaims rows and
  `occupiedThrough` counts released records (lines 507, 823), so each retry
  consumes card rows permanently. Retry is therefore an explicit human action,
  never a loop, and Phase 1 must measure how often `indeterminate` occurs before
  the Portal affordance ships.
- **Replay drifts.** Return the sheet with `drift {from, to}`. Never throw.
- **Replay inputs missing.** `impression: unknown`, explicitly. Every record
  predating this design is in that state. **No impression is synthesized for a
  print that was never observed.**
- **Low decode confidence.** Recorded on the scan. Below threshold the scan
  halts and asks rather than inferring — a mis-attributed card writes work to
  the wrong child's record.
- **Mixed-learner card.** Refuse the scan; name both learners.
- **Receipt fails after grading.** Grades stand; scan records `receipt: failed`.
  Never re-grade to obtain a receipt.

## Phases

Three independently shippable slices. Only Phase 2 needs the migration.

**Phase 1 — printer job tracking.** `Get-Jobs`, retain `job-id`, poll to
terminal, record the outcome. No new entities, no migration, no behaviour
change. Highest value per unit of risk: it is the slice that would have told us
only one sheet emerged. **Prototype the poll against the real printer before
committing to the rest** — this device has three times demonstrated that its
capability declarations do not bind its behaviour (octet-stream guess, silent
bit-depth drop, `sides` rejected despite `sides-supported`). AirPrint-class
printers often purge completed jobs quickly; if `completed` proves
unobservable, `indeterminate` becomes the steady state and the Portal retry
affordance in Phase 2 must be reconsidered.

**Phase 2 — impressions, scans, one receipt.** The model, the migration, the
bulk partition, `deferReceiptTo`, the settlement ordering. The large, risky
slice.

**Phase 3 — card decision records.** `cardDecision.mjs`, point-in-time
persistence, and the `markDelivered` succession fix. Independently valuable;
the `markDelivered` bug can be fixed on its own at any time.

## Testing

**Regression tests from real incidents:**

- Bulk print across three composable subjects produces **one** impression with
  three ordered members. Fails today by producing three jobs.
- One scan of a card holding two worksheets printed in **different impressions**
  produces **one** receipt and two graded sessions.
- A bulk batch containing one document unit and two bank units prints the two
  composed and the one solo — **and does not fail the batch**.
- `markDelivered` on a plain reuse does **not** stamp `successorCardId` on the
  predecessor and does **not** log `rollover-delivered`.

Note: no `until_full` fit-rule regression test is proposed. The 2026-08-31
rollover was correct behaviour under the then-current `after_scan` policy, so a
test asserting reuse at 32+3 would guard against nothing that happened.

**Determinism — the assertion that matters.** Not "the same YAML hashes the
same", which is a tautology (`renderInputDigest` is a sha256 over a sorted-key
YAML dump of the inputs, `YamlIssuedArtifactStore.mjs:11–13`). The assertion is:
**rendering the same document twice produces identical PDF bytes.** Replay is
meaningless otherwise, and this is the one claim the reproduction story rests
on. Assert it directly, on output.

**Other coverage:**

- **Unit:** replay verdicts; mixed-learner refusal; receipt formatting from
  fixed settlement outputs; `cardDecision` returning the failing conjunct.
- **Adapter:** polling against a fake IPP responder — each terminal state maps
  correctly, and a responder that never terminates yields `indeterminate`, not
  `failed`.
- **Settlement ordering:** aggregation throwing after member A settles leaves
  A's `outcome_recorded` and `rewarded` intact, prints no receipt, and does not
  re-apply A's reward on retry.
- **Non-scan lanes keep their paper:** `GradeSubmission` through the
  deferred-grading path still prints a retry ticket. This is the test that
  protects the lane the first draft would have broken.
- **Migration:** existing records migrate with ids intact and land as
  `impression: unknown`.

Test discipline follows `CLAUDE.md`: no conditional assertion skipping, no
vacuously-true returns. Gate is `npm run test:unit:vitest` against its baseline.

## Migration

91 issued records, 25 PDFs, 9 cards — one week old. A single migration renames
issued artifacts to issues, preserving ids, and marks every one
`impression: unknown`. No impressions are backfilled.

The issued-artifact store already carries a two-location legacy-path mechanism
(`#stem` / `#legacyStem`). The rename must **collapse** that rather than add a
third path: migrate every record to the new stem and delete the legacy lookup in
the same change, so the store ends with one path, not three.

## Out of scope

- **Agenda preview fidelity and the bulk-print card layout.** The preview adds a
  `PREVIEW ONLY` footer the print never carries and omits the bulk card the
  print always has; the bulk card stacks its content full-width instead of using
  the lesson card's code-column-plus-text shape. Drafted separately.
- **Portal code-entry feedback.** Consumed and invalid codes are both rejected
  with no explanation; an already-printed lesson dead-ends on "print or exit".
- **The duplex / `sides` negotiation.** Jobs are sent with duplex in the raster
  page header while the IPP `sides` attribute is dropped after a `validate-job`
  rejection, against a printer whose own default is two-sided. Suspected
  contributor to sheets not emerging; not diagnosable until Phase 1 lands.
