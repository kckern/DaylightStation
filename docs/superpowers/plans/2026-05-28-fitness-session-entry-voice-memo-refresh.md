# Session-Entry Voice-Memo Refresh-on-Save — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a just-saved voice memo appear on the session entry (chart view) without requiring the user to navigate away and back.

**Architecture:** The memo reaches disk only when the end-of-session `save_session` POST completes, but today (a) the session detail widget fetches once on mount — racing ahead of that fire-and-forget save — and (b) the `sessions` screen-data store is never invalidated on session end. Fix: expose the final-save promise from `PersistenceManager`, have `FitnessPlayer.executeClose` refetch the `sessions` store once that save settles, and make `FitnessSessionDetailWidget` re-fetch its own detail reactively whenever the `sessions` store changes.

**Tech Stack:** React, Vitest + @testing-library/react. `ScreenDataProvider` exposes `useScreenData(key)` and `useScreenDataRefetch()` → `refetch(key)`.

**Source audit:** `docs/_wip/audits/2026-05-28-fitness-session-multi-issue-postmortem-audit.md` (Issue 2).

**Run a single Vitest spec (repo root):** `frontend/node_modules/.bin/vitest run --config vitest.config.mjs <path-to-spec>`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/hooks/fitness/PersistenceManager.js` | Session persistence (HTTP save) | Capture the `save_session` promise chain into `_lastSavePromise`; add `whenLastSaveSettled()` |
| `frontend/src/hooks/fitness/FitnessSession.js` | Session lifecycle | Add `whenFinalPersistSettled()` passthrough |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Player close flow | Refetch `sessions` after final save settles |
| `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx` | Session detail view | Re-fetch its detail when the `sessions` store changes |
| Test files alongside the first and last | | |

---

## Task 1: Expose the final-save promise from PersistenceManager

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js` (the `persistSession` save chain around lines 1127–1164; add an accessor)
- Test: `frontend/src/hooks/fitness/PersistenceManager.savePromise.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/PersistenceManager.savePromise.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { PersistenceManager } from './PersistenceManager.js';

// Minimal valid session payload that passes validateSessionPayload.
function validSession() {
  const now = Date.now();
  return {
    sessionId: 'fs_20260528194117',
    startTime: now - 600000,
    endTime: now,
    durationMs: 600000,
    roster: [{ userId: 'user_2' }],
    timeline: { series: { user_2: { hr: [1, 2, 3] } } },
    tickCount: 100
  };
}

describe('PersistenceManager — whenLastSaveSettled', () => {
  it('resolves after the save_session POST settles', async () => {
    let resolveSave;
    const persistApi = vi.fn((url) => {
      if (url === 'api/v1/fitness/save_session') {
        return new Promise((res) => { resolveSave = () => res({ ok: true }); });
      }
      return Promise.resolve({ ok: true, granted: true });
    });
    const pm = new PersistenceManager({ persistApi });

    pm.persistSession(validSession(), { force: true });
    const settled = pm.whenLastSaveSettled();
    expect(settled).toBeInstanceOf(Promise);

    let done = false;
    settled.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);   // not yet — save_session POST is pending
    resolveSave();
    await settled;
    expect(done).toBe(true);
  });

  it('returns an already-resolved promise when no save is in flight', async () => {
    const pm = new PersistenceManager({ persistApi: vi.fn().mockResolvedValue({ ok: true }) });
    await expect(pm.whenLastSaveSettled()).resolves.toBeUndefined();
  });
});
```

(Confirm the constructor signature accepts `{ persistApi }` — line ~550 sets `this._persistApi = config.persistApi || DaylightAPI`. If the constructor needs other config, pass minimal stubs so it instantiates.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/PersistenceManager.savePromise.test.js`
Expected: FAIL — `whenLastSaveSettled` is not a function.

- [ ] **Step 3: Capture and expose the save promise**

In `PersistenceManager.js`, in `persistSession`, the save chain currently looks like:
```js
    this._saveTriggered = true;
    …
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => { … })
      …
      .then(() => { … this._saveTriggered = false; … });
    return true;
```
Assign the whole chain to an instance field. Change the chain's leading statement to capture it — i.e. replace the start of the chain assignment so the entire `.then(...)…` expression is stored:
```js
    this._saveTriggered = true;
    this._lastSavePromise = <the existing promise chain expression>
      .then(() => this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST'))
      .then(resp => { … })
      …
      .then(() => { … this._saveTriggered = false; … })
      .catch((err) => { this._saveTriggered = false; /* keep existing error handling */ throw err; })
      .catch(() => {});  // settle (never reject) so awaiters always resume
    return true;
```
Concretely: find the statement that begins the promise chain (it starts where the lock/acquire promise is created and `.then(...)`s into `save_session`). Prefix that expression with `this._lastSavePromise = `. Ensure the chain ends with a final `.catch(() => {})` so `whenLastSaveSettled()` resolves even on save failure (the refetch should still fire). Initialize `this._lastSavePromise = null;` in the constructor (near `this._saveTriggered = false;`).

Add the accessor method to the class:
```js
  /**
   * Promise that settles when the most recent save_session POST completes
   * (resolves even on failure). Resolves immediately if no save is in flight.
   */
  whenLastSaveSettled() {
    return this._lastSavePromise || Promise.resolve();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/PersistenceManager.savePromise.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js frontend/src/hooks/fitness/PersistenceManager.savePromise.test.js
git commit -m "feat(fitness): expose final save_session promise from PersistenceManager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: FitnessSession passthrough accessor

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js`

- [ ] **Step 1: Add the accessor**

Add a method to the `FitnessSession` class (near the other persistence helpers, e.g. after `_persistSession` at line ~2550):
```js
  /**
   * Promise that settles when the most recent session save completes.
   * Used by the player to refresh the sessions list only after the save lands.
   */
  whenFinalPersistSettled() {
    return this._persistenceManager?.whenLastSaveSettled?.() || Promise.resolve();
  }
```

- [ ] **Step 2: Sanity build**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/hooks/fitness/` (the fitness hooks suite imports FitnessSession; confirms no syntax/regression).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): FitnessSession.whenFinalPersistSettled passthrough

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refetch the sessions store after the final save settles

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx`

Component-level wiring; verified by Task 4's reactive test plus the manual check in Task 5.

- [ ] **Step 1: Get the refetch function**

Add near the top of `FitnessPlayer` (with the other hooks): import and call
```js
import { useScreenDataRefetch } from '@/screen-framework/data/ScreenDataProvider.jsx';
```
```js
  const refetchScreenData = useScreenDataRefetch();
```
(Match the existing import style/path used elsewhere in the module for `@/` aliases.)

- [ ] **Step 2: Refetch after the save settles, inside `executeClose`**

In `executeClose` (line ~968), after the redirect block (after the `onSessionEndRedirect(redirect)` try/catch), add:
```js
    // Refresh the sessions list once the final save has landed, so the just-saved
    // voice memo (and final stats) show on the session entry without a manual re-nav.
    if (typeof refetchScreenData === 'function') {
      Promise.resolve(fitnessSessionInstance?.whenFinalPersistSettled?.())
        .finally(() => { refetchScreenData('sessions'); });
    }
```
Add `refetchScreenData` and `fitnessSessionInstance` to the `useCallback` dependency array (the array already includes `fitnessSessionInstance?.sessionId`; add the instance and `refetchScreenData`).

- [ ] **Step 3: Sanity — run the player/overlay suite**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/player/`
Expected: PASS (additive change).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "feat(fitness): refetch sessions list after final save on session close

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Detail widget re-fetches when the sessions store changes

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx`
- Test: `frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.refresh.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `FitnessSessionDetailWidget.refresh.test.jsx`. Mock `useScreenData` so we control the `sessions` value, and mock `fetch` to count detail fetches:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

let sessionsValue = [];
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({
  useScreenData: (key) => (key === 'sessions' ? sessionsValue : null),
  useScreenDataRefetch: () => vi.fn()
}));
// Stub the FitnessContext hook the widget uses (voice memo add path).
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({ openVoiceMemoCapture: vi.fn() }),
  useFitness: () => ({ openVoiceMemoCapture: vi.fn() })
}));

import FitnessSessionDetailWidget from './FitnessSessionDetailWidget.jsx';

beforeEach(() => {
  sessionsValue = [];
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ sessionId: '20260528194117', summary: { voiceMemos: [] }, timeline: {} })
  });
});

describe('FitnessSessionDetailWidget — refetch on sessions change', () => {
  it('re-fetches its detail when the sessions store updates', async () => {
    const { rerender } = render(<FitnessSessionDetailWidget sessionId="20260528194117" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    // Simulate the post-save sessions refetch producing a new array reference.
    sessionsValue = [{ sessionId: '20260528194117', voiceMemos: [{ memoId: 'm1' }] }];
    rerender(<FitnessSessionDetailWidget sessionId="20260528194117" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
```

(Adjust the mocked import paths/hook names to match the widget's actual imports — confirm whether it uses `useFitnessContext` or `useFitness`, and the exact `ScreenDataProvider` import specifier, before running.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.refresh.test.jsx`
Expected: FAIL — only 1 fetch (the mount fetch); the widget doesn't react to `sessions` changes.

- [ ] **Step 3: Make the detail refetch reactive to the sessions store**

In `FitnessSessionDetailWidget.jsx`:
- Near the existing `useScreenDataRefetch()` line (140), add:
```js
  const sessionsData = useScreenData('sessions');
```
(Import `useScreenData` if not already imported from `ScreenDataProvider.jsx`.)
- Change the mount effect (lines 197–199) to also depend on `sessionsData` so a sessions-store update re-pulls the detail:
```js
  useEffect(() => {
    fetchSession();
  }, [fetchSession, sessionsData]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `frontend/node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.refresh.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.jsx frontend/src/modules/Fitness/widgets/FitnessSessionDetailWidget/FitnessSessionDetailWidget.refresh.test.jsx
git commit -m "fix(fitness): session detail refetches when sessions store changes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manual verification

- [ ] End a session with an end-of-video voice memo. Confirm that on landing at the session entry, the memo appears in the list/detail **without** navigating away and back. Confirm the sessions-list row also shows the memo.

---

## Notes
- The flow is now deterministic: `executeClose` waits for `whenFinalPersistSettled()` → refetches `sessions` → the new `sessions` reference triggers the detail widget's reactive `fetchSession()` → the YAML (now containing the memo) is re-read.
- `whenLastSaveSettled()` resolves even on save failure (final `.catch`), so a failed save still triggers a refresh attempt rather than hanging.
