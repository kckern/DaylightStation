# School physical events: issues, impressions, scans, cards

**Date:** 2026-09-01
**Status:** design approved, not yet implemented
**Supersedes:** nothing. Extends the print/scan lifecycle described in
`docs/reference/school/print-documents.md`.

---

## Problem

The word *artifact* means two different things, and the confusion has surfaced
as four separate defects in one morning.

An artifact today is **content**: an issued worksheet, bound to a session,
holding the items and the answer key that grading resolves against. That
concept is correct.

What has no name and no record is **the paper** — the physical sheet that came
out of a printer, carrying one or several worksheets, at a moment in time.
Because that object does not exist in the model:

1. **We cannot tell whether a worksheet printed.** An exact reprint reuses the
   original content record untouched, so nothing marks a second printing. The
   print-jobs ledger at `records/print/jobs.yml` holds one entry, last written
   six weeks before this was found. The last thing observed is
   `laser-printer.job-sent`, which fires when the IPP `Print-Job` response comes
   back `ok` — spooler acceptance, not printing. The adapter never captures the
   returned `job-id`, and `OPS` defines only `PRINT_JOB`, `VALIDATE_JOB` and
   `GET_PRINTER_ATTRIBUTES`: there is no `Get-Jobs` operation, so the printer
   cannot be asked what became of a job even in principle.
2. **One scan prints several receipts.** `CloseSessionOutcome` prints a result
   receipt per session closed. A card carrying two worksheets closes two
   sessions, so two slips spool out consecutively, sharing no scan identity.
3. **Reproduction is undefined.** There is no way to ask for "the sheet as it
   printed" as distinct from "this worksheet on its own".
4. **A card was retired with a third of it unused.** The answer-sheet rollover
   abandoned 18 of 50 rows, and the log line that records the decision never
   reached the log store.

These are one disease: physical events that carry real consequences and leave
no record of what happened or why.

## Evidence

Three incidents on 2026-08-31 and 2026-09-01, all reconstructed from stored
records. Each becomes a regression test.

**Bulk print produced three jobs, not one sheet.** A "print all" code resolved
three subjects. The self-service path loops `IssueDocument` per subject rather
than calling `IssueComposedWorksheet`, so three independent one-page jobs went
to the printer. All three logged `job-sent`; the batch reported
`{succeeded: 3, failed: 0}`. Not all three reached paper. Nothing recorded
which did.

**One scan printed two receipts.** Card `8424408` held scripture on rows 1–3
and civilization on rows 4–9. A single scan graded both at 100% and produced
two result receipts five seconds apart, with no shared identity. Critically,
the two worksheets were printed in **different print events a day apart** —
rows 1–3 on 2026-08-31, rows 4–9 on 2026-09-01. A receipt therefore cannot be
keyed to a print; it belongs to the scan.

**A card rolled over with 18 rows free.** Card `8684155` records
`tailSkipped: {start: 33, end: 50}`. The reuse policy is `until_full` and the
reuse test is `occupiedThrough + rowsNeeded <= capacity` — 32 + 3 <= 50, which
should have reused. The intended behaviour is already correct; the observed
behaviour is not. Why it fired is unknown: `school.answer-sheet.rollover`,
which carries the decision inputs, is absent from the log store for the whole
retention window, while its sibling `rollover-delivered` is present. The logger
is wired into the store.

**Known unknown.** Card `8424408`'s first allocation records a `renderedAt`
26 minutes *earlier* than card `8684155`'s final allocation, implying both were
live at once. This is unexplained. It is recorded here rather than guessed at;
the point-in-time rollover record specified below is what would make a
recurrence diagnosable.

## Decisions

| Question | Decision |
|---|---|
| What does a "print all" code produce? | One composed sheet. Self-service bulk routes through `IssueComposedWorksheet`, the path the teacher console already uses. |
| What does "reproduce exactly" mean? | Replay from pinned inputs, verified against a stored hash. Not byte retention. |
| How explicit is the content/presentation split? | Split and rename now. Content becomes an *issue*; the paper becomes an *impression*. |
| Is a scan a first-class record? | Yes — a peer of the impression, with the same anatomy. |
| What happens when a print does not complete? | Record the outcome and tell the child at the Portal. No automatic reprint. |
| What does replay drift mean? | A reported fact, not a failure. Return the sheet and name the renderer revisions. |
| Where does the rollover bug belong? | Here. It is the same disease. |

## Model

Four entities. Three are physical; one is content. The physical three share one
anatomy: **identity, ordered members, pinned inputs, recorded outcome.**

**Issue** — content. One per session. The immutable snapshot: unit, items,
visible option subset, order, A–E mapping, source locators, `rev`, `seed`,
`variant`, `renderInputSha256`. Grading resolves against it. Substantively
unchanged from today's issued artifact; it stops sharing a word with the paper.

**Impression** — one print event. Ordered members (issues), the pagination that
placed them, duplex, target printer, renderer revision, hash of what was sent,
IPP `job-id`, terminal job state. One impression per print, whether it carries
one worksheet or four.

**Scan** — one card read. The card, timestamp, decoded test id **with decode
confidence**, resolved row ranges mapped to sessions, per-member outcome, and
the single receipt produced.

**Card** — the long-lived physical sheet, capacity 50. Exists today. Gains a
**point-in-time rollover decision record** (`occupiedThrough`, `rowsNeeded`,
`remaining`, `policy`, `reason`) on the allocation, replacing the card-wide
write-back that makes today's decision unreconstructable.

Relationships the current model cannot express:

- An issue appears in **many** impressions — the original and every reprint.
- An impression carries **many** issues.
- A card spans **many** impressions and **many** scans.
- A scan's members may come from **different impressions**.

## Components

**Domain — `2_domains/school/physical/`** (pure, no I/O; the layer audit
enforces this):

- `impression.mjs` — validates an impression, computes the render-input
  fingerprint, and returns a replay verdict of `match`, `drift` or
  `incomplete`. Drift is a value, never an exception.
- `scan.mjs` — validates a scan; decides what one receipt says about N graded
  members; refuses a card whose members name more than one learner.
- `cardRollover.mjs` — the fit rule as a pure function. Given
  `occupiedThrough`, `rowsNeeded`, `capacity` and `policy`, returns reuse or
  rollover **with a reason**. Purity is what makes the Aug 31 case testable.

**Applications — `3_applications/school/`:**

- `IssueComposedWorksheet` becomes the single print path. Self-service bulk
  stops looping `IssueDocument` and calls it. It records an impression.
- `PrintImpression` — owns handoff and polling to terminal job state. An
  impression is not complete until the printer says so, or the deadline passes.
- `RecordCardScan` — creates the scan, grades its members, emits **one**
  receipt.
- `ReplayImpression` (reproduce the sheet) and `ReissueWorksheet` (reproduce
  one worksheet alone) — deliberately separate use cases answering different
  questions.
- `CloseSessionOutcome` **stops printing receipts**. This deletion is the fix
  for the double print.

**Adapters:**

- `LaserPrinterAdapter` — add `Get-Jobs` / `Get-Job-Attributes` to `OPS`,
  capture the returned `job-id`, poll to a terminal state.
- `YamlAllocationStore` — consume `cardRollover.mjs`; persist the decision
  point-in-time on the allocation; ensure the decision reaches the log store.
- New `YamlImpressionStore` and `YamlScanStore`. The issued-artifact store is
  renamed to issues.

**Frontend:** the Portal surfaces a failed or indeterminate print and offers a
retry.

## Data flow

### Print

```
child enters print-all code
  -> resolve bulk token -> N sessions
  -> IssueComposedWorksheet
       - per session: reuse or create Issue (grading ownership unchanged)
       - cardRollover.decide() per allocation, reason recorded
       - compose ONE document, chunked by remaining card rows
  -> create Impression {members ordered, pagination, duplex,
                        rendererRev, renderInputSha256, state: pending}
  -> PrintImpression: send -> capture job-id -> poll to terminal
  -> Impression.outcome = completed | failed | indeterminate
  -> on anything but completed: Portal says so, offers retry
```

### Scan

```
card fed to reader
  -> decode test id (confidence recorded as a field)
  -> resolve row ranges -> sessions
  -> assert a single learner across members
  -> grade each member (per-session outcomes unchanged)
  -> create Scan {card, members, outcomes, receiptId}
  -> print ONE receipt for the scan
```

### Reproduction

- **`ReissueWorksheet(issueId)`** — re-render that issue alone with fresh
  pagination and its own rows. Same assessed content, a differently shaped
  page. No impression is involved.
- **`ReplayImpression(impressionId)`** — re-run the renderer from the
  impression's pinned inputs, compare against the stored hash, return the sheet
  plus a verdict: `match`, or `drift {from, to}`.

The asymmetry is deliberate. Reissue is keyed by content and does not care what
paper it was on. Replay is keyed by the paper and must reproduce it exactly or
explain why it cannot.

## Error handling

Governing principle: **an outcome that is already true must not be lost because
reporting it failed.** Grading is durable before a receipt is attempted; an
impression's members are durable before the printer is touched.

- **Print never terminates.** Bounded deadline; on expiry the impression is
  `indeterminate` with the last observed state, **not** `failed`. The Portal
  treats both the same (the sheet is not in the child's hand either way), but
  the record keeps the distinction. Recording a guess as a fact is the defect
  this whole design exists to end.
- **Print fails.** Terminal state stored; Portal offers retry. **No automatic
  reprint** — a job that printed while reporting failure would produce
  duplicate worksheets bound to different answer-card rows.
- **Replay drifts.** Return the sheet with `drift {from, to}`. Never throw.
- **Replay inputs missing.** `impression: unknown`, explicitly. Every record
  predating this design is in that state. **No impression is synthesized for a
  print that was never observed** — a fabricated record behind a "reproduce
  exactly" API is worse than an absent one.
- **Low decode confidence.** Recorded as a field on the scan. Below threshold
  the scan halts and asks rather than inferring: a mis-attributed card writes
  work to the wrong child's record, the one failure here with no clean
  recovery.
- **Mixed-learner card.** Refuse the scan and name both learners.
- **Worksheet exceeds one card.** Existing `ALLOCATION_WORKSHEET_TOO_LARGE`
  behaviour is kept.
- **Receipt fails after grading.** Grades stand; the scan records
  `receipt: failed`; the teacher console can reprint. Never re-grade to obtain
  a receipt.

## Testing

Each incident above becomes a named regression test with its real numbers.

- `cardRollover.decide({occupiedThrough: 32, rowsNeeded: 3, capacity: 50,
  policy: 'until_full'})` returns reuse. Plus a boundary table: `rowsNeeded`
  equal to remaining reuses; one more rolls over; rollover always reports a
  reason.
- Bulk print across three subjects produces **one** impression with three
  ordered members.
- One scan of a card holding two worksheets printed in **different
  impressions** produces **one** receipt and two graded sessions.

Further coverage:

- **Unit (pure domain):** replay verdicts; one receipt from N members;
  mixed-learner refusal. Values only, no fixtures needed.
- **Adapter:** `LaserPrinterAdapter` polling against a fake IPP responder —
  each terminal state maps correctly, and a responder that never terminates
  yields `indeterminate`, not `failed`.
- **Determinism:** identical pinned inputs produce an identical
  `renderInputSha256` across two runs. Replay is meaningless without this, so
  it is asserted rather than assumed.
- **Absence:** `CloseSessionOutcome` does not call the printer. Deletions need
  a test or they grow back.
- **Migration:** existing records migrate with ids intact and land as
  `impression: unknown`, asserting that impressions were not invented.

Fixtures come from the real stored records, which are small and on disk. Test
discipline follows `CLAUDE.md`: no conditional assertion skipping, no
vacuously-true returns; a test that cannot establish its scenario fails. The
gate is `npm run test:unit:vitest` against its known baseline.

## Migration

The corpus is one week old: 91 issued records, 25 PDFs, 9 cards. A single
migration renames issued artifacts to issues, preserving ids, and marks every
one `impression: unknown`. No impressions are backfilled. Card records gain the
point-in-time rollover field going forward; existing cards keep their card-wide
values, which are explicitly not treated as point-in-time evidence.

## Out of scope

Tracked separately, deliberately not in this spec:

- **Agenda preview fidelity and the bulk-print card layout.** The preview adds
  a `PREVIEW ONLY` footer the print never carries and omits the bulk card the
  print always has; the bulk card stacks its content full-width instead of
  using the lesson card's code-column-plus-text shape. Independent work, already
  drafted.
- **Portal code-entry feedback.** Consumed and invalid codes are both rejected
  with no explanation, and an already-printed lesson dead-ends on
  "print or exit".
- **The duplex / `sides` negotiation.** Jobs are sent with duplex in the raster
  page header while the IPP `sides` attribute is dropped after a
  `validate-job` rejection, against a printer whose own default is
  two-sided. This is a suspected contributor to sheets not emerging, and it
  cannot be diagnosed until impressions record terminal job state. Revisit
  after this ships.
