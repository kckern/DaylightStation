# Media App P7 (External Control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Enable external systems (home automation, other browsers, dashboards) to drive this client's local session via WebSocket. When the app mounts, it subscribes to `client-control:<clientId>`; inbound `CommandEnvelope` messages (transport/queue/config/adopt-snapshot/system) are validated and dispatched to the local controller. Ack on `client-ack:<clientId>`.

**Architecture:** A side-effect hook `useExternalControl()` mounted inside `LocalSessionProvider` alongside `useUrlCommand` and `usePlaybackStateBroadcast`. Validates envelopes via `@shared-contracts/media/envelopes.mjs`. Routes commands to the local controller; sends an ack frame for every valid command.

**Tech Stack:** React · Vitest · `wsService` · `useSessionController('local')` · `mediaLog` · shared contracts.

## Pre-flight

- Parent: main post-P6. Worktree `feature/media-app-p7`. Baseline ~220 tests.
- **WebSocket:** `client-control:<clientId>` inbound; `client-ack:<clientId>` outbound ack (not yet a published contract; we define the simplest shape — `{topic: 'client-ack', clientId, commandId, ok, error?, appliedAt}` — and send via `wsService.send`).
- **Command envelope** (§6.2): `{type: 'command', targetDevice?, targetScreen?, commandId, command, params, ts}` — for `client-control` we care about `commandId` + `command` + `params`.

## File map

- `frontend/src/modules/Media/externalControl/useExternalControl.js` — hook + test
- `frontend/src/modules/Media/session/LocalSessionProvider.jsx` — **modify** — mount `useExternalControl` inside `UrlAndBroadcastMount` (rename to `SessionSideEffects`)
- `tests/live/flow/media/media-app-external.runtime.test.mjs` — e2e smoke

## Task 1: useExternalControl

```js
// frontend/src/modules/Media/externalControl/useExternalControl.js
import { useEffect } from 'react';
import { wsService } from '../../../services/WebSocketService.js';
import { useClientIdentity } from '../session/ClientIdentityProvider.jsx';
import { useSessionController } from '../session/useSessionController.js';
import mediaLog from '../logging/mediaLog.js';

function handleCommand(controller, envelope) {
  const { command, params = {} } = envelope;
  if (command === 'transport') {
    const { action, value } = params;
    const fn = controller.transport?.[action];
    if (typeof fn === 'function') fn(value);
  } else if (command === 'queue') {
    const { op, contentId, queueItemId, clearRest, from, to, items } = params;
    const q = controller.queue;
    if (!q) return;
    if (op === 'play-now') q.playNow?.({ contentId }, { clearRest });
    else if (op === 'play-next') q.playNext?.({ contentId });
    else if (op === 'add-up-next') q.addUpNext?.({ contentId });
    else if (op === 'add') q.add?.({ contentId });
    else if (op === 'remove') q.remove?.(queueItemId);
    else if (op === 'jump') q.jump?.(queueItemId);
    else if (op === 'clear') q.clear?.();
    else if (op === 'reorder') q.reorder?.(items ? { items } : { from, to });
  } else if (command === 'config') {
    const { setting, value } = params;
    const c = controller.config;
    if (!c) return;
    if (setting === 'shuffle') c.setShuffle?.(value);
    else if (setting === 'repeat') c.setRepeat?.(value);
    else if (setting === 'shader') c.setShader?.(value);
    else if (setting === 'volume') c.setVolume?.(value);
  } else if (command === 'adopt-snapshot') {
    const { snapshot, autoplay = true } = params;
    if (snapshot) controller.lifecycle?.adoptSnapshot?.(snapshot, { autoplay });
  }
}

export function useExternalControl() {
  const { clientId } = useClientIdentity();
  const controller = useSessionController('local');
  useEffect(() => {
    if (!clientId) return;
    const topic = `client-control:${clientId}`;
    const ackTopic = `client-ack`;
    const unsub = wsService.subscribe(
      (msg) => msg && msg.topic === topic,
      (msg) => {
        const commandId = msg.commandId;
        if (!commandId) return;
        try {
          handleCommand(controller, msg);
          mediaLog.externalControlReceived({ commandId, command: msg.command });
          wsService.send({ topic: ackTopic, clientId, commandId, ok: true, appliedAt: new Date().toISOString() });
        } catch (err) {
          mediaLog.externalControlRejected({ commandId, reason: err?.message });
          wsService.send({ topic: ackTopic, clientId, commandId, ok: false, error: err?.message, appliedAt: new Date().toISOString() });
        }
      }
    );
    return unsub;
  }, [clientId, controller]);
}

export default useExternalControl;
```

**Test (5 cases):**
1. Subscribes to `client-control:<clientId>`
2. Transport command routes to `controller.transport[action]`
3. Queue play-now routes to `controller.queue.playNow` with `{contentId}` and `{clearRest}`
4. Config volume routes to `controller.config.setVolume`
5. Sends ack on `client-ack` topic after every handled command

## Task 2: Wire into LocalSessionProvider

Modify `SessionSideEffects` (currently `UrlAndBroadcastMount`) to also call `useExternalControl()`.

**Read** `frontend/src/modules/Media/session/LocalSessionProvider.jsx` and find the inner component. Add the import + call:

```jsx
import { useExternalControl } from '../externalControl/useExternalControl.js';

function UrlAndBroadcastMount() {
  // ... existing hooks
  useExternalControl();
  return null;
}
```

**Test:** verify LocalSessionProvider still renders (existing test passes).

## Task 3: Final merge + validation

Tests: target ~230 vitest.
