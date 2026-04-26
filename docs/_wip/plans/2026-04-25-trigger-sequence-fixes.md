# Trigger Sequence Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the four issues uncovered in [`docs/_wip/audits/2026-04-25-nfc-to-playback-trigger-sequence-audit.md`](../audits/2026-04-25-nfc-to-playback-trigger-sequence-audit.md) so an NFC tap → audible playback drops from ~23 s with a "menu flash → cover image → page reload" visual sequence to ~13 s with a clean "blank/cover → playback" sequence.

**Architecture:** Five focused changes in three layers:
1. **Frontend (F1, CRITICAL):** Decouple `useCommandAckPublisher` from the `publishState` YAML gate so screens with `commands: true` always send `device-ack` back to the backend. This is the biggest single win — it unblocks WS-first delivery and stops the FKB-URL fallback from steamrolling working playback.
2. **Frontend (F5, UX):** When the screen mounts with an action search-param (`play`, `queue`, `open`, etc.), suppress the YAML-declared layout (the menu) on first render. Render a blank shell instead, until the action handler mounts the player or the action completes.
3. **Backend (F2, perf):** Skip the FKB camera check (3× 2 s retries) when the inbound query has no camera-requiring action. Saves ~4 s per cold trigger.
4. **Backend (F3, perf):** Make FKB `load(...)` return `ok` once the URL is acknowledged, and run `currentUrl` verification asynchronously as a background watchdog. Saves ~10 s on the cold-restart path where verification never completes.
5. **Ops (F7, cleanup):** Archive the conflicted-copy `nfc.yml` on prod.

**Tech Stack:** React 18, vitest + @testing-library/react (frontend tests), Node ESM (`.mjs`), express, vitest (backend tests).

**Branch / worktree:** Recommended to run this in a worktree. From repo root:
```bash
git worktree add ../DaylightStation-trigger-fixes -b fix/trigger-sequence-2026-04-25
cd ../DaylightStation-trigger-fixes
```

---

## Test commands cheat-sheet

- **Single frontend vitest file:** from repo root, `npx vitest run frontend/src/path/to/file.test.jsx` (root has vitest hoisted as a transitive dep; if it complains, run from `frontend/`).
- **Single backend vitest file (under `backend/tests/unit/...` or `tests/isolated/...`):** `npx vitest run <path>`.
- **Verify an existing test still passes:** same command, watch output for `PASS` / `FAIL`.

---

## Phase 1 — F1: Decouple ack publisher from `publishState` gate (CRITICAL)

**Why first:** This single fix eliminates the WS ack timeout AND the FKB-URL steamroll. Every other fix amplifies its impact.

**Design:** Today `<SessionPublishers>` mounts both `useSessionStatePublisher` AND `useCommandAckPublisher` together, gated on `wsConfig.publishState === true` in `ScreenRenderer.jsx:149-154`. Split the responsibilities:
- `<SessionStatePublisher>` — just the state publishing. Gated on `publishState`.
- `<CommandAckPublisher>` — just the ack publishing. Gated on `commands` (the same flag that mounts `useScreenCommands`).

Then `ScreenRenderer.ScreenSessionPublishers` mounts each on its own gate. No YAML changes.

### Task 1.1: Write failing test for split component — ack mounts on `commands` flag alone

**Files:**
- Test: `frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx` (new)

**Step 1.1.1: Create the failing test**

Create `frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

import { wsService } from '../../services/WebSocketService.js';
import { CommandAckPublisher } from './CommandAckPublisher.jsx';

function makeBus() {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const h of set) h(payload);
    },
  };
}

describe('CommandAckPublisher (standalone)', () => {
  beforeEach(() => wsService.send.mockClear());

  it('renders nothing when deviceId is missing', () => {
    const bus = makeBus();
    const { container } = render(<CommandAckPublisher actionBus={bus} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts the ack publisher and sends device-ack on media:queue-op', () => {
    const bus = makeBus();
    render(<CommandAckPublisher deviceId="livingroom-tv" actionBus={bus} />);

    bus.emit('media:queue-op', {
      op: 'play-now',
      contentId: 'plex:620707',
      commandId: 'cmd-abc',
    });

    const ackCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-ack',
    );
    expect(ackCalls.length).toBe(1);
    expect(ackCalls[0][0]).toMatchObject({
      topic: 'device-ack',
      deviceId: 'livingroom-tv',
      commandId: 'cmd-abc',
      ok: true,
    });
  });
});
```

**Step 1.1.2: Run the test — verify it fails**

```bash
npx vitest run frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx
```

Expected: FAIL with "Cannot find module './CommandAckPublisher.jsx'" or similar.

### Task 1.2: Create the `<CommandAckPublisher>` component

**Files:**
- Create: `frontend/src/screen-framework/publishers/CommandAckPublisher.jsx`

**Step 1.2.1: Write the component**

```jsx
import React from 'react';
import { useCommandAckPublisher } from './useCommandAckPublisher.js';

/**
 * CommandAckPublisher — renderless component that mounts the
 * useCommandAckPublisher hook for screens that accept WebSocket commands.
 *
 * Renders nothing. Activates only when `deviceId` and `actionBus` are present.
 *
 * Sibling component to <SessionStatePublisher>; either may be mounted
 * independently. Mount this one whenever the screen has
 * `wsConfig.commands === true` so backend WS-first dispatch can confirm
 * delivery.
 */
export function CommandAckPublisher({ deviceId, actionBus }) {
  if (!deviceId || !actionBus) return null;
  useCommandAckPublisher({ deviceId, actionBus });
  return null;
}

export default CommandAckPublisher;
```

> **Note:** React's rules-of-hooks lint will flag the conditional return before the hook call. Refactor to call the hook unconditionally and let it no-op internally (it already does — `useCommandAckPublisher.js:59`). Final shape:
>
> ```jsx
> export function CommandAckPublisher({ deviceId, actionBus }) {
>   useCommandAckPublisher({ deviceId, actionBus });
>   return null;
> }
> ```

**Step 1.2.2: Run the test — verify it passes**

```bash
npx vitest run frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx
```

Expected: PASS (both `it` blocks).

### Task 1.3: Write failing test for `<SessionStatePublisher>` split

**Files:**
- Test: `frontend/src/screen-framework/publishers/SessionStatePublisher.test.jsx` (new)

**Step 1.3.1: Create the test**

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

import { wsService } from '../../services/WebSocketService.js';
import { SessionStatePublisher } from './SessionStatePublisher.jsx';

describe('SessionStatePublisher (standalone)', () => {
  beforeEach(() => wsService.send.mockClear());

  it('publishes initial device-state when deviceId is present', () => {
    render(<SessionStatePublisher deviceId="tv-1" />);
    const initialCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state' && m.reason === 'initial',
    );
    expect(initialCalls.length).toBeGreaterThanOrEqual(1);
    expect(initialCalls[0][0].deviceId).toBe('tv-1');
  });

  it('renders nothing and publishes nothing when deviceId is missing', () => {
    const { container } = render(<SessionStatePublisher />);
    expect(container.firstChild).toBeNull();
    const stateCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state',
    );
    expect(stateCalls.length).toBe(0);
  });
});
```

**Step 1.3.2: Run — verify FAIL**

```bash
npx vitest run frontend/src/screen-framework/publishers/SessionStatePublisher.test.jsx
```

Expected: FAIL "Cannot find module './SessionStatePublisher.jsx'".

### Task 1.4: Create `<SessionStatePublisher>` component

**Files:**
- Create: `frontend/src/screen-framework/publishers/SessionStatePublisher.jsx`

Lift the state-publishing logic from `SessionPublishers.jsx` (which mounts both). Keep the fallback-source + context-source resolution exactly as it is. Just don't mount the ack publisher here.

```jsx
import React, { useMemo } from 'react';
import { useSessionStatePublisher } from './useSessionStatePublisher.js';
import { createSessionSource } from './SessionSource.js';
import { useSessionSourceContext } from './SessionSourceContext.jsx';

/**
 * SessionStatePublisher — renderless component that mounts the
 * session-state publisher for a screen.
 *
 * Sibling to <CommandAckPublisher>. Either may be mounted independently.
 * Mount this one whenever the screen has `wsConfig.publishState === true`.
 */
export function SessionStatePublisher({ deviceId, source: explicitSource }) {
  const ctxSource = useSessionSourceContext();

  const fallbackSource = useMemo(() => {
    if (!deviceId) return null;
    return createSessionSource({ ownerId: deviceId });
  }, [deviceId]);

  const source = explicitSource ?? ctxSource ?? fallbackSource;

  const getSnapshot = useMemo(
    () => (source ? () => source.getSnapshot() : null),
    [source],
  );
  const subscribe = useMemo(
    () => (source ? source.subscribe.bind(source) : null),
    [source],
  );

  useSessionStatePublisher({ deviceId, getSnapshot, subscribe });

  return null;
}

export default SessionStatePublisher;
```

**Step 1.4.1: Run — verify PASS**

```bash
npx vitest run frontend/src/screen-framework/publishers/SessionStatePublisher.test.jsx
```

Expected: PASS.

### Task 1.5: Wire ScreenRenderer to mount each publisher on its own gate

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx:149-154`

**Step 1.5.1: Read the current ScreenSessionPublishers function**

Re-read lines 143-160 of `frontend/src/screen-framework/ScreenRenderer.jsx` to see surrounding context.

**Step 1.5.2: Replace the function**

Replace the existing `ScreenSessionPublishers` function with:

```jsx
/**
 * ScreenSessionPublishers — Mounts the per-screen WS publishers based on the
 * screen's `websocket:` YAML block. Two independent publishers, two gates:
 *   - CommandAckPublisher mounts when `commands: true`. Required for backend
 *     WS-first dispatch to confirm delivery and avoid the FKB-URL steamroll.
 *   - SessionStatePublisher mounts when `publishState: true`. Used for live
 *     session-state hand-off.
 */
function ScreenSessionPublishers({ wsConfig }) {
  const bus = useBus();
  const deviceId = wsConfig?.guardrails?.device;
  if (!deviceId) return null;

  const wantsAck = wsConfig?.commands === true;
  const wantsState = wsConfig?.publishState === true;
  if (!wantsAck && !wantsState) return null;

  return (
    <>
      {wantsAck   && <CommandAckPublisher  deviceId={deviceId} actionBus={bus} />}
      {wantsState && <SessionStatePublisher deviceId={deviceId} />}
    </>
  );
}
```

**Step 1.5.3: Update the imports at the top of ScreenRenderer.jsx**

Replace the existing `import { SessionPublishers } from './publishers/SessionPublishers.jsx';` (around line 17) with:

```jsx
import { CommandAckPublisher }   from './publishers/CommandAckPublisher.jsx';
import { SessionStatePublisher } from './publishers/SessionStatePublisher.jsx';
```

**Step 1.5.4: Sanity-check existing SessionPublishers tests still pass**

The original `SessionPublishers.jsx` and its test stay in place for now (deletion is Task 1.7 after we know nothing else imports it):

```bash
npx vitest run frontend/src/screen-framework/publishers/SessionPublishers.test.jsx
```

Expected: PASS (unchanged file, unchanged test).

### Task 1.6: Add an integration-style test for ScreenSessionPublishers wiring

**Files:**
- Create: `frontend/src/screen-framework/ScreenSessionPublishers.test.jsx`

This is the test that *would have caught the original bug*. It asserts that `commands: true, publishState: false` mounts the ack publisher.

**Step 1.6.1: Decide test scope**

`ScreenSessionPublishers` is currently a private function inside `ScreenRenderer.jsx`. Two options:
- (a) Export it from `ScreenRenderer.jsx` for testing. Cleanest.
- (b) Move it into its own file `ScreenSessionPublishers.jsx` and import it back into ScreenRenderer.

Pick (b) for clearer separation. Move the function into `frontend/src/screen-framework/ScreenSessionPublishers.jsx`:

```jsx
import React from 'react';
import { useBus } from './hooks/useBus.js';   // verify the actual import path of useBus in ScreenRenderer.jsx
import { CommandAckPublisher }   from './publishers/CommandAckPublisher.jsx';
import { SessionStatePublisher } from './publishers/SessionStatePublisher.jsx';

export function ScreenSessionPublishers({ wsConfig }) {
  const bus = useBus();
  const deviceId = wsConfig?.guardrails?.device;
  if (!deviceId) return null;

  const wantsAck = wsConfig?.commands === true;
  const wantsState = wsConfig?.publishState === true;
  if (!wantsAck && !wantsState) return null;

  return (
    <>
      {wantsAck   && <CommandAckPublisher  deviceId={deviceId} actionBus={bus} />}
      {wantsState && <SessionStatePublisher deviceId={deviceId} />}
    </>
  );
}

export default ScreenSessionPublishers;
```

In `ScreenRenderer.jsx`, replace the inline function with:

```jsx
import { ScreenSessionPublishers } from './ScreenSessionPublishers.jsx';
```

**Step 1.6.2: Write the test**

`frontend/src/screen-framework/ScreenSessionPublishers.test.jsx`:

```jsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));

// Fake useBus — return a stable Map-based bus the publishers can subscribe to.
const fakeBus = (() => {
  const handlers = new Map();
  return {
    subscribe(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      handlers.get(event)?.forEach((h) => h(payload));
    },
  };
})();

vi.mock('./hooks/useBus.js', () => ({ useBus: () => fakeBus }));

import { wsService } from '../services/WebSocketService.js';
import { ScreenSessionPublishers } from './ScreenSessionPublishers.jsx';

describe('ScreenSessionPublishers gating', () => {
  beforeEach(() => wsService.send.mockClear());

  it('mounts ack publisher when commands:true even without publishState', () => {
    const wsConfig = { commands: true, guardrails: { device: 'livingroom-tv' } };
    render(<ScreenSessionPublishers wsConfig={wsConfig} />);

    fakeBus.emit('media:queue-op', {
      op: 'play-now',
      contentId: 'plex:620707',
      commandId: 'cmd-1',
    });

    const ackCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-ack',
    );
    expect(ackCalls.length).toBe(1);
    expect(ackCalls[0][0]).toMatchObject({
      deviceId: 'livingroom-tv',
      commandId: 'cmd-1',
      ok: true,
    });
  });

  it('mounts state publisher when publishState:true', () => {
    const wsConfig = {
      publishState: true,
      guardrails: { device: 'livingroom-tv' },
    };
    render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    const stateCalls = wsService.send.mock.calls.filter(
      ([m]) => m?.topic === 'device-state',
    );
    expect(stateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders nothing when neither flag is set', () => {
    const wsConfig = { guardrails: { device: 'livingroom-tv' } };
    const { container } = render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    expect(container.firstChild).toBeNull();
    expect(wsService.send.mock.calls.length).toBe(0);
  });

  it('renders nothing when device is missing', () => {
    const wsConfig = { commands: true };
    const { container } = render(<ScreenSessionPublishers wsConfig={wsConfig} />);
    expect(container.firstChild).toBeNull();
  });
});
```

**Step 1.6.3: Run all three test files**

```bash
npx vitest run frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx \
              frontend/src/screen-framework/publishers/SessionStatePublisher.test.jsx \
              frontend/src/screen-framework/ScreenSessionPublishers.test.jsx
```

Expected: ALL PASS.

### Task 1.7: Delete the now-unused `SessionPublishers.jsx`

**Files:**
- Delete: `frontend/src/screen-framework/publishers/SessionPublishers.jsx`
- Delete: `frontend/src/screen-framework/publishers/SessionPublishers.test.jsx`

**Step 1.7.1: Confirm no other importers**

```bash
grep -rln "from .*publishers/SessionPublishers" /Users/kckern/Documents/GitHub/DaylightStation --include="*.js" --include="*.jsx" --include="*.mjs"
```

Expected: only the test file (about to be deleted) and any docs.

**Step 1.7.2: Delete the files**

```bash
git rm frontend/src/screen-framework/publishers/SessionPublishers.jsx \
       frontend/src/screen-framework/publishers/SessionPublishers.test.jsx
```

**Step 1.7.3: Re-run the full publishers test suite**

```bash
npx vitest run frontend/src/screen-framework/publishers/
```

Expected: PASS.

### Task 1.8: Commit Phase 1

```bash
git add frontend/src/screen-framework/publishers/CommandAckPublisher.jsx \
        frontend/src/screen-framework/publishers/CommandAckPublisher.test.jsx \
        frontend/src/screen-framework/publishers/SessionStatePublisher.jsx \
        frontend/src/screen-framework/publishers/SessionStatePublisher.test.jsx \
        frontend/src/screen-framework/ScreenSessionPublishers.jsx \
        frontend/src/screen-framework/ScreenSessionPublishers.test.jsx \
        frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "fix(screen-framework): mount command ack publisher on commands flag, not publishState

Previously useCommandAckPublisher was bundled inside SessionPublishers
which only mounted when wsConfig.publishState === true. Screens with
commands:true but no publishState (e.g. living-room.yml) silently never
sent device-ack. Backend WS-first dispatch then timed out at 4s and the
FKB URL fallback steamrolled the working WS playback.

Splits into <CommandAckPublisher> (gated on commands) and
<SessionStatePublisher> (gated on publishState). No YAML changes."
```

---

## Phase 2 — F5: Suppress menu render on action-URL initial load (UX)

**Why second:** Visually the most jarring symptom for the user. Independent of Phase 1 — both fixes can ship in either order. With both fixed, the user sees `[blank/loading shell] → [cover image / playback]` instead of `[menu flash] → [cover image] → [reload + menu flash again] → [cover image]`.

**Design:** `ScreenAutoplay` (in `ScreenRenderer.jsx:46-126`) already parses the URL search-params and dispatches actions on a 500 ms delay (line 101). The `PanelRenderer` renders the YAML layout unconditionally regardless. Add a sibling check: if `parseAutoplayParams(search, AUTOPLAY_ACTIONS)` returns one or more actions on **first mount**, render a minimal `<ActionLoadingShell />` instead of the YAML layout. Once the first overlay opens (player overlay) or the action settles (menu becomes appropriate again), let the layout render normally.

State machine:

```
initial-mount
   |
   +-- action params present? --yes--> render <ActionLoadingShell />
   |                                        |
   |                                        +-- player overlay opens
   |                                        |     OR
   |                                        +-- 5s safety timeout
   |                                              |
   |                                              v
   |                                       render YAML layout
   +-- no action params --> render YAML layout (default)
```

The 5 s safety timeout ensures we never strand the user on a blank screen if the action handler fails silently.

### Task 2.1: Write failing test for `useInitialActionGate` hook

**Files:**
- Create: `frontend/src/screen-framework/hooks/useInitialActionGate.test.js`

**Step 2.1.1: Write the test**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInitialActionGate } from './useInitialActionGate.js';

describe('useInitialActionGate', () => {
  beforeEach(() => vi.useFakeTimers());

  it('returns suppressLayout=false when search has no action params', () => {
    const { result } = renderHook(() =>
      useInitialActionGate('?foo=bar&baz=qux'),
    );
    expect(result.current.suppressLayout).toBe(false);
  });

  it('returns suppressLayout=true when search has play=', () => {
    const { result } = renderHook(() =>
      useInitialActionGate('?play=plex:620707'),
    );
    expect(result.current.suppressLayout).toBe(true);
  });

  it('returns suppressLayout=true for queue= and open= too', () => {
    expect(renderHook(() => useInitialActionGate('?queue=plex:1')).result.current.suppressLayout).toBe(true);
    expect(renderHook(() => useInitialActionGate('?open=videocall/x')).result.current.suppressLayout).toBe(true);
  });

  it('clears suppressLayout when releaseGate is called', () => {
    const { result } = renderHook(() => useInitialActionGate('?play=plex:1'));
    expect(result.current.suppressLayout).toBe(true);
    act(() => result.current.releaseGate());
    expect(result.current.suppressLayout).toBe(false);
  });

  it('auto-clears after the safety timeout (5s)', () => {
    const { result } = renderHook(() => useInitialActionGate('?play=plex:1'));
    expect(result.current.suppressLayout).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.suppressLayout).toBe(false);
  });

  it('does not re-engage when search changes mid-session (initial only)', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useInitialActionGate(s),
      { initialProps: { s: '' } },
    );
    expect(result.current.suppressLayout).toBe(false);
    rerender({ s: '?play=plex:1' });
    expect(result.current.suppressLayout).toBe(false); // initial-only
  });
});
```

**Step 2.1.2: Run — verify FAIL**

```bash
npx vitest run frontend/src/screen-framework/hooks/useInitialActionGate.test.js
```

Expected: FAIL "Cannot find module".

### Task 2.2: Implement `useInitialActionGate`

**Files:**
- Create: `frontend/src/screen-framework/hooks/useInitialActionGate.js`

**Step 2.2.1: Read the existing action-param parser**

```bash
sed -n '1,140p' frontend/src/lib/parseAutoplayParams.js
```

Confirm the export name (`parseAutoplayParams`) and the canonical AUTOPLAY_ACTIONS list shape — we'll reuse it rather than redefining.

**Step 2.2.2: Write the hook**

```jsx
import { useEffect, useRef, useState } from 'react';
import { parseAutoplayParams } from '../../lib/parseAutoplayParams.js';

const SAFETY_TIMEOUT_MS = 5000;

// Same canonical list as ScreenAutoplay (ScreenRenderer.jsx ~line 31).
// Kept in sync intentionally — the gate must trigger for any param that
// ScreenAutoplay will eventually act on.
const GATED_ACTIONS = [
  'play', 'queue', 'playlist', 'random',
  'display', 'read', 'open',
  'app', 'launch', 'list',
];

/**
 * useInitialActionGate — when a screen mounts with an action search-param
 * (?play=, ?queue=, ?open=, …), suppress the YAML-declared layout for the
 * first paint so the user sees a blank/loading shell rather than a menu
 * flash. Released either:
 *   - explicitly via releaseGate() (called when an overlay opens), OR
 *   - automatically after SAFETY_TIMEOUT_MS in case the action silently
 *     fails to mount anything.
 *
 * Initial-only: changes to `search` after first mount do NOT re-engage
 * the gate. The gate state is decided once.
 *
 * @param {string} search - URL search string (with or without leading '?')
 * @returns {{ suppressLayout: boolean, releaseGate: () => void }}
 */
export function useInitialActionGate(search) {
  // Decided exactly once on first render.
  const initialDecision = useRef(null);
  if (initialDecision.current === null) {
    const actions = parseAutoplayParams(search ?? '', GATED_ACTIONS);
    initialDecision.current = Array.isArray(actions) ? actions.length > 0 : !!actions;
  }

  const [suppressLayout, setSuppressLayout] = useState(initialDecision.current);

  useEffect(() => {
    if (!suppressLayout) return undefined;
    const t = setTimeout(() => setSuppressLayout(false), SAFETY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [suppressLayout]);

  return {
    suppressLayout,
    releaseGate: () => setSuppressLayout(false),
  };
}
```

> **Implementation note:** `parseAutoplayParams` may return an array or an object — verify the return shape during Step 2.2.1 and adjust the `actions.length > 0` check accordingly. If it returns a single action object or null, use `actions !== null && (Array.isArray(actions) ? actions.length > 0 : true)`.

**Step 2.2.3: Run — verify all 6 tests PASS**

```bash
npx vitest run frontend/src/screen-framework/hooks/useInitialActionGate.test.js
```

Expected: PASS (6/6).

### Task 2.3: Wire the gate into ScreenRenderer

**Files:**
- Modify: `frontend/src/screen-framework/ScreenRenderer.jsx` (the section that renders `<ScreenProvider config={config.layout}>` around line 358)

**Step 2.3.1: Read lines 340-380 of ScreenRenderer.jsx**

Identify exactly where layout rendering happens and where ScreenAutoplay is mounted.

**Step 2.3.2: Add the gate**

Inside the screen render block, near where `useLocation`/`window.location.search` is read:

```jsx
import { useInitialActionGate } from './hooks/useInitialActionGate.js';
import { ActionLoadingShell }   from './ActionLoadingShell.jsx';

// inside the ScreenRenderer component body:
const { suppressLayout, releaseGate } = useInitialActionGate(window.location.search);

// Listen on the bus for the first overlay-open event so we can release
// the gate as soon as the player (or any other action handler) takes
// over the screen visually.
useEffect(() => {
  if (!suppressLayout) return undefined;
  const bus = getActionBus();
  const onShown = () => releaseGate();
  const unsub = bus.subscribe('overlay:shown', onShown);
  return () => unsub?.();
}, [suppressLayout, releaseGate]);
```

> **Verify:** the actual ActionBus event name fired by `ScreenActionHandler.showOverlay()`. Check `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:109-125`. If the event is named differently (e.g. `screen:overlay-mounted`), use the actual name. If no such event exists today, emit one inside `showOverlay` as part of this task.

Then in the JSX where `<ScreenProvider config={config.layout}>` lives:

```jsx
<ScreenProvider config={suppressLayout ? null : config.layout}>
  {suppressLayout
    ? <ActionLoadingShell />
    : <PanelRenderer />}
  {/* …existing siblings: ScreenAutoplay, ScreenActionHandler, etc… */}
</ScreenProvider>
```

> If `<ScreenProvider config={null}>` causes downstream null-deref, instead render the layout subtree fully but wrap it in CSS `visibility: hidden` until the gate releases. The renderless approach is preferred — fewer DOM mutations on release.

### Task 2.4: Create `<ActionLoadingShell>`

**Files:**
- Create: `frontend/src/screen-framework/ActionLoadingShell.jsx`
- Create: `frontend/src/screen-framework/ActionLoadingShell.scss`

**Step 2.4.1: Write the shell**

```jsx
import React from 'react';
import './ActionLoadingShell.scss';

/**
 * ActionLoadingShell — minimal blank-with-spinner placeholder shown while
 * an initial action (play/queue/open) is bootstrapping its handler. Replaces
 * the YAML layout for the first paint to avoid a menu-flash.
 */
export function ActionLoadingShell() {
  return (
    <div className="action-loading-shell">
      <div className="action-loading-shell__spinner" aria-hidden="true" />
    </div>
  );
}

export default ActionLoadingShell;
```

```scss
.action-loading-shell {
  position: absolute;
  inset: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;

  &__spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(255, 255, 255, 0.15);
    border-top-color: rgba(255, 255, 255, 0.7);
    border-radius: 50%;
    /* TVApp.scss kills CSS animations — use Web Animations API at runtime
       if a visible spinner is required on the TV route. For Phase 2, a
       static dim circle is acceptable; revisit if UX feedback asks for motion. */
  }
}
```

> **TV-app caveat (per CLAUDE.md):** `TVApp.scss` kills all CSS transitions/animations under `.tv-app-container`. If you want the spinner to actually spin on the living-room TV, use `element.animate()` (Web Animations API) in a `useEffect` rather than CSS keyframes.

### Task 2.5: Verify Phase 2 manually + with snapshot test

**Files:**
- Create (optional): `frontend/src/screen-framework/ScreenRenderer.test.jsx` (only if it doesn't exist)

**Step 2.5.1: Run all new tests**

```bash
npx vitest run frontend/src/screen-framework/hooks/useInitialActionGate.test.js
```

Expected: 6/6 PASS.

**Step 2.5.2: Manual verification in dev (browser)**

1. Confirm dev server is running: `lsof -i :3111` (per CLAUDE.md). If not, `npm run dev`.
2. Open `http://localhost:3111/screen/living-room` in a browser → menu should appear (gate not engaged).
3. Open `http://localhost:3111/screen/living-room?play=plex:620707` in a new tab → blank shell briefly, then player. **No menu flash.**

If the manual test fails, do NOT mark this task complete — debug rather than skip.

### Task 2.6: Commit Phase 2

```bash
git add frontend/src/screen-framework/hooks/useInitialActionGate.js \
        frontend/src/screen-framework/hooks/useInitialActionGate.test.js \
        frontend/src/screen-framework/ActionLoadingShell.jsx \
        frontend/src/screen-framework/ActionLoadingShell.scss \
        frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(screen-framework): suppress menu render when initial URL has action param

When a screen mounts at /screen/X?play=... (or queue, open, etc.),
render a blank ActionLoadingShell instead of the YAML layout for the
first paint. Eliminates the menu-flash before the player overlay
mounts. Gate releases on overlay:shown or after a 5s safety timeout."
```

---

## Phase 3 — F2: Skip FKB camera check for non-camera content

**Design:** `prepareForContent()` always runs the camera check (3× 2 s retries on failure). For `play=plex:*` / `play=files:*` / `queue=*` flows there is no camera need, so the retries waste ~4 s per cold trigger. Make the camera check skippable via an option, then have `WakeAndLoadService` infer skipability from the content query and pass the flag.

### Task 3.1: Write failing test for `prepareForContent({ skipCameraCheck: true })`

**Files:**
- Modify: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs` (add a new `describe` block)

**Step 3.1.1: Read the existing test file structure**

```bash
sed -n '1,80p' backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Identify the existing mock-shell pattern used to stub `adbAdapter.shell()`.

**Step 3.1.2: Append the new test**

```javascript
describe('prepareForContent skipCameraCheck option', () => {
  it('runs the camera check when no option passed (default behavior)', async () => {
    const shell = vi.fn().mockResolvedValue({ output: '0' });
    const adapter = makeAdapter({ adbAdapter: { shell } });
    await adapter.prepareForContent();
    const camCalls = shell.mock.calls.filter(
      ([cmd]) => cmd.includes('/dev/video') || cmd.includes('/dev/camera'),
    );
    expect(camCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('skips the camera check when skipCameraCheck:true is passed', async () => {
    const shell = vi.fn().mockResolvedValue({ output: '' });
    const adapter = makeAdapter({ adbAdapter: { shell } });
    const result = await adapter.prepareForContent({ skipCameraCheck: true });
    const camCalls = shell.mock.calls.filter(
      ([cmd]) => cmd.includes('/dev/video') || cmd.includes('/dev/camera'),
    );
    expect(camCalls.length).toBe(0);
    expect(result.cameraAvailable).toBe(false);
    expect(result.cameraSkipped).toBe(true);
  });
});
```

> **Note:** `makeAdapter()` is a helper assumed to exist in the file. If not, build a minimal adapter instance with stubbed dependencies (logger, adbAdapter, fkb REST client). Pattern: read the existing test file's setup and copy that.

**Step 3.1.3: Run — verify FAIL**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: the two new tests FAIL ("camCalls.length").

### Task 3.2: Implement the option in `prepareForContent`

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:180-205` (the camera-check block)

**Step 3.2.1: Add the option to the function signature**

Change `async prepareForContent()` to `async prepareForContent({ skipCameraCheck = false } = {})`.

**Step 3.2.2: Wrap the camera-check loop**

```js
let cameraAvailable = false;
let cameraSkipped  = false;

if (skipCameraCheck) {
  cameraSkipped = true;
  this.#logger.info?.('fullykiosk.prepareForContent.cameraCheck.skipped', {
    reason: 'skipCameraCheck-flag',
  });
} else {
  for (let camAttempt = 1; camAttempt <= MAX_CAMERA_ATTEMPTS; camAttempt++) {
    // …existing loop unchanged…
  }
}

return { ok: true, /* …existing fields…, */ cameraAvailable, cameraSkipped };
```

**Step 3.2.3: Run — verify PASS**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: PASS (including original tests untouched).

### Task 3.3: Add `requiresCamera(query)` helper + wire WakeAndLoadService

**Files:**
- Create: `backend/src/3_applications/devices/services/contentRequiresCamera.mjs`
- Test: `backend/tests/unit/suite/3_applications/devices/contentRequiresCamera.test.mjs`
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:239` (the `await device.prepareForContent()` call)

**Step 3.3.1: Write failing test for `contentRequiresCamera`**

```javascript
import { describe, it, expect } from 'vitest';
import { contentRequiresCamera } from '../../../../../src/3_applications/devices/services/contentRequiresCamera.mjs';

describe('contentRequiresCamera', () => {
  it('returns false for play=plex:*', () => {
    expect(contentRequiresCamera({ play: 'plex:620707' })).toBe(false);
  });
  it('returns false for queue=*', () => {
    expect(contentRequiresCamera({ queue: 'plex:1' })).toBe(false);
  });
  it('returns true for open=videocall/*', () => {
    expect(contentRequiresCamera({ open: 'videocall/abc' })).toBe(true);
  });
  it('returns true for app=webcam', () => {
    expect(contentRequiresCamera({ app: 'webcam' })).toBe(true);
  });
  it('returns false for empty query', () => {
    expect(contentRequiresCamera({})).toBe(false);
  });
});
```

**Step 3.3.2: Verify FAIL**

```bash
npx vitest run backend/tests/unit/suite/3_applications/devices/contentRequiresCamera.test.mjs
```

Expected: FAIL "Cannot find module".

**Step 3.3.3: Implement the helper**

`backend/src/3_applications/devices/services/contentRequiresCamera.mjs`:

```javascript
/**
 * Conservative allow-list of action+value combinations that need the
 * Shield TV camera. Default is "no camera" so we only pay the camera
 * check cost on flows that genuinely need it.
 */
const CAMERA_APPS = new Set(['webcam']);

export function contentRequiresCamera(query = {}) {
  if (typeof query.open === 'string' && query.open.startsWith('videocall/')) {
    return true;
  }
  if (typeof query.app === 'string' && CAMERA_APPS.has(query.app)) {
    return true;
  }
  // play / queue / list / display / read / launch / random / playlist
  // → none currently need the camera. Add to this function (with a test)
  //   if a new camera-using flow appears.
  return false;
}

export default contentRequiresCamera;
```

**Step 3.3.4: Verify PASS**

```bash
npx vitest run backend/tests/unit/suite/3_applications/devices/contentRequiresCamera.test.mjs
```

Expected: PASS (5/5).

**Step 3.3.5: Wire into WakeAndLoadService**

In `WakeAndLoadService.mjs` near the top of the file:

```js
import { contentRequiresCamera } from './contentRequiresCamera.mjs';
```

At the call site (line 239 currently):

```js
const skipCameraCheck = !contentRequiresCamera(contentQuery);
const prepResult = await device.prepareForContent({ skipCameraCheck });
result.steps.prepare = prepResult;
```

> If `device.prepareForContent` is a generic device interface (not just FKB), make sure other device adapters either accept and ignore the option (preferred — additive) or have a passthrough. Verify with: `grep -rln "prepareForContent" backend/src`.

**Step 3.3.6: Run all backend tests touched**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs \
              backend/tests/unit/suite/3_applications/devices/contentRequiresCamera.test.mjs
```

Expected: PASS.

### Task 3.4: Commit Phase 3

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs \
        backend/src/3_applications/devices/services/contentRequiresCamera.mjs \
        backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs \
        backend/tests/unit/suite/3_applications/devices/contentRequiresCamera.test.mjs
git commit -m "perf(devices): skip FKB camera check when content doesn't need it

Camera check ran 3 attempts (~4s wasted) for every wake-and-load,
including plex/files playback that has no camera need. Adds a
contentRequiresCamera() helper and a skipCameraCheck option on
FullyKiosk.prepareForContent. Conservative allow-list — only
videocall and webcam flows require the camera today."
```

---

## Phase 4 — F3: Decouple `trigger.fired` from FKB `currentUrl` verification

**Design:** FKB `load()` currently returns only after `#verifyLoadedUrl` finishes (10 s poll for `currentUrl` to populate). On Shield TV the `currentUrl` poll often never matches even when the page loaded fine. Add a `verifyAsync` option that returns `ok` immediately on `loadURL` ack and runs verification as a background task that just logs the outcome (and emits a wake-progress `load.unverified` event for ops dashboards) — but does NOT block the response.

**Why fourth:** With Phase 1 fixed, the FKB load only runs in cold-restart cases (no existing WS subscriber). Still worth fixing to eliminate the ~10 s hang on those paths.

### Task 4.1: Write failing test — load returns on ack with verifyAsync:true

**Files:**
- Modify: `backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs`

**Step 4.1.1: Append the new describe block**

```javascript
describe('load verifyAsync option', () => {
  it('default: blocks until #verifyLoadedUrl completes (or times out)', async () => {
    /* …existing behavior — assert load() awaits verification path… */
  });

  it('verifyAsync:true: returns ok as soon as loadURL is acknowledged', async () => {
    const fkbClient = makeStubbedClient({
      loadUrlAck: { ok: true, ms: 200 },
      currentUrlReturns: 'about:blank',  // never matches
    });
    const adapter = makeAdapter({ fkbClient });

    const start = Date.now();
    const result = await adapter.load('/screen/x', { play: 'plex:1' }, { verifyAsync: true });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    expect(result.verified).toBe('async');
    expect(elapsed).toBeLessThan(1000); // not waiting for the 10s verify
  });
});
```

**Step 4.1.2: Verify FAIL**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: the new test FAILs.

### Task 4.2: Implement `verifyAsync` in `load()`

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:250-285` (the `load()` function)

**Step 4.2.1: Add the option**

Change signature: `async load(path, query = {}, { verifyAsync = false } = {})`.

**Step 4.2.2: Branch around the verify call**

After `loadUrl` is acknowledged:

```js
if (verifyAsync) {
  // Fire-and-forget verification: log the result, emit a progress
  // event if it failed, but never block the caller.
  this.#verifyLoadedUrl(fullUrl, expectedPath).then(
    (verified) => {
      this.#logger.info?.('fullykiosk.load.async-verified', { fullUrl, verified });
    },
    (err) => {
      this.#logger.warn?.('fullykiosk.load.async-verify-failed', {
        fullUrl, error: err?.message,
      });
    },
  );
  return { ok: true, verified: 'async', loadTimeMs: Date.now() - startTime };
}

// Existing synchronous path:
const verified = await this.#verifyLoadedUrl(fullUrl, expectedPath);
// …unchanged…
```

**Step 4.2.3: Verify PASS**

```bash
npx vitest run backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
```

Expected: PASS (all tests).

### Task 4.3: Wire `verifyAsync` into WakeAndLoadService

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:451` (the `device.loadContent(screenPath, contentQuery)` call inside the FKB-fallback branch)

**Step 4.3.1: Plumb the option through**

`device.loadContent` likely just forwards to `adapter.load`. Verify the chain:

```bash
grep -n "loadContent\|prepareForContent" backend/src/3_applications/devices/Device.mjs 2>/dev/null
grep -n "loadContent" backend/src/2_domains/devices/*.mjs 2>/dev/null
```

If `loadContent(path, query)` doesn't pass an options arg today, add a third param: `loadContent(path, query, options = {})` and forward `options` to the adapter `load()` call. Audit all `loadContent` call sites for compatibility (additive change, should be safe).

**Step 4.3.2: Pass `verifyAsync: true` from WakeAndLoadService**

In the FKB-fallback branch (line 451):

```js
const loadResult = await device.loadContent(screenPath, contentQuery, { verifyAsync: true });
```

> **Rationale:** The wake-and-load flow already has `playback.log` correlation via `#armPlaybackWatchdog` (line 573). That's the authoritative "is the user actually seeing media" signal — strictly more useful than `currentUrl` polling. So the verification can run async and lose the race without harm.

### Task 4.4: Verify the new end-to-end timing in dev

**Step 4.4.1: Trigger a cold NFC tap manually**

Power off the living-room TV. Then from a terminal:

```bash
curl -sS http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/8d_6d_2a_07 | jq .
```

Tail the logs in another terminal:

```bash
ssh homeserver.local 'docker logs -f daylight-station 2>&1' \
  | grep -E "wake-and-load\.|trigger\.fired|fullykiosk\.load\.|play\.log\.request_received"
```

Expected: `trigger.fired` should now arrive shortly after `fullykiosk.load.acknowledged` (within ~1 s), not 10 s later.

### Task 4.5: Commit Phase 4

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs \
        backend/src/3_applications/devices/services/WakeAndLoadService.mjs \
        backend/src/2_domains/devices/*.mjs \
        backend/tests/unit/suite/1_adapters/devices/FullyKioskContentAdapter.test.mjs
git commit -m "perf(devices): make FKB load verification async on the wake-and-load path

FKB currentUrl polling routinely never confirms the new URL on Shield
TV (fullykiosk.load.unverified, ~11s wasted). Adds a verifyAsync option
on FullyKioskContentAdapter.load — returns ok on loadURL ack and runs
verification in the background. WakeAndLoadService passes verifyAsync
on the FKB-fallback path; playback confirmation comes from the existing
playback watchdog (which is the real signal anyway)."
```

---

## Phase 5 — F7: Archive the conflicted-copy nfc.yml

**Files:**
- Delete (on prod): `/usr/src/app/data/household/config/nfc (kckern-server's conflicted copy 2026-04-24).yml`

### Task 5.1: Verify the conflicted file is not the active config

**Step 5.1.1: Diff the two files**

```bash
ssh homeserver.local 'docker exec daylight-station diff \
  /usr/src/app/data/household/config/nfc.yml \
  "/usr/src/app/data/household/config/nfc (kckern-server'"'"'s conflicted copy 2026-04-24).yml"'
```

If the diff is empty, the conflict file is purely redundant. If not, **stop and ask the user** which version to keep before archiving — it may contain unmerged tag mappings.

### Task 5.2: Archive the conflicted file

**Step 5.2.1: Move to `_archive` rather than delete (per CLAUDE.md branch management spirit)**

```bash
ssh homeserver.local 'docker exec daylight-station mkdir -p /usr/src/app/data/household/config/_archive'
ssh homeserver.local 'docker exec daylight-station mv \
  "/usr/src/app/data/household/config/nfc (kckern-server'"'"'s conflicted copy 2026-04-24).yml" \
  /usr/src/app/data/household/config/_archive/nfc-conflicted-copy-2026-04-24.yml'
```

**Step 5.2.2: Verify the active config still loads correctly**

```bash
curl -sS http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/8d_6d_2a_07?dryRun=1 | jq .
```

Expected: `{ ok: true, dryRun: true, action: 'play', target: 'livingroom-tv', … }`

### Task 5.3: No commit needed

This is a prod-data cleanup, not a code change. Note in the audit doc that F7 is resolved.

---

## Final verification — end-to-end live test

After all phases land, test the full flow:

1. SSH to prod, power off the living-room TV.
2. Tail logs: `ssh homeserver.local 'docker logs -f daylight-station 2>&1' | grep -E "trigger|wake-and-load|fullykiosk|play\.log\.request"`
3. Tap NFC tag `8d_6d_2a_07` (or `curl http://homeserver.local:3111/api/v1/trigger/livingroom/nfc/8d_6d_2a_07`).
4. Expected: `trigger.fired` log arrives in **≤ 14 s** (down from 27.6 s), and the visible Shield TV sequence is **blank shell → cover image → audio playing**, with no menu flash and no page reload.
5. Tap the same tag again immediately (warm path). Expected: `trigger.fired` ≤ 4 s — the WS-first ack should now succeed.
6. Document the new measured timing as a postmortem note appended to the audit.

---

## Skill references

- **Executing this plan:** `superpowers:executing-plans` or `superpowers:subagent-driven-development`
- **Per-task TDD discipline:** `superpowers:test-driven-development`
- **Verifying before claiming done:** `superpowers:verification-before-completion`
- **Final review:** `superpowers:requesting-code-review`
