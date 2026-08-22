# OMR Grading Integrity, Scan Ceremony & Print-Again Correctness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a scanned OMR sheet always produce a visible outcome — credit a legitimate eraser instead of parking silently, announce every failure on the school screen, close the logging blind spots that hid all of this, and fix the card-allocation bug that gave one learner two conflicting row mappings for the same worksheet.

**Architecture:** Five independent slices over the existing paper pipeline (`omrRelay → quizScanRecorder → ResolveCardScan → RecordCardScanOutcome → CloseSessionOutcome`). Slice A fixes log fidelity so the rest is observable. Slice B adds a bounded leniency rule at the one place the verdict is decided. Slice C broadcasts scan outcomes on the existing `omr` event-bus topic. Slice D consumes that broadcast in the locked School panel as an audible/visible ceremony. Slice E repairs card allocation. Slices are ordered so each is independently shippable.

**Tech Stack:** Node ESM backend (DDD layers `0_system` → `5_composition`), Vitest, React 18 frontend, VictoriaLogs (`logs.kckern.net`), existing `eventBus` WS bridge, `useWebSocketSubscription`.

---

## Background: what actually happened on 2026-08-22

Three separate defects surfaced in one school session. All three are evidenced; do not re-derive them.

### Incident 1 — Milo's sheet graded 5/6 then went silent

Log chain (local time):

```
15:15:40  quiz.decode.sheet            testId 4071314, answered 6
15:15:40  school.print.scan-resolved   learner milo, 5/6, cardIdInferred null
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

### Incident 3 — Felix's reprint changed physical identity

Felix's session `ses_f6Buxumv` was **created 2026-08-14** and never submitted. On 2026-08-22 it was reprinted an 8-day-old artifact. Session events (all carrying the *same* `artifactId`):

```
2026-08-14T16:28  created
2026-08-14T17:55  issued      civilization/young-peoples-atlas-us/ws-ses-f6buxumv
2026-08-14T20:25  reprinted   (same artifactId)
2026-08-14T23:40  reprinted   (same artifactId, confirmed)
2026-08-22T22:00  reprinted   (same artifactId, confirmed)
```

**The "PRINT IT AGAIN" label was correct** — same artifact, genuinely printed before. The `reprinted` event already validates artifact identity (`sessionEvents.mjs:318-320`: *"reprinted artifactId … was never issued (a reprint reuses the original)"*). So print-again is **already artifact-scoped, not lesson-scoped**. The original hypothesis does not hold and must not be "fixed".

The real defect is one layer down. The same artifact+revision has **two conflicting card allocations**:

| Card file | recordId | Rows | Created |
|---|---|---|---|
| `cards/3598689.yml` | `…ws-ses-f6buxumv@657194d82:v0:1-10` | 1–10 | 2026-08-19 |
| `cards/5922785.yml` | `…ws-ses-f6buxumv@657194d82:v0:7-16` | 7–16 (sharing rows 1–6 with `arts/pokemon-identification/quiz-1`) | 2026-08-14 |

That is why Felix saw a different student number and was told to start at question 7. Both allocations are live for one `@rev:variant`.

**This is a grading-correctness hazard, not only a UX wart.** If the child fills the 1–10 card but the scan resolves through the 7–16 mapping, every answer is scored against the wrong question. `ResolveCardScan` has a `rowMappingDrifted` guard (`:256`) that may refuse the record — refusal is safer than mis-scoring, but it is another silent stop.

Also confirmed working and **not** to be changed: Milo (`profile` 6-item set) and Felix (`profile: upper`, 10 items) correctly received different content for the same unit.

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

This intentionally changes documented behaviour: `ResolveCardScan.mjs:292` says a double-mark is ambiguous *"regardless of what was marked — never guessed at (spec §5.4)"*. **Amend `docs/reference/school/print-documents.md` §5.4 in the same commit** — do not leave code and spec disagreeing.

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

**Autoplay warning — read before writing the sound.** The garage Firefox kiosk blocks audible autoplay until a user gesture (`CLAUDE.local.md`), and the Portal WebView is gesture-poor. On the school panel the scan itself is *not* a DOM gesture, so a bare `new Audio().play()` may never sound. Either reuse the existing cue-unlock helper (`installCueAudioUnlock`, used by Fitness) primed by the keypad taps the child already makes, or use a WebAudio oscillator beep from a context resumed on the first keypad press. **Verify on the real panel — do not assume it plays.**

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

## Slice E — Card allocation integrity

The highest-severity item: it can mis-score a child's work.

### Task E1: Reproduce the duplicate allocation

**Files:**
- Test: `tests/unit/domains/school/allocationUniqueness.test.mjs`

Write a failing test asserting that one `recordId` base (`<documentId>@<rev>:v<variant>`) resolves to **at most one** live card allocation. Reproduce with the real shape from the incident: the same `…ws-ses-f6buxumv@657194d82:v0` at rows `1-10` on one card and `7-16` on another.

**Do not guess the allocation-store API.** Read `backend/src/2_domains/school/documents/allocation.mjs` and the `allocationStore` wired in `5_composition/modules/schoolLifecycle.mjs` (`stores.allocationStore`) first, then write the test against the real interface.

### Task E2: Decide and implement the rule

Two candidate rules — **confirm with KC before implementing**, since they trade off differently:

- **(i) Reprint reuses the original allocation.** Matches what `sessionEvents.mjs:320` already promises (*"a reprint reuses the original"*) — same card id, same rows, same student number every time. Best for the child: the paper is identical. Needs the mint path to look up an existing live allocation before packing a new one.
- **(ii) Minting a new allocation retires the old.** Keeps card packing free but makes the newest allocation authoritative and marks the previous one superseded so a stale sheet is refused rather than mis-scored.

Recommendation: **(i)**, with (ii)'s supersede marker as the safety net for allocations that already exist in the wild.

Add a `school.print.allocation-duplicate` `warn` whenever a mint finds a live allocation for the same `@rev:variant` — this is how the household finds out it happened again.

### Task E3: Audit and repair existing data

**Files:**
- Create: `cli/school-allocation-audit.cli.mjs`

Read-only by default: walk `data/household/school/artifacts/print/cards/*.yml`, group by `recordId` base, report every base with more than one live card. `--fix` retires all but the most recent per the Task E2 rule.

Run it against the live tree and report the count before fixing anything:

```bash
node cli/school-allocation-audit.cli.mjs
```

Felix's `ws-ses-f6buxumv@657194d82:v0` (cards `3598689` and `5922785`) must appear. **Do not `--fix` prod without KC's go-ahead** — retiring the wrong card invalidates paper that may be sitting on a desk.

### Task E4: Stale-session hygiene (investigate, then propose)

Felix's session sat unfinished for 8 days and then silently resumed, handing him week-old work. There is already a `markSessionAbandoned` use case (`schoolLifecycle.mjs`) and a *"stale-work sweep (admin advocacy A5)"* route.

Find out why the sweep did not catch this session. **Report the finding before changing behaviour** — the fix might be a config threshold rather than code, and auto-abandoning live sessions is destructive if it fires too eagerly.

---

## Out of scope, worth fixing separately

**The result receipt prints a literal `undefined · undefined of undefined`.** Observed in Milo's slip between "Passing is 80%" and "NOTES FOR YOU". A template hole in the receipt renderer that reaches every child. Trace from `CloseSessionOutcome.#printed` (`:351`) into the receipt document builder.

**Reviewer notes are child-facing.** The note written for the record ("Two bubbles marked (B, D)…") printed to Milo under "NOTES FOR YOU". Anything Slice B auto-generates will land in front of a child — either keep such notes machine-only or word them for the reader.

---

## Verification checklist

- [ ] `npx vitest run tests/unit/system/logging/ tests/unit/domains/school/ tests/unit/applications/school/` passes
- [ ] `npm run audit:layers` passes — no new cross-layer imports (`2_domains` must not reach up)
- [ ] `npm run test:refactor` passes
- [ ] A backend event queried at `_time:5m` returns during a live session (the timestamp fix, end to end)
- [ ] A double-bubble worksheet row with one correct answer prints a receipt with no human step
- [ ] A three-bubble row still holds for review
- [ ] An unreadable sheet raises a banner on the panel *and* a `warn` in the store
- [ ] The allocation audit reports zero duplicates after repair
