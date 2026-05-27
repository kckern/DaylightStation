# Admin UI Feedback and Error Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface in-flight / success / failure / partial-failure / stale-data feedback for every operator action in the Admin UI, starting with PlaybackHub and extending the pattern to Scheduler, Household, System, and Agents pages — so an operator never has to guess what the backend just did.

**Architecture:** Introduce one tiny reusable helper (`frontend/src/modules/Admin/shared/feedback.js`) that wraps Mantine's existing `notifications.show()` (already wired in `AdminApp.jsx`) into three intent-named functions — `notifySuccess`, `notifyPartial`, `notifyFailure` — and a `runWithFeedback(fn, opts)` async wrapper that handles the full lifecycle (loading toast → resolved success/partial/failure toast) plus structured logging via the project logger. PlaybackHub is the trigger case: `useHubMutations` is the failure ground-zero because it returns `{ applied, skipped }` from a `200 OK` response and currently lets the `skipped[]` array die in `TransportRow.handlePlayNow` / `handlePrev` / `handleNext` / `handlePause` / `scheduleVolumeSend`. We fix `useHubMutations` first (it becomes the canonical example), then cascade the helper into the silent-failure call sites in the other Admin subfolders. Staleness is handled separately by reading `fetchedAt` from `useHubStatus` and rendering a `<StalenessBanner />` when the snapshot ages past a threshold.

**Tech Stack:** React 18, Mantine 7 (`@mantine/core`, `@mantine/notifications` — both already in `frontend/package.json`), Vitest 4 + `@testing-library/react` 16, the project's logging framework at `frontend/src/lib/logging/`.

**Key existing files (read before starting):**
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js` — the failure ground-zero
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js` — emits a Map but discards `fetchedAt`
- `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx` — entry point that composes everything
- `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx` — the "Play Now" / prev / next / pause / volume call sites
- `frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.jsx` — silent `updateDevice` swallowing
- `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx` — silent `saveFire` / `deleteFire`
- `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.jsx` — silent `updateDevice`
- `frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.jsx` — silent `updateDevice`
- `frontend/src/hooks/admin/useAdminConfig.js` — existing good example of the notifications pattern (we extract from this)
- `frontend/src/Apps/AdminApp.jsx` — already mounts `<Notifications position="bottom-right" autoClose={3000} />`
- `backend/src/4_api/v1/routers/playbackHub.mjs` — wire shape (`{ ok, applied, skipped:[{color, reason}] }`)
- `backend/src/3_applications/playback-hub/usecases/SendHubCommand.mjs` — skip reasons (`unreachable`, `not-found`, `contention`)
- `frontend/src/lib/logging/Logger.js` — `getLogger().child({...})`
- `frontend/src/lib/api.mjs` — `DaylightAPI` (throws on non-2xx)

**Constraints carried from the spec:**
- Reuse `@mantine/notifications` — do not add a new toast library.
- Do not refactor unrelated Admin shells (`AdminLayout`, `AdminHeader`, `AdminNav`).
- No backwards-compat shims; change `useHubMutations` shape if needed (consumers in this repo will be migrated in the same plan).
- Every new module starts with structured logging via `getLogger().child({ component: 'X' })`.
- Every task is TDD — failing test first, minimal impl, passing test, commit.

---

## File structure (created / modified)

**Created:**
- `frontend/src/modules/Admin/shared/feedback.js` — `notifySuccess` / `notifyPartial` / `notifyFailure` / `runWithFeedback` (the helper)
- `frontend/src/modules/Admin/shared/feedback.test.js` — unit tests for the helper
- `frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.jsx` — dimmed-overlay + "live updates paused" banner
- `frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx`
- `frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.js` — derives `{ isStale, secondsSinceUpdate }` from a Date
- `frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx`

**Modified:**
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js` — wrap calls in `runWithFeedback`, return `{ ok, result, error }`
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx` — assert on new shape + notification side effects
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js` — expose `fetchedAt` alongside the Map (returns `{ devices, fetchedAt }`)
- `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx` — assert new return shape
- `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx` — destructure new `useHubStatus` shape, render `<StalenessBanner />`
- `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx` — assert banner renders when stale
- `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx` — show button loading state + propagate errors via the helper-wrapped mutations
- `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx` — assert loading + toast
- `frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.jsx` — same pattern
- `frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.test.jsx`
- `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx` — same pattern
- `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx`
- `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.jsx` — same pattern
- `frontend/src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx`
- `frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.jsx` — same pattern
- `frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.test.jsx`
- `frontend/src/modules/Admin/Household/DeviceEditor.jsx` — replace `setError`+`Alert` with `runWithFeedback`
- `frontend/src/modules/Admin/Scheduler/JobDetail.jsx` — replace silent `setError` paths on `Run` button with toasts (keep Alert for load failures)
- `frontend/src/modules/Admin/System/IntegrationDetail.jsx` — toast on `testConnection` success/failure

---

## Self-review notes (run after writing all tasks)

Spec coverage:
- "In flight: button shows loading state" → Tasks 8, 11, 12, 13, 14 (button `loading` prop wired through `runWithFeedback`'s in-flight callback).
- "Success: brief confirmation" → Task 2 (`notifySuccess` green 3s).
- "Failure: actual error message" → Task 2 (`notifyFailure` red no-autoclose).
- "Partial: applied + skipped" → Task 2 (`notifyPartial` yellow 7s, formatted message lists both).
- "Stale data: dimmed + banner" → Tasks 5, 6, 7 (`useStaleness`, `StalenessBanner`, page integration).
- "Survey ≥2 other Admin subfolders" → Tasks 15, 16, 17 (Household DeviceEditor, Scheduler JobDetail, System IntegrationDetail).

Placeholder scan: pass.
Type consistency: `runWithFeedback` always returns `{ ok, result, error }`; the renamed `useHubMutations` API matches across Tasks 3, 4, 8, 11, 12, 13, 14. `useHubStatus` shape change in Task 5 is consumed in Tasks 7 and 17.

---

## Task 0: Pre-flight — verify test infra and read the spec

**Files:** none (read-only)

- [ ] **Step 1: Verify Vitest works**

Run from `/opt/Code/DaylightStation/frontend/`:

```bash
npx vitest run src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx
```

Expected: existing suite passes (this is our control). If it fails, stop and report — we do not start work on a broken baseline.

- [ ] **Step 2: Re-read the trigger case in the spec**

The bug: clicking "Play Now" on the `white` device card, backend returns `{ ok: true, applied: [], skipped: [{color: 'white', reason: 'unreachable'}] }` with HTTP 502, UI shows nothing. We will fix this end-to-end and cascade the pattern.

- [ ] **Step 3: No commit (read-only step)**

---

## Task 1: Add `runWithFeedback` and notify helpers — failing test

**Files:**
- Create: `frontend/src/modules/Admin/shared/feedback.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Admin/shared/feedback.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @mantine/notifications BEFORE importing feedback.js
const showMock = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args) },
}));

// Mock the logger so we don't pollute the structured-log stream.
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy }),
}));

import {
  notifySuccess,
  notifyFailure,
  notifyPartial,
  runWithFeedback,
} from './feedback.js';

beforeEach(() => {
  showMock.mockClear();
  logSpy.info.mockClear();
  logSpy.warn.mockClear();
  logSpy.error.mockClear();
});

describe('notifySuccess', () => {
  it('shows a green toast with the given title and message', () => {
    notifySuccess({ title: 'Played', message: 'white now playing' });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Played',
      message: 'white now playing',
      color: 'green',
      autoClose: 3000,
    }));
  });
});

describe('notifyFailure', () => {
  it('shows a red toast that does NOT auto-close', () => {
    notifyFailure({ title: 'Play failed', message: 'white: unreachable' });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Play failed',
      message: 'white: unreachable',
      color: 'red',
      autoClose: false,
    }));
  });
});

describe('notifyPartial', () => {
  it('shows a yellow toast listing applied and skipped', () => {
    notifyPartial({
      title: 'Play partial',
      applied: ['red', 'blue'],
      skipped: [{ color: 'white', reason: 'unreachable' }],
    });
    const call = showMock.mock.calls[0][0];
    expect(call.color).toBe('yellow');
    expect(call.title).toBe('Play partial');
    expect(call.message).toContain('red, blue');
    expect(call.message).toContain('white: unreachable');
    expect(call.autoClose).toBe(7000);
  });
});

describe('runWithFeedback', () => {
  it('returns { ok: true, result } when fn resolves and shows a success toast', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, applied: ['red'], skipped: [] });
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      successTitle: 'Played',
      successMessage: (r) => `applied: ${r.applied.join(',')}`,
      partialFromResult: (r) => ({
        applied: r.applied,
        skipped: r.skipped,
        isPartial: r.skipped?.length > 0,
      }),
    });

    expect(out).toEqual({ ok: true, result: { ok: true, applied: ['red'], skipped: [] } });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ color: 'green' }));
    expect(logSpy.info).toHaveBeenCalledWith('playback-hub.play.success', expect.any(Object));
  });

  it('shows a partial toast when partialFromResult flags isPartial', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      applied: ['red'],
      skipped: [{ color: 'white', reason: 'unreachable' }],
    });
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      successTitle: 'Played',
      partialTitle: 'Play partial',
      partialFromResult: (r) => ({
        applied: r.applied,
        skipped: r.skipped,
        isPartial: r.skipped.length > 0,
      }),
    });

    expect(out.ok).toBe(true);
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ color: 'yellow' }));
    expect(logSpy.warn).toHaveBeenCalledWith('playback-hub.play.partial', expect.any(Object));
  });

  it('returns { ok: false, error } and shows a failure toast on throw', async () => {
    const err = new Error('HTTP 502');
    const fn = vi.fn().mockRejectedValue(err);
    const out = await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
      failureTitle: 'Play failed',
    });

    expect(out).toEqual({ ok: false, error: err });
    expect(showMock).toHaveBeenCalledWith(expect.objectContaining({
      color: 'red',
      title: 'Play failed',
      message: 'HTTP 502',
    }));
    expect(logSpy.error).toHaveBeenCalledWith('playback-hub.play.failure', expect.objectContaining({
      message: 'HTTP 502',
    }));
  });

  it('logs an info event when the fn starts (in-flight signal)', async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true });
    await runWithFeedback(fn, {
      logger: logSpy,
      eventName: 'playback-hub.play',
    });
    expect(logSpy.info).toHaveBeenCalledWith('playback-hub.play.started', expect.any(Object));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `/opt/Code/DaylightStation/frontend/`:

```bash
npx vitest run src/modules/Admin/shared/feedback.test.js
```

Expected: FAIL — `Cannot find module './feedback.js'`.

- [ ] **Step 3: No commit (test-only step, paired with Task 2)**

---

## Task 2: Implement `feedback.js`

**Files:**
- Create: `frontend/src/modules/Admin/shared/feedback.js`

- [ ] **Step 1: Verify the parent directory exists**

```bash
ls /opt/Code/DaylightStation/frontend/src/modules/Admin/shared/
```

Expected: directory listing (it already exists per the Admin folder structure).

- [ ] **Step 2: Write the implementation**

```javascript
// frontend/src/modules/Admin/shared/feedback.js
/**
 * Admin-UI feedback helpers — thin wrapper around @mantine/notifications.
 *
 * Three intent-named toast functions:
 *   notifySuccess({ title, message })        green, 3s auto-close
 *   notifyPartial({ title, applied, skipped }) yellow, 7s auto-close, formats applied/skipped
 *   notifyFailure({ title, message })        red, no auto-close
 *
 * `runWithFeedback(fn, opts)` — runs an async function and:
 *   - logs `${eventName}.started` (info)
 *   - on resolve: if `partialFromResult` returns `{ isPartial: true }`, shows
 *     partial toast + logs `${eventName}.partial` (warn). Otherwise shows
 *     success toast + logs `${eventName}.success` (info).
 *   - on reject: shows failure toast + logs `${eventName}.failure` (error).
 *
 * Returns:
 *   { ok: true, result }  on resolve (partial or fully successful)
 *   { ok: false, error }  on throw
 *
 * The hook NEVER re-throws — callers branch on `ok`. This is intentional: a
 * "Play Now" click should not crash React when the hub is unreachable.
 *
 * The opts.logger param accepts any object with .info/.warn/.error methods
 * (e.g. the result of getLogger().child({ component: 'X' })).
 */

import { notifications } from '@mantine/notifications';

export function notifySuccess({ title, message }) {
  notifications.show({
    title,
    message: message ?? '',
    color: 'green',
    autoClose: 3000,
  });
}

export function notifyFailure({ title, message }) {
  notifications.show({
    title,
    message: message ?? 'An error occurred',
    color: 'red',
    autoClose: false,
  });
}

export function notifyPartial({ title, applied = [], skipped = [] }) {
  const lines = [];
  if (applied.length > 0) lines.push(`applied: ${applied.join(', ')}`);
  if (skipped.length > 0) {
    const skipDesc = skipped
      .map((s) => `${s.color}: ${s.reason}`)
      .join('; ');
    lines.push(`skipped: ${skipDesc}`);
  }
  notifications.show({
    title,
    message: lines.join(' · '),
    color: 'yellow',
    autoClose: 7000,
  });
}

/**
 * @param {() => Promise<any>} fn
 * @param {{
 *   logger: { info: Function, warn: Function, error: Function },
 *   eventName: string,
 *   successTitle?: string,
 *   successMessage?: string | ((result: any) => string),
 *   partialTitle?: string,
 *   partialFromResult?: (result: any) => { isPartial: boolean, applied?: string[], skipped?: any[] },
 *   failureTitle?: string,
 *   logContext?: object,
 * }} opts
 * @returns {Promise<{ ok: true, result: any } | { ok: false, error: Error }>}
 */
export async function runWithFeedback(fn, opts = {}) {
  const {
    logger,
    eventName,
    successTitle,
    successMessage,
    partialTitle,
    partialFromResult,
    failureTitle,
    logContext = {},
  } = opts;

  if (!logger || !eventName) {
    throw new Error('runWithFeedback: logger and eventName are required');
  }

  logger.info(`${eventName}.started`, logContext);

  try {
    const result = await fn();
    const partial = partialFromResult ? partialFromResult(result) : null;
    if (partial?.isPartial) {
      logger.warn(`${eventName}.partial`, {
        ...logContext,
        applied: partial.applied,
        skipped: partial.skipped,
      });
      if (partialTitle) {
        notifyPartial({
          title: partialTitle,
          applied: partial.applied ?? [],
          skipped: partial.skipped ?? [],
        });
      }
    } else if (successTitle) {
      const msg = typeof successMessage === 'function'
        ? successMessage(result)
        : successMessage;
      logger.info(`${eventName}.success`, logContext);
      notifySuccess({ title: successTitle, message: msg });
    } else {
      logger.info(`${eventName}.success`, logContext);
    }
    return { ok: true, result };
  } catch (error) {
    logger.error(`${eventName}.failure`, {
      ...logContext,
      message: error?.message ?? String(error),
    });
    if (failureTitle) {
      notifyFailure({ title: failureTitle, message: error?.message ?? String(error) });
    }
    return { ok: false, error };
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/shared/feedback.test.js
```

Expected: PASS — all 6 tests green.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/shared/feedback.js frontend/src/modules/Admin/shared/feedback.test.js
git commit -m "feat(admin): add feedback helper for toast notifications

Adds runWithFeedback() + notifySuccess/notifyPartial/notifyFailure as a
thin wrapper around @mantine/notifications. Used to replace silent
error-swallowing across Admin UI."
```

---

## Task 3: Rewire `useHubMutations` to use `runWithFeedback` — failing test

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`

- [ ] **Step 1: Hoist a top-level mock for `@mantine/notifications`**

At the very top of `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx`, BEFORE the existing `import { useHubMutations }` line, add:

```javascript
// Hoisted by Vitest. The shared spy is exposed via the module so tests
// below can clear and inspect calls.
import { vi } from 'vitest';

export const showMock = vi.fn();
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args) },
}));
```

(The `import { vi } from 'vitest';` already exists in the file — collapse the duplicates if so. The `export` is needed because Vitest hoists `vi.mock` above imports, and the test bodies need to read `showMock`.)

Wait — `vi.mock` is hoisted but its factory function executes in a sandbox where module-scope variables are not available. The standard pattern is `vi.hoisted`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { showMock } = vi.hoisted(() => ({ showMock: vi.fn() }));
vi.mock('@mantine/notifications', () => ({
  notifications: { show: (...args) => showMock(...args) },
}));

import { useHubMutations } from './useHubMutations.js';
```

This is the actual code to put at the top of the file. `vi.hoisted` lets the factory reference `showMock` because both get hoisted together.

In the existing `beforeEach`, add `showMock.mockClear();`:

```javascript
  beforeEach(() => {
    revalidate = vi.fn();
    global.fetch = vi.fn();
    showMock.mockClear();
  });
```

- [ ] **Step 2: Append the feedback-wiring describe block**

Append the following inside the existing `describe('useHubMutations', ...)` block, AFTER `describe('deleteFire', ...)` and BEFORE the final standalone `it('works when no revalidate callback is provided', ...)`:

```javascript
  // --------------------------------------------------------------------
  // Feedback shape (returns { ok, result, error })
  // --------------------------------------------------------------------

  describe('feedback wiring', () => {
    it('sendCommand returns { ok: true, result } on full success', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true, applied: ['red'], skipped: [],
      }));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red', action: 'play',
        });
      });

      expect(response).toEqual({
        ok: true,
        result: { ok: true, applied: ['red'], skipped: [] },
      });
    });

    it('sendCommand returns { ok: true, result } AND shows a partial toast when skipped is non-empty', async () => {
      global.fetch.mockReturnValueOnce(ok({
        ok: true,
        applied: [],
        skipped: [{ color: 'white', reason: 'unreachable' }],
      }, 502));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'white', action: 'play',
        });
      });

      expect(response.ok).toBe(true);
      expect(response.result.skipped).toEqual([
        { color: 'white', reason: 'unreachable' },
      ]);
      const yellow = showMock.mock.calls.find((c) => c[0].color === 'yellow');
      expect(yellow).toBeTruthy();
      expect(yellow[0].message).toContain('white');
      expect(yellow[0].message).toContain('unreachable');
    });

    it('sendCommand returns { ok: false, error } when fetch rejects', async () => {
      global.fetch.mockRejectedValueOnce(new Error('network'));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.sendCommand({
          target: 'red', action: 'play',
        });
      });

      expect(response.ok).toBe(false);
      expect(response.error.message).toBe('network');
      const red = showMock.mock.calls.find((c) => c[0].color === 'red');
      expect(red).toBeTruthy();
    });

    it('updateDevice returns { ok: false, error } when response is non-2xx', async () => {
      global.fetch.mockReturnValueOnce(ok(
        { ok: false, error: 'invariant violated: max < min' },
        422,
      ));

      const { result } = renderHook(() => useHubMutations({ revalidate }));
      let response;
      await act(async () => {
        response = await result.current.updateDevice('red', { volume: { min: 90, max: 10 } });
      });

      expect(response.ok).toBe(false);
      expect(response.error.message).toContain('invariant violated');
      expect(revalidate).not.toHaveBeenCalled();
      const red = showMock.mock.calls.find((c) => c[0].color === 'red');
      expect(red).toBeTruthy();
      expect(red[0].message).toContain('invariant violated');
    });
  });
```

- [ ] **Step 2: Update the EXISTING sendCommand tests to expect the new shape**

In the same file, modify each existing `it(...)` inside `describe('sendCommand', ...)` and `describe('updateDevice', ...)` and `describe('saveFire', ...)` and `describe('deleteFire', ...)` — change every `expect(response).toEqual({ ok: true, ... })` to wrap the body:

Replace this block in the `'POSTs to /command and returns the result'` test:

```javascript
      expect(response).toEqual({ ok: true, applied: ['red'], skipped: [] });
```

with:

```javascript
      expect(response).toEqual({ ok: true, result: { ok: true, applied: ['red'], skipped: [] } });
```

Apply the same wrapper transform to ALL other `expect(response)...` assertions in the file:
- `'auto-retries ONCE...'` → `expect(response.result.applied).toEqual(['yellow', 'green']);`
- `'does NOT retry a second time...'` → `expect(response.result.skipped).toEqual([{ color: 'red', reason: 'contention' }]);`
- `'does NOT retry on non-contention skips'` → `expect(response.result.applied).toEqual([]);`
- `'PATCHes /devices/:color...'` → `expect(response.result.device.color).toBe('red');`
- `'DELETEs /scheduled/:id...'` → `expect(response).toEqual({ ok: true, result: { ok: true } });`
- `'does NOT call revalidate on a non-2xx response'` (deleteFire) → `expect(response.ok).toBe(false);`

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx
```

Expected: FAIL — both old-shape tests fail (because impl still returns the raw body) AND the new feedback tests fail.

- [ ] **Step 4: No commit (paired with Task 4)**

---

## Task 4: Rewrite `useHubMutations` to use `runWithFeedback`

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js`

- [ ] **Step 1: Replace the file contents in full**

```javascript
// frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js
import { useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { runWithFeedback } from '../../shared/feedback.js';

const CONTENTION_RETRY_DELAY_MS = 500;

/**
 * Write helpers for the playback-hub admin.
 *
 * Every call goes through `runWithFeedback` so the user sees a toast for
 * success / partial / failure, and an entry shows up in the structured log
 * stream under `playback-hub.<action>.<phase>`.
 *
 * Each mutation returns `{ ok, result?, error? }`:
 *   - on full success:    { ok: true, result: <wire body> }
 *   - on partial success: { ok: true, result: <wire body> }  (yellow toast shown)
 *   - on HTTP error or network throw: { ok: false, error }   (red toast shown)
 *
 * `sendCommand` keeps its existing contention auto-retry (500ms delay,
 * single retry, only the contention'd targets), but now the toast logic
 * runs against the FINAL merged result, not the intermediate one.
 */
export function useHubMutations({ revalidate } = {}) {
  const logger = useMemo(
    () => getLogger().child({ component: 'useHubMutations' }),
    [],
  );

  const sendCommandRaw = useCallback(async (body, _attempt = 0) => {
    const r = await fetch('/api/v1/playback-hub/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await r.json();

    // The backend uses HTTP 502 for "all skips are terminal" partial-failure
    // (see playbackHub.mjs:50-58) but the body still has `ok: true` plus
    // `applied: []` + `skipped: [{color, reason}]`. We treat that as a
    // structured partial result, NOT a thrown error, so runWithFeedback
    // can classify it as yellow-partial via `partialFromResult`. Real
    // protocol-level errors (the body has `ok: false`) become exceptions.
    if (_attempt === 0 && Array.isArray(result?.skipped)) {
      const contention = result.skipped.filter((s) => s?.reason === 'contention');
      if (contention.length > 0) {
        const retryTargets = contention.map((s) => s.color).join(',');
        await new Promise((res) => setTimeout(res, CONTENTION_RETRY_DELAY_MS));
        return sendCommandRaw({ ...body, target: retryTargets }, 1);
      }
    }

    if (result?.ok === false) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const sendCommand = useCallback((body) => {
    return runWithFeedback(() => sendCommandRaw(body), {
      logger,
      eventName: `playback-hub.command.${body?.action ?? 'unknown'}`,
      successTitle: 'Command sent',
      successMessage: (r) =>
        `${body?.action ?? 'command'}: ${(r.applied ?? []).join(', ') || '(no targets)'}`,
      partialTitle: 'Command partial',
      partialFromResult: (r) => ({
        applied: r.applied ?? [],
        skipped: r.skipped ?? [],
        isPartial: (r.skipped ?? []).length > 0,
      }),
      failureTitle: 'Command failed',
      logContext: { action: body?.action, target: body?.target },
    });
  }, [logger, sendCommandRaw]);

  const updateDeviceRaw = useCallback(async (color, patch) => {
    const r = await fetch(
      `/api/v1/playback-hub/devices/${encodeURIComponent(color)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    const result = await r.json();
    if (!r.ok) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const updateDevice = useCallback((color, patch) => {
    return runWithFeedback(() => updateDeviceRaw(color, patch), {
      logger,
      eventName: 'playback-hub.update-device',
      successTitle: 'Saved',
      successMessage: () => `${color} updated`,
      failureTitle: `Could not update ${color}`,
      logContext: { color },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, updateDeviceRaw, revalidate]);

  const saveFireRaw = useCallback(async (fire) => {
    const isUpdate = !!fire?.id;
    const url = isUpdate
      ? `/api/v1/playback-hub/scheduled/${encodeURIComponent(fire.id)}`
      : `/api/v1/playback-hub/scheduled`;
    const r = await fetch(url, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fire),
    });
    const result = await r.json();
    if (!r.ok) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const saveFire = useCallback((fire) => {
    const isUpdate = !!fire?.id;
    return runWithFeedback(() => saveFireRaw(fire), {
      logger,
      eventName: isUpdate
        ? 'playback-hub.fire.update'
        : 'playback-hub.fire.create',
      successTitle: isUpdate ? 'Schedule updated' : 'Schedule created',
      successMessage: (r) =>
        `${r.fire?.target ?? fire?.target ?? '?'} @ ${r.fire?.time ?? fire?.time ?? '?'}`,
      failureTitle: 'Could not save schedule',
      logContext: { id: fire?.id, target: fire?.target },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, saveFireRaw, revalidate]);

  const deleteFireRaw = useCallback(async (id) => {
    const r = await fetch(
      `/api/v1/playback-hub/scheduled/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const body = await r.json();
        detail = body?.error ?? detail;
      } catch { /* no body */ }
      const err = new Error(detail);
      err.status = r.status;
      throw err;
    }
    return { ok: true };
  }, []);

  const deleteFire = useCallback((id) => {
    return runWithFeedback(() => deleteFireRaw(id), {
      logger,
      eventName: 'playback-hub.fire.delete',
      successTitle: 'Schedule deleted',
      successMessage: () => `id: ${id}`,
      failureTitle: 'Could not delete schedule',
      logContext: { id },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, deleteFireRaw, revalidate]);

  return { sendCommand, updateDevice, saveFire, deleteFire };
}

export default useHubMutations;
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx
```

Expected: PASS — all tests including the new feedback wiring tests.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.js frontend/src/modules/Admin/PlaybackHub/hooks/useHubMutations.test.jsx
git commit -m "feat(admin/playback-hub): surface success/partial/failure feedback from mutations

Wraps sendCommand/updateDevice/saveFire/deleteFire in runWithFeedback so
that every call produces a structured log event AND a Mantine toast.
Trigger case: Play Now on an unreachable device now shows a yellow
partial-failure toast naming the device and reason."
```

---

## Task 5: Expose `fetchedAt` from `useHubStatus` — failing test

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx`

- [ ] **Step 1: Update the test file**

Open the existing file and inspect its first few tests to understand what is currently asserted (it asserts the returned Map). Then add a new top-level describe block:

```javascript
describe('useHubStatus return shape', () => {
  it('returns { devices: Map, fetchedAt: Date } instead of bare Map', async () => {
    const initialBody = {
      ok: true,
      slots: [{ color: 'red', volume: 50 }],
      fetchedAt: '2026-05-27T12:00:00.000Z',
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(initialBody),
    });

    const { result } = renderHook(() => useHubStatus());

    // Allow the GET to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toHaveProperty('devices');
    expect(result.current).toHaveProperty('fetchedAt');
    expect(result.current.devices).toBeInstanceOf(Map);
    expect(result.current.devices.get('red')).toMatchObject({ color: 'red', volume: 50 });
    expect(result.current.fetchedAt).toBeInstanceOf(Date);
    expect(result.current.fetchedAt.toISOString()).toBe('2026-05-27T12:00:00.000Z');
  });

  it('returns { devices: empty Map, fetchedAt: null } before initial GET resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => { /* never resolves */ }));
    const { result } = renderHook(() => useHubStatus());
    expect(result.current.devices).toBeInstanceOf(Map);
    expect(result.current.devices.size).toBe(0);
    expect(result.current.fetchedAt).toBeNull();
  });
});
```

Then **update the existing tests** that destructure the return value or call `.get()` on it directly — they currently do `const map = result.current; map.get('red')`. Wherever that pattern appears, change to `const { devices } = result.current; devices.get('red')`. (Inspect the existing file first — there are likely 2–3 such call sites.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx
```

Expected: FAIL — `result.current.devices is undefined` for the new tests, AND the updated existing tests fail.

- [ ] **Step 3: No commit (paired with Task 6)**

---

## Task 6: Implement the new `useHubStatus` shape

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js`

- [ ] **Step 1: Replace the file contents in full**

```javascript
// frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js
import { useEffect, useState, useMemo, useCallback } from 'react';
import { wsService } from '../../../../services/WebSocketService.js';

/**
 * Live hub status. Returns BOTH a Map<color, SlotStatus> and the timestamp
 * of the most recent snapshot, so consumers can detect staleness.
 *
 * Wire shapes:
 *   GET response  → { ok, slots:   SlotStatus[], fetchedAt: <iso string> }
 *   WS message    → { data: { devices: SlotStatus[], fetchedAt: Date } }
 *
 * Race guard: GET (~100-500 ms) can land AFTER a WS tick. `accept()` only
 * applies payloads strictly newer than the current snapshot.
 *
 * @returns {{ devices: Map<string, object>, fetchedAt: Date | null }}
 */
export function useHubStatus() {
  const [snapshot, setSnapshot] = useState(null);

  const accept = useCallback((data) => {
    if (!data?.fetchedAt) return;
    const t = data.fetchedAt instanceof Date
      ? data.fetchedAt
      : new Date(data.fetchedAt);
    setSnapshot((prev) => {
      if (prev?.fetchedAt && prev.fetchedAt >= t) return prev;
      const list = data.devices ?? data.slots ?? [];
      return { devices: list, fetchedAt: t };
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/v1/playback-hub/status')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body?.ok) accept(body);
      })
      .catch(() => { /* WS will deliver shortly */ });
    return () => { cancelled = true; };
  }, [accept]);

  useEffect(() => {
    return wsService.subscribe('playback-hub:status', (msg) => {
      if (msg?.type === 'playback-hub.status.snapshot') {
        accept(msg.data);
      }
    });
  }, [accept]);

  return useMemo(() => {
    const m = new Map();
    (snapshot?.devices ?? []).forEach((d) => m.set(d.color, d));
    return { devices: m, fetchedAt: snapshot?.fetchedAt ?? null };
  }, [snapshot]);
}

export default useHubStatus;
```

- [ ] **Step 2: Update `PlaybackHubPage.jsx` to use the new shape**

In `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx`, change:

```javascript
  const status = useHubStatus();
```

to:

```javascript
  const { devices: statusByColor, fetchedAt: statusFetchedAt } = useHubStatus();
```

And change:

```javascript
          status={status.get(device.color)}
```

to:

```javascript
          status={statusByColor.get(device.color)}
```

Leave `statusFetchedAt` unused for now — Task 7 wires it into the banner. Mark it `// eslint-disable-next-line no-unused-vars` if your project lints unused vars, otherwise leave plain.

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx
```

Expected: PASS — both files.

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.js frontend/src/modules/Admin/PlaybackHub/hooks/useHubStatus.test.jsx frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx
git commit -m "refactor(admin/playback-hub): expose fetchedAt from useHubStatus

useHubStatus now returns { devices: Map, fetchedAt: Date | null } so
downstream code can detect staleness when the WS feed goes silent."
```

---

## Task 7a: `useStaleness` hook — failing test

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStaleness } from './useStaleness.js';

describe('useStaleness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports not-stale for a fresh timestamp', () => {
    const now = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(now);
    const { result } = renderHook(() => useStaleness(now, { staleAfterMs: 10000 }));
    expect(result.current.isStale).toBe(false);
    expect(result.current.secondsSinceUpdate).toBe(0);
  });

  it('reports stale after staleAfterMs elapses', () => {
    const t0 = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(t0);
    const { result } = renderHook(() => useStaleness(t0, { staleAfterMs: 10000, tickMs: 1000 }));
    expect(result.current.isStale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(result.current.isStale).toBe(true);
    expect(result.current.secondsSinceUpdate).toBeGreaterThanOrEqual(15);
  });

  it('reports isStale=true when fetchedAt is null (never received a snapshot)', () => {
    const { result } = renderHook(() => useStaleness(null, { staleAfterMs: 10000 }));
    expect(result.current.isStale).toBe(true);
    expect(result.current.secondsSinceUpdate).toBeNull();
  });

  it('updates secondsSinceUpdate as time passes', () => {
    const t0 = new Date('2026-05-27T12:00:00.000Z');
    vi.setSystemTime(t0);
    const { result } = renderHook(() => useStaleness(t0, { staleAfterMs: 10000, tickMs: 1000 }));
    expect(result.current.secondsSinceUpdate).toBe(0);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.secondsSinceUpdate).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx
```

Expected: FAIL — `Cannot find module './useStaleness.js'`.

- [ ] **Step 3: No commit (paired with 7b)**

---

## Task 7b: Implement `useStaleness`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.js`

- [ ] **Step 1: Write the implementation**

```javascript
// frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.js
import { useEffect, useState } from 'react';

/**
 * Derive a staleness signal from a "last updated" timestamp.
 *
 * The broadcaster ticks every 3s. With a default `staleAfterMs` of 10s we
 * tolerate two missed ticks before raising the staleness flag.
 *
 * @param {Date|null} fetchedAt - timestamp of the most recent snapshot
 * @param {{ staleAfterMs?: number, tickMs?: number }} [opts]
 * @returns {{ isStale: boolean, secondsSinceUpdate: number | null }}
 */
export function useStaleness(fetchedAt, opts = {}) {
  const { staleAfterMs = 10000, tickMs = 1000 } = opts;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  if (!fetchedAt) {
    return { isStale: true, secondsSinceUpdate: null };
  }

  const elapsed = Math.max(0, now - fetchedAt.getTime());
  return {
    isStale: elapsed > staleAfterMs,
    secondsSinceUpdate: Math.floor(elapsed / 1000),
  };
}

export default useStaleness;
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx
```

Expected: PASS — all 4 tests.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.js frontend/src/modules/Admin/PlaybackHub/hooks/useStaleness.test.jsx
git commit -m "feat(admin/playback-hub): add useStaleness hook for status-feed liveness"
```

---

## Task 7c: `StalenessBanner` component — failing test

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx`

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { StalenessBanner } from './StalenessBanner.jsx';

function r(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('StalenessBanner', () => {
  it('renders null when not stale', () => {
    const { container } = r(<StalenessBanner isStale={false} secondsSinceUpdate={2} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a banner when stale', () => {
    const { getByText } = r(<StalenessBanner isStale={true} secondsSinceUpdate={42} />);
    expect(getByText(/live updates paused/i)).toBeTruthy();
    expect(getByText(/42/)).toBeTruthy();
  });

  it('renders "no snapshot yet" when secondsSinceUpdate is null', () => {
    const { getByText } = r(<StalenessBanner isStale={true} secondsSinceUpdate={null} />);
    expect(getByText(/no snapshot/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx
```

Expected: FAIL — `Cannot find module './StalenessBanner.jsx'`.

- [ ] **Step 3: No commit (paired with 7d)**

---

## Task 7d: Implement `StalenessBanner`

**Files:**
- Create: `frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.jsx`

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.jsx
import React from 'react';
import { Alert } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * StalenessBanner — visible only when the live status feed is stale.
 * Shows above the device cards so the operator knows the "BT ✓ / idle / 45/75"
 * info under each card may not reflect reality.
 *
 * Props:
 *   isStale:              boolean - from useStaleness
 *   secondsSinceUpdate:   number | null - from useStaleness
 */
export function StalenessBanner({ isStale, secondsSinceUpdate }) {
  if (!isStale) return null;
  const detail = secondsSinceUpdate == null
    ? 'no snapshot received yet'
    : `last update ${secondsSinceUpdate}s ago`;
  return (
    <Alert
      icon={<IconAlertTriangle size={16} />}
      color="yellow"
      title="Live updates paused"
    >
      Status cards below may not reflect reality — {detail}.
    </Alert>
  );
}

export default StalenessBanner;
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx
```

Expected: PASS — all 3 tests.

- [ ] **Step 3: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.jsx frontend/src/modules/Admin/PlaybackHub/components/StalenessBanner.test.jsx
git commit -m "feat(admin/playback-hub): add StalenessBanner for paused live updates"
```

---

## Task 7e: Wire `StalenessBanner` into `PlaybackHubPage`

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx`

- [ ] **Step 1: Add a failing test**

Append the following inside the existing `describe('PlaybackHubPage', ...)` block in `PlaybackHubPage.test.jsx`:

```javascript
  it('renders StalenessBanner when fetchedAt is null', () => {
    // Hub config loaded but no status snapshot yet → banner visible.
    hubConfigState.config = { devices: [{ color: 'red', class: 'private', volume: {} }] };
    hubConfigState.loading = false;
    hubConfigState.error = null;
    hubStatusMap.clear();
    // Override the useHubStatus mock for this test to return null fetchedAt.
    vi.doMock('./hooks/useHubStatus', () => ({
      useHubStatus: () => ({ devices: new Map(), fetchedAt: null }),
    }));
    // Re-import the page so the new mock is picked up.
    return import('./PlaybackHubPage.jsx').then(({ default: FreshPage }) => {
      const { getByText } = render(
        <MantineProvider>
          <FreshPage />
        </MantineProvider>,
      );
      expect(getByText(/live updates paused/i)).toBeTruthy();
    });
  });
```

(NOTE: the test file's existing mock for `useHubStatus` returns the bare Map. After Task 6 we changed `PlaybackHubPage.jsx` to destructure `{ devices, fetchedAt }`. **Update the top-of-file mock** in `PlaybackHubPage.test.jsx` from:

```javascript
vi.mock('./hooks/useHubStatus', () => ({
  useHubStatus: () => hubStatusMap,
}));
```

to:

```javascript
vi.mock('./hooks/useHubStatus', () => ({
  useHubStatus: () => ({ devices: hubStatusMap, fetchedAt: new Date() }),
}));
```

This makes the existing tests pass against the new shape AND lets the new test override via `vi.doMock`.)

- [ ] **Step 2: Run tests to verify the new one fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx
```

Expected: FAIL on the new test — banner not rendered.

- [ ] **Step 3: Wire the banner into `PlaybackHubPage.jsx`**

Replace the imports block:

```jsx
import React from 'react';
import { Stack, Loader, Alert, Text } from '@mantine/core';
import { useHubStatus } from './hooks/useHubStatus';
import { useHubConfig } from './hooks/useHubConfig';
import { useHubMutations } from './hooks/useHubMutations';
import DeviceCard from './components/DeviceCard';
import './PlaybackHubPage.scss';
```

with:

```jsx
import React from 'react';
import { Stack, Loader, Alert, Text } from '@mantine/core';
import { useHubStatus } from './hooks/useHubStatus';
import { useHubConfig } from './hooks/useHubConfig';
import { useHubMutations } from './hooks/useHubMutations';
import { useStaleness } from './hooks/useStaleness';
import DeviceCard from './components/DeviceCard';
import { StalenessBanner } from './components/StalenessBanner.jsx';
import './PlaybackHubPage.scss';
```

Then replace the function body's `return` block. Current:

```jsx
  return (
    <Stack gap="md" p="md" className="playback-hub-page">
      {config.devices.map((device) => (
        <DeviceCard
          key={device.color}
          slot={device}
          status={statusByColor.get(device.color)}
          scheduledFires={allFires.filter((f) => f.target === device.color)}
          mutations={mutations}
        />
      ))}
    </Stack>
  );
```

New:

```jsx
  const { isStale, secondsSinceUpdate } = useStaleness(statusFetchedAt);

  return (
    <Stack gap="md" p="md" className="playback-hub-page">
      <StalenessBanner isStale={isStale} secondsSinceUpdate={secondsSinceUpdate} />
      {config.devices.map((device) => (
        <DeviceCard
          key={device.color}
          slot={device}
          status={statusByColor.get(device.color)}
          scheduledFires={allFires.filter((f) => f.target === device.color)}
          mutations={mutations}
        />
      ))}
    </Stack>
  );
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx
```

Expected: PASS — all tests including the new banner test.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.jsx frontend/src/modules/Admin/PlaybackHub/PlaybackHubPage.test.jsx
git commit -m "feat(admin/playback-hub): render StalenessBanner when status feed is stale"
```

---

## Task 8: TransportRow — show button loading state for Play Now / prev / next / pause

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx`

- [ ] **Step 1: Add a failing test for button loading state**

Append inside the existing `describe('TransportRow', ...)` block:

```javascript
  it('disables Play Now button while sendCommand is in flight', async () => {
    let resolveCmd;
    const pending = new Promise((resolve) => { resolveCmd = resolve; });
    mutations.sendCommand = vi.fn().mockReturnValue(pending);

    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    // Pick a value so Play Now is enabled.
    act(() => {
      pickerOnChangeRef('plex:42');
    });

    const playBtn = screen.getByRole('button', { name: /^play now$/i });
    expect(playBtn).not.toBeDisabled();

    fireEvent.click(playBtn);
    // While in flight: still in DOM but disabled.
    expect(playBtn).toBeDisabled();

    await act(async () => {
      resolveCmd({ ok: true, result: { applied: ['red'], skipped: [] } });
    });

    expect(playBtn).not.toBeDisabled();
  });

  it('does not crash if sendCommand returns { ok: false }', async () => {
    mutations.sendCommand = vi.fn().mockResolvedValue({
      ok: false,
      error: new Error('HTTP 502'),
    });

    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    act(() => {
      pickerOnChangeRef('plex:42');
    });

    fireEvent.click(screen.getByRole('button', { name: /^play now$/i }));
    // Just await microtasks — no throw expected.
    await act(async () => { await Promise.resolve(); });
    // Button should be re-enabled after the failure too.
    const playBtn = screen.getByRole('button', { name: /^play now$/i });
    expect(playBtn).not.toBeDisabled();
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx
```

Expected: FAIL — the button does not currently track in-flight state.

- [ ] **Step 3: Update `TransportRow.jsx`**

Replace the function body of `export function TransportRow({ slot, status, mutations })`. Existing handlers `handlePrev` / `handleNext` / `handlePause` / `handlePlayNow` are fire-and-forget. Change to:

```jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Group, Slider, Button, ActionIcon, Box } from '@mantine/core';
import {
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import { LabeledContentPicker } from './LabeledContentPicker.jsx';

const VOLUME_DEBOUNCE_MS = 300;

export function TransportRow({ slot, status, mutations }) {
  const maxVol = slot?.volume?.max ?? 100;
  const minVol = slot?.volume?.min ?? 0;
  const defaultVol = slot?.volume?.default ?? 0;

  const [pickedValue, setPickedValue] = useState('');
  const [sliderValue, setSliderValue] = useState(status?.volume ?? defaultVol);
  const [busyKey, setBusyKey] = useState(null); // 'prev' | 'pause' | 'next' | 'play' | null

  const userInteractingRef = useRef(false);
  useEffect(() => {
    if (userInteractingRef.current) return;
    if (typeof status?.volume === 'number') {
      setSliderValue(status.volume);
    }
  }, [status?.volume]);

  const debounceTimerRef = useRef(null);
  const scheduleVolumeSend = useCallback((vol) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      userInteractingRef.current = false;
      mutations.sendCommand({
        action: 'volume',
        target: slot.color,
        volume: vol,
      });
    }, VOLUME_DEBOUNCE_MS);
  }, [mutations, slot.color]);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  const run = useCallback(async (key, body) => {
    setBusyKey(key);
    try {
      await mutations.sendCommand(body);
    } finally {
      setBusyKey(null);
    }
  }, [mutations]);

  const handlePrev = () => run('prev', { action: 'prev', target: slot.color });
  const handleNext = () => run('next', { action: 'next', target: slot.color });
  const handlePause = () => run('pause', { action: 'pause', target: slot.color });
  const handlePlayNow = () => {
    if (!pickedValue) return;
    run('play', { action: 'play', target: slot.color, contentId: pickedValue });
  };

  const isPaused = status?.paused === true;

  return (
    <Group gap="sm" wrap="nowrap" align="center" mt="md">
      <ActionIcon size="lg" variant="default" onClick={handlePrev}
        aria-label="prev" title="Previous"
        loading={busyKey === 'prev'} disabled={busyKey !== null && busyKey !== 'prev'}>
        <IconPlayerSkipBack size={18} />
      </ActionIcon>
      <ActionIcon size="lg" variant="default" onClick={handlePause}
        aria-label={isPaused ? 'play' : 'pause'} title={isPaused ? 'Resume' : 'Pause'}
        loading={busyKey === 'pause'} disabled={busyKey !== null && busyKey !== 'pause'}>
        {isPaused ? <IconPlayerPlay size={18} /> : <IconPlayerPause size={18} />}
      </ActionIcon>
      <ActionIcon size="lg" variant="default" onClick={handleNext}
        aria-label="next" title="Next"
        loading={busyKey === 'next'} disabled={busyKey !== null && busyKey !== 'next'}>
        <IconPlayerSkipForward size={18} />
      </ActionIcon>
      <Box style={{ width: 140 }}>
        <Slider
          value={sliderValue} min={minVol} max={maxVol}
          onChange={(v) => {
            userInteractingRef.current = true;
            setSliderValue(v);
            scheduleVolumeSend(v);
          }}
          label={(v) => `${v}/${maxVol}`}
        />
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <LabeledContentPicker
          value={pickedValue}
          onChange={(id) => setPickedValue(id || '')}
          placeholder="Pick content..."
        />
      </Box>
      <Button size="sm" variant="filled"
        disabled={!pickedValue || (busyKey !== null && busyKey !== 'play')}
        loading={busyKey === 'play'}
        onClick={handlePlayNow}>
        Play Now
      </Button>
    </Group>
  );
}

export default TransportRow;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx
```

Expected: PASS — all tests including the new in-flight tests. The existing tests should also still pass because the mocked `sendCommand` is `vi.fn().mockResolvedValue({ ok: true })` (synchronous-ish resolve), so `busyKey` flips back to `null` before assertions.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/components/TransportRow.jsx frontend/src/modules/Admin/PlaybackHub/components/TransportRow.test.jsx
git commit -m "feat(admin/playback-hub): show button loading state in TransportRow

Buttons now disable + show spinner while sendCommand is in flight.
Other buttons in the row dim as well to make the active op visible."
```

---

## Task 9: VolumeLimitsSection — handle `{ ok: false }` from updateDevice

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.test.jsx`

- [ ] **Step 1: Add a failing test**

Append inside the existing describe block (read the file first to find it):

```javascript
  it('does NOT rebaseline when updateDevice returns { ok: false }', async () => {
    const mutations = {
      updateDevice: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('HTTP 422: invariant violated'),
      }),
    };
    const slot = { color: 'red', volume: { default: 50, min: 0, max: 75 } };

    const { getByRole, getAllByRole } = render(
      <MantineProvider>
        <VolumeLimitsSection slot={slot} mutations={mutations} />
      </MantineProvider>,
    );

    // Change min to 80 (would violate invariant: min > max).
    const numberInputs = getAllByRole('textbox');
    fireEvent.change(numberInputs[1], { target: { value: '80' } });

    const saveBtn = getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await act(async () => { await Promise.resolve(); });

    // After failure: the form should STILL be dirty (Save still enabled)
    // so the user knows their change wasn't accepted.
    expect(getByRole('button', { name: /save/i })).not.toBeDisabled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.test.jsx
```

Expected: FAIL — current code calls `setBaseline({ ...vals })` unconditionally.

- [ ] **Step 3: Patch the file**

In `VolumeLimitsSection.jsx`, replace the `handleSave` function:

Current:

```javascript
  const handleSave = async () => {
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, { volume: { ...vals } });
      setBaseline({ ...vals });
    } finally {
      setSaving(false);
    }
  };
```

New:

```javascript
  const handleSave = async () => {
    setSaving(true);
    try {
      const out = await mutations.updateDevice(slot.color, { volume: { ...vals } });
      // Only rebaseline on success — useHubMutations already showed a toast
      // either way (success green, failure red).
      if (out?.ok) {
        setBaseline({ ...vals });
      }
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.jsx frontend/src/modules/Admin/PlaybackHub/components/VolumeLimitsSection.test.jsx
git commit -m "fix(admin/playback-hub): VolumeLimitsSection keeps dirty state on save failure

Previously the form rebaselined unconditionally, hiding the fact that
the backend rejected the change. Now we only rebaseline on { ok: true }."
```

---

## Task 10: SchedulesSection — verify it still works (no-op task)

**Files:** none (verification only)

The current `SchedulesSection.jsx` does not have a baseline/dirty pattern: it calls `mutations.updateDevice(...)` and does no post-success state update (the local `windows` state is only resynced by the `useEffect` after the parent's `revalidate()` runs). This means there is no "silent commit" bug to fix here — if the call fails, the parent's `revalidate()` does NOT run (because `useHubMutations.updateDevice` only calls `revalidate` on success), so the local `windows` stays as the user typed it.

The user already gets a red toast from the feedback wrapper added in Task 4.

- [ ] **Step 1: Verify by running the existing test file**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/SchedulesSection.test.jsx
```

Expected: PASS — no test or impl changes required for this section.

- [ ] **Step 2: No commit (verification only)**

---

## Task 11: HomeAutomationSection — keep dirty state on failure

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.test.jsx`

The current code (line 59) does `setBaseline({ ...vals })` unconditionally after the `await mutations.updateDevice(...)`. After Task 4, `updateDevice` returns `{ ok: false, error }` on failure instead of throwing — so the form rebaselines even on failure and the user loses both the change and the visual cue ("Save" stays disabled).

- [ ] **Step 1: Add a failing test**

Append inside the existing describe block in `HomeAutomationSection.test.jsx`:

```javascript
  it('does NOT rebaseline when updateDevice returns { ok: false }', async () => {
    const mutations = {
      updateDevice: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('HTTP 422: invariant violated'),
      }),
    };
    const slot = {
      color: 'red',
      class: 'public',
      volume: { default: 50, min: 0, max: 75 },
      ha_entity_id: 'media_player.living_room',
      ha_turn_off_on_stop: false,
    };

    const { getByRole, getByLabelText } = render(
      <MantineProvider>
        <HomeAutomationSection slot={slot} mutations={mutations} />
      </MantineProvider>,
    );

    // Edit the entity ID to flip the form to dirty.
    const entityInput = getByLabelText(/home automation entity id/i);
    fireEvent.change(entityInput, { target: { value: 'switch.bedroom' } });

    const saveBtn = getByRole('button', { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await act(async () => { await Promise.resolve(); });

    // After failure the form must REMAIN dirty (Save still enabled),
    // and the entity input must show the user's typed value.
    expect(getByRole('button', { name: /^save$/i })).not.toBeDisabled();
    expect(entityInput.value).toBe('switch.bedroom');
  });
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/HomeAutomationSection.test.jsx
```

Expected: FAIL — the unconditional `setBaseline` rebaselines, making `isDirty` false and the Save button disabled.

- [ ] **Step 3: Patch `HomeAutomationSection.jsx`**

Replace the existing `handleSave`:

```javascript
  const handleSave = async () => {
    if (violatesPublicInvariant) return;
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, {
        haEntityId: vals.haEntityId,
        haTurnOffOnStop: vals.haTurnOffOnStop,
      });
      setBaseline({ ...vals });
    } finally {
      setSaving(false);
    }
  };
```

with:

```javascript
  const handleSave = async () => {
    if (violatesPublicInvariant) return;
    setSaving(true);
    try {
      const out = await mutations.updateDevice(slot.color, {
        haEntityId: vals.haEntityId,
        haTurnOffOnStop: vals.haTurnOffOnStop,
      });
      if (out?.ok) {
        setBaseline({ ...vals });
      }
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/HomeAutomationSection.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.jsx frontend/src/modules/Admin/PlaybackHub/components/HomeAutomationSection.test.jsx
git commit -m "fix(admin/playback-hub): HomeAutomationSection keeps dirty state on save failure"
```

---

## Task 12: ScheduledFiresSection — handle { ok: false } from saveFire / deleteFire

**Files:**
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx`
- Modify: `frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx`

Two silent-failure bugs in the current code:

1. `handleSave` (line ~96): for a NEW row (no `id`), it calls `mutations.saveFire({ id: newFireId(), ... })` and then runs `updateRow(idx, { id })` UNCONDITIONALLY. If the save fails, the row in local state still gets the client-generated id, so the trash icon flips from "remove (not yet saved)" to "delete fire" — telling the user the fire was persisted when it wasn't.

2. `handleConfirmDelete` (line ~120): always calls `setConfirmDelete({ open: false, id: null })` in `finally`. If the delete fails, the modal closes — the user thinks the delete worked. Worse, after Task 4 changed `deleteFire` to return `{ ok: false, error }` instead of throwing on failure, the modal closes silently with no error indication.

The fix: branch the state updates on `out?.ok`.

- [ ] **Step 1: Add failing tests**

In `ScheduledFiresSection.test.jsx`, append inside the existing describe block:

```javascript
  it('does NOT mark a new fire as saved when saveFire returns { ok: false }', async () => {
    const mutations = {
      saveFire: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('HTTP 400: invalid time'),
      }),
      deleteFire: vi.fn(),
    };

    const { getByRole, queryByRole } = render(
      <MantineProvider>
        <ScheduledFiresSection
          target="red"
          fires={[]}
          slotMaxVolume={75}
          mutations={mutations}
        />
      </MantineProvider>,
    );

    // Add a new row.
    fireEvent.click(getByRole('button', { name: /^add fire$/i }));
    // Click "Save fire" on the new row.
    fireEvent.click(getByRole('button', { name: /^save fire$/i }));
    await act(async () => { await Promise.resolve(); });

    // The "delete fire" ActionIcon should NOT appear (which it only does
    // for rows with `r.id`). The "Remove (not yet saved)" icon should
    // still be there. Both have aria-label "delete fire 1" but the
    // `title` attribute differs.
    const removeButton = getByRole('button', { name: /delete fire 1/i });
    expect(removeButton.getAttribute('title')).toMatch(/not yet saved/i);

    // And saveFire was called once — no duplicate.
    expect(mutations.saveFire).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the confirm modal when deleteFire returns { ok: false }', async () => {
    const fire = {
      id: 'f1', time: '07:00', target: 'red',
      queue: 'plex:42', days: 'weekdays',
    };
    const mutations = {
      saveFire: vi.fn(),
      deleteFire: vi.fn().mockResolvedValue({
        ok: false,
        error: new Error('HTTP 404'),
      }),
    };

    const { getByRole, queryByText } = render(
      <MantineProvider>
        <ScheduledFiresSection
          target="red"
          fires={[fire]}
          slotMaxVolume={75}
          mutations={mutations}
        />
      </MantineProvider>,
    );

    // Click the trash icon for the saved fire.
    fireEvent.click(getByRole('button', { name: /delete fire 1/i }));

    // ConfirmModal renders a Confirm button — find it. Check the project's
    // ConfirmModal.jsx for the exact button label; common labels are
    // "Confirm" or "Delete". If the test fails to find it, inspect the
    // ConfirmModal rendering.
    fireEvent.click(getByRole('button', { name: /^confirm$|^delete$/i }));
    await act(async () => { await Promise.resolve(); });

    // Modal title should still be visible (modal stayed open).
    expect(queryByText(/delete scheduled fire/i)).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx
```

Expected: FAIL — both new tests.

- [ ] **Step 3: Patch `handleSave` in `ScheduledFiresSection.jsx`**

Replace this block (lines ~96-114):

```javascript
  const handleSave = async (idx) => {
    const row = rows[idx];
    const id = row.id || newFireId();
    setSavingId(idx);
    try {
      await mutations.saveFire({
        id,
        time: row.time,
        days: row.days,
        target: row.target || target,
        queue: row.queue,
        durationMin: row.indefinite ? null : Number(row.durationMin) || null,
        volumeOverride: row.volumeOverride == null ? null : Number(row.volumeOverride),
      });
      updateRow(idx, { id });
    } finally {
      setSavingId(null);
    }
  };
```

with:

```javascript
  const handleSave = async (idx) => {
    const row = rows[idx];
    const id = row.id || newFireId();
    setSavingId(idx);
    try {
      const out = await mutations.saveFire({
        id,
        time: row.time,
        days: row.days,
        target: row.target || target,
        queue: row.queue,
        durationMin: row.indefinite ? null : Number(row.durationMin) || null,
        volumeOverride: row.volumeOverride == null ? null : Number(row.volumeOverride),
      });
      if (out?.ok) {
        updateRow(idx, { id });
      }
    } finally {
      setSavingId(null);
    }
  };
```

- [ ] **Step 4: Patch `handleConfirmDelete`**

Replace this block (lines ~120-129):

```javascript
  const handleConfirmDelete = async () => {
    if (!confirmDelete.id) return;
    setDeleting(true);
    try {
      await mutations.deleteFire(confirmDelete.id);
    } finally {
      setDeleting(false);
      setConfirmDelete({ open: false, id: null });
    }
  };
```

with:

```javascript
  const handleConfirmDelete = async () => {
    if (!confirmDelete.id) return;
    setDeleting(true);
    try {
      const out = await mutations.deleteFire(confirmDelete.id);
      if (out?.ok) {
        setConfirmDelete({ open: false, id: null });
      }
    } finally {
      setDeleting(false);
    }
  };
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx
```

Expected: PASS.

If the confirm-button test fails with "unable to find role", inspect `frontend/src/modules/Admin/shared/ConfirmModal.jsx` for the actual button text and adjust the regex.

- [ ] **Step 6: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.jsx frontend/src/modules/Admin/PlaybackHub/components/ScheduledFiresSection.test.jsx
git commit -m "fix(admin/playback-hub): ScheduledFiresSection respects { ok: false } from saveFire/deleteFire

Save: do not flip new-row trash icon to 'delete fire' when the server
rejected the save. Delete: keep the confirm modal open when the delete
fails so the failure toast remains contextual."
```

---

## Task 13: Full PlaybackHub regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full PlaybackHub test directory**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/PlaybackHub/
```

Expected: ALL tests across `hooks/`, `components/`, and the page test pass. If anything fails, fix it before moving on.

- [ ] **Step 2: Run the shared feedback test directory**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/shared/
```

Expected: PASS.

- [ ] **Step 3: No commit (verification only)**

---

## Task 14: Household DeviceEditor — replace silent `setError` with toasts

**Files:**
- Modify: `frontend/src/modules/Admin/Household/DeviceEditor.jsx`

- [ ] **Step 1: Read the file**

Open `frontend/src/modules/Admin/Household/DeviceEditor.jsx`. Note the three async handlers (around lines 251, 285, 303): `fetchDevice`, `handleSave`, `handleDelete`. Each currently does `try { await DaylightAPI(...) } catch (err) { setError(err); }`. The `setError` then renders an `<Alert>` at the bottom of the page — which works for load failures but is easy to miss for save/delete failures (no scroll, no toast).

- [ ] **Step 2: Modify `handleSave` to also show a toast**

At the top of the file, add:

```javascript
import { notifySuccess, notifyFailure } from '../shared/feedback.js';
```

Find the existing `handleSave` block. It currently looks like:

```javascript
    setError(null);
    try {
      await DaylightAPI(`/api/v1/admin/household/devices/${deviceId}`, device, 'PUT');
      // ...success path
    } catch (err) {
      setError(err);
    }
```

Change to:

```javascript
    setError(null);
    try {
      await DaylightAPI(`/api/v1/admin/household/devices/${deviceId}`, device, 'PUT');
      notifySuccess({ title: 'Device saved', message: deviceId });
      // ...success path (existing)
    } catch (err) {
      setError(err);
      notifyFailure({ title: 'Save failed', message: err.message });
    }
```

- [ ] **Step 3: Same for `handleDelete`**

Find the existing `handleDelete` block (around line 303). Add `notifySuccess` on resolve and `notifyFailure` on catch, with titles `Device deleted` / `Delete failed`.

- [ ] **Step 4: Verify by running existing tests**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/Household/
```

Expected: still PASS (we did not break anything; we only added toasts).

NOTE: If there is no existing test file for `DeviceEditor.jsx`, skip — this task is intentionally low-test because the existing component already has a visible `Alert` element; the toast is an additive improvement.

- [ ] **Step 5: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/Household/DeviceEditor.jsx
git commit -m "feat(admin/household): show toast on DeviceEditor save/delete

Adds Mantine toasts on top of the existing Alert banner so the operator
gets unmissable feedback even when scrolled to the top of a long form."
```

---

## Task 15: Scheduler JobDetail — toast on Run button

**Files:**
- Modify: `frontend/src/modules/Admin/Scheduler/JobDetail.jsx`

- [ ] **Step 1: Read the file**

Open `frontend/src/modules/Admin/Scheduler/JobDetail.jsx`. The handler at ~line 95-108 is the trigger case: clicking "Run now" calls `DaylightAPI('/api/v1/admin/scheduler/jobs/:id/run', ...)`. Today the only feedback is `setError(...)` on failure and a silent refresh on success.

- [ ] **Step 2: Wire `notifySuccess`/`notifyFailure` in**

At the top of the file:

```javascript
import { notifySuccess, notifyFailure } from '../shared/feedback.js';
```

Find the existing handler. It currently looks like:

```javascript
    try {
      await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}/run`, {}, 'POST');
      setTimeout(() => fetchJob(), 1000);
    } catch (err) {
      setError(err.message || 'Failed to trigger job');
    }
```

Change to:

```javascript
    try {
      await DaylightAPI(`/api/v1/admin/scheduler/jobs/${jobId}/run`, {}, 'POST');
      notifySuccess({ title: 'Job triggered', message: jobId });
      setTimeout(() => fetchJob(), 1000);
    } catch (err) {
      const msg = err.message || 'Failed to trigger job';
      setError(msg);
      notifyFailure({ title: 'Trigger failed', message: msg });
    }
```

Apply the same pattern to the delete handler at ~line 148:

```javascript
    } catch (err) {
      const msg = err.message || 'Failed to delete job';
      setError(msg);
      notifyFailure({ title: 'Delete failed', message: msg });
    }
```

…and add a `notifySuccess({ title: 'Job deleted', message: jobId })` after the successful DELETE.

- [ ] **Step 3: Smoke-test that the file still compiles**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/Scheduler/
```

Expected: still PASS (or no tests — that is fine; the import resolution alone catches typos).

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/Scheduler/JobDetail.jsx
git commit -m "feat(admin/scheduler): toast on Run / Delete in JobDetail"
```

---

## Task 16: System IntegrationDetail — toast on Test connection

**Files:**
- Modify: `frontend/src/modules/Admin/System/IntegrationDetail.jsx`

- [ ] **Step 1: Read the file**

Open `frontend/src/modules/Admin/System/IntegrationDetail.jsx`. There is a `handleTest` (or similar) handler that calls `testConnection(provider)` from `useAdminIntegrations`. Find it.

- [ ] **Step 2: Wire toasts**

At the top:

```javascript
import { notifySuccess, notifyFailure } from '../shared/feedback.js';
```

In the `handleTest` (around line 70-80):

```javascript
    try {
      const result = await testConnection(provider);
      // existing success path
      notifySuccess({
        title: 'Connection OK',
        message: `${provider}: ${result?.status ?? 'reachable'}`,
      });
    } catch (err) {
      // existing setError
      notifyFailure({ title: 'Connection failed', message: err.message });
    }
```

- [ ] **Step 3: Smoke-test**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/System/
```

Expected: PASS (or no tests — same as Task 15).

- [ ] **Step 4: Commit**

```bash
cd /opt/Code/DaylightStation && git add frontend/src/modules/Admin/System/IntegrationDetail.jsx
git commit -m "feat(admin/system): toast on integration connection test result"
```

---

## Task 17: Final regression sweep + smoke screenshot

**Files:** none (verification only)

- [ ] **Step 1: Run the full Admin test tree**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/modules/Admin/
```

Expected: ALL tests pass. If any tests fail that were previously passing, investigate before claiming completion.

- [ ] **Step 2: Run the broader Admin-adjacent hooks**

```bash
cd /opt/Code/DaylightStation/frontend && npx vitest run src/hooks/admin/
```

Expected: PASS.

- [ ] **Step 3: Manually verify the trigger case**

On `kckern-server` (this is a dev/prod host — see `CLAUDE.local.md`):

```bash
# Start dev backend if not already running
ss -tlnp | grep 3112  # only start if not listening
# If not running:
# nohup node backend/index.js > /tmp/backend-dev.log 2>&1 &
```

Open `http://kckern-server:3112/admin/playback-hub` in a browser, click "Play Now" on the `white` card. Confirm:
- The button shows a loading spinner while in flight.
- A toast appears in the bottom-right within 2-3 seconds (either green "Command sent" or yellow "Command partial" with "white: unreachable").
- The toast stays visible long enough to read (failure toasts: indefinite; partial: 7s).
- Disconnect the WS feed (kill the backend, then restart) — the StalenessBanner should show up within ~10s.

- [ ] **Step 4: No final commit (verification only)**

This is the natural end of the plan. The diff list `git log --oneline -20` should show ~12-14 commits, one per task.

---

## Appendix: notes for the executor

- **Vitest config:** the project's Vitest binary is at `frontend/node_modules/.bin/vitest`; the convenience command is `cd frontend && npx vitest run <path>`.
- **Logger pattern:** the project's CLAUDE.md is explicit — never use raw `console.log`. Every new module here uses `getLogger().child({ component: 'X' })`. Lifecycle events: `*.started` / `*.success` / `*.partial` / `*.failure`.
- **No `--no-verify`:** if a pre-commit hook complains, fix the underlying issue and recommit; do NOT skip hooks.
- **No backend changes needed.** The wire shape is already correct: HTTP 200/502 + `{ ok, applied, skipped }`. The bug is purely frontend.
- **Mantine `<Notifications>` is already mounted** in `AdminApp.jsx` line 133 — no provider wiring needed.
- **Mantine `notifications.show` defaults:** if no `autoClose` is set, it inherits the provider's `autoClose={3000}`. We override per-call so success=3s, partial=7s, failure=indefinite.
