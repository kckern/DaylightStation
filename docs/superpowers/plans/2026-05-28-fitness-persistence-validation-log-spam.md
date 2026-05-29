# Tame `fitness.persistence.validation_failed` Log Spam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `fitness.persistence.validation_failed` from flooding the session log (1,155 entries in one 38-min session) for the benign, expected "not yet persistable" reasons, while still surfacing genuine validation failures at `warn`.

**Architecture:** Every autosave attempt early in a session fails validation with `reason: "session-too-short"` (and similar) until the session is long enough — this is normal, not a warning. Split the emit: benign/transient reasons go through the rate-limited `logger.sampled(...)` (info-level, aggregated) under a distinct event name; genuine failures keep the un-sampled `warn`.

**Tech Stack:** Vitest. `getLogger().sampled(event, data, { maxPerMinute, aggregate })` emits at info with a `<event>.aggregated` summary when over budget.

**Source audit:** `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 5).

**Run a single Vitest spec (repo root):** `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/PersistenceManager.js` | Session persist + validation | Route benign validation reasons to `sampled` info; keep real failures as `warn` |
| `frontend/src/hooks/fitness/PersistenceManager.logspam.test.js` | Test | Create |

---

## Task 1: Sample the benign validation reasons

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (the validation-failed branch at lines ~907–915)
- Test: `frontend/src/hooks/fitness/PersistenceManager.logspam.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/PersistenceManager.logspam.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const warnSpy = vi.fn();
const sampledSpy = vi.fn();
const debugSpy = vi.fn();
vi.mock('../../lib/logging/Logger.js', () => ({
  default: () => ({ warn: warnSpy, info: vi.fn(), debug: debugSpy, error: vi.fn(), sampled: sampledSpy }),
  __esModule: true
}));

import { PersistenceManager } from './PersistenceManager.js';

beforeEach(() => { warnSpy.mockClear(); sampledSpy.mockClear(); });

// A session that fails validation with reason 'session-too-short'.
function tooShortSession() {
  const now = Date.now();
  return {
    sessionId: 'fs_test', startTime: now - 1000, endTime: now, durationMs: 1000,
    roster: [{ userId: 'user_2' }], timeline: { series: { user_2: { hr: [1, 2, 3] } } }, tickCount: 100
  };
}

describe('PersistenceManager — validation log spam', () => {
  it('routes session-too-short to sampled (not warn)', () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    for (let i = 0; i < 20; i += 1) pm.persistSession(tooShortSession(), { force: true });

    // No warn-level validation_failed for the benign reason.
    const warnedValidationFailed = warnSpy.mock.calls.some(
      ([ev]) => ev === 'fitness.persistence.validation_failed'
    );
    expect(warnedValidationFailed).toBe(false);
    // It used the rate-limited sampled path instead.
    expect(sampledSpy).toHaveBeenCalledWith(
      'fitness.persistence.validation_skipped',
      expect.objectContaining({ reason: 'session-too-short' }),
      expect.objectContaining({ maxPerMinute: expect.any(Number) })
    );
  });
});
```

(Confirm the exact Logger import specifier used in `PersistenceManager.js` — adjust the `vi.mock` path to match, e.g. `'../../lib/logging/Logger.js'`. Confirm `validateSessionPayload` returns `reason: 'session-too-short'` for a 1 s session — it does, per line 838. If the minimal payload trips a different reason first, adjust the fixture so `session-too-short` is the reason.)

- [ ] **Step 2: Run to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/PersistenceManager.logspam.test.js`
Expected: FAIL — today every attempt calls `warn('fitness.persistence.validation_failed', …)`.

- [ ] **Step 3: Split benign vs genuine failures**

In `PersistenceManager.js`, replace the validation-failed emit block (lines ~907–915):
```js
      getLogger().warn('fitness.persistence.validation_failed', {
        sessionId: sessionData?.sessionId,
        reason: validation?.reason,
        rosterLength: (Array.isArray(sessionData?.roster) ? sessionData.roster.length : 0),
        hasPriorSave: this.hasSuccessfulSave(sessionData?.sessionId)
      });
```
with:
```js
      const validationDetail = {
        sessionId: sessionData?.sessionId,
        reason: validation?.reason,
        rosterLength: (Array.isArray(sessionData?.roster) ? sessionData.roster.length : 0),
        hasPriorSave: this.hasSuccessfulSave(sessionData?.sessionId)
      };
      // Benign "not yet persistable" reasons fire on every early-session autosave —
      // rate-limit them to info+aggregate instead of warn-spamming the log.
      const BENIGN_VALIDATION_REASONS = new Set([
        'session-too-short',
        'session-too-short-and-empty',
        'insufficient-ticks'
      ]);
      if (BENIGN_VALIDATION_REASONS.has(validation?.reason)) {
        getLogger().sampled('fitness.persistence.validation_skipped', validationDetail, { maxPerMinute: 4, aggregate: true });
      } else {
        getLogger().warn('fitness.persistence.validation_failed', validationDetail);
      }
```
(Leave the existing capped `console.error` debug line above it untouched.)

- [ ] **Step 4: Run to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/PersistenceManager.logspam.test.js`
Expected: PASS.

- [ ] **Step 5: Run the broader persistence suite for regressions**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/` (filter to PersistenceManager specs if the full run is noisy). Confirm no test relied on a `warn` for `session-too-short`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js frontend/src/hooks/fitness/PersistenceManager.logspam.test.js
git commit -m "chore(fitness): rate-limit benign persistence validation log spam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes
- Genuine validation failures (`no-participants`, `series-tick-mismatch`, `no-meaningful-data`, `series-size-cap`, etc.) still emit at `warn` un-sampled — they're rare and worth seeing.
- If a benign reason ever indicates a real problem, the `<event>.aggregated` summary (emitted once per 60 s window when over budget) still records the count, so nothing is silently dropped.
