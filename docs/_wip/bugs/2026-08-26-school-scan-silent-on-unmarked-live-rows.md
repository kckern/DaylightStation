# School scan — a fed sheet produced no ceremony and no sound — 2026-08-26

**Status:** F-1–F-5 implemented, tested, and deployed
**Window:** 2026-08-26 08:32–08:35 PDT (`15:32`–`15:35Z`)
**Surfaces:** `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs`,
`backend/src/3_applications/school/documents/ResolveCardScan.mjs`,
`frontend/src/modules/School/selfService/useScanCeremony.js`,
`frontend/src/modules/School/selfService/scanCeremonySound.js`
**Evidence:** the structured log store (UTC window `2026-08-26T15:28Z`–`15:36Z`),
the allocation store and decoded-scan day files in the data volume, `git log -L`
**Deployed build at time of incident:** `1b9c39d8a` (built 2026-08-26 00:30 PDT)

Learners are referred to as **M\*\*\*** and **F\*\*\*\***. Card ids (7-digit
student numbers bubbled on paper) are redacted to their first two digits —
`40•••••` is M\*\*\*'s card, `59•••••` is F\*\*\*\*'s.

---

## 1. What happened

M\*\*\* fed his OMR card into the study reader **four times** in two and a half
minutes. Every read succeeded. The room stayed completely silent — no receipt, no
banner on the Portal panel, no error tone. He gave up and tapped his NFC card
instead, which printed his agenda normally.

The household's reaction — *"this was never supposed to be possible"* — is
correct, and is the real finding here. The system carries an explicit,
documented guarantee that **a scan never ends in silence** (print-document spec
§6.2). That guarantee has a backstop event, a banner, and an audible cue, all
built for exactly this moment. None of them fired, because the code path taken
exits above all three.

**Two defects, one visible symptom:**

- **D-1 (primary)** — the child got no acknowledgement of any kind.
- **D-2** — the grown-ups got no log line either, so the incident was invisible
  in the log store and only findable by reasoning backwards from an *absence*.

---

## 2. Timeline

All times UTC; local is PDT (−7).

| Time | Event | Note |
|---|---|---|
| `14:54:14` | live allocation record created — rows **34–39** | M\*\*\*'s new worksheet is issued |
| `15:30:07` | F\*\*\*\* scans card `59•••••` | full pipeline works: decode → resolve → grade → receipt |
| `15:32:44` | `quiz.decode.sheet` `40•••••` answered **33** | **silence** |
| `15:33:11` | `quiz.decode.sheet` `40•••••` answered **33** | **silence** |
| `15:34:49` | `quiz.decode.sheet` `40•••••` answered **33** | **silence** |
| `15:35:01` | `quiz.decode.sheet` `40•••••` answered **33** | **silence** |
| `15:35:11` | `omr.ingest.nfc` — M\*\*\* taps his card | gives up on the sheet |
| `15:35:22` | `school.card.agenda-printed` | agenda prints fine |

F\*\*\*\*'s scan two minutes earlier is the control: same reader, same code
build, same minute-scale window, and it produced `scan-resolved` **13 ms** after
its decode. The pipeline was healthy the whole time.

---

## 3. Root cause

### The physical situation

The OMR card is **cumulative** — each new worksheet claims the next block of
rows on the same piece of card stock, and old marks stay on it forever. M\*\*\*'s
card carries seven allocation records:

| Rows | Status |
|---|---|
| 1–6, 7–12, 13–18, 19–24, 25–30, 31–33 | `satisfied` (six finished worksheets) |
| **34–39** | **`live`** — today's worksheet, issued `14:54:14Z` |

Rows 1–33 is exactly 33 rows. The decode reported `answered: 33` on all four
attempts, and the decoded rows are **1 through 33** with **nothing in 34–39**.

Comparing today's decode against the prior day's scan of the same card, rows
1–30 are **byte-identical**. These are stale marks physically sitting on the
card. M\*\*\* did not re-bubble anything — he fed a card whose new rows were
still blank.

*(Whether he'd done the worksheet on paper and not transferred it, or hadn't
started, is outside what the logs can say. Either way the machine's correct
answer is "your new rows are blank" — which is precisely what it failed to say.)*

### The code path

`ResolveCardScan.execute` behaves exactly as designed:

```js
const live = records.filter((record) => record.status === 'live');
// A reused card retains old marks in satisfied rows. While a new worksheet
// is live, grade only that live allocation and ignore the settled rows.
const eligible = live.length > 0 ? live : records.filter(...);
```

`eligible` narrows to the single live record (rows 34–39). None of its owned
rows appears in `answeredRows`, so it is recorded as a **`silentLiveRecords`**
entry — the deliberate "wrong-rows signature" diagnostic — and skipped.
`results` returns empty.

Then `schoolPrintScanConsumer.mjs` drops it:

```js
if (!outcome?.results?.length) {
  // No live/satisfied print-document allocation record on this card
  // at all — the ordinary case for every legacy bubble sheet on this
  // bus, and NOT an error: the recorder already has the decoded scan.
  logger.debug?.('school.print.scan-no-allocation', {   // :180
    testId, unallocatedRows: outcome?.unallocatedRows ?? [],
  });
  return;                                                // :183
}
if (outcome.silentLiveRecords?.length) {                 // :185 — UNREACHABLE
  logger.warn?.('school.print.scan-live-record-unmarked', { ... });
```

**The diagnostic written for this exact signature sits one line below the guard
that prevents it from ever running.**

`git log -L176,190` shows commit `fb73343a7` *("scan diagnostics — unknown cards
warn with near-misses, repeats and silent cardmates flagged")* added the
`silentLiveRecords` block directly beneath a pre-existing early return. It has
never once been reachable in the case where `silentLiveRecords` is the **only**
thing that happened.

### Why the block's own reasoning is inverted

The code argues, at length, that this signature should go to the house rather
than the child:

> *"Told to the HOUSE, not to the child's panel … there is no child action …
> and the sheet still grades (this branch falls through to the per-record
> ceremonies rather than returning)."*

That reasoning is sound **when a silent record sits alongside a graded one** —
some other record speaks, so this one need not. It is exactly backwards in the
alone-case: nothing grades, nothing else speaks, and the child's action is
obvious and entirely self-service — *bubble rows 34–39 and rescan*. The author
reasoned about the co-occurring case and the guard above made the alone-case
unreachable, so the mistake was never observable.

---

## 4. Why there was no sound — and there should have been

This is a distinct failure from the missing log line and deserves its own
statement, because the audible cue is the one piece of feedback a child gets
without looking at anything.

The ceremony is fully built and correct. `useScanCeremony.js` subscribes to the
`omr` topic; `scanCeremonySound.js` maps tone families to three deliberately
distinct WebAudio patterns:

| Tone | Pattern | Meaning |
|---|---|---|
| `success` | short rising pair | good news climbs |
| `warn` | single held mid tone | pause — go get someone |
| `error` | **low double-buzz** | *"that didn't work"* |

The hook's own header states the requirement verbatim — *"a scan must always be
acknowledged on screen"* — and names `scan-not-recorded` as *"the backstop that
makes 'every' literal: a sheet that reaches the consumer and produces no
ceremony of its own gets that one, so no scan can end in silence."*

**Every one of those mechanisms is driven by `eventBus.broadcast` from the
consumer.** The consumer returned at `:183` without broadcasting. The panel
therefore received nothing at all — not a suppressed event, not an unrecognised
event, *nothing*. No banner, no double-buzz.

The `scan-not-recorded` backstop and the `spoke` tracker that arms it live at
`:456`, also below the early return. **The guarantee and the path that violates
it never meet.** The ceremony system was never broken; it was never told.

---

## 5. Why it was invisible in the logs

The single line this path emitted was `logger.debug?.('school.print.scan-no-allocation')`.

Production runs at `info`, and debug events are never shipped to the log store.
So the only artefact of four fed sheets was a line that does not exist anywhere
a person would look. The incident had to be diagnosed by noticing that four
`quiz.decode.sheet` events had **no successor events**, and reasoning backwards
from that gap.

The `debug` level is defensible for its stated case — a legacy bubble sheet with
no live record on the card, which is genuinely routine. It is indefensible when
the card **has** a live record: that is a worksheet the system itself issued and
is waiting on, and its scan producing nothing is never routine.

Note the same file already learned this lesson once, at `:86-91`, for the
unresolved path:

> *"WARN, not debug: production runs at `info` … so at debug this line — the
> single best explanation for 'I scanned it and nothing happened' — was dropped
> entirely and an unreadable sheet left no trace at all."*

The identical argument applies here and was not carried across.

---

## 6. Ruled out

Each of these was checked against evidence, not assumed:

- **The reader/board.** Four clean decodes, and an NFC tap 10 s later that
  printed an agenda. Hardware is healthy.
- **The thermal printer.** Printed M\*\*\*'s agenda at `15:35:22` and
  F\*\*\*\*'s result receipt at `15:30`.
- **The decode.** Card id read cleanly all four times — no `?` wildcards, so
  the ambiguous-id path was never entered. 33 rows resolved consistently.
- **Card-id misread / unknown card.** Would have produced
  `school.print.scan-unknown-card` at `warn`. The card resolved to real records.
- **A dead card.** Would have produced `school.print.scan-dead-card` at `warn`.
  A `live` record exists.
- **The recent artifact-id refactor** (`70a13f537`, `1b9c39d8a`, `3b5a49ac8`).
  Plausible on its face, since those commits reshape record ids and were
  deployed hours earlier — but ruled out: the allocation record was found, read,
  and correctly narrowed. F\*\*\*\*'s scan on the same build graded end-to-end.
  The failure is row-overlap logic, not id resolution.
- **Duplicate-scan dedup.** The four decodes are 27 s–98 s apart, far outside
  the dedup window, and all four were persisted.

---

## 7. Fix

### F-1 — Move the diagnostic above the guard (root cause)

Hoist the `silentLiveRecords` block above the `!results.length` early return in
`schoolPrintScanConsumer.mjs`. It is currently dead code in the case it was
written for.

### F-2 — Give the alone-case a child-facing ceremony with an `error` tone

When `silentLiveRecords` is non-empty **and** nothing graded, broadcast a
terminal outcome so the panel banners and the double-buzz fires:

```js
if (outcome.silentLiveRecords?.length) {
  logger.warn?.('school.print.scan-live-record-unmarked', { testId, silentLiveRecords: outcome.silentLiveRecords });
  gradingHook?.fire({ result: 'partial', testId, code: 'live_record_unmarked', ... }).catch(() => {});
  // When nothing else will speak for this sheet, this is the only voice it has.
  if (!outcome.results?.length) {
    eventBus.broadcast?.(broadcastTopic, {
      event: 'scan-rows-unmarked',
      testId,
      learnerId: outcome.silentLiveRecords[0].learnerId ?? null,
      rowRange: outcome.silentLiveRecords[0].rowRange,
    });
  }
}
```

A **new** event rather than reusing `scan-not-recorded`, whose copy — *"Already
done / I read that sheet, but there was nothing new to mark"* — is factually
wrong here. Nothing was done; the work is still outstanding. Proposed copy in
`useScanCeremony.js`, following the existing child-readable, never-blaming
register:

```
scan-rows-unmarked → error  "Nothing filled in yet"
                            "Your new questions are rows {start}–{end}. Fill them in, then scan again."
```

`error` tone is the right family: it rings the low double-buzz that means
*"that didn't work"*, and the child's next move is to act on the sheet, not to
fetch a grown-up. Naming the row range is what makes it actionable — on a
cumulative card the child cannot otherwise tell which block is theirs today.

### F-3 — Promote the silent log line when a live record exists

`school.print.scan-no-allocation` stays `debug` only when the card carries no
live record (the genuine legacy-sheet case). When a live record exists and the
scan still produced nothing, it must be `warn`, carrying `unallocatedRows` and
the live record's `rowRange`.

### F-4 — Make the "never silent" guarantee structural

The `spoke` tracker and its `scan-not-recorded` backstop cannot protect any path
that returns above them. Restructure so **every** terminal exit funnels through
one place that asserts a ceremony was emitted — so a future early return cannot
silently opt out of the guarantee the way this one did. This is the durable fix;
F-1 and F-2 close today's instance.

### F-5 (secondary) — an entirely blank card was initially silent, now routes correctly

**Original claim (now superseded):** If a card with a live record is fed with **no** marks anywhere, `answeredRows.size === 0`, so `unknownCard` and `deadCard` (both of which require answers) are skipped, `silentLiveRecords` is not populated (it also requires `answeredRows.size > 0`), and `results` is empty — the same silent exit.

**What is actually true:** The residual defect was never silence after F-3/F-4 landed. Empirically verified on 2026-08-26: a blank card with a live record emitted `scan-not-recorded` plus two `warn` lines. The real defect was misleading copy: `scan-not-recorded` renders as "Already done / I read that sheet, but there was nothing new to mark" — factually false for a card nobody filled in.

**Fix, now shipped (commits `568c0f058`, `71229f604`):** `ResolveCardScan.mjs` dropped the `answeredRows.size > 0` precondition from its `silentLiveRecords` push, so a blank card now routes into the `scan-rows-unmarked` ceremony instead. That ceremony's copy already names the rows to fill in ("Your new questions are rows {start}–{end}. Fill them in, then scan again.") and rings the `error` tone.

---

## 8. Tests

The existing suite covers `silentLiveRecords` **alongside** a graded record,
which is why this shipped. Regression coverage needed:

1. **Consumer, alone-case** — a live record whose owned rows are unmarked while
   other rows carry marks, with no other gradeable record ⇒ asserts
   `school.print.scan-live-record-unmarked` is logged **and** a
   `scan-rows-unmarked` broadcast is emitted. This test fails on the current
   code, which is the point.
2. **Ceremony mapping** — `scan-rows-unmarked` ⇒ tone `error`, row range
   interpolated into the copy.
3. **Sound** — tone `error` selects the double-buzz pattern.
4. **Guarantee test (F-4)** — every terminal outcome shape from
   `ResolveCardScan` produces exactly one ceremony broadcast. This is the test
   that would have caught the original ordering mistake.

---

## 8a. What was actually implemented

F-1 through F-4, test-first. F-5 is deliberately left open.

| File | Change |
|---|---|
| `ResolveCardScan.mjs` | returns `cardRecordCount` — the only thing that distinguishes "a sheet we never issued" from "our card, nothing matched", since `results: []` covers both |
| `schoolPrintScanConsumer.mjs` | `speak()` funnel + `settleOutcome()`; `silentLiveRecords` hoisted; `scan-rows-unmarked` broadcast; `scan-no-allocation` promoted to `warn` when the card is ours |
| `useScanCeremony.js` | `scan-rows-unmarked` → `error` tone, *"Nothing filled in yet / Your new questions are rows {start}–{end}."* |

**On F-4.** The backstop is no longer something a `return` can jump over. The
outcome handling moved into a nested `settleOutcome()` whose returns cannot
escape the check, and every broadcast goes through `speak()` — which is also
what the backstop reads. A future outcome that calls `eventBus.broadcast`
directly would be invisible to the guarantee again, so that rule is now written
into the module header.

**On the copy.** Deliberately NOT `scan-not-recorded` ("Already done — nothing
new to mark"), which is false here: the work is still outstanding. The row range
is what makes it actionable, and a missing range degrades the wording without
ever costing the ceremony — the one failure mode this event exists to prevent.

**Tests:** 6 consumer (incl. a 5-case table asserting every terminal outcome
shape produces exactly one ceremony), 2 resolver, 3 ceremony-mapping. All were
watched failing first; the two resolver tests were re-verified by reverting the
production line and confirming they go red.

**Regression status:** the silent-scan suite is 16/16; the touched suites are
264/264. The full vitest gate reports three failing files
(`school.progress`, `registryCompleteness`, `closeOutcome`) — all three
**pre-existing**, verified by reverting all three source changes and observing
identical failures. Two further files (`nfcTapIngress.shutdown`, `pianoGames`)
report "no test suite found" under a directory-glob vitest run; they are
`node:test` files and are not vitest's to run.

---

## 9. Immediate remediation

No data was lost or corrupted — nothing was written, which is the whole problem.
M\*\*\*'s worksheet is still ungraded and its session still open.

His card's live record (rows **34–39**) is intact and still `live`. Bubbling
rows 34–39 and rescanning will grade normally and print the result receipt. No
reissue or teacher-console intervention is needed.

---

## 10. Deployment note

A fix could not be deployed during the investigation window: the Portal was in
active use (self-service traffic minutes before and during), and the deploy gate
correctly halts on a child at the Portal. Ship once the Portal is idle.
