# Media App P6 (Session Portability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Take Over (pull a remote session to local) and Hand Off (push the local session to a remote), completing J6 + J7.

**Architecture:** Two thin hooks. `useTakeOver` hits `POST /device/:id/session/claim`, receives a SessionSnapshot, and calls `LocalSessionAdapter.portability.receiveClaim(snapshot)`. `useHandOff` pulls a snapshot via `snapshotForHandoff()`, then delegates to `DispatchProvider.dispatchToTarget({mode: 'adopt', snapshot, targetIds: [deviceId]})` — `DispatchProvider` needs a small extension to POST adopt-mode bodies instead of GETing query params. UI: FleetView gains "Take Over" per card; NowPlayingView gains "Hand Off to…" with device picker.

**Tech Stack:** React · Vitest · Playwright · existing `DaylightAPI`, `wsService`, `useSessionController`, `LocalSessionProvider`, `DispatchProvider`, `FleetProvider`.

## Pre-flight

- Parent: main post-P5. ~204 unit tests. Worktree `feature/media-app-p6`.
- **APIs** (verified, respond with "not configured" when session control isn't wired — client handles gracefully):
  - `POST /api/v1/device/:id/session/claim` — body `{commandId}` — response `{ok, commandId, snapshot, stoppedAt}` or 502 `ATOMICITY_VIOLATION`
  - `POST /api/v1/device/:id/load` — body `{mode: 'adopt', snapshot, dispatchId}` — idempotent, 60s cache

## File map

- `frontend/src/modules/Media/peek/useTakeOver.js` — hook + test
- `frontend/src/modules/Media/cast/useHandOff.js` — hook + test
- `frontend/src/modules/Media/cast/DispatchProvider.jsx` — **modify** — `dispatchToTarget` accepts `mode: 'adopt'` + `snapshot` and POSTs instead of GET via `buildDispatchUrl`
- `frontend/src/modules/Media/shell/FleetView.jsx` — **modify** — Take Over button per card
- `frontend/src/modules/Media/shell/NowPlayingView.jsx` — **modify** — Hand Off device picker
- `tests/live/flow/media/media-app-portability.runtime.test.mjs` — e2e

## Task 1: DispatchProvider — adopt-mode

Extend `DispatchProvider.dispatchToTarget` to handle `mode: 'adopt'`. Instead of calling `buildDispatchUrl` + GET, POST to `api/v1/device/:id/load` with body `{dispatchId, snapshot, mode: 'adopt'}`.

**File modifications to DispatchProvider.jsx:** inside `dispatchToTarget`, branch on `mode === 'adopt'`:

```js
const isAdopt = mode === 'adopt';
for (const deviceId of targetIds) {
  const dispatchId = uuid();
  dispatchIds.push(dispatchId);
  dispatch({ type: 'INITIATED', dispatchId, deviceId, contentId: contentId ?? 'adopt', mode });
  mediaLog.dispatchInitiated({ dispatchId, deviceId, contentId, mode });

  const promise = isAdopt
    ? DaylightAPI(`api/v1/device/${deviceId}/load`, { dispatchId, snapshot, mode: 'adopt' }, 'POST')
    : DaylightAPI(buildDispatchUrl({ deviceId, play, queue, dispatchId, shader, volume, shuffle }));
  // ... rest of .then/.catch unchanged
}
```

**Test:** append a test case to `DispatchProvider.test.jsx` verifying adopt-mode hits POST.

## Task 2: useTakeOver

```js
// frontend/src/modules/Media/peek/useTakeOver.js
import { useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

function uuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTakeOver() {
  const local = useSessionController('local');
  return useCallback(async (deviceId) => {
    const commandId = uuid();
    mediaLog.takeoverInitiated({ deviceId, sessionId: null });
    try {
      const res = await DaylightAPI(`api/v1/device/${deviceId}/session/claim`, { commandId }, 'POST');
      if (res?.ok && res.snapshot) {
        local.portability.receiveClaim(res.snapshot);
        mediaLog.takeoverSucceeded({ deviceId, sessionId: res.snapshot?.sessionId, position: res.snapshot?.position });
        return { ok: true };
      }
      mediaLog.takeoverFailed({ deviceId, error: res?.error ?? 'unknown' });
      return { ok: false, error: res?.error ?? 'claim-failed' };
    } catch (err) {
      mediaLog.takeoverFailed({ deviceId, error: err?.message });
      return { ok: false, error: err?.message };
    }
  }, [local]);
}

export default useTakeOver;
```

**Test (4 cases):** success adopts snapshot; failure leaves local unchanged; atomicity violation rejects; uses commandId.

## Task 3: useHandOff

```js
// frontend/src/modules/Media/cast/useHandOff.js
import { useCallback } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useDispatch } from './useDispatch.js';
import mediaLog from '../logging/mediaLog.js';

export function useHandOff() {
  const local = useSessionController('local');
  const { dispatchToTarget } = useDispatch();
  return useCallback(async (deviceId, { mode = 'transfer' } = {}) => {
    const snapshot = local.portability.snapshotForHandoff?.();
    if (!snapshot) return { ok: false, error: 'no-snapshot' };
    mediaLog.handoffInitiated({ deviceId, mode });
    const ids = await dispatchToTarget({ targetIds: [deviceId], snapshot, mode: 'adopt' });
    // Local transport.stop only if user asked for Transfer (not Fork)
    if (mode === 'transfer') {
      try { local.transport.stop(); } catch {}
    }
    return { ok: true, dispatchIds: ids };
  }, [local, dispatchToTarget]);
}

export default useHandOff;
```

**Test:** handoff fires dispatch with adopt mode + snapshot; transfer mode stops local; fork keeps local.

## Task 4: FleetView Take Over button

Add a "Take Over" button per card that calls `useTakeOver()(deviceId)`.

## Task 5: NowPlayingView Hand Off picker

Add a dropdown of fleet devices; selecting one calls `useHandOff()(deviceId)`.

## Task 6: Playwright e2e — portability buttons render and fire (mocked / best-effort; backend may not actually claim/adopt).

## Task 7: Final merge + validation.

Tests: target ~220 vitest + ~1 Playwright.
