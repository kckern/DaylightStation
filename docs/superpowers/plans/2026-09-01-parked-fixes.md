# Parked Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix one live data-corruption bug, ship three written-but-unverified
rendering fixes with the regression test that should have guarded them, and add
the measurement needed before any OMR decode policy can be tuned.

**Architecture:** Six independent tasks against the existing DDD layers. No new
subsystems, no migrations, no schema changes. Each task ends in a commit that
can ship on its own.

**Tech Stack:** Node ESM (`.mjs`), vitest, js-yaml, node-canvas
(`DocumentReceiptRenderer`).

## Global Constraints

- Backend modules are ESM `.mjs`. Frontend is `.jsx`/`.js`.
- Tests live beside their source as `*.test.mjs` and run under **vitest**.
- Gate command: `npm run test:unit:vitest`. It reports failures against a known
  baseline; **your change must not add new failing files to that baseline.**
- Never use raw `console.*` for diagnostics — use the injected logger.
- Domain layer (`2_domains/`) is pure: no I/O. An import audit enforces this.
- Do not commit to `main` without running the gate first.
- Do NOT deploy. `./scripts/deploy-gate.sh` must pass and a human decides.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/src/1_adapters/school/documents/YamlAllocationStore.mjs` | Persist card origin on allocation; gate succession write-back on it | 1 |
| `backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs` | Lineage regression | 1 |
| `backend/src/3_applications/school/usecases/BuildAgenda.mjs` | Preview carries real action label + bulk card | 2 |
| `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs` | Bulk card uses the lesson card's code-column shape | 2 |
| `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.bulkPrint.test.mjs` | Bulk card layout + preview fidelity | 2 |
| `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs` | Retain the parsed IPP `job-id` | 3 |
| `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobId.test.mjs` | Job-id retention | 3 |
| `backend/src/3_applications/school/documents/ResolveCardScan.mjs` | Record decode confidence on every scan | 4 |
| `backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs` | Confidence recorded both paths | 4 |
| `backend/src/2_domains/school/reachability.test.mjs` | Declared actions include `reading-session` | 5 |
| `backend/src/0_system/events/` (bus topic registry) | Register `state-gates` / `shutdown.state` | 6 |

---

### Task 1: Card lineage is rewritten on every reuse delivery

`markDelivered` treats any truthy `predecessorCardId` as the rollover
succession. The **reuse** branch inherits `predecessorCardId` from the card's
first record (`YamlAllocationStore.mjs:284`), so every ordinary reuse delivery
on a card that once rolled over re-stamps its predecessor's records and re-logs
`rollover-delivered`, indefinitely.

`firstUse` already distinguishes the two branches (set `true` only at line 301)
but is returned, never persisted — so `markDelivered` cannot see it. This task
persists the decision.

**Files:**
- Modify: `backend/src/1_adapters/school/documents/YamlAllocationStore.mjs:304-313` (record construction), `:352-370` (markDelivered)
- Test: `backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: allocation records gain `cardOrigin: 'first' | 'rollover' | 'reuse'`.
  Task 4 does not depend on it; no later task consumes it.

- [ ] **Step 1: Write the failing test**

Append to `YamlAllocationStore.test.mjs`, inside the
`describe('allocateNext — atomic monotonic whole-worksheet allocation')` block.
It uses that file's existing `fakeIo`, `scriptedRng` and `request` helpers.

The sequence mirrors the real incident: card A rolls over to B under
`after_scan` (A still holds live work), then B is reused under `until_full`.
That third delivery is a plain reuse and must not touch A.

```javascript
it('does not rewrite predecessor lineage when a delivery is a plain reuse', async () => {
  const { io } = fakeIo();
  const store = new YamlAllocationStore({
    directory: '/docs',
    io,
    rng: scriptedRng([[8, 6, 8, 4, 1, 5, 5], [9, 4, 2, 7, 6, 0, 8]]),
    now: () => '2026-08-31T10:00:00.000Z',
  });

  // Card A, first use of a fresh chain.
  const a = await store.allocateNext({
    request: request({ documentId: 'math', learnerId: 'user_4', rowRange: { start: 1, end: 6 } }),
    policy: { reuse: 'after_scan' },
  });
  expect(a.firstUse).toBe(true);
  expect(a.record.cardOrigin).toBe('first');
  await store.markDelivered({ cardId: a.record.cardId, recordId: a.record.recordId });

  // A still holds live work, so `after_scan` correctly mints card B.
  const b = await store.allocateNext({
    request: request({ documentId: 'scripture', learnerId: 'user_4', rowRange: { start: 1, end: 3 } }),
    policy: { reuse: 'after_scan' },
  });
  expect(b.firstUse).toBe(true);
  expect(b.record.cardOrigin).toBe('rollover');
  await store.markDelivered({ cardId: b.record.cardId, recordId: b.record.recordId });

  // The genuine rollover DOES retire A's tail. This part is correct today.
  const afterRollover = await store.findByCard(a.record.cardId);
  expect(afterRollover[0].successorCardId).toBe(b.record.cardId);
  const tailAfterRollover = afterRollover[0].tailSkipped;

  // Now an ordinary reuse of B under `until_full`.
  const c = await store.allocateNext({
    request: request({ documentId: 'science', learnerId: 'user_4', rowRange: { start: 1, end: 2 } }),
    policy: { reuse: 'until_full' },
  });
  expect(c.firstUse).toBe(false);
  expect(c.record.cardId).toBe(b.record.cardId);
  expect(c.record.cardOrigin).toBe('reuse');
  // It inherits the predecessor pointer -- which is exactly why the old
  // condition misfired.
  expect(c.record.predecessorCardId).toBe(a.record.cardId);
  await store.markDelivered({ cardId: c.record.cardId, recordId: c.record.recordId });

  // THE ASSERTION: card A is untouched by a delivery that was not its rollover.
  const afterReuse = await store.findByCard(a.record.cardId);
  expect(afterReuse[0].tailSkipped).toEqual(tailAfterRollover);
  expect(afterReuse.map((r) => r.successorCardId))
    .toEqual(afterRollover.map((r) => r.successorCardId));
});
```

Note `allocateNext` takes `{ request, policy }` only — rows come from
`request.rowRange.end`, which must start at 1.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs -t 'plain reuse'
```

Expected: FAIL — `c.record.cardOrigin` is `undefined`, and `tailSkipped` on card
A has been recomputed by the reuse delivery.

- [ ] **Step 3: Persist the decision on the record**

In `allocateNext`, at the `allocationRecord({...})` call (around line 305), add
one field. `firstUse` and `predecessorCardId` are both already in scope.

```javascript
      const record = allocationRecord({
        cardId,
        request: shifted,
        renderedAt: this.#now(),
        generation,
        predecessorCardId,
        // WHICH DECISION PRODUCED THIS ROW, recorded when it is made.
        // `predecessorCardId` cannot answer this: the reuse branch inherits it
        // from the card's first record, so a truthy value means "this card was
        // once rolled over to", not "this delivery is that rollover".
        cardOrigin: firstUse ? (predecessorCardId ? 'rollover' : 'first') : 'reuse',
        identiconVersion: ANSWER_SHEET_IDENTICON_VERSION,
        cardCapacity: capacity,
      });
```

If `allocationRecord` whitelists its fields, add `cardOrigin` to that whitelist
too — check `2_domains/school/documents/allocation.mjs` and follow whatever
shape the existing fields use.

- [ ] **Step 4: Gate the write-back on it**

In `markDelivered`, replace the condition at line 352:

```javascript
      // ONLY A GENUINE ROLLOVER retires the predecessor's tail. This used to
      // test `delivered.predecessorCardId`, which every reuse on the card also
      // carries — so each ordinary delivery re-stamped the predecessor and
      // re-logged the rollover, forever. It also made card history untrustworthy
      // after the fact: fields written days later read as contemporaneous.
      if (delivered.cardOrigin === 'rollover' && delivered.predecessorCardId) {
```

Leave the body unchanged.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/school/documents/YamlAllocationStore.mjs \
        backend/src/1_adapters/school/documents/YamlAllocationStore.test.mjs \
        backend/src/2_domains/school/documents/allocation.mjs
git commit -m "fix(school): stamp card succession only on a genuine rollover

The reuse branch inherits predecessorCardId, so markDelivered read every
ordinary delivery as the rollover succession and re-stamped the predecessor's
records each time. The decision is now recorded on the allocation when it is
made, and read from there."
```

---

### Task 2: Ship the agenda preview and bulk-card fixes, with the test that guards them

Three changes are already written in the working tree and have never been
rendered or asserted. Do not rewrite them — verify them, add the regression
test, then commit.

The preview exists so a grown-up can see what the printer will produce. It was
wrong in both directions: it added `PREVIEW ONLY — ASK A GROWN-UP TO START THIS
LESSON`, a line the print never carries, in the exact slot a reader consults;
and it omitted the "Print all sheets" card the print always has, because preview
offers never carried the `printable` flag the bulk gate counts.

**Files:**
- Modify (already changed, verify only): `backend/src/3_applications/school/usecases/BuildAgenda.mjs`, `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs`
- Create: `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.bulkPrint.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the existing changes**

```bash
git diff backend/src/3_applications/school/usecases/BuildAgenda.mjs \
         backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs
```

Confirm three things are present: `BuildAgenda` uses `suffix` for the preview
action label and pushes `printable` on the preview offer; the preview branch of
the bulk block sets `PREVIEW_BULK_TOKEN`/`PREVIEW_ACCESS_CODE`;
`bulkPrintActionOp` measures a two-column card and the draw branch calls
`drawCodeColumn`.

- [ ] **Step 2: Write the failing test**

Create `DocumentReceiptRenderer.bulkPrint.test.mjs`. Read
`DocumentReceiptRenderer.actionFooter.test.mjs` first and copy its renderer
construction and its technique for inspecting output — do not invent a new
harness.

```javascript
import { describe, expect, it } from 'vitest';
import { createDocumentReceiptRenderer } from './DocumentReceiptRenderer.mjs';

const bulkBlock = {
  type: 'scan_action',
  action: 'preview:not-a-bulk-ticket',
  presentation: 'bulk_print',
  label: 'Print all sheets',
  hideCode: true,
  subjects: ['math', 'civilization', 'scripture'],
  panelCode: '000000',
};

describe('bulk print card', () => {
  it('is no taller than a single lesson card is wide-columned', async () => {
    const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    const png = await renderer.render({
      id: 'agenda-test', title: 'TEST', blocks: [bulkBlock],
    });
    expect(png.length).toBeGreaterThan(0);
    // The two-column card must be materially shorter than the old stacked one.
    // Stacked height was padding*2 + blockGap + rowGap*3 + heading + subjects +
    // codeArea + codeGap + codeLines; two-column is padding*2 + max(code, text).
    // 320px is comfortably between the two for a 3-subject card.
    const { height } = await pngSize(png);
    expect(height).toBeLessThan(320);
  });
});
```

Add a small `pngSize` helper in the test file that reads width/height from the
PNG IHDR chunk (bytes 16–24, big-endian), rather than adding an image
dependency:

```javascript
async function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
```

If `renderer.render` takes a different argument shape, follow the shape used in
`DocumentReceiptRenderer.actionFooter.test.mjs`.

- [ ] **Step 3: Write the preview-fidelity test**

Append to the same file. This is the test that matters most — it asserts the
preview and the print agree.

```javascript
import { BuildAgenda } from '../../../3_applications/school/usecases/BuildAgenda.mjs';

it('preview carries no PREVIEW ONLY text and does include the bulk card', async () => {
  // Build a preview agenda for a learner with 2+ printable subjects using the
  // same fixture style as BuildAgenda.progress.test.mjs (previewOnly: true).
  const result = await buildPreviewAgenda();   // helper, see that test file
  const serialized = JSON.stringify(result.document);
  expect(serialized).not.toMatch(/PREVIEW ONLY/i);
  expect(serialized).not.toMatch(/ask a grown-up to start this lesson/i);
  const blocks = result.document.blocks ?? [];
  expect(blocks.some((b) => b.presentation === 'bulk_print')).toBe(true);
});
```

`buildPreviewAgenda` is not a real helper. Build it from
`BuildAgenda.progress.test.mjs:68-71`, which already constructs
`new BuildAgenda({ ..., previewOnly: true, clock, timezone })` with a full set
of in-memory fakes — copy that construction wholesale.

Two things that will silently defeat this test if you get them wrong:

- Give it **at least two sessions whose units are printable** (`moveKind` of
  `print`), or the bulk gate correctly emits no card and the assertion passes
  vacuously. A vacuous pass here is worse than no test.
- Pass `selfService` truthy, or the bulk block is skipped entirely regardless of
  how many printable offers exist.

- [ ] **Step 4: Run both tests**

```bash
npx vitest run backend/src/1_rendering/school/documents/DocumentReceiptRenderer.bulkPrint.test.mjs
```

Expected: PASS, because the implementation is already in the tree. **If either
fails, the existing changes are wrong — fix the implementation, not the test.**

- [ ] **Step 5: Render the preview and look at it once**

```bash
node backend/index.js &
sleep 8
curl -s "http://localhost:3112/api/v1/school/lifecycle/learners/user_4/agenda/preview?studyDay=2026-09-01" \
  -o /tmp/agenda-preview.png
pkill -f 'node backend/index.js'
```

Open `/tmp/agenda-preview.png`. Confirm: no `PREVIEW ONLY` line on any card; a
"PRINT ALL SHEETS" card is present with its QR and six digits in a left column
and the subject list beside them. The port is the dev backend port from
`.claude/settings.local.json`; check it rather than assuming.

- [ ] **Step 6: Run the gate**

```bash
npm run test:unit:vitest 2>&1 | tail -5
```

Expected: no new failing files versus the baseline.

- [ ] **Step 7: Commit**

```bash
git add backend/src/3_applications/school/usecases/BuildAgenda.mjs \
        backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs \
        backend/src/1_rendering/school/documents/DocumentReceiptRenderer.bulkPrint.test.mjs
git commit -m "fix(school): make the agenda preview show what actually prints

The preview added a PREVIEW ONLY footer the print never carries, in the slot a
reader consults to learn what the child is told to do, and omitted the bulk
card the print always has. The bulk card now uses the lesson card's shape --
code column left, text right -- through one shared draw path.

Tested, which is the point: these sat unverified because 'render it and look'
was never automated."
```

---

### Task 3: Retain the IPP job id

`decodeResponse` already parses `job-id` out of the Print-Job response;
`#sendIpp` destructures only `{ok, statusCode}` and drops it. Behaviour does not
change — this is the precondition for job-state tracking.

**Files:**
- Modify: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs:505-515`
- Test: `backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobId.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `#sendIpp` resolves `{ok, bytes, copies, jobId}`; `jobId` is a number
  or `null`. `printPdf`'s resolved value carries `jobId` through unchanged.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';
import { encodeRequest } from './ipp.mjs';

describe('IPP job id retention', () => {
  it('returns the job-id the printer assigned', async () => {
    // Fake IPP responder: status 0x0000 plus a job-attributes group carrying
    // job-id 42. Group tag 0x02 = job attributes; 0x21 = integer.
    const body = Buffer.concat([
      Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]), // version/status/request-id
      Buffer.from([0x02]),                                           // job-attributes group
      Buffer.from([0x21, 0x00, 0x06]), Buffer.from('job-id'),
      Buffer.from([0x00, 0x04, 0x00, 0x00, 0x00, 0x2a]),             // value 42
      Buffer.from([0x03]),                                           // end
    ]);
    const adapter = makeAdapterWithFakeTransport(body);   // see step 2
    const result = await adapter.printPdf(Buffer.from('%PDF-1.4\n'), { jobName: 't' });
    expect(result.jobId).toBe(42);
  });
});
```

- [ ] **Step 2: Build the fake transport**

The adapter posts over HTTP. Stub `globalThis.fetch` for the duration of the
test rather than opening a socket:

```javascript
function makeAdapterWithFakeTransport(responseBody) {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => responseBody.buffer.slice(
      responseBody.byteOffset, responseBody.byteOffset + responseBody.byteLength,
    ),
  });
  const { LaserPrinterAdapter } = require('./LaserPrinterAdapter.mjs');
  return new LaserPrinterAdapter({ host: '127.0.0.1', port: 631 });
}
```

Read the adapter's constructor and its actual transport call first; if it uses
`http.request` rather than `fetch`, stub that instead. Restore whatever you stub
in an `afterEach`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobId.test.mjs
```

Expected: FAIL — `result.jobId` is `undefined`.

- [ ] **Step 4: Retain it**

In `#sendIpp`, change the destructure and the return:

```javascript
    const { ok, statusCode, attrs } = await this.#ipp(OPS.PRINT_JOB, attrs_, document, this.#printTimeout);
    if (!ok) { /* unchanged throw */ }
    // The printer's own handle for this job. Parsed all along by
    // `decodeResponse` and dropped here, which is why nothing downstream could
    // ever ask what became of a job.
    // `decodeResponse` collects EVERY attribute as an array
    // (`(attrs[name] ||= []).push(value)`, ipp.mjs:219), so this is `[42]`,
    // never `42`.
    const jobId = Number.isInteger(attrs?.['job-id']?.[0]) ? attrs['job-id'][0] : null;
    this.#logger.info?.('laser-printer.job-sent', {
      host: this.#host, port: this.#port, transport: 'ipp', jobName, user, copies,
      documentFormat, jobAttributes, bytes: document.length, jobId,
    });
    return { ok: true, bytes: document.length, copies, jobId };
```

Rename the local attribute variable if `attrs` already shadows the request
attributes — the existing method builds its request attrs into a local called
`attrs`, so one of the two must be renamed (`requestAttrs` is fine).

Add `jobId: null` to `#sendRaw9100`'s resolved object so both transports return
the same shape — JetDirect has no job handle, and saying so explicitly beats an
absent key.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobId.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.mjs \
        backend/src/1_adapters/hardware/laser-printer/LaserPrinterAdapter.jobId.test.mjs
git commit -m "feat(printer): retain the IPP job id the printer assigns

decodeResponse has always parsed it; sendIpp dropped it. Nothing downstream
could ask what became of a job. No behaviour change -- this is the precondition
for job-state tracking."
```

---

### Task 4: Record decode confidence on every scan

`ResolveCardScan` logs `card-id-inferred` as a warn when it resolves a partial
test id, and logs nothing at all when the id decodes cleanly. So there is no way
to answer "how often does the reader produce a partial read?" — and no decode
policy should be tuned without that number.

This task adds measurement only. It changes no decisions.

**Files:**
- Modify: `backend/src/3_applications/school/documents/ResolveCardScan.mjs:591-613`
- Test: `backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `execute()`'s resolved object gains
  `decode: { pattern: string, cardId: string, inferred: boolean, missingDigits: number }`.
  The follow-up decode-gate plan consumes this.

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, expect, it } from 'vitest';

describe('decode confidence', () => {
  it('records a clean decode with zero missing digits', async () => {
    const resolver = makeResolver({ cards: ['8424408'] });   // fixture per existing tests
    const result = await resolver.execute({ testId: '8424408', answers: { 1: 'A' } });
    expect(result.decode).toEqual({
      pattern: '8424408', cardId: '8424408', inferred: false, missingDigits: 0,
    });
  });

  it('records an inferred decode with the count of unread digits', async () => {
    const resolver = makeResolver({ cards: ['8424408', '8684155'] });
    const result = await resolver.execute({ testId: '84?????', answers: { 1: 'A' } });
    expect(result.decode).toEqual({
      pattern: '84?????', cardId: '8424408', inferred: true, missingDigits: 5,
    });
  });
});
```

`makeResolver` is not a real helper — build the resolver the way
`ResolveCardScan.test.mjs` already does at its lines 163 and 261:
`new ResolveCardScan({ allocationStore, repository, heldScanStore })`, with the
same in-memory `allocationStore` and `repository` fakes that file constructs.
Seed the allocation store with the two card ids the tests above name, and give
each an allocation record so `findByCard` returns something.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs
```

Expected: FAIL — `result.decode` is `undefined`.

- [ ] **Step 3: Build the decode record**

After the inference block (just past line 613), add:

```javascript
    // MEASUREMENT, NOT POLICY. Recorded on every scan, clean or inferred, so
    // "how often does the reader produce a partial read?" is answerable. No
    // decode policy should be tuned from anecdote, and two scans is anecdote.
    const decode = {
      pattern: String(testId),
      cardId,
      inferred: cardIdInferred !== null,
      missingDigits: (String(testId).match(/\?/g) ?? []).length,
    };
    this.#logger.info?.('school.scan.decode', decode);
```

Then add `decode` to every object this method returns after this point,
including the early-return error branches below it. Read to the end of
`execute` and add it to each `return` — a decode record that is missing exactly
when the scan failed would defeat the purpose.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the gate**

```bash
npm run test:unit:vitest 2>&1 | tail -5
```

Other `ResolveCardScan` tests assert on the returned shape; if any used a strict
equality on the whole object they will now fail. Update those assertions — the
new field is intended.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/documents/ResolveCardScan.mjs \
        backend/src/3_applications/school/documents/ResolveCardScan.decodeConfidence.test.mjs
git commit -m "feat(school): record card-id decode confidence on every scan

Only inferred reads were logged, and only as a warn, so the partial-read rate
was unknowable. Measurement first: the decode gate that follows should be tuned
from a real rate, not from two observations."
```

---

### Task 5: story-time reports unreachable while its trigger is declared

`school.program-status.no-entry-point` fires on every boot for story-time
(`entryAction: reading-session`) for two learners, and per
`programStatusCollection.mjs:43-48` that `error: true` shape "stops the status
board's done chip and the receipt's done-for-the-day". Yet
`data/household/triggers/sources.yml` declares
`livingroom.learner_action: reading-session`, and reading sessions demonstrably
open. So the declaration exists and the reachability path is not seeing it.

Do not guess at the cause. Write the test that pins the expected behaviour, let
it tell you where the break is.

**Files:**
- Test: `backend/src/2_domains/school/reachability.test.mjs` (extend; create if absent)
- Modify: whichever of `backend/src/2_domains/school/reachability.mjs` or
  `backend/src/app.mjs:4776` the test proves wrong.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test against the real config shape**

`sources.yml` has locations at the TOP LEVEL, each with a `modality`, not nested
under an `nfc` key:

```javascript
import { describe, expect, it } from 'vitest';
import { declaredEntryActions, entryActionIsReachable } from './reachability.mjs';

const SOURCES_SHAPE = {
  study:      { modality: 'nfc', target: 'portal',        learner_action: 'print-agenda' },
  livingroom: { modality: 'nfc', target: 'livingroom-tv', action: 'play-next',
                learner_action: 'reading-session' },
};

describe('declared entry actions', () => {
  it('includes every learner_action declared in the trigger sources', () => {
    const declared = declaredEntryActions(SOURCES_SHAPE);
    expect(declared).not.toBeNull();
    expect([...declared].sort()).toEqual(['print-agenda', 'reading-session']);
  });

  it('reports story-time reachable', () => {
    expect(entryActionIsReachable({
      entryAction: 'reading-session',
      declaredActions: declaredEntryActions(SOURCES_SHAPE),
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run backend/src/2_domains/school/reachability.test.mjs
```

Two outcomes, and they point at different files:

- **FAIL** → `declaredEntryActions` does not read this shape. Fix it in
  `reachability.mjs` to collect `learner_action` from each location value.
- **PASS** → the domain is fine and the wiring is wrong: `app.mjs:4776` reads
  `triggerConfig?.nfc?.locations`, but `sources.yml` has locations at the top
  level. Fix the wiring to pass the locations the parser actually produces, and
  add a test at the composition seam asserting the declared set is non-empty.

- [ ] **Step 3: Apply the fix the test pointed to, then re-run**

```bash
npx vitest run backend/src/2_domains/school/reachability.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Verify against the running app**

```bash
node backend/index.js 2>&1 | grep -m5 'no-entry-point' &
sleep 20; pkill -f 'node backend/index.js'
```

Expected: **no** `no-entry-point` lines for story-time.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/reachability.mjs \
        backend/src/2_domains/school/reachability.test.mjs backend/src/app.mjs
git commit -m "fix(school): see the learner actions the trigger sources declare

story-time declares reading-session and sources.yml declares it too, but the
reachability projection never saw it -- so the program reported error:true on
every boot, which suppresses the status board done chip and the receipt's
done-for-the-day for two learners."
```

---

### Task 6: Register the unknown bus topics

`bus.topic.unknown` warns four times per state-gates assertion, plus once for
`shutdown.state`. Nothing is broken; the noise hides real warnings.

**Files:**
- Modify: the bus topic registry (find it with the grep in step 1)
- Test: the registry's existing test file

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Find the registry and the publishers**

```bash
grep -rn "bus.topic.unknown" --include=*.mjs backend/src/ | grep -v test
grep -rn "state-gates\|shutdown.state" --include=*.mjs backend/src/ | grep -i "publish\|broadcast" | head
```

Read the warn site to learn where the known-topic list lives.

- [ ] **Step 2: Write the failing test**

In the registry's existing test file, assert both topics are known:

```javascript
it('knows the topics the app actually publishes', () => {
  expect(isKnownTopic('state-gates')).toBe(true);
  expect(isKnownTopic('shutdown.state')).toBe(true);
});
```

Use the real exported predicate name from step 1.

- [ ] **Step 3: Run it**

Expected: FAIL for both topics.

- [ ] **Step 4: Register them**

Add both to the known-topic list, with a one-line comment naming the publisher
so a future reader knows why they exist.

- [ ] **Step 5: Run the test, then the gate**

```bash
npx vitest run <registry test path>
npm run test:unit:vitest 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add <registry file> <registry test file>
git commit -m "chore: register the state-gates and shutdown.state bus topics

Four warns per assertion for topics the app publishes on purpose. Warn noise is
what hides real warnings."
```

---

## After all tasks

- [ ] Run the full gate and confirm no new failures versus baseline:

```bash
npm run test:unit:vitest 2>&1 | grep -E "NEW failing|tests —"
```

- [ ] **Do not deploy.** Run `./scripts/deploy-gate.sh` and report its result;
  a human decides whether to build and swap the container. A redeploy takes the
  app down for ~45s and the gate blocks while a child is at the Portal.

## Not in this plan

- **Portal code feedback and the OMR decode gate.** Both are designed in
  `docs/superpowers/specs/2026-09-01-parked-issues-design.md`; the escalation
  design needs a learner name picker that does not exist on that surface
  (the Portal has Keypad, LaunchCard and ScanCeremony only), and the decode gate
  should wait for the rate that Task 4 measures. They get their own plan.
- **Impressions, scans, the combined receipt.** Companion spec.
- **`records/print/jobs.yml`.** An earlier draft proposed deleting it. It is not
  dead: `PrintService.mjs:125,163,185,209` reads and appends it for the
  household printables quota and approval flow — a different subsystem from
  worksheet issuance, merely unused since July. Leave it alone. The honest
  finding is that worksheet printing has no ledger, not that this one is dead.
