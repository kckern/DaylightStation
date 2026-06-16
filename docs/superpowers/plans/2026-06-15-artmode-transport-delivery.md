# Transport-Agnostic Display/Scene Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GET /device/:id/load?display=art:<preset>` engage the ArtMode scene on any target (FKB + WebSocket) and any screen (screensaver or not), by converging both transports on a central `display:content` handler.

**Architecture:** Add a `display` command kind to the structured command protocol so the WebSocket transport can carry the display intent; both FKB (URL → ScreenAutoplay) and WS (command → useScreenCommands) emit `display:content` on the action bus; a central handler in the always-mounted `ScreenActionHandler` fetches the preset and shows ArtMode (moved out of the screensaver-coupled `ScreenScreensaver`).

**Tech Stack:** Node ESM (`.mjs`), shared-contracts, React, Vitest.

**Test runner:** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.

---

## File Structure

- `shared/contracts/media/commands.mjs` (modify) — add `display` command kind.
- `shared/contracts/media/envelopes.mjs` (modify) — validate `display` params.
- `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs` (modify) — display branch.
- `frontend/src/screen-framework/commands/useScreenCommands.js` (modify) — `display` → `display:content`.
- `frontend/src/screen-framework/actions/ScreenActionHandler.jsx` (modify) — central `display:content` art handler.
- `frontend/src/screen-framework/ScreenScreensaver.jsx` (modify) — remove the sub-project-3 scene code.
- `frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx` (delete).
- `docs/reference/content/content-model.md`, `docs/reference/screen-configs.md` (modify) — document the display command + ad-hoc trigger.
- Tests: `shared/contracts/media/display-command.test.mjs`, `tests/unit/devices/WebSocketContentAdapter.display.test.mjs`, `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (extend).

---

### Task 1: Protocol — add the `display` command kind

**Files:**
- Modify: `shared/contracts/media/commands.mjs`
- Modify: `shared/contracts/media/envelopes.mjs`
- Test: `shared/contracts/media/display-command.test.mjs`

- [ ] **Step 1: Write the failing test** — create `shared/contracts/media/display-command.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { isCommandKind } from './commands.mjs';
import { buildCommandEnvelope, validateCommandEnvelope } from './envelopes.mjs';

describe('display command kind', () => {
  it('isCommandKind recognizes display', () => {
    expect(isCommandKind('display')).toBe(true);
  });
  it('builds + validates a display envelope with contentId', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'living', command: 'display', commandId: 'c1',
      params: { contentId: 'art:classical-evening' },
    });
    expect(env.command).toBe('display');
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });
  it('rejects a display envelope missing contentId', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'living', command: 'display', commandId: 'c1', params: {},
    });
    const result = validateCommandEnvelope(env);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/contentId/);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs shared/contracts/media/display-command.test.mjs` (build throws `unknown command kind "display"`).

- [ ] **Step 3a: Add the kind** in `shared/contracts/media/commands.mjs`. Change:
```js
export const COMMAND_KINDS = Object.freeze([
  'transport', 'queue', 'config', 'adopt-snapshot', 'system',
]);
```
to:
```js
export const COMMAND_KINDS = Object.freeze([
  'transport', 'queue', 'config', 'adopt-snapshot', 'system', 'display',
]);
```

- [ ] **Step 3b: Validate params** in `shared/contracts/media/envelopes.mjs`. In `validateCommandParams`, immediately BEFORE the `if (command === 'system') {` branch, insert:
```js
  if (command === 'display') {
    if (!isStr(p.contentId)) {
      errors.push('params.contentId: required non-empty string');
    }
    return;
  }
```
(`isStr` is already defined/used in this file.)

- [ ] **Step 4: Run to confirm PASS** — same command → 3 green.

- [ ] **Step 5: Run the existing protocol tests to confirm no regression:**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs shared/contracts/media/commands.test.mjs shared/contracts/media/envelopes.test.mjs
```
Expected: green.

- [ ] **Step 6: Commit**
```bash
git add shared/contracts/media/commands.mjs shared/contracts/media/envelopes.mjs shared/contracts/media/display-command.test.mjs
git commit -m "feat(protocol): add display command kind (params.contentId)"
```

---

### Task 2: WebSocket transport carries the display intent

**Files:**
- Modify: `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs`
- Modify: `frontend/src/screen-framework/commands/useScreenCommands.js`
- Test: `tests/unit/devices/WebSocketContentAdapter.display.test.mjs`

- [ ] **Step 1: Write the failing test** — create `tests/unit/devices/WebSocketContentAdapter.display.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { WebSocketContentAdapter } from '../../../backend/src/1_adapters/devices/WebSocketContentAdapter.mjs';

const make = () => {
  const broadcast = vi.fn(async () => {});
  const adapter = new WebSocketContentAdapter(
    { topic: 'office', deviceId: 'office-tv' },
    { wsBus: { broadcast }, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  return { adapter, broadcast };
};

describe('WebSocketContentAdapter display intent', () => {
  it('broadcasts a display envelope for query.display', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', { display: 'art:classical-evening' });
    expect(r.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [topic, env] = broadcast.mock.calls[0];
    expect(topic).toBe('office');
    expect(env.command).toBe('display');
    expect(env.params.contentId).toBe('art:classical-evening');
  });

  it('still broadcasts a queue envelope for media content (unchanged)', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', { queue: 'plex:1' });
    expect(r.ok).toBe(true);
    expect(broadcast.mock.calls[0][1].command).toBe('queue');
    expect(broadcast.mock.calls[0][1].params.contentId).toBe('plex:1');
  });

  it('still errors when no contentId and no display', async () => {
    const { adapter, broadcast } = make();
    const r = await adapter.load('/screen/office', {});
    expect(r.ok).toBe(false);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/devices/WebSocketContentAdapter.display.test.mjs` (display query currently → "no contentId" error).

- [ ] **Step 3a: Add the display branch** in `backend/src/1_adapters/devices/WebSocketContentAdapter.mjs`. In `async load(path, query = {})`, immediately AFTER `this.#metrics.loads++;` and BEFORE `const resolved = resolveContentId(query);`, insert:
```js
    // Display/scene delivery: `display=<contentId>` carries no media contentId;
    // broadcast a `display` command the screen routes to display:content.
    if (typeof query.display === 'string' && query.display.length > 0) {
      try {
        const commandId = randomUUID();
        const envelope = buildCommandEnvelope({
          targetDevice: this.#deviceId,
          command: 'display',
          commandId,
          params: { contentId: query.display },
        });
        await this.#wsBus.broadcast(this.#topic, envelope);
        this.#logger.info?.('websocket.load.display', {
          topic: this.#topic, deviceId: this.#deviceId, commandId, contentId: query.display,
        });
        return { ok: true, topic: this.#topic, commandId, loadTimeMs: Date.now() - startTime };
      } catch (error) {
        this.#metrics.errors++;
        this.#logger.error?.('websocket.load.error', {
          topic: this.#topic, deviceId: this.#deviceId, error: error.message,
        });
        return { ok: false, topic: this.#topic, error: error.message };
      }
    }
```
(`randomUUID` and `buildCommandEnvelope` are already imported in this file.)

- [ ] **Step 3b: Route the command on the frontend** in `frontend/src/screen-framework/commands/useScreenCommands.js`. Immediately AFTER the `if (command === 'queue') { ... }` block, insert:
```js
    if (command === 'display') {
      logger().info('commands.display', { commandId, params });
      bus.emit('display:content', { id: params.contentId, commandId });
      return;
    }
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs tests/unit/devices/WebSocketContentAdapter.display.test.mjs` → 3 green.

- [ ] **Step 5: Commit**
```bash
git add backend/src/1_adapters/devices/WebSocketContentAdapter.mjs frontend/src/screen-framework/commands/useScreenCommands.js tests/unit/devices/WebSocketContentAdapter.display.test.mjs
git commit -m "feat(artmode): WS transport carries display command → display:content"
```

(The `useScreenCommands` mapping mirrors its untested sibling command branches; it's covered end-to-end by the live office dispatch in Task 6.)

---

### Task 3: Central `display:content` handler in `ScreenActionHandler`

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
- Test: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (extend)

- [ ] **Step 1: Add failing tests** to `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`.

(a) Add this module-level mock near the other `vi.mock(...)` calls (after the Player mock):
```jsx
// Stub the 'art' widget so the scene overlay renders without ArtMode's deps.
vi.mock('../widgets/registry.js', () => ({
  getWidgetRegistry: () => ({
    get: () => (props) => <div data-testid="art-scene" data-collection={props.collection || ''} />,
  }),
}));
```

(b) Add these tests inside the `describe('ScreenActionHandler', ...)` block:
```jsx
  it('engages the art scene on a display:content art: id', async () => {
    vi.spyOn(apiModule, 'DaylightAPI').mockResolvedValue({ collection: 'all', music: { queue: 'plex:622894' } });
    const { findByTestId, queryByTestId } = render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    expect(queryByTestId('art-scene')).toBeNull();
    await act(async () => { getActionBus().emit('display:content', { id: 'art:classical-evening' }); });
    const el = await findByTestId('art-scene');
    expect(el.dataset.collection).toBe('all');
    expect(apiModule.DaylightAPI).toHaveBeenCalledWith('api/v1/art/preset/classical-evening');
  });

  it('ignores non-art display:content ids', async () => {
    const spy = vi.spyOn(apiModule, 'DaylightAPI').mockResolvedValue({});
    spy.mockClear();   // shared spy — drop any call history from prior tests
    render(
      <ScreenOverlayProvider>
        <ScreenActionHandler />
      </ScreenOverlayProvider>
    );
    act(() => { getActionBus().emit('display:content', { id: 'immich:abc' }); });
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to confirm FAIL** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (no `display:content` handler → no `art-scene`).

- [ ] **Step 3: Add the handler** in `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`.

(a) Add `handleDisplayContent` next to the other `useCallback` handlers (e.g. right after `handleDisplayOverlay`):
```jsx
  // Ad-hoc ArtMode scene: a display:content art:<preset> id (from a FKB URL param
  // or a WS display command) fetches the preset props and shows ArtMode fullscreen.
  // Works on any screen, independent of the screensaver config.
  const handleDisplayContent = useCallback((payload) => {
    const id = payload?.id;
    if (!id || !String(id).startsWith('art:')) return;
    const preset = String(id).slice('art:'.length);
    DaylightAPI(`api/v1/art/preset/${encodeURIComponent(preset)}`)
      .then((props) => {
        if (!props) return;
        const Component = getWidgetRegistry().get('art');
        if (!Component) { logger().warn('action.scene.widget-not-found'); return; }
        showOverlay(
          Component,
          { ...props, onExit: () => dismissOverlay('fullscreen') },
          { mode: 'fullscreen', priority: 'high' },
        );
        logger().info('action.scene.show', { preset });
      })
      .catch((err) => logger().warn('artmode.scene.unknown', { preset, error: err?.message }));
  }, [showOverlay, dismissOverlay]);
```

(b) Register it next to the other `useScreenAction(...)` calls (e.g. after `useScreenAction('display:overlay', handleDisplayOverlay);`):
```jsx
  useScreenAction('display:content', handleDisplayContent);
```

- [ ] **Step 4: Run to confirm PASS** — `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` → all green (new + existing).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "feat(artmode): central display:content art-scene handler (any screen)"
```

---

### Task 4: Remove the scene code from `ScreenScreensaver`

**Files:**
- Modify: `frontend/src/screen-framework/ScreenScreensaver.jsx`
- Delete: `frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx`

The central handler (Task 3) supersedes the screensaver-coupled scene code from sub-project 3. Remove it so `display:content` isn't double-handled.

- [ ] **Step 1: Delete the obsolete scene test**
```bash
git rm frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx
```

- [ ] **Step 2: Revert the scene additions in `frontend/src/screen-framework/ScreenScreensaver.jsx`.**

(a) Restore the import block to:
```jsx
import { useEffect, useRef } from 'react';
import { useScreenOverlay } from './overlays/ScreenOverlayProvider.jsx';
import { getWidgetRegistry } from './widgets/registry.js';
import { useMenuNavigationContext } from '../context/MenuNavigationContext.jsx';
import getLogger from '../lib/logging/Logger.js';
```
(removes `useCallback`, `useScreenAction`, `DaylightAPI`).

(b) Remove the scene-subscription block (the `sceneRef` ref, `onSceneContent` useCallback, and the `useScreenAction('display:content', onSceneContent);` line) that sits just after the `hasOverlayRef` block.

(c) Remove the `showScene` definition and the `sceneRef.current = showScene;` line inside the main effect (the block added after `function show() { ... }`, including its `if (timer) clearTimeout(timer);` line).

(d) Remove `sceneRef.current = null;` from the effect cleanup (restore cleanup's first line to `if (timer) clearTimeout(timer);`).

The file returns to its sub-project-2 state (passive idle/boot screensaver only).

- [ ] **Step 3: Confirm the passive screensaver still works + nothing references the removed code:**
```bash
grep -nE "sceneRef|onSceneContent|showScene|display:content|useScreenAction|DaylightAPI" frontend/src/screen-framework/ScreenScreensaver.jsx || echo "(clean — no scene code remains)"
```
Expected: prints `(clean — no scene code remains)`.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/screen-framework/ScreenScreensaver.jsx frontend/src/screen-framework/ScreenScreensaver.scene.test.jsx
git commit -m "refactor(artmode): move scene handling out of ScreenScreensaver (now central)"
```

---

### Task 5: Update reference docs

**Files:**
- Modify: `docs/reference/content/content-model.md`
- Modify: `docs/reference/screen-configs.md`

Reference docs are present-tense endstate (describe what the system does). Read each file's relevant section first, then make the additions below.

- [ ] **Step 1: `content-model.md`** — in the structured-command / capabilities discussion, document that the command protocol includes a **`display`** kind (`params.contentId`) and that the `display:content` action is delivered transport-agnostically: the FKB transport forwards it as a `?display=<contentId>` URL param (consumed by `ScreenAutoplay`) and the WebSocket transport carries it as a `display` `CommandEnvelope` (routed by `useScreenCommands`); both converge on the `display:content` action handled by `ScreenActionHandler`. (Present tense; no class names in body beyond what the file's style already uses — match the file's conventions; a directory-pointer footer if the file uses one.)

- [ ] **Step 2: `screen-configs.md`** — document triggering ArtMode ad hoc via `GET /api/v1/device/<id>/load?display=art:<preset>`: it works on any screen and any target (FKB or WebSocket), does **not** require a `screensaver:` block, resolves the preset from `artmode.yml`, and shows ArtMode as a one-shot fullscreen scene. Note this is distinct from the passive screensaver (`screensaver.preset`, idle/boot, silent).

- [ ] **Step 3: Update the docs freshness marker** (per docs workflow):
```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

- [ ] **Step 4: Commit**
```bash
git add docs/reference/content/content-model.md docs/reference/screen-configs.md docs/docs-last-updated.txt
git commit -m "docs(reference): display command + ad-hoc ArtMode trigger across transports"
```

---

### Task 6: Full suite + live verification (office + living-room)

**Files:** none.

- [ ] **Step 1: Run the full touched-surface suite**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  shared/contracts/media/display-command.test.mjs \
  shared/contracts/media/commands.test.mjs \
  shared/contracts/media/envelopes.test.mjs \
  tests/unit/devices/WebSocketContentAdapter.display.test.mjs \
  tests/unit/art/ \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  frontend/src/screen-framework/widgets/ArtMode.test.jsx
```
Expected: all green. (Note: `ScreenScreensaver.scene.test.jsx` is gone; the passive `ScreenScreensaver` has no co-located test to break.)

- [ ] **Step 2: Build + deploy** (stash unrelated WIP first, restore after — per prior plans).

- [ ] **Step 3: Live — office (WebSocket transport)**
```bash
curl -s "http://localhost:3111/api/v1/device/office-tv/load?display=art:classical-evening" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ok:', d.get('ok'), '| failedStep:', d.get('failedStep'))"
sleep 20; sudo docker logs --since 2m daylight-station 2>&1 | grep -iE "websocket.load.display|commands.display|action.scene|art.preset" | tail -8
```
Expected: `ok: True`; logs show the display command broadcast on the `office` topic and (if the office screen is connected) the scene engaging. The office TV shows ArtMode (with classical music) over its dashboard; OK/Back dismisses back to the dashboard.

- [ ] **Step 4: Live — living-room (FKB transport) still works**
```bash
curl -s "http://localhost:3111/api/v1/device/livingroom-tv/load?display=art:classical-evening" | python3 -c "import sys,json;d=json.load(sys.stdin);print('ok:', d.get('ok'))"
```
Expected: `ok: True`; living-room shows the art-with-music scene (unchanged from sub-project 3, now via the central handler).

(Deploy + physical TV actuation are the operator's call; the plan ends at green tests + these dispatch checks.)

---

## Notes for the implementer
- Run specs with `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` (NOT `npm test`). `@shared-contracts` and `#shared-contracts` both resolve.
- The `display` command is additive to the protocol — existing `transport`/`queue`/`config`/`adopt-snapshot`/`system` commands are untouched.
- FKB path is unchanged (URL `?display=` → `ScreenAutoplay` → `display:content`); only the WS path and the central handler are new. Both converge on `ScreenActionHandler`.
- After Task 4, `display:content` must be handled in exactly ONE place (`ScreenActionHandler`) — verify no duplicate handler remains.
