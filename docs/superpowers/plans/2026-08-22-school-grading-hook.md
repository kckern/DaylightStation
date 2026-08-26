# School Grading Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire one configured Home Assistant script, carrying the scan outcome as script variables, on every terminal OMR scan outcome.

**Architecture:** A `SchoolGradingHookAdapter` shaped like `AmbientLedAdapter` (injected gateway, circuit breaker, never throws) is called by `schoolPrintScanConsumer` at the four points it already logs a terminal outcome. Behaviour lives entirely in Home Assistant; this repo passes the grade and gets out of the way.

**Spec:** `docs/superpowers/specs/2026-08-22-school-grading-hook-design.md` — read it before starting.

**Tech Stack:** Node ESM (`.mjs`), vitest, `IHomeAutomationGateway.callService`.

## Global Constraints

- **Three test runners, split by LOCATION.** This plan touches two of them:
  - `tests/isolated/**`, `tests/unit/**` files importing from `'vitest'` → **vitest**: `npx vitest run <file>`
  - colocated `backend/src/**/*.test.mjs` → **node:test**: `node --test <file>`
  - (`tests/unit/**` files using jest globals → `NODE_OPTIONS=--experimental-vm-modules npx jest <path>`. Not used here.)
  Every file this plan creates is **vitest**, with an explicit `import { describe, it, expect } from 'vitest'`.
- **`npm run test:backend` is BROKEN** (`scripts/test-backend.mjs` does not exist). Never use it as a gate.
- **`--reporter=line` crashes this vitest version.** Use the default reporter.
- **The gate baseline is empty.** `scripts/audit-baseline.vitest.txt` lists zero known-failing files, so ANY failure in the 869-file vitest population fails `npm run test:unit:vitest`. Never run `gate-vitest --update` to absorb a failure you introduced.
- **Home automation must never affect grading.** The adapter returns `{ok:false}` rather than throwing. No code path added by this plan may prevent a scan from being recorded.
- **Do not touch the data volume.** Config is read through the existing school-config loader; no `docker exec` writes.
- **Variables are snake_case** (Home Assistant convention), not the camelCase used inside this codebase.

---

## Task 1: Return the review reasons so the hook can pass them

The spec's variable contract requires `reasons` and `items` on the `review` outcome. `RecordCardScanOutcome` computes both — it logs them at `school.print.scan-awaiting-review` — but its return value carries only `pendingReview`, so the consumer cannot see them.

**Files:**
- Modify: `backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs` (the awaiting-review return, ~line 429)
- Test: `tests/isolated/adapter/school/recordCardScanOutcomeReview.test.mjs` (create)

**Interfaces:**
- Produces: the awaiting-review return becomes
  `{ sessionId, advancedTo: 'submitted', reason: 'awaiting-review', pendingReview: number, reasons: string[], items: string[] }`.
  Tasks 3 reads `reasons` and `items` from it.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/school/recordCardScanOutcomeReview.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';

// The awaiting-review branch already builds these two arrays for its log line;
// this pins that they also reach the caller, which is the only way the grading
// hook can name WHICH row stopped the session.
describe('RecordCardScanOutcome — awaiting-review return shape', () => {
  it('returns reasons and items alongside pendingReview', async () => {
    const { result } = await runAwaitingReviewCase();
    expect(result.reason).toBe('awaiting-review');
    expect(result.pendingReview).toBe(2);
    expect(result.reasons).toEqual(['ambiguous']);
    expect(result.items).toEqual(['q1', 'q2']);
  });

  it('deduplicates reasons but not items', async () => {
    const { result } = await runAwaitingReviewCase();
    // two pending rows, both 'ambiguous' -> one reason, two items
    expect(result.reasons).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });
});
```

Write `runAwaitingReviewCase()` as a local helper in the same file that constructs `RecordCardScanOutcome` with stubbed stores and drives it to the awaiting-review branch with two pending rows both carrying `reason: 'ambiguous'` and item ids `q1`, `q2`. Read the constructor's real dependency list from `RecordCardScanOutcome.mjs` and stub exactly those — do not invent a shape.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/isolated/adapter/school/recordCardScanOutcomeReview.test.mjs`
Expected: FAIL — `result.reasons` is `undefined`.

- [ ] **Step 3: Add the two fields to the return**

In `RecordCardScanOutcome.mjs`, the awaiting-review branch already computes these for its log call. Hoist them to consts and return them:

```javascript
          const reviewReasons = [...new Set(pending.map((row) => row.reason))];
          const reviewItems = pending.map((row) => row.itemId);
          this.#logger.info?.('school.print.scan-awaiting-review', {
            sessionId,
            recordId: card.recordId,
            pendingReview: pending.length,
            learnerId: state.learnerId ?? null,
            reasons: reviewReasons,
            items: reviewItems,
          });
          return {
            sessionId,
            advancedTo: 'submitted',
            reason: 'awaiting-review',
            pendingReview: pending.length,
            reasons: reviewReasons,
            items: reviewItems,
          };
```

The log payload must stay byte-identical in content — it is queried in the log store.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapter/school/recordCardScanOutcomeReview.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Confirm no existing caller broke**

Run: `npx vitest run tests/isolated/composition/schoolPrintScanConsumer.test.mjs tests/isolated/adapter/school/`
Expected: all pass. Adding keys to a returned object is additive, but this proves it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/3_applications/school/documents/RecordCardScanOutcome.mjs \
        tests/isolated/adapter/school/recordCardScanOutcomeReview.test.mjs
git commit -m "feat(school): return review reasons and items to the caller

The awaiting-review branch already built both arrays for its log line but
returned only pendingReview, so a caller could learn that a session stopped
but not which row stopped it or why. The grading hook needs both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The adapter

**Files:**
- Create: `backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs`
- Test: `tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`

**Interfaces:**
- Consumes: a gateway exposing `callService(domain, service, data)` (`IHomeAutomationGateway`), and `loadSchoolConfig(householdId)` returning the parsed `school.yml`.
- Produces:
  `new SchoolGradingHookAdapter({ gateway, loadSchoolConfig, logger })`
  with one public method
  `async fire({ result, householdId, learnerId, testId, sessionId, percent, earned, total, pendingReview, reasons, items, code })`
  returning `{ok: boolean, skipped?: boolean, reason?: string, error?: string}`. **Never throws.**
  Also `getMetrics()` and `reset()`, matching `AmbientLedAdapter`.

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { SchoolGradingHookAdapter } from '#adapters/school/SchoolGradingHookAdapter.mjs';

function makeAdapter({ script = 'script.school_graded', failWith = null } = {}) {
  const calls = [];
  const gateway = {
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
      if (failWith) throw new Error(failWith);
      return { ok: true };
    },
  };
  const loadSchoolConfig = () => (script ? { grading_hook: { script } } : {});
  return { adapter: new SchoolGradingHookAdapter({ gateway, loadSchoolConfig }), calls };
}

const GRADED = {
  result: 'graded', learnerId: 'learner4', testId: '4071314',
  sessionId: 'ses_f6Buxumv', percent: 83, earned: 5, total: 6,
};

describe('SchoolGradingHookAdapter', () => {
  it('calls the configured script with the graded variable set', async () => {
    const { adapter, calls } = makeAdapter();
    const res = await adapter.fire(GRADED);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].domain).toBe('script');
    expect(calls[0].service).toBe('school_graded');
    expect(calls[0].data).toEqual({
      result: 'graded', learner_id: 'learner4', test_id: '4071314',
      session_id: 'ses_f6Buxumv', percent: 83, earned: 5, total: 6,
      pending_review: null, reasons: [], items: [], code: null,
    });
  });

  it('fills inapplicable keys with null and [] on an unresolved outcome', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire({ result: 'unresolved', testId: '12123F', code: 'CARD_ID_UNREADABLE' });
    expect(calls[0].data).toEqual({
      result: 'unresolved', learner_id: null, test_id: '12123F',
      session_id: null, percent: null, earned: null, total: null,
      pending_review: null, reasons: [], items: [], code: 'CARD_ID_UNREADABLE',
    });
  });

  it('passes review reasons and items through', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire({
      result: 'review', learnerId: 'learner3', testId: '4071314', sessionId: 'ses_x',
      pendingReview: 1, reasons: ['ambiguous'], items: ['q1'],
    });
    expect(calls[0].data.pending_review).toBe(1);
    expect(calls[0].data.reasons).toEqual(['ambiguous']);
    expect(calls[0].data.items).toEqual(['q1']);
  });

  it('accepts a bare service name without the script. prefix', async () => {
    const { adapter, calls } = makeAdapter({ script: 'school_graded' });
    await adapter.fire(GRADED);
    expect(calls[0].domain).toBe('script');
    expect(calls[0].service).toBe('school_graded');
  });

  it('is a no-op when grading_hook is not configured', async () => {
    const { adapter, calls } = makeAdapter({ script: null });
    const res = await adapter.fire(GRADED);
    expect(res).toEqual({ ok: true, skipped: true, reason: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('never throws when the gateway throws', async () => {
    const { adapter } = makeAdapter({ failWith: 'HA unreachable' });
    const res = await adapter.fire(GRADED);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/HA unreachable/);
  });

  it('opens the circuit after 5 consecutive failures and then skips', async () => {
    const { adapter, calls } = makeAdapter({ failWith: 'boom' });
    for (let i = 0; i < 5; i++) await adapter.fire(GRADED);
    expect(calls).toHaveLength(5);
    const res = await adapter.fire(GRADED);
    expect(res).toMatchObject({ ok: true, skipped: true, reason: 'backoff' });
    expect(calls).toHaveLength(5); // no 6th attempt
  });

  it('does NOT deduplicate identical consecutive grades', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.fire(GRADED);
    await adapter.fire(GRADED);
    expect(calls).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Create `backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs`:

```javascript
/**
 * SchoolGradingHookAdapter — fires one configured Home Assistant script when a
 * paper scan reaches a terminal outcome, passing the outcome as script
 * variables.
 *
 * Deliberately a dumb pipe: it does not decide what a score MEANS. `school.yml`
 * names one script; Home Assistant branches on the `result` variable. Retuning
 * a light must never require a redeploy of this repo.
 *
 * Modelled on `1_adapters/fitness/AmbientLedAdapter.mjs`, with two deliberate
 * departures:
 *   - NO deduplication. A scene is a state; a grade is an EVENT. Two learners
 *     both scoring 83% each deserve their own light.
 *   - NO throttle. Three children scanning in succession must all fire; a
 *     2s window would silently swallow the second and third.
 *
 * Home automation must never affect grading, so this never throws.
 */
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const MAX_FAILURES = 5;
const MAX_BACKOFF_MS = 60000;

/** Every call carries this key set; inapplicable values are null / []. */
function toVariables(o) {
  return {
    result: o.result,
    learner_id: o.learnerId ?? null,
    test_id: o.testId ?? null,
    session_id: o.sessionId ?? null,
    percent: o.percent ?? null,
    earned: o.earned ?? null,
    total: o.total ?? null,
    pending_review: o.pendingReview ?? null,
    reasons: o.reasons ?? [],
    items: o.items ?? [],
    code: o.code ?? null,
  };
}

export class SchoolGradingHookAdapter {
  #gateway;
  #loadSchoolConfig;
  #logger;

  constructor(config) {
    if (!config?.gateway) {
      throw new InfrastructureError('SchoolGradingHookAdapter requires gateway', {
        code: 'MISSING_DEPENDENCY', dependency: 'gateway',
      });
    }
    if (!config?.loadSchoolConfig) {
      throw new InfrastructureError('SchoolGradingHookAdapter requires loadSchoolConfig', {
        code: 'MISSING_DEPENDENCY', dependency: 'loadSchoolConfig',
      });
    }
    this.#gateway = config.gateway;
    this.#loadSchoolConfig = config.loadSchoolConfig;
    this.#logger = config.logger || console;

    this.failureCount = 0;
    this.backoffUntil = 0;
    this.metrics = {
      totalRequests: 0, firedCount: 0, failureCount: 0,
      skippedNotConfigured: 0, skippedBackoff: 0,
      resultHistogram: {}, lastFiredAt: null,
    };
  }

  async fire(outcome) {
    this.metrics.totalRequests++;
    const now = Date.now();

    const script = this.#loadSchoolConfig(outcome?.householdId)?.grading_hook?.script;
    if (!script) {
      this.metrics.skippedNotConfigured++;
      this.#logger.debug?.('school.grading_hook.skipped', { reason: 'not_configured' });
      return { ok: true, skipped: true, reason: 'not_configured' };
    }

    if (this.backoffUntil > now) {
      this.metrics.skippedBackoff++;
      this.#logger.warn?.('school.grading_hook.skipped', {
        reason: 'backoff', remainingMs: this.backoffUntil - now, failureCount: this.failureCount,
      });
      return { ok: true, skipped: true, reason: 'backoff' };
    }

    // `script.school_graded` -> domain script, service school_graded.
    // A bare `school_graded` is used as the service name as-is.
    const service = script.startsWith('script.') ? script.slice('script.'.length) : script;
    const variables = toVariables(outcome);

    try {
      await this.#gateway.callService('script', service, variables);
      this.failureCount = 0;
      this.metrics.firedCount++;
      this.metrics.lastFiredAt = new Date(now).toISOString();
      this.metrics.resultHistogram[variables.result] =
        (this.metrics.resultHistogram[variables.result] || 0) + 1;
      this.#logger.info?.('school.grading_hook.fired', {
        script, result: variables.result, learnerId: variables.learner_id,
      });
      return { ok: true };
    } catch (error) {
      this.failureCount++;
      this.metrics.failureCount++;
      if (this.failureCount >= MAX_FAILURES) {
        const backoffMs = Math.min(
          MAX_BACKOFF_MS, 1000 * (2 ** (this.failureCount - MAX_FAILURES)),
        );
        this.backoffUntil = Date.now() + backoffMs;
        this.#logger.error?.('school.grading_hook.circuit_open', {
          failureCount: this.failureCount, backoffMs, error: error.message,
        });
      } else {
        this.#logger.error?.('school.grading_hook.failed', {
          script, result: variables.result, error: error.message,
          failureCount: this.failureCount,
        });
      }
      return { ok: false, error: error.message };
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      circuitBreaker: {
        failureCount: this.failureCount,
        maxFailures: MAX_FAILURES,
        isOpen: this.backoffUntil > Date.now(),
      },
    };
  }

  reset() {
    const previous = { failureCount: this.failureCount, backoffUntil: this.backoffUntil };
    this.failureCount = 0;
    this.backoffUntil = 0;
    this.#logger.info?.('school.grading_hook.reset', { previous });
    return { ok: true, previous };
  }
}

export default SchoolGradingHookAdapter;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/school/SchoolGradingHookAdapter.mjs \
        tests/isolated/adapter/school/SchoolGradingHookAdapter.test.mjs
git commit -m "feat(school): grading hook adapter — one HA script, outcome as variables

Dumb pipe by design: school.yml names one script, Home Assistant branches on
the result variable. No dedup (a grade is an event, not a state) and no
throttle (three children scanning in a row must all fire). Never throws —
home automation must not be able to affect grading.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Fire it from the four terminal branches

**Files:**
- Modify: `backend/src/5_composition/modules/schoolPrintScanConsumer.mjs`
- Test: `tests/isolated/composition/schoolPrintScanConsumerHook.test.mjs` (create)

**Interfaces:**
- Consumes: `SchoolGradingHookAdapter#fire` (Task 2) and the `reasons`/`items` now returned by `RecordCardScanOutcome` (Task 1).
- Produces: `createSchoolPrintScanConsumer({ …, gradingHook })` — one new optional dependency, default `null`.

The four insertion points, all beside logs that already exist:

| outcome | site | variables in scope |
|---|---|---|
| `unresolved` | beside `school.print.scan-unresolved` (~:65) | `testId`, `outcome.error.code` |
| `refused` | beside `school.print.scan-record-refused` (~:131) | `testId`, `card.recordId`, `card.error.code`, `card.learnerId` |
| `graded` | in the `.then()` where `sectionOutcome.advancedTo === 'graded'` (~:174) | `card.learnerId`, `card.earnedPoints`, `card.totalPoints`, `sectionOutcome.sessionId`, `testId` |
| `review` | same `.then()`, when `sectionOutcome.reason === 'awaiting-review'` | `sectionOutcome.pendingReview`, `.reasons`, `.items`, `.sessionId`, `card.learnerId`, `testId` |

- [ ] **Step 1: Write the failing test**

Create `tests/isolated/composition/schoolPrintScanConsumerHook.test.mjs`. Build the consumer with a fake `gradingHook` that records `fire()` calls, drive one scan per outcome, and assert the hook saw the right `result` and payload. Read `schoolPrintScanConsumer.mjs`'s real dependency list and the existing `tests/isolated/composition/schoolPrintScanConsumer.test.mjs` for the established fixture shape — reuse that fixture rather than inventing one.

Required cases:

```javascript
  it('fires result=graded with the score', async () => { /* … */ });
  it('fires result=review with pendingReview, reasons and items', async () => { /* … */ });
  it('fires result=unresolved with the resolver code', async () => { /* … */ });
  it('fires result=refused with the record code', async () => { /* … */ });
  it('does nothing when no gradingHook is injected', async () => { /* … */ });
  it('still records the grade when the hook rejects', async () => { /* … */ });
```

The last case is the important one: make the fake hook's `fire()` return a rejected promise and assert `recordCardScanOutcome.execute` was still called and the consumer did not throw.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/isolated/composition/schoolPrintScanConsumerHook.test.mjs`
Expected: FAIL — the hook is never called.

- [ ] **Step 3: Add the dependency and the four calls**

Add `gradingHook = null` to the destructured parameter list. Then at each site, beside the existing log:

```javascript
        // Home automation is a bystander: never awaited into the grading path
        // and never able to fail it. The adapter already swallows its own
        // errors; this catch covers a hook that rejects outright.
        gradingHook?.fire({
          result: 'unresolved', testId, code: outcome.error.code,
        }).catch(() => {});
```

Use the same fire-and-forget `.catch(() => {})` shape at all four sites. Do **not** `await` — a slow Home Assistant must not delay recording a grade.

For the two sites inside the `.then()`, read `sectionOutcome` for `sessionId`/`pendingReview`/`reasons`/`items` and `card` for `learnerId`/`earnedPoints`/`totalPoints`.

Update the JSDoc: the `@param` block gains `gradingHook`, described as optional and non-blocking.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/isolated/composition/schoolPrintScanConsumerHook.test.mjs tests/isolated/composition/schoolPrintScanConsumer.test.mjs`
Expected: both files pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/5_composition/modules/schoolPrintScanConsumer.mjs \
        tests/isolated/composition/schoolPrintScanConsumerHook.test.mjs
git commit -m "feat(school): fire the grading hook on all four scan outcomes

Fire-and-forget beside the four terminal logs. Never awaited into the
grading path — a slow or broken Home Assistant must not delay or prevent a
grade being recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Compose it

**Files:**
- Modify: `backend/src/5_composition/modules/schoolLifecycle.mjs` (or wherever `createSchoolPrintScanConsumer` is constructed — find it, do not assume)

**Interfaces:**
- Consumes: `adapters.haGateway` (present in composition — see `5_composition/modules/homeApi.mjs`, which guards on it being absent) and the existing school-config loader used by that module.

- [ ] **Step 1: Find the construction site**

```bash
grep -rn "createSchoolPrintScanConsumer" backend/src --include=*.mjs | grep -v test
```
Read it before editing. If `haGateway` is not already in scope there, thread it from the same place `homeApi.mjs` gets it.

- [ ] **Step 2: Construct the adapter and inject it**

Guard on the gateway being present — a household with no Home Assistant must boot cleanly:

```javascript
  const gradingHook = adapters.haGateway
    ? new SchoolGradingHookAdapter({
        gateway: adapters.haGateway,
        loadSchoolConfig: (hid) => configService.getHouseholdAppConfig(hid, 'school') || {},
        logger: logger.child?.({ module: 'school-grading-hook' }) || logger,
      })
    : null;
```

Use whatever config accessor that module already uses for `school.yml` rather than introducing a second one.

- [ ] **Step 3: Verify boot is unaffected without a gateway**

Run: `npx vitest run tests/isolated/composition/`
Expected: all pass, including any existing wiring test. If a wiring test enumerates the consumer's dependencies, update it to include `gradingHook`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/5_composition/modules/schoolLifecycle.mjs
git commit -m "feat(school): wire the grading hook into the scan consumer

Guarded on haGateway so a household without Home Assistant boots unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Document it

**Files:**
- Modify: `docs/reference/school/README.md`
- Modify: `docs/reference/school/print-documents.md` (§8, beside the scan-outcome events table added earlier)

- [ ] **Step 1: Document the hook**

In `print-documents.md` §8, directly after the `school.print.scan-unresolved` / `scan-awaiting-review` table, add a short subsection covering: the `school.yml` `grading_hook.script` config, the full variable table from the spec, that all four outcomes fire, that behaviour lives in Home Assistant, and that the hook can never affect grading. State plainly that there is no score-band mapping and no per-learner override **by design**, so nobody adds one thinking it was an oversight.

In `README.md`, add one cross-reference from the scanning section pointing at it.

- [ ] **Step 2: Verify no contradiction**

```bash
grep -rn "grading_hook" docs/reference/school/
```
Expected: the new subsection and the cross-reference agree on the config key and the variable names.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/school/
git commit -m "docs(school): document the grading hook and its variable contract

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Gate

- [ ] **Step 1: Run every test this plan touched**

```bash
npx vitest run \
  tests/isolated/adapter/school/ \
  tests/isolated/composition/
```
Record actual pass counts. Do not proceed on a failure.

- [ ] **Step 2: Run the full gate**

```bash
npm run test:unit:vitest
```
Expected: `0 files failing`, `OK (no new failures vs baseline)`, exit 0. The baseline is empty, so any regression anywhere shows up here. **Never** run `--update` to make this pass.

---

## Self-Review

**Spec coverage.** Every element of the design spec maps to a task: the adapter and its no-dedup/no-throttle departures → Task 2; the uniform variable contract including `null`/`[]` filling → Task 2 Step 1 (two explicit assertions) ; `script.` prefix handling → Task 2; firing on all four outcomes → Task 3; grading-never-affected → Task 3 Step 1's rejecting-hook case and the fire-and-forget shape in Step 3; config presence as the enable switch → Task 2's `not_configured` case; composition guard → Task 4; docs → Task 5.

**Gap closed by Task 1.** The spec's `reasons`/`items` for the `review` outcome were not reachable — `RecordCardScanOutcome` logged them but returned only `pendingReview`. Task 1 exists solely to make the spec implementable, and is sequenced first because Task 3 depends on it.

**Known soft spots, deliberately left to the implementer with instructions rather than guessed:** Task 1 Step 1 and Task 3 Step 1 both say to read the existing fixture/dependency shape rather than invent one, because those constructors take several collaborators whose exact shape is not worth transcribing incorrectly here. Task 4 Step 1 says to find the construction site rather than naming a line.

**Type consistency.** `fire()` takes camelCase (`learnerId`, `pendingReview`) and emits snake_case (`learner_id`, `pending_review`) — the boundary is `toVariables()`, and both sides appear in Task 2's tests. The return shape `{ok, skipped?, reason?, error?}` is consistent across Task 2's implementation, its tests, and Task 3's fire-and-forget usage.
