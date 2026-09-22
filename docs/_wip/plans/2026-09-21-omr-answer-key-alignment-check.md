# OMR Answer-Key Alignment Check — Spec

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans if this
> spec is later turned into an implementation task.
>
> **Status:** spec only, not started. Two numeric constants below (§4) are
> flagged for KC to set — do not guess them and start building; that is the
> one destructive judgment call in this spec, same caution as slice E of
> `2026-08-22-omr-grading-integrity.md`.

**Goal:** Detect, at grading time, the specific failure pattern where a
learner's paper answers are internally shifted by one or two rows relative to
the sheet's own printed questions — and hold the outcome for a teacher's
eyes instead of silently finalizing it as `needs_remediation` — without ever
auto-accepting the shifted reading as correct.

**Non-goal:** this does not change how Learner1's New York sheet graded (see
§1 — his data does not trigger this check, and shouldn't). It closes a gap
in the *system's* ability to catch this pattern when it does happen, not a
misgrade that already happened.

---

## 1. Why this, why now

2026-09-21: Learner1 scored 2/6 (33%, `needs_remediation`) on the New York
civilization lesson (`atlas-us-p082-new-york`, session `ses_qkd1wl1fzz`). He
told a parent he might have mismatched rows to questions. Checking by hand —
pulling the worksheet's answer key (`data/household/school/records/worksheets/
ses_qkd1wl1fzz.yml`) and the raw OMR scan trail (`data/household/school/
records/assessments/omr/study-omr/2026-09-21.yml`) and testing his six marks
against every ±1/±2 row shift and a reversal — found no shift that scores
better than the literal reading. His four misses are genuine content misses.

That hand check is exactly the kind of thing the system should be able to do
itself, automatically, the moment a sheet grades badly — not something a
parent reconstructs from three YAML files after the fact. This spec is that
capability.

## 2. What already exists — do not rebuild this

`backend/src/2_domains/school/omrAlignment.mjs` (`omrAlignmentError`) already
does offset-shift detection, called from `ResolveCardScan.execute()`
(`backend/src/3_applications/school/documents/ResolveCardScan.mjs:672`) on
**every** scan, before grading. It compares each new scan's raw marks against
a `baselineStore` snapshot of the marks that same card showed on an *earlier*
scan of the *same rows*, looking for evidence the whole card fed askew this
pass relative to last pass (≥6 matching rows, ≥80% agreement under the shift,
shift beating literal by ≥4, ≥3 distinct patterns — deliberately conservative
so an ordinary answer revision between passes can't trigger it). A match
routes the scan to `ReviewHeldCardScan` (`backend/src/3_applications/school/
documents/ReviewHeldCardScan.mjs`) — a teacher-gated queue with
`confirm`/`reassign`/`redo` resolutions — instead of grading it.

**This cannot catch Learner1's hypothesis, by design.** It compares scan N
against scan N-1. If a learner's marks are shifted the *same way on every
single pass* — which is exactly what "I put answers in the wrong number
ranges" describes — there is no earlier, differently-shifted baseline to
disagree with. The check's own doc comment is explicit about this scope:
*"Compare measured marks only, never an answer key."* It was built to catch
the *scanner* misreading a card it read correctly before, not a learner who
was consistently wrong about which row is which from the first mark onward.

That's the gap this spec fills: a second check, content-aware, that compares
against the answer key instead of a prior scan.

## 3. Design

### 3.1 New domain function

`backend/src/2_domains/school/omrKeyAlignment.mjs` — pure, no I/O, mirrors
`omrAlignment.mjs`'s shape and gets the same kind of focused unit tests.

```js
/**
 * Compare one worksheet's marked answers against its own answer key, at
 * every ±1/±2 row shift within the worksheet's OWN row range only — never
 * reaching into a neighboring worksheet's rows on the same physical card.
 * Returns a candidate only when the shift would score meaningfully better
 * than the literal reading; never returns anything for an already-passing
 * literal reading.
 */
export function omrKeyAlignmentSuspect(rows) {
  // rows: [{ row, given, correctLetter }], in printed order, ownedRows only.
  // ...
}
```

Input is the per-row `{ row, given, correctLetter }` triples already
available at the exact point `ResolveCardScan`'s per-record grading builds
`rowResults` (`backend/src/3_applications/school/documents/
ResolveCardScan.mjs:1121`-ish, where `gradeRow(item, answers[planned.row],
points)` runs per row): `given` is `answers[planned.row]`, and
`correctLetterFor(item)` (already defined at `ResolveCardScan.mjs:278`, and
already reused by the eraser-leniency pass) supplies `correctLetter`. No new
answer-key plumbing is needed — this reuses data the grading pass already
has in hand at that line.

**Row scope is hard-limited to `record.rowRange`.** Never compare against a
neighboring worksheet's rows (row 21's scripture key, row 28's math key).
This mirrors the existing check's `owners[row] === baseline.owners[row]`
guard in `ResolveCardScan.mjs:670-671` — a shift that would reach across a
worksheet boundary is a different failure class (a genuinely wrong-sheet
scan) and is out of scope here; `ResolveCardScan`'s existing identity
preflight already exists for that.

### 3.2 Algorithm

For each offset in `[-2, -1, 1, 2]`, walk the worksheet's own rows and count:
- `literalMatches`: rows where `given === correctLetter` at the printed row
- `shiftedMatches`: rows where `given === correctLetter` at `row + offset`,
  where `row + offset` is *also inside this worksheet's own row range*

Flag a candidate only when **all** of:
1. item count ≥ `MIN_ITEMS` (§4) — too few rows and any shift can coincide
   with the key by chance (a 3-item worksheet has 6 orderings; this is not
   a statistically meaningful signal at that size)
2. `literalMatches / itemCount` is a failing/borderline score, not already
   a clean pass — no point flagging a sheet that graded fine
3. `shiftedMatches - literalMatches ≥ MARGIN` (§4) — a small, ordinary
   number of coincidental matches under a shift must never trigger this

This is deliberately the mirror image of `omrAlignmentError`'s own
conservatism (6 rows / 80% / patterns ≥ 3) — same philosophy, different
thresholds because the input shape is different (worksheets here run 3-12
rows, not the 25-row blocks the existing check was tuned against).

### 3.3 Where it hooks in

Inside `ResolveCardScan`'s per-record grading (same function that builds
`rowResults`/`totalPoints`/`earnedPoints`, `ResolveCardScan.mjs:1121-1246`),
run `omrKeyAlignmentSuspect` over `questionRows` (post-grade, pre- or
post-leniency — pre-leniency is correct: leniency is about erasure
interpretation on individual rows, orthogonal to whether the whole block is
row-shifted) once the record's own rows are **fully marked** (same
"never grade a card with any blank row" gate this method already applies
elsewhere per the doc comment near `ResolveCardScan.mjs:696`).

When a candidate is found, the record's result gains a new field —
`keyAlignmentSuspect: { offset, literalMatches, shiftedMatches, itemCount }`
— rather than a hard error. **Grading still happens and the literal score is
still computed** (never silently substitute the shifted reading as truth);
this field is evidence for `SchoolPrintScanConsumer`/`CloseSessionOutcome`
to act on, the same "measurement, not policy" posture the rest of this file
already takes toward `cardIdInferred` and `revisionSuperseded`.

### 3.4 What happens when suspected

`SchoolPrintScanConsumer` (`backend/src/3_applications/school/workflows/
SchoolPrintScanConsumer.mjs`) sees `keyAlignmentSuspect` on a graded result
and, instead of letting the outcome finalize immediately (today: `submitted`
→ `graded` → `outcome_recorded` → receipt, all in one pass — see the
`ses_qkd1wl1fzz` event log, all four events at the same timestamp), routes it
through the **existing** `ReviewHeldCardScan` queue with a new hold reason,
`'possible-key-shift'`, carrying the offset/score evidence. This reuses
`confirm`/`reassign`/`redo` verbatim:
- **confirm** — teacher looked, the literal grade stands (genuine misses,
  exactly Learner1's actual case), outcome finalizes as it would have anyway
- **redo** — new sheet issued, same as any other held-scan redo today
- *(no new action needed — "the shift really was it" is just `redo` +
  letting the child re-mark cleanly; this spec does not add an action that
  accepts the shifted reading as a grade, on purpose — see Non-goals)*

The room still gets an honest signal in the meantime — same "a scan is never
silent" principle the 2026-08-22 plan already established for
`scan-awaiting-review` — rather than a hard block on the learner moving on.

### 3.5 Log event

`school.scan.key-alignment-suspected` — `{ cardId, recordId, learnerId,
offset, literalMatches, shiftedMatches, itemCount }` — `warn`, same level as
`school.scan.alignment-refused` and `school.scan.card-id-inferred`: a
machine judgment call, deserves a human's eyes once.

## 4. Numeric constants — KC's call, not a guess

| Constant | Purpose | Starting suggestion |
|---|---|---|
| `MIN_ITEMS` | floor below which shift-checking is statistically meaningless | 5 (excludes the house's 3-item scripture worksheets entirely) |
| `MARGIN` | minimum extra correct answers a shift must produce over the literal reading | 2 |

Do not ship this with guessed values. A margin set too low nags on ordinary
bad days (false positives erode trust in the whole review queue, the same
failure mode `omrAlignmentError`'s own comment warns against: *"a handful of
ordinary revisions therefore cannot on its own trigger a refusal"*); set too
high, it misses real cases. This needs a look at the house's real worksheet
score distribution before picking numbers, not a first-principles guess.

## 5. Non-goals

- **No auto-regrade.** The shifted reading is never treated as truth by the
  system on its own. A human confirms.
- **No reordering/pairwise-swap/reversal detection.** Scope is simple ±1/±2
  row shifts only, matching the existing check's precedent. Broader
  reordering detection (tested by hand for Learner1 — reversal, pairwise swaps)
  is a plausible future slice but multiplies false-positive surface fast
  and isn't justified by anything seen in the data yet.
- **Not for on-screen quizzes.** Row-shift is a physical bubble-sheet failure
  mode; on-screen quizzes have no equivalent row geometry to shift.
- **Not cross-worksheet.** Never evaluates a shift that would reach into a
  neighboring worksheet's rows on the same card (§3.1).

## 6. Test plan

- **Regression fixture, must NOT trigger:** Learner1's actual `ses_qkd1wl1fzz`
  data (`given` = C,A,B,C,C,C at rows 22-27; key = C,B,B,A,A,D). No offset
  in `[-2,-1,1,2]` improves on 2/6 by the margin — assert
  `omrKeyAlignmentSuspect` returns `null` for this exact input. This is the
  single most important test in this spec: it proves the check discriminates
  "genuinely wrong" from "plausibly shifted," using a real case where a
  parent explicitly suspected the latter and was wrong.
- **Positive fixture, must trigger:** synthetic 6-row worksheet where the
  learner's marks are the *correct* key values shifted down by one row
  (row N's mark equals row N-1's correct answer, throughout) — literal score
  low, shifted score at or near perfect.
- **Boundary fixtures:** exactly `MIN_ITEMS - 1` rows (never triggers,
  regardless of how clean the shift is); shift that would reach past the
  worksheet's own `rowRange` (must be excluded from that offset's count, not
  wrapped or clipped into a neighboring worksheet's rows).
- **Already-passing sheet:** a shift that would coincidentally score even
  higher on an already-passing literal grade must not trigger (§3.2, rule 2).

## 7. Open questions for KC

1. Confirm `MIN_ITEMS`/`MARGIN` (§4) against real worksheet score history —
   I have not pulled that distribution for this spec.
2. Should a suspected-shift hold also suppress the `grading_hook` (the HA
   siren-tone cue)? Today `needs_remediation` presumably fires a distinct
   tone from `passed`; firing that before a human confirms which one it
   really is would be premature the same way the receipt is.
3. Does the review queue distinguish this hold reason visually from the
   existing `'redo-held-wrong-sheet-scan'` reason in the teacher UI, or do
   both read as generic "needs your attention"? If the surface is generic
   today, a `possible-key-shift` hold should probably say why in plain
   language ("shifting his answers up one row would score much better —
   worth asking him before this counts against him") rather than just a
   code, since the whole point is saving a parent the manual reconstruction
   done for Learner1 today.
