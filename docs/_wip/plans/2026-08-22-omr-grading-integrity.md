# OMR Grading Integrity, Scan Ceremony & Print-Again Correctness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> ## STATUS — read before starting
>
> **Slices A and F are DONE and merged.** Do not re-implement them.
> - `9a5537bb7` Slice A — log timestamps carry their UTC offset; scan-unresolved
>   raised to `warn`; awaiting-review carries reasons/items; LogsQL docs fixed.
> - `a89bf7bd8` Slice F — thermal write waits for the flush callback; raster
>   conversion made linear; the check glyph transliterated. Verified on the real
>   printer with a 576x5000 PNG: 360,034 bytes, 19,895ms/698MB RSS → 11,080ms/124MB.
>
> **Build B + C + D as ONE branch.** They are a single user-visible behaviour —
> a scan always produces an outcome. A broadcast nobody consumes and a ceremony
> with nothing to show are not independently reviewable.
>
> **G + H as a second branch.** H opens `receipts.mjs`, so fold the two
> "out of scope" receipt bugs at the bottom of this document into it while it is
> already open.
>
> **Do NOT build E.** Task E1 is an investigation that reports back to KC. Picking
> a staleness threshold without him is the one destructive guess here.
>
> **Checklist items marked 👤 need a human at the hardware.** You cannot verify
> them from a terminal, and ticking "tests pass" while they go unchecked is
> exactly how these defects survived for weeks.

**Goal:** Make every scan and every card tap produce a visible, truthful outcome — credit a legitimate eraser instead of parking silently, announce failures on the school screen, stop the thermal printer truncating and corrupting the next job, stop repeat taps flooding the printer, pair every QR with its keypad code, and close the logging blind spots that hid all of it.

**Architecture:** Eight independent slices over the paper pipeline (`omrRelay → quizScanRecorder → ResolveCardScan → RecordCardScanOutcome → CloseSessionOutcome`) and the thermal print path. **A** fixes log fidelity so everything else is observable. **B** adds bounded grading leniency. **C** broadcasts scan outcomes on the existing `omr` bus. **D** turns that into an on-screen ceremony. **E** addresses stale session resumption. **F** repairs the thermal printer wire contract. **G** adds an agenda print cooldown. **H** binds every QR to its code. Each slice is independently shippable; only D depends on C.

**Tech Stack:** Node ESM backend (DDD layers `0_system` → `5_composition`), Vitest, React 18 frontend, VictoriaLogs (`logs.kckern.net`), existing `eventBus` WS bridge, `useWebSocketSubscription`.

---

## Background: what actually happened on 2026-08-22

Several separate defects surfaced in one school session. All are evidenced below from logs, session records and on-device probes; do not re-derive them. Where a first-draft finding was later corrected, the correction is marked inline — trust the correction, not the original claim.

### Incident 1 — Learner3's sheet graded 5/6 then went silent

Log chain (local time):

```
15:15:40  quiz.decode.sheet            testId 4071314, answered 6
15:15:40  school.print.scan-resolved   learner learner3, 5/6, cardIdInferred null
15:15:40  school.print.scan-awaiting-review  pendingReview 1
          → nothing printed, no signal in the room
```

Cause: Q1 `us-union-civil-war-meaning` decoded as `given: ['B','D']` — two bubbles. The child erased B and chose D; the eraser left enough graphite to read. `ResolveCardScan.mjs:292` marks any multi-mark on a single-select row `ambiguous` with `earned: 0`, never inspecting whether one of the marks is right. One ambiguous item makes `pending.length = 1`, so `RecordCardScanOutcome.mjs:417` returns `advancedTo: 'submitted'`; `schoolPrintScanConsumer.mjs:163` only calls `closeSessionOutcome` on `'graded'`; `CloseSessionOutcome.#printed` is what prints the receipt. So the receipt never prints and nothing tells the room.

The answer key confirms the eraser reading was legitimate — sheet order A/B/C/D = territories / Central America / The West / **The North**, and `answer: The North` = D.

Resolved manually in prod via `POST /api/v1/school/lifecycle/sessions/ses_5yGnmuJ0/review/us-union-civil-war-meaning` → session finished 100%, receipt printed 15:27:22. The underlying behaviour is unchanged and will recur.

### Incident 2 — a second sheet failed with no trace

```
15:16:39  omr.ingest.reader_error   echo "12123F"
```

`omrRelay.mjs:187` logs it and broadcasts it; nothing in the UI consumes it. From the room it is indistinguishable from Incident 1.

### Incident 3 — Learner4's reprint changed physical identity

Learner4's session `ses_f6Buxumv` was **created 2026-08-14** and never submitted. On 2026-08-22 it was reprinted an 8-day-old artifact. Session events (all carrying the *same* `artifactId`):

```
2026-08-14T16:28  created
2026-08-14T17:55  issued      civilization/young-peoples-atlas-us/ws-ses-f6buxumv
2026-08-14T20:25  reprinted   (same artifactId)
2026-08-14T23:40  reprinted   (same artifactId, confirmed)
2026-08-22T22:00  reprinted   (same artifactId, confirmed)
```

**The "PRINT IT AGAIN" label was correct** — same artifact, genuinely printed before. The `reprinted` event already validates artifact identity (`sessionEvents.mjs:318-320`: *"reprinted artifactId … was never issued (a reprint reuses the original)"*). So print-again is **already artifact-scoped, not lesson-scoped**. The original hypothesis does not hold and must not be "fixed".

The real defect is that **an 8-day-old session resumed silently**. His one live card allocation is `5922785`, rows **7–16**, minted 2026-08-14 when `arts/creature-identification/quiz-1` held rows 1–6 of that shared physical card. So the sheet legitimately starts at question 7 and legitimately carries a different student number — for a packing context eight days stale that nobody in the room could see.

A sweep of `artifacts/print/cards/` confirms only **one** allocation is `live` for that record; a rows 1–10 card (`3598689`) exists but is `released`. See Slice E for the full table and the correction it supersedes. **There is no data corruption here and no migration to write.**

Also confirmed working and **not** to be changed: Learner3 (`profile` 6-item set) and Learner4 (`profile: upper`, 10 items) correctly received different content for the same unit.

### Cross-cutting: the logs actively misled

1. **Backend timestamps are wrong in the store.** `logger.mjs:22` and `dispatcher.mjs:18` emit local wall-clock with the `Z` stripped (`2026-08-22T15:00:58`). VictoriaLogs parses that as UTC and files every backend event 7 hours early. The frontend sends real UTC with `Z`. A `_time:2h` query returned **zero** backend events during an active session.
2. **The most common silent failure is invisible in prod.** `schoolPrintScanConsumer.mjs:57` logs `school.print.scan-unresolved` at `debug`; production `defaultLevel` is `info` (`data/system/config/logging.yml`), so unreadable-card scans are dropped entirely.
3. **`| stats count() by (field)` is invalid LogsQL** (documented wrong in `CLAUDE.md`). Correct form: `| stats by (field) count()`.

**Log store:** container `victoria-logs` (`victoriametrics/victoria-logs:latest`, created 2026-08-17), `:9428`, 7-day retention / 4 GB cap, bind-mounted at `/media/kckern/DockerDrive/daylight-victorialogs`. Reachable from the macbook at `https://logs.kckern.net`, at `http://10.0.0.10:9428`, or via `ssh homeserver.local`. No separate shipper container — the app posts directly.

---

## Slice A — Logging fidelity

Do this first: the remaining slices are unverifiable without it.

### Task A1: Backend timestamps carry their UTC offset

**Files:**
- Modify: `backend/src/0_system/logging/logger.mjs:17-23`
- Modify: `backend/src/0_system/logging/dispatcher.mjs:12-38`
- Modify: `backend/src/0_system/logging/ingestion.mjs:20-24`
- Create: `tests/unit/system/logging/localTimestampOffset.test.mjs`

Keep local wall-clock (the house is self-hosted and single-timezone; local time is what gets read). Append the real offset so the value is also unambiguous — `2026-08-22T15:00:58.668-07:00`. This satisfies both "show me local time" and "let the store sort it correctly".

**Step 1: Write the failing test**

```javascript
// tests/unit/system/logging/localTimestampOffset.test.mjs
import { describe, it, expect } from 'vitest';
import { formatLocalTimestamp } from '#system/logging/localTimestamp.mjs';

describe('formatLocalTimestamp', () => {
  it('keeps local wall-clock and appends the offset', () => {
    const ts = formatLocalTimestamp(new Date('2026-08-22T22:00:58.668Z'), 'America/Los_Angeles');
    expect(ts).toBe('2026-08-22T15:00:58.668-07:00');
  });

  it('round-trips to the same instant', () => {
    const at = new Date('2026-08-22T22:00:58.668Z');
    expect(new Date(formatLocalTimestamp(at, 'America/Los_Angeles')).getTime()).toBe(at.getTime());
  });

  it('handles a UTC zone with +00:00, never a bare Z-less string', () => {
    expect(formatLocalTimestamp(new Date('2026-01-05T09:30:00.000Z'), 'UTC'))
      .toBe('2026-01-05T09:30:00.000+00:00');
  });
});
```

**Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/system/logging/localTimestampOffset.test.mjs`
Expected: FAIL — cannot resolve `#system/logging/localTimestamp.mjs`.

**Step 3: Create the shared helper**

Both `logger.mjs` and `dispatcher.mjs` (and `ingestion.mjs`) currently carry near-duplicate copies of this function. Extract one.

```javascript
// backend/src/0_system/logging/localTimestamp.mjs
/**
 * Local wall-clock with an explicit UTC offset — `2026-08-22T15:00:58.668-07:00`.
 *
 * The house is self-hosted and single-timezone, so local time is what a human
 * reads. The offset is what keeps the log store honest: VictoriaLogs parses an
 * offset-less ISO string as UTC, which filed every backend event 7 hours early
 * and made backend and frontend events interleave wrongly.
 */
const PARTS = {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  fractionalSecondDigits: 3, hour12: false,
};

function offsetFor(at, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}:${m[3]}` : '+00:00';
}

export function formatLocalTimestamp(at = new Date(), timeZone = null) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, ...PARTS })
      .formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
    + `.${p.fractionalSecond}${offsetFor(at, zone)}`;
}

export default formatLocalTimestamp;
```

Check `package.json` `imports` for the `#system/*` subpath alias; if the alias differs, use the form the neighbouring files already import by.

**Step 4: Run the test**

Run: `npx vitest run tests/unit/system/logging/localTimestampOffset.test.mjs`
Expected: PASS (3 tests).

**Step 5: Replace all three call sites**

In `logger.mjs` and `ingestion.mjs`, delete the local `getLocalTimestamp` and import the helper. In `dispatcher.mjs`, keep the `globalTimezone` behaviour by passing it through: `formatLocalTimestamp(new Date(), globalTimezone)`. Update the stale doc comments that promise `"2026-01-23T16:54:50.536"` / *"no Z suffix = local time"*.

**Step 6: Verify nothing else asserts the old shape**

Run: `npx vitest run tests/unit/system/logging/ tests/unit/config/timezoneDefault.test.mjs`
Expected: PASS. Fix any fixture that hard-codes an offset-less timestamp.

**Step 7: Commit**

```bash
git add backend/src/0_system/logging/ tests/unit/system/logging/localTimestampOffset.test.mjs
git commit -m "fix(logging): stamp backend events with local time plus UTC offset

VictoriaLogs read the offset-less local timestamp as UTC and filed every
backend event 7 hours early, so a _time:2h query returned zero backend
events during a live session."
```

---

### Task A2: Promote the silent scan failures to visible levels

**Files:**
- Modify: `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs:57`
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs:417`
- Test: `tests/unit/applications/school/scanLogLevels.test.mjs`

`scan-unresolved` at `debug` is dropped in production, which is precisely the event that explains "I scanned it and nothing happened". Raise it to `warn` and give it the fields needed to act.

**Step 1: Write the failing test**

```javascript
// tests/unit/applications/school/scanLogLevels.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { createSchoolPrintScanConsumer } from '#composition/modules/schoolPrintScanConsumer.mjs';

function harness(outcome) {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  let handler;
  const eventBus = { subscribe: (_t, fn) => { handler = fn; return () => {}; } };
  createSchoolPrintScanConsumer({
    eventBus, logger,
    resolveCardScan: { execute: async () => outcome },
  });
  return { logger, fire: (p) => handler(p) };
}

describe('scan log levels', () => {
  it('an unresolved card warns (not debug) so production sees it', async () => {
    const { logger, fire } = harness({ error: { code: 'CARD_ID_UNREADABLE' } });
    await fire({ event: 'sheet', marks: [1, 2, 3] });
    await new Promise((r) => setImmediate(r));
    expect(logger.warn).toHaveBeenCalledWith(
      'school.print.scan-unresolved',
      expect.objectContaining({ code: 'CARD_ID_UNREADABLE' }),
    );
    expect(logger.debug).not.toHaveBeenCalledWith('school.print.scan-unresolved', expect.anything());
  });
});
```

**Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/applications/school/scanLogLevels.test.mjs`
Expected: FAIL — `warn` not called; `debug` was.

**Step 3: Make the change**

In `schoolPrintScanConsumer.mjs`, change `logger.debug?.('school.print.scan-unresolved', …)` to `logger.warn?.` and widen the payload to `{ testId, testIdCandidates, code, decodedAnswerCount }` so a reader can tell a blank feed from a misread id.

In `RecordCardScanOutcome.mjs:417`, add the reasons to the awaiting-review line — without them the log says work stopped but not why:

```javascript
this.#logger.info?.('school.print.scan-awaiting-review', {
  sessionId, recordId: card.recordId, pendingReview: pending.length,
  learnerId: state.learnerId,
  reasons: pending.map((p) => p.reason),           // ambiguous | free_response
  items: pending.map((p) => p.itemId),
});
```

**Step 4: Run the test**

Run: `npx vitest run tests/unit/applications/school/scanLogLevels.test.mjs`
Expected: PASS.

**Step 5: Commit**

```bash
git add backend/src/5_composition/modules/schoolPrintScanConsumer.mjs \
        backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs \
        tests/unit/applications/school/scanLogLevels.test.mjs
git commit -m "fix(school): make unresolved scans visible in production logs"
```

---

### Task A3: Correct the LogsQL documentation

**Files:**
- Modify: `CLAUDE.md` (the "Reading Logs" section)

`| stats count() by (context.app)` is rejected by VictoriaLogs:

```
cannot parse "stats" pipe: unexpected token "(" after [count(*) as "by"]
```

Replace every occurrence with `| stats by (field) count()`, and note that dotted fields need quoting:

```bash
curl -s https://logs.kckern.net/select/logsql/query \
  -d 'query=_time:24h | stats by ("context.app") count() as n | sort by (n desc)'
```

Add the container facts from the Background section (name, retention, the three reachability routes). Commit with `docs(logging): correct LogsQL stats syntax and record the log store`.

---

## Slice B — Ambiguity leniency

**Policy (decided with KC, 2026-08-22):**

1. A multi-mark on a single-select row earns **full credit** when **exactly two** marks are present and **one of them is the correct answer** — the eraser signature.
2. Three or more marks never earn credit. Neither does a two-mark row where *both* marks are wrong.
3. A row where the marks cover **every available choice** never earns credit, regardless of count. This is what stops a true/false row (2 choices) from being auto-credited by rule 1 — marking both *is* marking everything.
4. **Tolerance: at most `max(1, floor(rowCount / 5))` credited rows per sheet.** Beyond that cap the remaining ambiguous rows fall through to the review queue as they do today — never silently zeroed.
5. Ordering is by question number, so the cap is deterministic and the earliest rows get the benefit.
6. `archetype` (`documentV2.mjs:37` — `quiz` | `worksheet` | `infopage`) selects strictness: **`worksheet` lenient, `quiz` strict** (cap 0). Low-stakes work is generous; a real quiz is not.

**The spec change is the point, not a side effect.** `ResolveCardScan.mjs:292` and `print-documents.md` §5.4 currently say a double-mark is ambiguous *"regardless of what was marked — never guessed at"*. KC has decided (2026-08-22) that a double-mark **is** permitted under the bounded conditions above, because rules 1–6 already establish that no abuse is in play: two marks with one correct is an eraser, and anything resembling shotgunning (3+ marks, all choices covered, both marks wrong, or exceeding the per-sheet cap) still earns nothing and still holds for review.

Rewrite §5.4 to state the new rule as the intended behaviour rather than an exception bolted onto a prohibition, and **amend it in the same commit as the code** — do not leave the spec and the resolver disagreeing.

### Task B1: The pure decision function

**Files:**
- Create: `backend/src/2_domains/school/documents/ambiguityLeniency.mjs`
- Test: `tests/unit/domains/school/ambiguityLeniency.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/domains/school/ambiguityLeniency.test.mjs
import { describe, it, expect } from 'vitest';
import { creditsAsEraser, leniencyCap } from '#domains/school/documents/ambiguityLeniency.mjs';

const mc4 = { type: 'multiple_choice', choiceCount: 4 };

describe('creditsAsEraser', () => {
  it('credits two marks when one is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['B', 'D'], correctLetter: 'D' })).toBe(true);
  });

  it('refuses two marks when neither is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['A', 'B'], correctLetter: 'D' })).toBe(false);
  });

  it('refuses three or more marks even when one is correct', () => {
    expect(creditsAsEraser({ item: mc4, given: ['A', 'B', 'D'], correctLetter: 'D' })).toBe(false);
  });

  it('refuses when every choice is marked (true/false double-mark)', () => {
    const tf = { type: 'true_false', choiceCount: 2 };
    expect(creditsAsEraser({ item: tf, given: ['A', 'B'], correctLetter: 'A' })).toBe(false);
  });
});

describe('leniencyCap', () => {
  it('gives a short worksheet one free pass', () => {
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 6 })).toBe(1);
  });

  it('scales at one in five', () => {
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 10 })).toBe(2);
    expect(leniencyCap({ archetype: 'worksheet', rowCount: 20 })).toBe(4);
  });

  it('is strict for a quiz', () => {
    expect(leniencyCap({ archetype: 'quiz', rowCount: 20 })).toBe(0);
  });
});
```

**Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/domains/school/ambiguityLeniency.test.mjs`
Expected: FAIL — module not found.

**Step 3: Implement**

```javascript
// backend/src/2_domains/school/documents/ambiguityLeniency.mjs
/**
 * Bounded leniency for multi-mark rows (2026-08-22 policy).
 *
 * A child who erases one bubble and fills another often leaves enough graphite
 * for the reader to see both. That is an eraser, not a guess, and it used to
 * cost the whole question AND stall the sheet in the review queue. Two marks
 * with one correct is credited; anything that looks like shotgunning is not.
 */
const LENIENT_ARCHETYPES = new Set(['worksheet']);

export function creditsAsEraser({ item, given, correctLetter } = {}) {
  if (!Array.isArray(given) || given.length !== 2) return false;
  if (!correctLetter) return false;
  const choiceCount = Number(item?.choiceCount) || 0;
  // Marking every choice is marking everything — never an eraser.
  if (choiceCount > 0 && given.length >= choiceCount) return false;
  return given.includes(correctLetter);
}

export function leniencyCap({ archetype, rowCount } = {}) {
  if (!LENIENT_ARCHETYPES.has(archetype)) return 0;
  const rows = Number(rowCount) || 0;
  if (rows <= 0) return 0;
  return Math.max(1, Math.floor(rows / 5));
}

export default { creditsAsEraser, leniencyCap };
```

**Step 4: Run the test**

Run: `npx vitest run tests/unit/domains/school/ambiguityLeniency.test.mjs`
Expected: PASS (7 tests).

**Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/ambiguityLeniency.mjs \
        tests/unit/domains/school/ambiguityLeniency.test.mjs
git commit -m "feat(school): add bounded eraser-leniency rules for multi-mark rows"
```

---

### Task B2: Apply leniency in the resolver

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs` (`gradeRow` ~`:272-300`, and its caller)
- Modify: `docs/reference/school/print-documents.md` §5.4
- Test: `tests/unit/applications/school/resolveCardScanLeniency.test.mjs`

`gradeRow` currently grades one row with no knowledge of the sheet, so the per-sheet cap cannot live inside it. Grade rows first, then run a second pass that promotes eligible `ambiguous` rows to `correct` until the cap is spent.

**Step 1: Write the failing test**

Cover: (a) a lenient worksheet promotes the eraser row and reaches full credit; (b) the promoted row is `gradedBy: 'engine-leniency'`; (c) a second eligible row on a 6-row worksheet stays `ambiguous` because the cap is 1; (d) a `quiz` archetype promotes nothing.

**Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/applications/school/resolveCardScanLeniency.test.mjs`
Expected: FAIL — rows stay `ambiguous`.

**Step 3: Implement the second pass**

Leave `gradeRow` alone (it stays a pure per-row function). After the rows are graded, add:

```javascript
import { creditsAsEraser, leniencyCap } from '#domains/school/documents/ambiguityLeniency.mjs';

/**
 * Promote eraser-signature rows to `correct`, cheapest-explanation first and
 * capped per sheet. Runs AFTER per-row grading because the cap is a property
 * of the sheet, not the row.
 */
function applyLeniency({ results, archetype, itemsById, logger }) {
  let budget = leniencyCap({ archetype, rowCount: results.length });
  if (budget <= 0) return results;
  return results
    .slice()
    .sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
    .map((row) => {
      if (row.status !== 'ambiguous' || budget <= 0) return row;
      const item = itemsById.get(row.itemId);
      const correctLetter = correctLetterFor(item);   // reuse letterToChoice/gradeAnswer
      if (!creditsAsEraser({ item, given: row.given, correctLetter })) return row;
      budget -= 1;
      logger?.info?.('school.print.scan-leniency-applied', {
        itemId: row.itemId, given: row.given, correctLetter, remainingBudget: budget,
      });
      return { ...row, status: 'correct', earned: row.points, leniency: 'eraser' };
    });
}
```

Write `correctLetterFor(item)` next to the existing `letterToChoice` — it is that mapping inverted against `item.answer`. When the letter cannot be derived, return `null` so `creditsAsEraser` refuses; never guess.

Carry `leniency: 'eraser'` into the verdict written by `RecordCardScanOutcome` so a promoted row is auditable, and set `gradedBy: 'engine-leniency'` rather than plain `'engine'`.

**Step 4: Run the test**

Run: `npx vitest run tests/unit/applications/school/resolveCardScanLeniency.test.mjs`
Expected: PASS.

**Step 5: Run the whole school suite for regressions**

Run: `npx vitest run tests/unit/domains/school/ tests/unit/applications/school/`
Expected: PASS. `RecordCardScanOutcome.test.mjs:542` (*"an ambiguous row holds at submitted"*) asserts the old behaviour — it must keep passing by using a **non-lenient** fixture (a `quiz` archetype, or two-marks-both-wrong). Update the fixture; do not delete the test. The hold-at-submitted path still matters for genuinely unresolvable rows.

**Step 6: Amend the spec**

Rewrite `print-documents.md` §5.4's *"never guessed at"* paragraph to state the new rule and its bounds, and note that everything outside the eraser signature still holds at `submitted`.

**Step 7: Commit**

```bash
git add backend/src/3_applications/school/documents/ResolveCardScan.mjs \
        backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs \
        docs/reference/school/print-documents.md \
        tests/unit/applications/school/
git commit -m "feat(school): credit eraser-signature multi-marks within a per-sheet cap"
```

---

## Slice C — Broadcast scan outcomes

`createSchoolPrintScanConsumer` is documented **subscribe-only** (`eventBus` — *"IEventBus (subscribe only)"*). The ceremony needs outcomes on the wire, so this is a deliberate widening of that contract: update the JSDoc rather than quietly breaking it.

### Task C1: Publish outcomes on the `omr` topic

**Files:**
- Modify: `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs`
- Test: `tests/unit/applications/school/scanOutcomeBroadcast.test.mjs`

Emit one message per terminal outcome, reusing the topic the relay already broadcasts on (`omr`) so the frontend needs no new transport:

| `event` | When | Payload |
|---|---|---|
| `scan-graded` | session reached `graded` | `learnerId, earnedPoints, totalPoints, percent, result` |
| `scan-review` | held at `awaiting-review` | `learnerId, pendingReview, reasons, items` |
| `scan-unresolved` | resolver error | `code, testId, testIdCandidates` |
| `scan-refused` | per-record refusal | `code, recordId` |

`reader-error` already broadcasts from `omrRelay.mjs:188` — do not duplicate it.

Write the test first (assert `eventBus.broadcast` called with the right topic and shape for each branch), watch it fail, implement, watch it pass, commit as `feat(school): broadcast paper-scan outcomes on the omr bus`.

---

## Slice D — The scan ceremony in the School panel

**Requirement (KC):** a scan must always be acknowledged on screen. Success already prints, so the screen matters most on failure — a sound plus plain words naming what went wrong. This is the locked self-service panel, where a child has no other feedback channel.

### Task D1: `useScanCeremony`

**Files:**
- Create: `frontend/src/modules/School/selfService/useScanCeremony.js`
- Test: `frontend/src/modules/School/selfService/useScanCeremony.test.js`

Subscribe to topic `omr` with `useWebSocketSubscription` (the exact pattern in `useSchoolLaunch.js`). Map each message to `{ tone: 'success'|'warn'|'error', title, detail, at }`. Auto-clear after ~12s; a new scan replaces the current one.

Copy — plain, child-readable, never blaming:

| Event | Title | Detail |
|---|---|---|
| `scan-graded` | "Scored!" | "{n} of {m} right — your sheet is printing." |
| `scan-review` | "Needs a grown-up" | "Question {q} had two answers filled in. Ask a grown-up to check it." |
| `scan-unresolved` | "Couldn't read that sheet" | "The student number didn't come through. Try scanning again, slowly." |
| `scan-refused` | "That sheet doesn't match" | "This paper doesn't line up with what's on file. Ask a grown-up." |
| `reader-error` | "Scanner hiccup" | "The scanner didn't catch that. Feed the sheet again." |

Log every ceremony through the existing facade — add `scan: (detail, data) => emit('scan', detail, data)` to `frontend/src/modules/School/schoolLog.js` (per `CLAUDE.md`, no raw `console.*`).

TDD as above: failing test → implement → pass → commit.

### Task D2: `ScanCeremony` component + sound

**Files:**
- Create: `frontend/src/modules/School/selfService/ScanCeremony.jsx`
- Modify: `frontend/src/modules/School/School.scss`

An `role="status"` banner over the keypad/launch card, tone-coloured, large enough to read across the room.

**The target device — measured, not assumed.** The school panel is the **Facebook Portal 10"** (`data/household/screens/portal.yml`), Android 9, FullyKiosk 1.60.1-play at **10.0.0.92**, Chrome 131 WebView, 1280×800, mounted at `/screens/portal` with `school: { mode: locked }`. It has built-in speakers.

**This has nothing to do with the garage Firefox kiosk.** An earlier draft of this plan wrongly imported that machine's autoplay constraint. Probed on the Portal's own FKB REST API on 2026-08-22:

```
autoplayAudio:   True
autoplayVideos:  True
resumeVideoAudio: True
```

FKB is configured to permit autoplay, so a programmatic `new Audio().play()` on a scan event should sound **without** needing a prior gesture. No unlock shim is required. Still confirm on the panel once — a WebView flag permitting autoplay and audio actually reaching the speaker are two different claims.

Two things that do matter here:

- **Respect the SPA software master.** `portal.yml` defines `volume.defaultMaster: 0.6` with a custom curve; the panel's volume keys drive it through the `portalKeys` APK. Route the cue through the same master rather than playing at raw full volume, or the ceremony will be the loudest thing in the room.
- **Do not use the FKB alarm path.** `playAlarmSoundOnMovement` / `alarmSoundFileUrl` are a different subsystem with its own volume, and the Portal's Control Center already had to be disabled once for playing tones on the assistant audio path (see `portal.yml`).

Distinct tones: a short rising pair for success, a low double-buzz for error.

### Task D3: Mount it

**Files:**
- Modify: `frontend/src/modules/School/SchoolApp.jsx`

Mount inside `<main className="school-app__body">` so it renders in **both** locked and unlocked modes — a scan can land either way. Place it as a sibling of the lock branch (near `SchoolApp.jsx:668`), not inside it.

```jsx
const ceremony = useScanCeremony();
…
<main className="school-app__body">
  {ceremony.current && <ScanCeremony {...ceremony.current} onDismiss={ceremony.clear} />}
  {/* existing lock branch and runners unchanged */}
```

Manual verification (nothing here is provable from unit tests alone):
1. `ssh homeserver.local` and confirm the panel is on `/screens/portal`.
2. Feed a good sheet → receipt prints **and** the success banner shows.
3. Feed a sheet with a deliberate double-bubble in one row → banner says needs-a-grown-up.
4. Feed a blank/upside-down sheet → unreadable banner, and confirm `school.print.scan-unresolved` now appears at `warn` in the store.

Commit each task separately.

---

## Slice E — Stale session resumption

> **CORRECTION (verified 2026-08-22, after the first draft of this plan).** An
> earlier version of this slice claimed Learner4's worksheet had *two conflicting
> live card allocations* and called it a mis-scoring hazard. **That was wrong.**
> Card records carry a `status` field and only one allocation is live:
>
> | Card | Rows | Status |
> |---|---|---|
> | `3598689` | 1–10 | `released` |
> | `5922785` | 7–16 | **`live`** |
>
> A full sweep of `artifacts/print/cards/` found every duplicate base resolves
> to at most one `live` record. **No data is corrupt and no repair is needed** —
> KC's authorisation to repair data is noted and unspent. Do not write a
> migration for this.

### What actually went wrong

Learner4's session `ses_f6Buxumv` was **created 2026-08-14 and never submitted**,
then silently resumed eight days later. Everything he saw follows from that:

- The **student number changed** because his one live allocation is card
  `5922785`, minted 2026-08-14 — not the card he had most recently seen.
- The sheet **starts at question 7** because that allocation is rows 7–16: when
  it was minted, `arts/creature-identification/quiz-1` held rows 1–6 of the same
  physical card. Correct behaviour for that allocation, bewildering eight days
  later with no memory of the context.
- **"PRINT IT AGAIN" was truthful** — same `artifactId`, genuinely printed
  before (three times on 08-14). Print-again is already artifact-scoped
  (`sessionEvents.mjs:318-320` refuses a reprint whose artifact was never
  issued). **Do not rework print-again scoping.**

So the bug is not allocation and not the label. It is that a week-old session
can resume as if it were today's work.

### Task E1: Find out why the stale sweep missed it

**Files:**
- Read: `backend/src/5_composition/modules/schoolLifecycle.mjs` (`markSessionAbandoned` wiring)
- Read: the stale-work sweep route ("admin advocacy A5")

There is already a `markSessionAbandoned` use case and a stale-work sweep. An
8-day-old `issued` session should have been caught. Determine whether the sweep
never runs, runs with too long a threshold, or skips `issued`/`reprinted` states.

**Report the finding before changing behaviour.** The fix may be a config
threshold rather than code, and auto-abandoning sessions is destructive if it
fires too eagerly — a child mid-worksheet must not have it yanked.

### Task E2: Make a resumed session say so

**Files:**
- Modify: the agenda/offer path that resolves an existing session (trace from
  `school.selfservice.code.resolved`, which already logs `state: 'reprinted'`)
- Test: `tests/unit/applications/school/staleSessionOffer.test.mjs`

Whatever the sweep decides, a reprint of work issued days ago should not present
itself as fresh. Add the issue date to the offer so the paper carries it:

```
PRINT IT AGAIN · Unit 0 · 1/1
Started Thu 14 Aug · questions 7-16
```

Naming the row range is what would have made Learner4's sheet legible without
anyone reading a log. Add a `school.session.stale-resume` `info` log with
`{ sessionId, learnerId, ageDays, rowRange }` so the household can see how often
this happens.

### Task E3: Keep the duplicate check as a guard, not a repair

**Files:**
- Create: `cli/school-allocation-audit.cli.mjs`

The data is clean today, but nothing *enforces* the one-live-allocation
invariant. Ship the audit read-only as a standing check rather than a migration:
group `artifacts/print/cards/*.yml` by `recordId` base and report any base with
**more than one `live`** record. Expected output today: zero.

Add a `school.print.allocation-duplicate` `warn` at mint time if a second `live`
allocation is ever created for one `@rev:variant`. That is the guard that would
turn this from an archaeology exercise into an alert.


## Slice F — Thermal printer wire integrity

Three reported symptoms; **two of them are one bug.**

### The truncation and the offset are the same defect

`ThermalPrinterAdapter.#executePrintJob` (`:678-686`) builds the entire job into one Buffer and then:

```javascript
device.write(commands);

setTimeout(() => {
  device.close();
  this.#logger.info?.('thermalPrinter.job.complete', { duration: Date.now() - startTime });
  resolve(true);
}, 1000);
```

Every part of that is unsafe:

1. **The flush callback is discarded.** `escpos-network` defines `write(data, callback)` and passes the callback straight to `net.Socket.write` — it is available and ignored.
2. **`close()` is a hard destroy.** The library's `close` calls `this.device.destroy()`, not `end()`. Destroying a socket discards whatever is still queued in userspace.
3. **1000 ms is a guess, not a completion signal.** A thermal printer applies TCP backpressure — it accepts bytes at printing speed. A raster receipt (Learner4's laser equivalent was 255 KB; the School receipt path renders `{type:'image'}`) cannot flush in a second, so `socket.write` queues the remainder and the timer destroys it.
4. **`resolve(true)` is unconditional.** `thermalPrinter.job.complete` is emitted even when the paper is half-printed, which is why every logged `duration` clusters at ~1.2 s regardless of job size. The success signal in the logs is meaningless today.

**Why the next receipt prints shifted.** Truncation lands mid-`GS v 0` raster, with the printer still counting down an expected byte total. The following job's `ESC @` initialise bytes are consumed as bitmap payload instead of being parsed as a command, so the parser stays desynchronised and rows render horizontally rotated — the reported "left 15% cut off, printing on the right". This is why the corruption appeared on Learner3's *agenda*, the job after the long one. It is not a printer memory fault; it is our contract.

### Task F1: Wait for the flush, close cleanly

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs:678-686`
- Test: `tests/unit/adapters/hardware/thermalPrinterFlush.test.mjs`

**Step 1: Write the failing test**

Use a fake device exposing `open/write/close` where `write` holds its callback so the test can assert the adapter has *not* closed yet. Assert: (a) `close` is not called before the write callback fires; (b) `job.complete` is not logged before it either; (c) a write error resolves `false`, not `true`.

**Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/adapters/hardware/thermalPrinterFlush.test.mjs`
Expected: FAIL — `close` called on the timer while the write is still outstanding.

**Step 3: Implement**

```javascript
await new Promise((resolveWrite, rejectWrite) => {
  device.write(commands, (err) => (err ? rejectWrite(err) : resolveWrite()));
});

// The callback fires when the bytes leave OUR buffer. Give the printer a
// brief, size-scaled grace period to drain its own before dropping the
// socket — escpos-network's close() is a destroy(), so anything still in
// flight would be discarded.
const drainMs = Math.min(15000, 500 + Math.ceil(commands.length / 1024) * 20);
await new Promise((r) => setTimeout(r, drainMs));

device.close();
this.#logger.info?.('thermalPrinter.job.complete', {
  duration: Date.now() - startTime, bytes: commands.length, drainMs,
});
resolve(true);
```

Log `bytes` — without payload size in the logs there is no way to correlate a bad print with a big job, which is exactly what made this hard to see.

**Step 4: Run the test**

Run: `npx vitest run tests/unit/adapters/hardware/thermalPrinterFlush.test.mjs`
Expected: PASS.

**Step 5: Verify on real hardware**

Print the longest receipt available (a full worksheet result) and confirm it completes, then immediately print an agenda and confirm it is **not** shifted. The second print is the real test — the offset only shows on the job *after* a truncated one.

**Step 6: Commit**

```bash
git add backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs \
        tests/unit/adapters/hardware/thermalPrinterFlush.test.mjs
git commit -m "fix(thermal): wait for flush before destroying the socket

A fixed 1000ms timer closed the socket mid-write on long jobs. Because
escpos-network's close() is a destroy(), the queued remainder was dropped:
the receipt truncated, and the printer — left mid-raster — rendered the
NEXT job horizontally shifted."
```

### Task F2: Resynchronise defensively

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs`

Even with F1, a mid-job power blip or cable knock can strand the printer mid-raster. Prefix each job with a short run of `NUL` padding **before** `ESC @`, so a printer still counting raster bytes consumes the padding and then meets a clean initialise. Cheap insurance; harmless when the parser is already idle.

Verify a deliberately truncated job (kill the socket mid-write) still leaves the *next* print correctly aligned.

### Task F3: The check mark never prints

**Files:**
- Modify: `backend/src/1_adapters/hardware/thermal-printer/escposEncode.mjs:26-35`
- Test: `tests/unit/adapters/hardware/escposEncode.test.mjs`

`DocumentEscPosRenderer.mjs:132` emits `[✓]` for a correct answer and `[×]` for a wrong one:

```javascript
content: Array.from({ length: block.totalCount },
  (_, index) => (index < block.correctCount ? '[✓]' : '[×]')).join(' ')
```

`✓` (U+2713) is **not in CP858**. `encodeText` maps it to iconv's `0x3F` replacement and then deliberately drops it (`:56`), so a correct answer prints as an empty `[]` while a wrong one prints `[×]` — `×` (U+00D7) *is* in CP858. The mark row is therefore both broken and backwards-looking.

Fix in the transliteration table, which is exactly the mechanism this case was built for:

```javascript
'✓': '√',   // U+2713 → U+221A, a real CP858 ROM glyph (0xFB) that reads as a check
'✗': 'x',
'☐': '[ ]',
'☑': '[√]',
```

Add a regression test asserting `encodeText('[✓]')` yields three bytes ending `0xFB` before `]`, and a broader test that **no printable glyph silently vanishes** — iterate the characters the receipt renderers actually emit and assert each encodes to at least one byte. The silent-drop rule at `:56` is right for emoji but it is what let this ship, so the guard belongs in a test.

Commit as `fix(thermal): print the check mark instead of dropping it`.

---

## Slice G — Agenda print cooldown

**Requirement (KC):** children tap the NFC card repeatedly and the printer fires every time. Suppress a repeat agenda print within a configurable window; **15 minutes** is the starting value.

The logs show the pattern plainly — Learner1 at 15:02:33, 15:04:00, 15:05:29, 15:07:09 (four prints in under five minutes), Learner2 at 15:06:22 and 15:08:03, every one of them printing the same "Nothing is assigned right now."

### Task G1: Config-driven cooldown

**Files:**
- Modify: `data/household/school/school.yml` (add the policy block)
- Modify: the agenda path behind `school.card.agenda-printed` (trace from `nfc.tap.school_card` in the `nfc-tap` module through `schoolLifecycle.mjs`)
- Test: `tests/unit/applications/school/agendaCooldown.test.mjs`

Config:

```yaml
# data/household/school/school.yml
agenda:
  # Repeat taps inside this window reprint nothing — the child already has
  # the paper. 0 disables the cooldown.
  cooldownMinutes: 15
```

**Rules:**

1. Key the cooldown on **learnerId**, not card UID — a learner with two cards is still one child.
2. Persist `lastAgendaPrintedAt` per learner so it survives a container restart. A restart currently reopens the floodgate.
3. **Suppression must still acknowledge the tap.** A child who taps and gets *nothing* will tap harder — that is the behaviour we are trying to stop. Reuse Slice D's ceremony: broadcast a `agenda-suppressed` event so the panel says "You already have today's agenda — check your desk." No paper, but a response.
4. **Bypass when the agenda content has changed** since the last print (new offers, a completed session). Reprinting genuinely new work is not abuse. Compare the rendered agenda's content hash; when it differs, print and reset the clock.
5. Log `school.card.agenda-suppressed` at `info` with `{ learnerId, sinceMinutes, cooldownMinutes }` so the household can see whether 15 minutes is the right number.

Rule 4 is what keeps this from being a blunt instrument — without it, a child who finishes a worksheet and taps for their next assignment gets stonewalled.

**Step 1:** Write the failing test — a second tap inside the window with identical content does not print; outside the window it does; changed content prints regardless of the window.
**Step 2:** Run it, watch it fail.
**Step 3:** Implement.
**Step 4:** Run it, watch it pass.
**Step 5:** Commit as `feat(school): cool down repeat agenda prints`.

---

## Slice H — Bind every QR to its keypad code

**Requirement (KC):** a QR code and its six-digit panel code are one affordance. The code must sit *with* its QR, never as a footnote at the bottom of the slip.

### What is actually wrong

The agenda already pairs them per section (`receipts.mjs:306` pushes `panelCodeBlocks` immediately after the tokened `lessonAction`), which is why Learner4's single-offer slip looked right:

```
PRINT IT AGAIN · Unit 0 · 1/1
sch:9EYZXPZUGUNGFSFV
PANEL CODE 579078
```

Two real defects sit underneath that:

1. **The result receipt emits QR tokens with no code at all.** `resultReceipt` pushes `lessonAction({ token })` and `{type:'scan_action', action: token}` and never calls `panelCodeBlocks`. Learner3's printed receipt carried `sch:XAXYT6X849DUPEVX` under "Scan to print the next worksheet" with nothing to type. On a panel where scanning is awkward, that QR is a dead end.
2. **The pairing is keyed to the wrong thing.** `accessCodesBySubject?.[section.subject]` maps codes by *subject*, while QRs are minted per *token*. Two offers in one subject cannot each get their own code, and nothing structurally prevents a QR from rendering codeless — it is a convention, not an invariant.

### Task H1: Make the pairing structural

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs` (`panelCodeBlocks`, `lessonAction`, the agenda section loop, `resultReceipt`)
- Test: `tests/unit/domains/school/receiptQrCodePairing.test.mjs`

Re-key codes from subject to **token** (`accessCodesByToken`), then make the QR block itself own the code so the two cannot be separated. Emitting a scannable token should *require* its code, rather than relying on a caller to remember a second push.

**Step 1: Write the failing test — the invariant, not the layout**

```javascript
// tests/unit/domains/school/receiptQrCodePairing.test.mjs
import { describe, it, expect } from 'vitest';
import { agendaReceipt, resultReceipt } from '#domains/school/documents/receipts.mjs';

/** Every scannable block must be followed by its own PANEL CODE line. */
function assertEveryQrHasAdjacentCode(blocks) {
  const flat = JSON.stringify(blocks);
  const qrCount = (flat.match(/scan_action|lesson_action/g) || []).length;
  const codeCount = (flat.match(/PANEL CODE/g) || []).length;
  expect(codeCount).toBe(qrCount);
}

describe('QR / panel-code pairing', () => {
  it('pairs them on a result receipt (regression: Learner3, 2026-08-22)', () => {
    const r = resultReceipt({
      sessionId: 'ses_x', unitTitle: 'The United States', result: 'passed', percent: 100,
      actions: [{ token: 'XAXYT6X849DUPEVX', label: 'Scan to print the next worksheet',
                  presentation: 'lesson', accessCode: '123456' }],
    });
    assertEveryQrHasAdjacentCode(r.blocks);
  });

  it('gives two offers in ONE subject two distinct codes', () => { /* … */ });

  it('never prints a bare code with no QR above it', () => { /* … */ });
});
```

Assert the **invariant** (counts match, order is QR-then-code), not exact strings — a layout tweak should not break the test, but a codeless QR must.

**Step 2:** Run it, watch it fail — the result-receipt case reports 1 QR / 0 codes.

**Step 3: Implement**

Give `lessonAction`/`scan_action` an `accessCode` field and emit the code line as part of the same block group. Thread `accessCodesByToken` through the agenda loop and into `resultReceipt` (which does not receive codes at all today — the caller in `CloseSessionOutcome`/`ReceiptPrinting` must mint one for the next-up token, the same way the agenda path already does).

Where no code can be minted, print the QR **with an explicit line saying scanning is the only way in** rather than leaving a silent gap — a missing code should be visible, not invisible.

**Step 4:** Run the test, watch it pass.

**Step 5:** Check the renderers still lay it out sanely — `DocumentEscPosRenderer.mjs` and `DocumentReceiptRenderer.mjs` both consume these blocks; a new nested shape may need handling in each. Print one of each receipt type on real paper before calling it done.

**Step 6: Commit**

```bash
git add backend/src/2_domains/school/documents/receipts.mjs \
        backend/src/1_rendering/school/documents/ \
        tests/unit/domains/school/receiptQrCodePairing.test.mjs
git commit -m "fix(school): bind every printed QR to its own keypad code

The result receipt printed a scannable token with nothing to type, and
agenda codes were keyed by subject while QRs are minted per token."
```

---

## Out of scope, worth fixing separately

**The result receipt prints a literal `undefined · undefined of undefined`.** Observed in Learner3's slip between "Passing is 80%" and "NOTES FOR YOU". A template hole in the receipt renderer that reaches every child. Trace from `CloseSessionOutcome.#printed` (`:351`) into the receipt document builder.

**Reviewer notes are child-facing.** The note written for the record ("Two bubbles marked (B, D)…") printed to Learner3 under "NOTES FOR YOU". Anything Slice B auto-generates will land in front of a child — either keep such notes machine-only or word them for the reader.

---

## The 5-minute hardware ritual

**Most of these no longer need the school room.** `cli/school/sim.mjs` runs the
real use cases against throwaway state, so six of the seven were verified from
a terminal on 2026-08-23 — see each line. The commands:

```
node cli/school.mjs sim --subject civilization --course young-peoples-atlas-us --lower learner3 --lesson atlas-us-p006-united-states.yml --self-service
node cli/school.mjs sim --subject civilization --course young-peoples-atlas-us --lower learner3 --lesson atlas-us-p006-united-states.yml --double-bubble
node cli/school.mjs sim --subject civilization --course young-peoples-atlas-us --lower learner3 --lesson atlas-us-p006-united-states.yml --triple-bubble
node cli/school.mjs sim --subject civilization --course young-peoples-atlas-us --lower learner3 --lesson atlas-us-p006-united-states.yml --tap
```

Getting there needed the sim repaired first: it had a hardcoded macOS data
path, walked a `units/<unit>/lessons/` course layout no course uses any more,
read `courses` where the on-disk key is `enrollments`, and crashed on its own
documented single-learner invocation (d68e890e7). `--self-service`,
`--double-bubble`/`--triple-bubble` and `--tap` were added because the
properties they check could not otherwise be exercised at all.

The ONE item that still wants a person is the unreadable-sheet BANNER: a
pixel on a panel is not a thing a CLI can see.

The original note follows.

Most of the 👤 items fall out of ONE pass at the school room, and it is worth
doing deliberately rather than waiting to notice a defect in the wild:

1. Feed a clean, correctly-filled sheet → receipt prints, marks visible.
2. Feed a sheet with ONE row double-bubbled, one of the two correct → grades
   full credit and prints, no grown-up step (Slice B).
3. Feed a sheet with THREE bubbles in a row → holds for review, panel says so
   (Slices B + D).
4. Feed a blank or upside-down sheet → panel says it could not be read, and a
   `warn` lands in the store (Slices C + D + A).
5. Tap a school card twice within the cooldown → second tap prints nothing but
   the panel acknowledges it (Slice G).

That covers B, C, D, F and G against real hardware in one visit.

## Verification checklist

- [ ] `npx vitest run tests/unit/system/logging/ tests/unit/domains/school/ tests/unit/applications/school/` passes
- [ ] `npm run audit:layers` passes — no new cross-layer imports (`2_domains` must not reach up)
- [ ] `npm run test:refactor` passes
- [x] A backend event queried at `_time:5m` returns during a live session — DONE (drift measured at 0ms)
- [x] ✅ A double-bubble worksheet row with one correct answer prints a receipt with no human step — VERIFIED 2026-08-23 via `school sim --double-bubble`: row grades `status: correct`, 1/1, no review flag
- [x] ✅ A three-bubble row still holds for review — VERIFIED 2026-08-23 via `school sim --triple-bubble`: row grades `status: ambiguous`, 0/1
- [ ] 👤 An unreadable sheet raises a banner on the panel *and* a `warn` in the store — the `warn`/broadcast half is covered by `schoolPrintScanConsumer.test.mjs`; the BANNER still needs eyes on the panel, which is the only part of this list that genuinely does
- [ ] The allocation audit reports zero bases with more than one LIVE record (expected: already true)
- [ ] A resumed session older than a day prints its issue date and row range
- [x] 👤 A long receipt prints to completion, and the job printed **immediately after** it is not shifted — DONE, verified on paper 2026-08-22
- [x] `thermalPrinter.job.complete` logs real `bytes` and only after the flush callback — DONE
- [x] ✅ A correct answer prints a visible check glyph, not `[]` — VERIFIED 2026-08-23 on paper (Learner4's and Learner3's reprinted result cards) and in `school sim`'s rendered receipt
- [x] ✅ A second card tap inside the cooldown prints nothing but still says something — VERIFIED 2026-08-23 via `school sim --tap`: `agenda_suppressed`, zero paper, message "You already have today's agenda — check your desk."
- [x] ✅ A tap after new work is assigned still prints, cooldown notwithstanding — VERIFIED 2026-08-23 via `school sim --tap`: a changed agenda fingerprint prints again inside the window
- [x] ✅ Every printed QR — agenda **and** result receipt — has its own code beside it — VERIFIED 2026-08-23 via `school sim --self-service` (agenda QR + next-up QR each carry their own six digits) and on paper. NOTE: the code is drawn UNDER the QR inside the card, not as a text block after it (6642037b5)
