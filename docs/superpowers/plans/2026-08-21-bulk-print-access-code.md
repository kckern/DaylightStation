# Bulk-Print Access Code Implementation Plan

> Historical planning record preserved during the 2026-10-08 integration. Current reference docs and implementation supersede older UI and timing details here. Keypad telemetry uses the existing self-service logger and never records code digits; current stray-input, submit-settle, and screen-off guards remain authoritative.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a child to type one 6-digit code to print all of today's printable worksheets at once, instead of typing a separate code per subject.

**Architecture:** A new `agenda_print` token class references per-subject `subject_next` tokens. Resolution dereferences them, runs one planner pass to confirm printability, and fans out to `IssueDocument` per subject. The receipt renders the bulk QR + code at the bottom. The portal keypad shows a multi-subject launch card.

**Tech Stack:** Node.js (ESM `.mjs`), React (`.jsx`), vitest + Jest, SCSS

## Global Constraints

- `domain/` tests use Jest (`import { describe, it, expect } from '@jest/globals'` or bare); `rendering/`, `modules/` tests use vitest (`import { describe, it, expect } from 'vitest'`).
- Run domain tests: `npx jest tests/isolated/domain/school/sessions/tokens.test.mjs`
- Run rendering tests: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/rendering/school/FILE`
- Run module tests: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/modules/School/FILE`
- Backend imports use `#domains/`, `#applications/` path aliases (defined in package.json `imports`).
- Never use raw `console.log` — use the structured logger.
- Token body charset: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no O/0, no I/1), 16 chars, prefixed `sch:`.
- Access code: 6-digit zero-padded decimal.

---

### Task 1: Token Domain — `agenda_print` class, validation, semantics

**Files:**
- Modify: `backend/src/2_domains/school/sessions/tokens.mjs`
- Test: `tests/isolated/domain/school/sessions/tokens.test.mjs`

**Interfaces:**
- Produces: `mintToken({ tokenClass: 'agenda_print', subject: { learnerId, tokenRefs }, ... })` returns a valid token record. `isAccessCodeLive` returns `true` for live `agenda_print` records. `resolveTokenState` returns `{ status: 'actionable' }` for non-expired `agenda_print` records without needing sessionState.

- [ ] **Step 1: Write failing tests for `agenda_print` validation**

Add to `tokens.test.mjs`:

```js
describe('agenda_print', () => {
  const REFS = ['sch:AAAA2222BBBB3333', 'sch:CCCC4444DDDD5555'];

  it('mints with learnerId + tokenRefs subject', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    expect(record.tokenClass).toBe('agenda_print');
    expect(record.subject.learnerId).toBe('user_4');
    expect(record.subject.tokenRefs).toEqual(REFS);
  });

  it('rejects missing learnerId', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { tokenRefs: REFS },
      at: AT, rng: seededRng(),
    })).toThrow(/learnerId/);
  });

  it('rejects empty tokenRefs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: [] },
      at: AT, rng: seededRng(),
    })).toThrow(/tokenRefs/);
  });

  it('rejects non-sch: prefixed refs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: ['bad:token'] },
      at: AT, rng: seededRng(),
    })).toThrow(/tokenRefs/);
  });

  it('rejects duplicate tokenRefs', () => {
    expect(() => mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: [REFS[0], REFS[0]] },
      at: AT, rng: seededRng(),
    })).toThrow(/duplicate/i);
  });

  it('accepts an access code (unlike other non-subject_next classes)', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
      accessCode: '123456',
      accessCodeExpiresAt: '2026-07-28T04:00:00.000Z',
    });
    expect(record.accessCode).toBe('123456');
  });

  it('does not require sessionId', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: REFS },
      at: AT, rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    expect(record.subject.sessionId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/school/sessions/tokens.test.mjs --verbose 2>&1 | tail -30`
Expected: Failures on `agenda_print` — either "not a valid token class" or subject validation errors.

- [ ] **Step 3: Add `agenda_print` to TOKEN_CLASSES**

In `tokens.mjs`, line 25 — add `'agenda_print'` to the array:

```js
export const TOKEN_CLASSES = Object.freeze([
  'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
  'subject_next', 'learning_action', 'answer_sheet_lost', 'agenda_print',
]);
```

- [ ] **Step 4: Add subject validation branch for `agenda_print`**

In `createTokenRecord`, between the `answer_sheet_lost` branch (line ~146) and the default `sessionId` branch (line ~147), add:

```js
  } else if (tokenClass === 'agenda_print') {
    if (!isNonEmptyString(subject.learnerId)) {
      throw new ValidationError(`${caller}: agenda_print subject requires a learnerId`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (!Array.isArray(subject.tokenRefs) || subject.tokenRefs.length === 0) {
      throw new ValidationError(`${caller}: agenda_print subject requires a non-empty tokenRefs array`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (subject.tokenRefs.some((r) => typeof r !== 'string' || !r.startsWith(TOKEN_PREFIX))) {
      throw new ValidationError(`${caller}: agenda_print tokenRefs must all be sch:-prefixed strings`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
    if (new Set(subject.tokenRefs).size !== subject.tokenRefs.length) {
      throw new ValidationError(`${caller}: agenda_print tokenRefs contains duplicates`, {
        code: 'SCHOOL_TOKEN_SUBJECT_INVALID', details: { caller, tokenClass },
      });
    }
  } else {
```

- [ ] **Step 5: Broaden the access-code whitelist**

In `createTokenRecord`, change the guard at line ~155 from:

```js
  if (accessCode != null && tokenClass !== 'subject_next') {
```

to:

```js
  if (accessCode != null && tokenClass !== 'subject_next' && tokenClass !== 'agenda_print') {
```

- [ ] **Step 6: Add `agenda_print` to SEMANTICS table**

After the `answer_sheet_lost` entry in the `SEMANTICS` object, add:

```js
  agenda_print: {
    actionable: () => true,
    alreadyDone: () => false,
  },
```

- [ ] **Step 7: Add `agenda_print` to sessionless short-circuit in `resolveTokenState`**

At line ~352-356, where `subject_next`, `learning_action`, and `answer_sheet_lost` short-circuit, add `agenda_print`:

```js
  if (['subject_next', 'learning_action', 'answer_sheet_lost', 'agenda_print'].includes(record.tokenClass)) {
```

- [ ] **Step 8: Update `isAccessCodeLive` class check**

At line ~243, change:

```js
  if (record.tokenClass !== 'subject_next') return false;
```

to:

```js
  if (record.tokenClass !== 'subject_next' && record.tokenClass !== 'agenda_print') return false;
```

- [ ] **Step 9: Write tests for `isAccessCodeLive` and `resolveTokenState` with `agenda_print`**

Add to `tokens.test.mjs`:

```js
describe('isAccessCodeLive — agenda_print', () => {
  const bulkRecord = mintToken({
    tokenClass: 'agenda_print',
    subject: { learnerId: 'user_4', tokenRefs: ['sch:AAAA2222BBBB3333'] },
    at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
    expiresAt: '2026-07-28T10:00:00.000Z',
    accessCode: '654321',
    accessCodeExpiresAt: '2026-07-28T04:00:00.000Z',
  });

  it('returns true for a live bulk code', () => {
    expect(isAccessCodeLive(bulkRecord, { now: '2026-07-27T12:00:00.000Z' })).toBe(true);
  });

  it('returns false after the code expires', () => {
    expect(isAccessCodeLive(bulkRecord, { now: '2026-07-28T04:00:01.000Z' })).toBe(false);
  });
});

describe('resolveTokenState — agenda_print', () => {
  it('is actionable without sessionState', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: ['sch:AAAA2222BBBB3333'] },
      at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    const result = resolveTokenState(record, { now: '2026-07-27T12:00:00.000Z' });
    expect(result.status).toBe('actionable');
  });

  it('is expired after expiresAt', () => {
    const record = mintToken({
      tokenClass: 'agenda_print',
      subject: { learnerId: 'user_4', tokenRefs: ['sch:AAAA2222BBBB3333'] },
      at: '2026-07-27T10:00:00.000Z', rng: seededRng(),
      expiresAt: '2026-07-28T10:00:00.000Z',
    });
    const result = resolveTokenState(record, { now: '2026-07-29T00:00:00.000Z' });
    expect(result.status).toBe('expired');
  });
});
```

- [ ] **Step 10: Run all tests to verify they pass**

Run: `npx jest tests/isolated/domain/school/sessions/tokens.test.mjs --verbose 2>&1 | tail -30`
Expected: All tests pass, including the new `agenda_print` tests and the existing `TOKEN_CLASSES` snapshot test (which needs updating — see step 3).

- [ ] **Step 11: Update the TOKEN_CLASSES snapshot test**

The existing test at line 33-38 asserts the exact array. Update it to include `'agenda_print'`:

```js
  it('is the closed spec §6.1 set', () => {
    expect(TOKEN_CLASSES).toEqual([
      'identify', 'select_unit', 'issue_document', 'media_action', 'remediation', 'recovery',
      'subject_next', 'learning_action', 'answer_sheet_lost', 'agenda_print',
    ]);
  });
```

- [ ] **Step 12: Run all token tests to confirm green**

Run: `npx jest tests/isolated/domain/school/sessions/tokens.test.mjs --verbose 2>&1 | tail -30`
Expected: All pass.

- [ ] **Step 13: Commit**

```bash
git add backend/src/2_domains/school/sessions/tokens.mjs tests/isolated/domain/school/sessions/tokens.test.mjs
git commit -m "feat(school): add agenda_print token class for bulk-print access codes"
```

---

### Task 2: Block Validation — allow `bulk_print` presentation

**Files:**
- Modify: `backend/src/2_domains/school/documents/blocks.mjs`
- Test: (inline — the validators are tested via the document builders that call them)

**Interfaces:**
- Produces: `scan_action` blocks with `presentation: 'bulk_print'` and a `subjects` string array pass validation.

- [ ] **Step 1: Update the presentation whitelist**

In `blocks.mjs`, line ~270, change:

```js
    if (raw.presentation !== undefined && !['default', 'lesson'].includes(raw.presentation)) {
      push('scan_action presentation must be default|lesson when present');
    }
```

to:

```js
    if (raw.presentation !== undefined && !['default', 'lesson', 'bulk_print'].includes(raw.presentation)) {
      push('scan_action presentation must be default|lesson|bulk_print when present');
    }
```

- [ ] **Step 2: Add `subjects` array validation**

After the `hideCode` validation in the `scan_action` block validator, add:

```js
    if (raw.subjects !== undefined) {
      if (!Array.isArray(raw.subjects) || raw.subjects.length === 0
          || raw.subjects.some((s) => !isNonEmptyString(s))) {
        push('scan_action subjects must be a non-empty array of non-empty strings when present');
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/2_domains/school/documents/blocks.mjs
git commit -m "feat(school): allow bulk_print presentation and subjects field on scan_action blocks"
```

---

### Task 3: Receipt Document — emit bulk-print block

**Files:**
- Modify: `backend/src/2_domains/school/documents/receipts.mjs`
- Test: `tests/isolated/domain/school/agenda.test.mjs` (or add a focused test for `agendaDocument`)

**Interfaces:**
- Consumes: `agendaDocument({ ..., bulkToken, bulkAccessCode })` — two new optional params.
- Produces: When `bulkToken` and `bulkAccessCode` are present, the returned `document.blocks` ends with a `scan_action` block with `presentation: 'bulk_print'` and `subjects` array, followed by the panel-code text blocks.

- [ ] **Step 1: Extend `agendaDocument` signature**

In `receipts.mjs`, update the function signature (line ~204) to accept `bulkToken` and `bulkAccessCode`:

```js
export function agendaDocument({
  learnerId, learnerName = null, generatedAt = null, timeZone = 'UTC',
  sections = [], tokensBySubject = {}, accessCodesBySubject = {},
  bulkToken = null, bulkAccessCode = null,
  footer = null, notes = [],
} = {})
```

- [ ] **Step 2: Add bulk-print block emission after the per-subject loop**

After the existing per-subject blocks loop (after line ~297), before the return, add:

```js
  if (isNonEmptyString(bulkToken) && typeof bulkAccessCode === 'string' && PANEL_CODE.test(bulkAccessCode)) {
    const printableSubjects = offered.map((s) => s.subject);
    blocks.push({
      type: 'scan_action',
      action: bulkToken,
      presentation: 'bulk_print',
      label: 'Print all sheets',
      hideCode: true,
      subjects: printableSubjects,
    });
    blocks.push(...panelCodeBlocks(bulkAccessCode));
  }
```

- [ ] **Step 3: Write a test for the bulk-print block**

Add a test (in the appropriate test file — if `agendaDocument` isn't directly tested, create a focused test):

```js
it('emits a bulk_print scan_action when bulkToken and bulkAccessCode are present', () => {
  const doc = agendaDocument({
    learnerId: 'user_4',
    sections: [
      { subject: 'maths', servedToday: false, next: { unitId: 'u1', title: 'Fractions' } },
      { subject: 'reading', servedToday: false, next: { unitId: 'u2', title: 'Chapter 5' } },
    ],
    tokensBySubject: { maths: 'sch:AAAA', reading: 'sch:BBBB' },
    accessCodesBySubject: { maths: '111111', reading: '222222' },
    bulkToken: 'sch:BULK1234',
    bulkAccessCode: '999999',
  });
  const bulkBlock = doc.blocks.find((b) => b.presentation === 'bulk_print');
  expect(bulkBlock).toBeDefined();
  expect(bulkBlock.action).toBe('sch:BULK1234');
  expect(bulkBlock.subjects).toEqual(['maths', 'reading']);
  const codeBlock = doc.blocks.find((b) => b.type === 'rich_text' && b.text?.includes('999999'));
  expect(codeBlock).toBeDefined();
});

it('omits the bulk block when bulkToken is absent', () => {
  const doc = agendaDocument({
    learnerId: 'user_4',
    sections: [{ subject: 'maths', servedToday: false, next: { unitId: 'u1', title: 'Fractions' } }],
    tokensBySubject: { maths: 'sch:AAAA' },
  });
  const bulkBlock = doc.blocks.find((b) => b.presentation === 'bulk_print');
  expect(bulkBlock).toBeUndefined();
});
```

- [ ] **Step 4: Run tests and verify they pass**

Run the appropriate test file. Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/school/documents/receipts.mjs tests/isolated/domain/school/
git commit -m "feat(school): emit bulk_print block on agenda receipt when bulk code is minted"
```

---

### Task 4: BuildAgenda — mint `agenda_print` token

**Files:**
- Modify: `backend/src/3_applications/school/usecases/BuildAgenda.mjs`

**Interfaces:**
- Consumes: `mintToken({ tokenClass: 'agenda_print', ... })` from Task 1.
- Produces: `execute()` return now includes `bulkToken` and `bulkAccessCode` in the `agendaDocument()` call. Each offer entry gains a `printable: boolean` field.

- [ ] **Step 1: Thread printability through to the offer**

In `#offerFor` (line ~474), the method already calls `nextMove(unit, state)` and gets `move`. Add `move.kind` to the return shape. Change:

```js
    return { sessionId, suffix: move.label, created };
```

to:

```js
    return { sessionId, suffix: move.label, created, moveKind: move.kind };
```

- [ ] **Step 2: Store `printable` on each offer**

In the section where offers are built (line ~284), after `const { sessionId, suffix, created } = await this.#offerFor(...)`, compute printability:

```js
      const printable = moveKind === 'document' || moveKind === 'print';
```

Update the destructure to include `moveKind`:
```js
      const { sessionId, suffix, created, moveKind } = await this.#offerFor({ ... });
```

Add `printable` to the offer object pushed to the `offers` array:

```js
      offers.push({
        subject: section.subject,
        unitId: entry.unitId,
        sessionId,
        token: record.token,
        tokenClass: 'subject_next',
        label: `${entry.title} — ${suffix}`,
        printable,
      });
```

- [ ] **Step 3: Mint the bulk token after per-subject offers**

After the per-subject loop ends and before the return statement, add:

```js
    let bulkToken = null;
    let bulkAccessCode = null;
    if (this.#selfService) {
      const printableOffers = offers.filter((o) => o.printable);
      if (printableOffers.length >= 2) {
        bulkAccessCode = mintAccessCode({
          rng: this.#rng,
          taken: (code) => liveCodes.has(code) || mintedCodes.has(code),
        });
        mintedCodes.add(bulkAccessCode);
        const tokenRefs = printableOffers.map((o) => o.token);
        const bulkExpiresAt = new Date(
          Math.min(...printableOffers.map((o) => Date.parse(expiresAt))),
        ).toISOString();
        const bulkRecord = mintToken({
          tokenClass: 'agenda_print',
          subject: { learnerId, tokenRefs },
          at: nowIso,
          rng: this.#rng,
          expiresAt: bulkExpiresAt,
          accessCode: bulkAccessCode,
          accessCodeExpiresAt: this.#accessCodeExpiryFor(nowIso, bulkExpiresAt),
        });
        await this.#tokens.put(bulkRecord);
        bulkToken = bulkRecord.token;
        this.#logger.info?.('school.agenda.bulk-print.minted', {
          learnerId, tokenRefCount: tokenRefs.length,
          subjects: printableOffers.map((o) => o.subject),
        });
      } else {
        this.#logger.debug?.('school.agenda.bulk-print.skipped', {
          learnerId, printableCount: printableOffers.length,
        });
      }
    }
```

- [ ] **Step 4: Pass `bulkToken` and `bulkAccessCode` to `agendaDocument()`**

Update the `agendaDocument()` call in the return statement:

```js
      document: agendaDocument({
        learnerId, learnerName, generatedAt: nowIso, timeZone: this.#timezone,
        sections: sectionsForDocument, tokensBySubject, accessCodesBySubject,
        bulkToken, bulkAccessCode,
        notes,
      }),
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/school/usecases/BuildAgenda.mjs
git commit -m "feat(school): mint agenda_print bulk token when 2+ subjects are printable"
```

---

### Task 5: ResolveAccessCode — bulk resolution path

**Files:**
- Modify: `backend/src/3_applications/school/usecases/ResolveAccessCode.mjs`

**Interfaces:**
- Consumes: `agenda_print` token records from the registry. Per-subject `subject_next` tokens via `tokenRefs`.
- Produces: `resolve({ code })` returns `{ card, resolution }` where `card.bulk === true` and `resolution.kind === 'bulk_print'` with `refs` array, or a friendly all-done card when all refs are exhausted.

- [ ] **Step 1: Add early branch in `resolve` for `agenda_print`**

In the `resolve` method, before the existing `subject.subject` guard (line ~186), add:

```js
    if (record.tokenClass === 'agenda_print') {
      return this.#resolveBulk(record, { now: nowIso });
    }
```

- [ ] **Step 2: Implement `#resolveBulk`**

Add a new private method:

```js
  async #resolveBulk(record, { now }) {
    const { learnerId, tokenRefs } = record.subject;
    this.#logger.info?.('school.selfservice.bulk.resolve-start', {
      learnerId, totalRefCount: tokenRefs.length,
    });

    let refs;
    try {
      refs = await Promise.all(tokenRefs.map((t) => this.#tokens.get(t)));
    } catch (error) {
      this.#logger.error?.('school.selfservice.bulk.registry-error', { error: error.message });
      return { card: NOT_ANSWERING, resolution: null };
    }

    const liveRefs = refs.filter((r) => r && resolveTokenState(r, { now }).status === 'actionable');
    if (!liveRefs.length) {
      this.#logger.info?.('school.selfservice.bulk.exhausted', { learnerId });
      return {
        card: {
          ok: true, learner: learnerId, subject: null, title: null,
          bulk: true, items: [],
          sentence: "You're all done for today!",
          actions: [{ kind: 'exit', label: 'Go back' }],
        },
        resolution: null,
      };
    }

    const { plan, sections } = await this.#planForLearner(learnerId, now);
    const printableRefs = [];

    for (const ref of liveRefs) {
      const subject = ref.subject?.subject;
      if (!subject) continue;
      const section = sections.find((s) => s.subject === subject);
      if (!section || section.servedToday || !section.next) continue;

      const entry = plan.entries?.find((e) => e.unitId === section.next.unitId);
      if (!entry) continue;

      const { sessionId, state } = await this.#readState({ entry, learnerId, nowIso: now });
      const unit = this.#curriculum.getUnit?.(entry.unitId) ?? {};
      const move = nextMove(unit, state);
      const actions = offeredActions(
        { kind: 'move', move, sessionId, state, unit, entry },
        { mediaSurface: this.#mediaSurface, bankPrintable: this.#bankPrintable(unit) },
      );
      const isPrint = actions.some((a) => a.kind === 'print');
      if (!isPrint) continue;

      printableRefs.push({
        token: ref.token, subject, sessionId,
        entry, title: entry.title ?? section.next.title ?? subject,
      });
    }

    if (!printableRefs.length) {
      this.#logger.info?.('school.selfservice.bulk.exhausted', { learnerId });
      return {
        card: {
          ok: true, learner: learnerId, subject: null, title: null,
          bulk: true, items: [],
          sentence: "You're all done for today!",
          actions: [{ kind: 'exit', label: 'Go back' }],
        },
        resolution: null,
      };
    }

    this.#logger.info?.('school.selfservice.bulk.resolved', {
      learnerId, liveRefCount: printableRefs.length, totalRefCount: tokenRefs.length,
    });

    return {
      card: {
        ok: true, learner: learnerId, subject: null,
        title: 'Print all sheets',
        bulk: true,
        items: printableRefs.map((r) => ({ subject: r.subject, title: r.title })),
        sentence: null,
        actions: [
          { kind: 'print', label: 'Print all sheets' },
          { kind: 'exit', label: 'Go back' },
        ],
      },
      resolution: {
        kind: 'bulk_print',
        learnerId,
        refs: printableRefs,
      },
    };
  }
```

Note: `#planForLearner` and `#readState` are internal methods that the existing single-subject resolution already uses. Reuse them; if they're inlined in the existing `#resolve`, extract into named privates first.

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/school/usecases/ResolveAccessCode.mjs
git commit -m "feat(school): resolve agenda_print codes with planner-based printability check"
```

---

### Task 6: RunSelfServiceAction — bulk print fan-out

**Files:**
- Modify: `backend/src/3_applications/school/usecases/RunSelfServiceAction.mjs`

**Interfaces:**
- Consumes: `resolution.kind === 'bulk_print'` with `resolution.refs` from Task 5.
- Produces: `execute()` returns `{ outcome, sentence, action, sessionId, effect }` where `effect.results` is an array of per-subject results.

- [ ] **Step 1: Add `bulk_print` branch in `#run`**

Before the `resolution.kind !== 'move'` guard (line ~242), add:

```js
    if (resolution?.kind === 'bulk_print' && kind === 'print') {
      return this.#bulkPrint(resolution);
    }
```

- [ ] **Step 2: Implement `#bulkPrint`**

```js
  async #bulkPrint(resolution) {
    const { learnerId, refs } = resolution;
    this.#logger.info?.('school.selfservice.bulk.print.start', { learnerId, refCount: refs.length });

    const results = [];
    for (const ref of refs) {
      try {
        const session = await ensureSession({
          entry: ref.entry, learnerId,
          nowIso: this.#clock().toISOString(),
          sessions: this.#sessions, newSessionId: this.#newSessionId,
        });
        const result = await this.#issue.execute({ sessionId: session.sessionId });
        const status = result?.status ?? 'unavailable';
        this.#logger.info?.('school.selfservice.bulk.print.ref', {
          subject: ref.subject, status, artifactId: result?.artifactId ?? null,
        });
        results.push({ subject: ref.subject, status, artifactId: result?.artifactId ?? null, pageCount: result?.pageCount ?? null });
      } catch (error) {
        this.#logger.error?.('school.selfservice.bulk.print.ref', {
          subject: ref.subject, status: 'error', error: error.message,
        });
        results.push({ subject: ref.subject, status: 'error', artifactId: null, pageCount: null });
      }
    }

    const succeeded = results.filter((r) => r.status === 'issued' || r.status === 'reprinted').length;
    const debounced = results.filter((r) => r.status === 'debounced').length;
    const failed = results.length - succeeded - debounced;

    let outcome;
    let sentence;
    if (succeeded > 0) {
      outcome = 'done';
      sentence = failed > 0
        ? `${succeeded} of ${results.length} sheets printed — ${failed} could not print.`
        : `${succeeded} ${succeeded === 1 ? 'sheet' : 'sheets'} printed.`;
    } else if (debounced === results.length) {
      outcome = 'debounced';
      sentence = "They're already on the way — give it a minute.";
    } else if (results.every((r) => r.status === 'already_done')) {
      outcome = 'refused';
      sentence = 'Those are all finished.';
    } else {
      outcome = 'failed';
      sentence = 'The printer did not answer. Try that again in a minute.';
    }

    this.#logger.info?.('school.selfservice.bulk.print.done', { succeeded, failed, debounced, outcome });

    return {
      outcome,
      sentence,
      sessionId: null,
      effect: { results },
    };
  }
```

- [ ] **Step 3: Import `ensureSession`**

At the top of the file, ensure `ensureSession` is imported from `./offerSession.mjs`:

```js
import { ensureSession } from './offerSession.mjs';
```

(Check if it's already imported — it may be.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/3_applications/school/usecases/RunSelfServiceAction.mjs
git commit -m "feat(school): bulk print fan-out with per-ref ensureSession and outcome aggregation"
```

---

### Task 7: ResolveScanAction — scan-path for `agenda_print` QR

**Files:**
- Modify: `backend/src/3_applications/school/usecases/ResolveScanAction.mjs`

**Interfaces:**
- Consumes: `agenda_print` token records. Uses the same planner-based resolution as `ResolveAccessCode.#resolveBulk`.
- Produces: When a parent scans a bulk QR, immediately fans out to `IssueDocument` per subject. Returns the standard `{ status, tokenClass, sessionId, physical, printed, message, effect }` shape.

- [ ] **Step 1: Add `agenda_print` case in `#route`**

In the switch at line ~167, add before `default`:

```js
      case 'agenda_print':   return this.#bulkPrint(record);
```

- [ ] **Step 2: Implement `#bulkPrint`**

This method reuses the same planner-based resolution pattern as `ResolveAccessCode.#resolveBulk`, but fans out to `IssueDocument` immediately (no card — parent scanning IS the authorization):

```js
  async #bulkPrint(record) {
    const { learnerId, tokenRefs } = record.subject;
    const refs = await Promise.all(tokenRefs.map((t) => this.#tokens.get(t)));
    const liveRefs = refs.filter((r) => r && resolveTokenState(r, { now: this.#clock().toISOString() }).status === 'actionable');

    if (!liveRefs.length) {
      return {
        status: 'already_done', tokenClass: 'agenda_print', sessionId: null,
        physical: 'receipt', printed: false,
        message: "Everything on today's list is done.", effect: null,
      };
    }

    const results = [];
    for (const ref of liveRefs) {
      const subject = ref.subject?.subject;
      if (!subject) continue;
      try {
        const session = await ensureSession({
          entry: { unitId: ref.subject?.unitId, sessionId: ref.subject?.sessionId },
          learnerId, nowIso: this.#clock().toISOString(),
          sessions: this.#sessions, newSessionId: this.#newSessionId,
        });
        const result = await this.#issue.execute({ sessionId: session.sessionId });
        results.push({ subject, status: result?.status ?? 'unavailable' });
      } catch {
        results.push({ subject, status: 'error' });
      }
    }

    const succeeded = results.filter((r) => r.status === 'issued' || r.status === 'reprinted').length;
    return {
      status: succeeded > 0 ? 'issued' : 'print_failed',
      tokenClass: 'agenda_print', sessionId: null,
      physical: 'worksheet', printed: succeeded > 0,
      message: succeeded > 0
        ? `${succeeded} ${succeeded === 1 ? 'sheet' : 'sheets'} printed.`
        : 'The printer did not answer.',
      effect: { results },
    };
  }
```

Note: The exact shape of `ensureSession`'s `entry` arg depends on what fields the `subject_next` ref's `subject` carries. The ref was minted with `subject: { learnerId, subject }` — it does NOT carry `unitId` or `sessionId`. Those must be resolved via the planner, similar to how `#subjectNext` works. Adapt the implementation to match the existing `#subjectNext` pattern in this file.

- [ ] **Step 3: Commit**

```bash
git add backend/src/3_applications/school/usecases/ResolveScanAction.mjs
git commit -m "feat(school): handle agenda_print QR scans with immediate bulk print fan-out"
```

---

### Task 8: Receipt Renderers — `bulk_print` presentation

**Files:**
- Modify: `backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs`
- Modify: `backend/src/1_rendering/school/documents/DocumentEscPosRenderer.mjs`
- Test: `tests/isolated/rendering/school/documentReceiptRenderer.test.mjs`
- Test: `tests/isolated/rendering/school/documentEscPosRenderer.test.mjs`

**Interfaces:**
- Consumes: `scan_action` blocks with `presentation: 'bulk_print'` and `subjects: string[]`.
- Produces: The raster renderer draws a separator, heading, subject list, and QR. The ESC/POS renderer emits text items and a QR/barcode.

- [ ] **Step 1: Add `bulk_print` branch in `DocumentReceiptRenderer.actionOp`**

In `actionOp` (line ~211), after the existing `lesson` branch, add a branch for `bulk_print`:

```js
    const bulkPrint = block.presentation === 'bulk_print';
    if (bulkPrint) {
      // separator line
      const sepY = y + theme.layout.blockGap;
      ops.push({ type: 'line', x: margin, y: sepY, width: innerWidth, color: '#CCCCCC' });

      // heading
      const headY = sepY + 12;
      ops.push({
        type: 'text', text: 'PRINT ALL SHEETS',
        x: margin, y: headY, font: theme.fonts.eyebrow,
        maxWidth: innerWidth, align: 'left',
      });

      // subject list
      let listY = headY + theme.fonts.eyebrow.size + 6;
      for (const subj of (block.subjects ?? [])) {
        ops.push({
          type: 'text', text: `• ${subj}`,
          x: margin + 8, y: listY, font: theme.fonts.body,
          maxWidth: innerWidth - 8, align: 'left',
        });
        listY += theme.fonts.body.size + 4;
      }

      // QR code area
      const codeY = listY + 8;
      // (reuse the existing QR drawing logic from the lesson branch)
    }
```

Adapt the exact coordinates and QR drawing to match the existing `lesson` branch's QR code rendering pattern. The QR payload is `block.action`.

- [ ] **Step 2: Add `bulk_print` branch in `DocumentEscPosRenderer`**

In the `scan_action` handler (line ~150), add a branch for `bulk_print`:

```js
      if (block.presentation === 'bulk_print') {
        items.push({ type: 'text', content: '', align: 'left' });
        items.push({ type: 'text', content: '─'.repeat(32), align: 'center' });
        items.push({ type: 'text', content: 'PRINT ALL SHEETS', align: 'left', style: { bold: true } });
        for (const subj of (block.subjects ?? [])) {
          items.push({ type: 'text', content: `• ${subj}`, align: 'left' });
        }
      } else if (block.presentation === 'lesson') {
```

The QR/barcode item after the branch stays as-is — it already uses `block.action`.

- [ ] **Step 3: Write tests for both renderers**

Add a test to `documentReceiptRenderer.test.mjs` verifying a `bulk_print` block produces ops (check for the heading text). Add a test to `documentEscPosRenderer.test.mjs` verifying the text items and QR output.

- [ ] **Step 4: Run renderer tests**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs tests/isolated/rendering/school/documentReceiptRenderer.test.mjs tests/isolated/rendering/school/documentEscPosRenderer.test.mjs`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_rendering/school/documents/DocumentReceiptRenderer.mjs backend/src/1_rendering/school/documents/DocumentEscPosRenderer.mjs tests/isolated/rendering/school/
git commit -m "feat(school): render bulk_print presentation on thermal receipt"
```

---

### Task 9: LaunchCard — bulk variant

**Files:**
- Modify: `frontend/src/modules/School/selfService/LaunchCard.jsx`
- Modify: `frontend/src/modules/School/School.scss`

**Interfaces:**
- Consumes: `card.bulk === true`, `card.items: Array<{ subject, title }>`.
- Produces: Renders a multi-subject list with a single "Print all sheets" button, or the all-done sentence when `items` is empty.

- [ ] **Step 1: Add bulk variant to the `card` view in LaunchCard**

In the `card` view section (line ~68), add a conditional for `card.bulk`:

```jsx
      {view === 'card' && (
        <div className={`school-selfservice-card__head${card.bulk ? ' school-selfservice-card--bulk' : ''}`}>
          {card.subject && <p className="school-selfservice-card__subject">{card.subject}</p>}
          {card.title && <h1 className="school-selfservice-card__title">{card.title}</h1>}
          {card.bulk && card.items?.length > 0 && (
            <ul className="school-selfservice-card__items">
              {card.items.map((item, i) => (
                <li key={i} className="school-selfservice-card__item">
                  <span className="school-selfservice-card__item-subject">{item.subject}</span>
                  <span className="school-selfservice-card__item-title">{item.title}</span>
                </li>
              ))}
            </ul>
          )}
          {card.sentence && <p className="school-selfservice-card__sentence">{card.sentence}</p>}
        </div>
      )}
```

Keep the existing action buttons rendering — they already iterate `card.actions` and handle exit vs. non-exit.

- [ ] **Step 2: Add bulk styles to School.scss**

After the existing `.school-selfservice-card` styles (line ~1767), add:

```scss
.school-selfservice-card--bulk {
  text-align: left;
}
.school-selfservice-card__items {
  list-style: none; margin: 0.6rem 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 0.5rem;
  width: 100%; text-align: left;
}
.school-selfservice-card__item {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 0.5rem 0.8rem;
  border-bottom: 1px solid var(--school-border);
  font-size: 1.15rem;
}
.school-selfservice-card__item-subject {
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  font-size: 0.95rem; color: var(--school-muted);
}
.school-selfservice-card__item-title {
  font-weight: 600;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/School/selfService/LaunchCard.jsx frontend/src/modules/School/School.scss
git commit -m "feat(school): bulk launch card variant with multi-subject item list"
```

---

### Task 10: Composition wiring

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs`

**Interfaces:**
- Consumes: All the new capabilities from Tasks 1-7.
- Produces: The composition root wires everything so the full flow works end-to-end.

- [ ] **Step 1: Verify wiring**

Check that `BuildAgenda`, `ResolveAccessCode`, `RunSelfServiceAction`, and `ResolveScanAction` are all constructed with the dependencies they need. The new code in Tasks 4-7 uses:

- `BuildAgenda`: already has `tokens`, `rng`, `selfService`, `clock`, `logger` — no new deps needed.
- `ResolveAccessCode`: already has `tokens`, `curriculum`, `sessions`, `issueDocument`, `clock`, `logger` — the `#planForLearner`, `#readState`, `#bankPrintable` methods are all wired via existing deps. No new deps needed.
- `RunSelfServiceAction`: already has `sessions`, `issueDocument`, `newSessionId`, `clock`, `logger`. Needs `ensureSession` imported directly (not injected). No new composition deps needed.
- `ResolveScanAction`: already has `tokens`, `sessions`, `issue` (IssueDocument), `newSessionId`, `clock`. Needs `ensureSession` imported directly. No new composition deps needed.

If no new dependencies are needed, this task is a no-op verification.

- [ ] **Step 2: Commit (only if changes were needed)**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "chore(school): wire bulk-print dependencies in composition root"
```

---

### Task 11: End-to-end smoke test

**Files:**
- Test manually via the agenda preview API

- [ ] **Step 1: Start the dev server**

Check if already running: `ss -tlnp | grep 3112`
If not: `node backend/index.js &`

- [ ] **Step 2: Generate an agenda preview and verify the bulk block**

```bash
curl -s http://localhost:3113/api/v1/school/learners/user_4/agenda/preview?format=json | jq '.sections | length'
```

Verify the response includes the bulk-print block in the document. If the learner has 2+ printable subjects, the document blocks should end with a `bulk_print` scan_action.

- [ ] **Step 3: Test the access code flow**

If the preview returns a `bulkAccessCode`, type it on the portal keypad (or simulate via API):

```bash
curl -s -X POST http://localhost:3113/api/v1/school/self-service/resolve \
  -H 'Content-Type: application/json' \
  -d '{"code":"THE_CODE"}'
```

Verify the response has `bulk: true`, `items` array, and the print action.

- [ ] **Step 4: Commit any fixes discovered during smoke testing**
