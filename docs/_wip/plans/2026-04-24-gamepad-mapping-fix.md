# Gamepad Mapping Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make gamepad input on the Living Room Shield TV navigate the menu and arcade selector flawlessly and intuitively, with one consistent button mapping (no double-fire, no select/back conflict).

**Architecture:** The screen-framework already has a `GamepadAdapter` that polls `navigator.getGamepads()` and dispatches synthetic `keydown` events. The Menu module also has its own duplicate gamepad pollers inside `Menu.jsx` (`MenuItems` component) and `ArcadeSelector.jsx` — they predate the framework adapter. These duplicates cause: (a) double-firing on navigation (two `navigateTo` calls per d-pad press), and (b) a select/back conflict on button 1 (B/east face button) where the framework says select but the local poller says back. Fix: make `GamepadAdapter` the single source of truth, delete the local pollers from both components, and adjust the framework button map so button 1 → Escape (back) — matching Western/Steam/Xbox UX (south face = primary, east face = back).

**Tech Stack:** React, vitest with happy-dom environment, Web Gamepad API, Anthropic logging framework, Web Animations API.

**Final button map (post-fix):**

| Button (standard mapping) | Common labels | Action |
|---|---|---|
| 0 (south) | A / X / B-Nintendo | **select** (Enter) |
| 1 (east) | B / O / A-Nintendo | **back** (Escape) ← changed from select |
| 2 (west) | X / □ / Y-Nintendo | select (Enter) |
| 3 (north) | Y / △ / X-Nintendo | select (Enter) |
| 4 (LB) | L1 | unmapped ← changed from select |
| 5 (RB) | R1 | unmapped ← changed from select |
| 8 (View / Select / Minus) | — | **back** (Escape) |
| 9 (Menu / Start / Plus) | — | select (Enter) |
| 12-15 (D-pad) | — | ArrowUp/Down/Left/Right (with key repeat) |
| Left stick (axes 0,1) | — | ArrowUp/Down/Left/Right (deadzone 0.5, with repeat) |

Rationale: any face button + Start = select (forgiving), small View/Select button + east face = back (intuitive), shoulder buttons unmapped (so accidental L1/R1 won't select a game).

---

## Task 1: Add baseline GamepadAdapter unit test

**Why this task:** No test exists for `GamepadAdapter` today. Establish a regression baseline that reflects the *current* (broken) behavior. We'll update it in Task 3 to assert the fixed behavior.

**Files:**
- Create: `frontend/src/screen-framework/input/adapters/GamepadAdapter.test.js`

**Step 1: Write the baseline test asserting current behavior**

Use `KeyboardAdapter.test.js` (in the same folder) as the structural template — same `vitest`/`ActionBus` pattern. The Gamepad adapter polls via `requestAnimationFrame`, so the test must (a) mock `navigator.getGamepads` to return a fake gamepad object whose buttons we control, and (b) drive the polling loop manually by stubbing `requestAnimationFrame` to capture the callback and invoke it on demand.

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { GamepadAdapter } from './GamepadAdapter.js';

function makeFakeGamepad({ buttons = 17, axes = 4 } = {}) {
  return {
    index: 0,
    id: 'Test Gamepad',
    mapping: 'standard',
    buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })),
    axes: Array.from({ length: axes }, () => 0),
  };
}

describe('GamepadAdapter — current behavior baseline', () => {
  let bus, adapter, fakeGp, rafCallbacks;

  beforeEach(() => {
    bus = new ActionBus();
    fakeGp = makeFakeGamepad();
    vi.stubGlobal('navigator', { getGamepads: () => [fakeGp] });
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    adapter = new GamepadAdapter(bus);
    adapter.attach();
  });

  afterEach(() => {
    adapter.destroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function tick() {
    const cb = rafCallbacks.shift();
    if (cb) cb();
  }

  function pressButton(idx) {
    fakeGp.buttons[idx].pressed = true;
    tick();
  }
  function releaseButton(idx) {
    fakeGp.buttons[idx].pressed = false;
    tick();
  }

  it('button 0 (south face) emits select', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    pressButton(0);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('button 1 (east face) currently emits select [will change in Task 3]', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    pressButton(1);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('button 8 (View/Select) emits escape', () => {
    const handler = vi.fn();
    bus.subscribe('escape', handler);
    pressButton(8);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('button 12 (d-pad up) emits navigate up', () => {
    const handler = vi.fn();
    bus.subscribe('navigate', handler);
    pressButton(12);
    expect(handler).toHaveBeenCalledWith({ direction: 'up' });
  });

  it('dispatches synthetic keydown alongside ActionBus emit', () => {
    const listener = vi.fn();
    window.addEventListener('keydown', listener);
    pressButton(0);
    expect(listener).toHaveBeenCalled();
    const ev = listener.mock.calls[0][0];
    expect(ev.key).toBe('Enter');
    expect(ev.__gamepadSynthetic).toBe(true);
    window.removeEventListener('keydown', listener);
  });
});
```

**Step 2: Run the test to confirm baseline passes**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/GamepadAdapter.test.js
```

Expected: 5 passing. (Confirms: poll loop is reachable, button-0/1/8/12 currently behave as the BUTTON_MAP says, synthetic event flag is set.)

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.test.js
git commit -m "test(gamepad): add baseline test for current button map"
```

---

## Task 2: Add a failing test for the new button map (TDD red)

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.test.js`

**Step 1: Add a new `describe` block at the bottom of the file asserting the post-fix behavior**

```js
describe('GamepadAdapter — fixed mapping (Task 2-3 target)', () => {
  let bus, adapter, fakeGp, rafCallbacks;

  beforeEach(() => {
    bus = new ActionBus();
    fakeGp = makeFakeGamepad();
    vi.stubGlobal('navigator', { getGamepads: () => [fakeGp] });
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    adapter = new GamepadAdapter(bus);
    adapter.attach();
  });

  afterEach(() => {
    adapter.destroy();
    vi.unstubAllGlobals();
  });

  const tick = () => { const cb = rafCallbacks.shift(); if (cb) cb(); };
  const press = (i) => { fakeGp.buttons[i].pressed = true; tick(); };

  it('button 1 (east face) emits ESCAPE (was select)', () => {
    const onEscape = vi.fn();
    const onSelect = vi.fn();
    bus.subscribe('escape', onEscape);
    bus.subscribe('select', onSelect);
    press(1);
    expect(onEscape).toHaveBeenCalledWith({});
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('button 1 dispatches synthetic Escape keydown (was Enter)', () => {
    const listener = vi.fn();
    window.addEventListener('keydown', listener);
    press(1);
    const calls = listener.mock.calls.filter(([e]) => e.__gamepadSynthetic);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0].key).toBe('Escape');
    window.removeEventListener('keydown', listener);
  });

  it('button 4 (LB) is unmapped — emits nothing on the bus', () => {
    const wildcard = vi.fn();
    bus.subscribe('*', wildcard);
    press(4);
    // Wildcard receives all emits; ensure none came through for button 4
    expect(wildcard).not.toHaveBeenCalled();
  });

  it('button 5 (RB) is unmapped — emits nothing', () => {
    const wildcard = vi.fn();
    bus.subscribe('*', wildcard);
    press(5);
    expect(wildcard).not.toHaveBeenCalled();
  });

  it('button 0 (south) still emits select', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    press(0);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('button 9 (Start/Menu/Plus) still emits select', () => {
    const handler = vi.fn();
    bus.subscribe('select', handler);
    press(9);
    expect(handler).toHaveBeenCalledWith({});
  });

  it('button 8 (View/Select/Minus) still emits escape', () => {
    const handler = vi.fn();
    bus.subscribe('escape', handler);
    press(8);
    expect(handler).toHaveBeenCalledWith({});
  });
});
```

Also **delete the stale baseline test for button 1** (the `'button 1 (east face) currently emits select [will change in Task 3]'` test from Task 1) — that assertion will start failing in Task 3 and we don't want two tests asserting opposite behaviors.

**Step 2: Run the new tests to confirm they FAIL**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/GamepadAdapter.test.js
```

Expected: the four new tests in the second describe block fail (button 1 still emits select; buttons 4 & 5 still emit select). The other tests pass.

**Step 3: Commit the failing tests**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.test.js
git commit -m "test(gamepad): add failing tests for fixed button map"
```

---

## Task 3: Update GamepadAdapter BUTTON_MAP (TDD green)

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js:10-23`

**Step 1: Replace the BUTTON_MAP object**

Find this block in `GamepadAdapter.js`:

```js
const BUTTON_MAP = {
  0:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // A
  1:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // B
  2:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // X
  3:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Y
  4:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // LB
  5:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // RB
  8:  { key: 'Escape',     action: 'escape',   payload: {},                        repeats: false }, // Select
  9:  { key: 'Enter',      action: 'select',   payload: {},                        repeats: false }, // Start
  12: { key: 'ArrowUp',    action: 'navigate',  payload: { direction: 'up' },      repeats: true },
  13: { key: 'ArrowDown',  action: 'navigate',  payload: { direction: 'down' },    repeats: true },
  14: { key: 'ArrowLeft',  action: 'navigate',  payload: { direction: 'left' },    repeats: true },
  15: { key: 'ArrowRight', action: 'navigate',  payload: { direction: 'right' },   repeats: true },
};
```

Replace with:

```js
// Standard Gamepad mapping (https://www.w3.org/TR/gamepad/#dfn-standard-gamepad-layout)
// Button positions are physical, not labeled — button 0 is always the bottom (south)
// face button regardless of whether it's labeled "A" (Xbox) or "B" (Nintendo).
//
// Mapping rationale: any primary face button + Start = select (forgiving on a TV
// where users fumble); the east face button + the small View/Select button = back.
// Shoulder buttons are unmapped so an accidental L1/R1 grip-press doesn't launch
// a game from the arcade selector.
const BUTTON_MAP = {
  0:  { key: 'Enter',      action: 'select',   payload: {},                   repeats: false }, // South face (A / X / Nintendo-B)
  1:  { key: 'Escape',     action: 'escape',   payload: {},                   repeats: false }, // East face (B / O / Nintendo-A) — back
  2:  { key: 'Enter',      action: 'select',   payload: {},                   repeats: false }, // West face (X / □ / Nintendo-Y)
  3:  { key: 'Enter',      action: 'select',   payload: {},                   repeats: false }, // North face (Y / △ / Nintendo-X)
  // 4 (LB) and 5 (RB) intentionally unmapped — see note above
  8:  { key: 'Escape',     action: 'escape',   payload: {},                   repeats: false }, // View / Select / Minus — back
  9:  { key: 'Enter',      action: 'select',   payload: {},                   repeats: false }, // Menu / Start / Plus — select
  12: { key: 'ArrowUp',    action: 'navigate', payload: { direction: 'up' },    repeats: true },
  13: { key: 'ArrowDown',  action: 'navigate', payload: { direction: 'down' },  repeats: true },
  14: { key: 'ArrowLeft',  action: 'navigate', payload: { direction: 'left' },  repeats: true },
  15: { key: 'ArrowRight', action: 'navigate', payload: { direction: 'right' }, repeats: true },
};
```

**Step 2: Run the test to verify all assertions pass**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/GamepadAdapter.test.js
```

Expected: all tests pass (both the baseline describe block and the fixed-mapping describe block).

**Step 3: Run the rest of the framework tests as a regression check**

```bash
cd frontend && npx vitest run src/screen-framework/input
```

Expected: nothing else breaks (Keyboard, Numpad, Remote, InputManager, ActionBus, useScreenAction tests all still pass).

**Step 4: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.js
git commit -m "fix(gamepad): button 1 → Escape, unmap shoulder buttons L1/R1"
```

---

## Task 4: Delete the duplicate gamepad poller in `MenuItems` (Menu.jsx)

**Why this task:** The `MenuItems` component in `Menu.jsx` runs its own `requestAnimationFrame` loop polling `navigator.getGamepads()`. With the framework now dispatching synthetic `keydown` events for every gamepad action, this duplicate poller causes double-fire navigation (single d-pad press → two `navigateTo` calls → potential 2-cell jump because `navigateTo` updates `activeIndexRef.current` synchronously).

The keyboard handler in the same component (`Menu.jsx:855-913`) already responds to `Enter`, `Escape`, and `Arrow*`, which is exactly what `GamepadAdapter` synthesizes — so deleting the gamepad poller drops zero functionality.

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx:915-1026` (delete the entire gamepad-polling `useEffect`)

**Step 1: Delete the gamepad-polling useEffect**

Find the block beginning at `Menu.jsx:915` with the comment `// --- Gamepad API polling (physical game controllers) ---` and ending at `Menu.jsx:1026` with the closing `}, [columns, navigateTo, setSelectedIndex, findKeyForItem, logger]);`. Remove the entire `useEffect(() => { ... });` block, including the comment header.

The keyboard handler `useEffect` immediately above it (`Menu.jsx:854-913`) stays exactly as-is.

**Step 2: Verify nothing else in the file references the removed code**

```bash
grep -n "menu.gamepad" /Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Menu/Menu.jsx
```

Expected: no matches. (`menu.gamepad-select`, `menu.gamepad-back`, `menu.gamepad-polling.*` log events were defined only inside the deleted block.)

**Step 3: Run the menu-related unit tests**

```bash
cd frontend && npx vitest run src/modules/Menu
```

Expected: all menu-related tests pass (no regressions). If no test files exist for Menu, `vitest` will report 0 tests — that's fine, this step is a regression sweep, not a new requirement.

**Step 4: Run the dev server in a one-off and quickly smoke-test the menu with a keyboard**

(See "Verification" section at the bottom for the full Shield TV smoke test. For now just keyboard-test locally.)

```bash
# In /Users/kckern/Documents/GitHub/DaylightStation
lsof -i :3111  # confirm dev server already running per CLAUDE.md
```

If running, open the local dev URL (whatever port system.yml resolves to — should be 3111 on kckern-macbook). Navigate the TV menu with arrow keys, press Enter, press Escape. All should work as before.

If the dev server is not running, ask the user to start it (per CLAUDE.md: do NOT auto-start when in doubt — confirm first).

**Step 5: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "refactor(menu): delete duplicate gamepad poller — framework adapter is SSOT"
```

---

## Task 5: Delete the duplicate gamepad poller in `ArcadeSelector.jsx`

**Why this task:** Same rationale as Task 4 — `ArcadeSelector.jsx` has its own gamepad polling loop plus a `gamepadStateRef` ref pattern. With the framework dispatching synthetic `keydown` events, the ArcadeSelector's existing keyboard handler (lines 169-220) already covers all gamepad inputs.

**Files:**
- Modify: `frontend/src/modules/Menu/ArcadeSelector.jsx`
  - Delete `gamepadStateRef` ref declaration: lines 230-238
  - Delete the ref-sync `useEffect`: lines 241-246
  - Delete the gamepad-polling `useEffect`: lines 248-352

**Step 1: Delete the three blocks**

Open `ArcadeSelector.jsx` and remove:

1. **`gamepadStateRef`** (lines 230-238) — the entire `// --- Gamepad API polling ...` comment header through the closing `});` of the `useRef`.

2. **The ref-sync useEffect** (lines 241-246) — `// Keep ref in sync with latest values` through its closing `});`.

3. **The polling useEffect** (lines 248-352) — `useEffect(() => { if (!items.length) return; ...` through its closing `}, [items.length, logger]);`.

The keyboard handler `useEffect` above (lines 222-225) and below it stay as-is. The `selectCooldownRef` (line 167) stays — the keyboard handler still uses it.

**Step 2: Verify nothing else references the removed identifiers**

```bash
grep -n "gamepadStateRef\|arcade.gamepad\|gamepad-polling" /Users/kckern/Documents/GitHub/DaylightStation/frontend/src/modules/Menu/ArcadeSelector.jsx
```

Expected: no matches.

**Step 3: Run vitest to ensure nothing breaks**

```bash
cd frontend && npx vitest run src/modules/Menu src/screen-framework/input
```

Expected: all green.

**Step 4: Commit**

```bash
git add frontend/src/modules/Menu/ArcadeSelector.jsx
git commit -m "refactor(arcade): delete duplicate gamepad poller — framework adapter is SSOT"
```

---

## Task 6: Verify the synthetic keydown reaches both keyboard handlers

**Why this task:** With the local pollers gone, gamepad input now flows exclusively through `GamepadAdapter` → synthetic `KeyboardEvent` → window `keydown` listeners on `MenuItems` and `ArcadeSelector`. Both handlers register at the `window` level (via `useEffect` with `window.addEventListener('keydown', ...)`), so they should both pick up the synthetic events.

But: `enableGlobalKeyCapture()` (`fkb.js:137-155`) attaches at `{ capture: true }`. The framework's synthetic event has `bubbles: true, cancelable: true` — that does reach window in capture phase too. `enableGlobalKeyCapture` only logs; it doesn't `preventDefault`. So no interference.

This task is a non-code verification step — write a test that proves the chain.

**Files:**
- Create: `frontend/src/screen-framework/input/adapters/GamepadAdapter.integration.test.js`

**Step 1: Write the integration test**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionBus } from '../ActionBus.js';
import { GamepadAdapter } from './GamepadAdapter.js';

function makeFakeGamepad() {
  return {
    index: 0,
    id: 'Test Gamepad',
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

describe('GamepadAdapter integration — synthetic events reach keyboard handlers', () => {
  let bus, adapter, fakeGp, rafCallbacks;

  beforeEach(() => {
    bus = new ActionBus();
    fakeGp = makeFakeGamepad();
    vi.stubGlobal('navigator', { getGamepads: () => [fakeGp] });
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { rafCallbacks.push(cb); return rafCallbacks.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    adapter = new GamepadAdapter(bus);
    adapter.attach();
  });

  afterEach(() => {
    adapter.destroy();
    vi.unstubAllGlobals();
  });

  const tick = () => { const cb = rafCallbacks.shift(); if (cb) cb(); };
  const press = (i) => { fakeGp.buttons[i].pressed = true; tick(); };

  it('a window keydown listener sees the right key for each gamepad button', () => {
    const seenKeys = [];
    const listener = (e) => seenKeys.push(e.key);
    window.addEventListener('keydown', listener);

    press(0);  // south → Enter
    press(1);  // east → Escape
    press(8);  // View → Escape
    press(9);  // Menu → Enter
    press(12); // d-pad up → ArrowUp
    press(13); // d-pad down → ArrowDown
    press(14); // d-pad left → ArrowLeft
    press(15); // d-pad right → ArrowRight

    window.removeEventListener('keydown', listener);

    expect(seenKeys).toEqual([
      'Enter', 'Escape', 'Escape', 'Enter',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);
  });

  it('shoulder buttons (4, 5) do NOT dispatch a keydown', () => {
    const listener = vi.fn();
    window.addEventListener('keydown', listener);
    press(4);
    press(5);
    window.removeEventListener('keydown', listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the integration test**

```bash
cd frontend && npx vitest run src/screen-framework/input/adapters/GamepadAdapter.integration.test.js
```

Expected: 2 passing.

**Step 3: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.integration.test.js
git commit -m "test(gamepad): integration test — synthetic events reach window listeners"
```

---

## Task 7: Update the FKB resume → arcade-selector loop sanity check

**Why this task:** Independently of the button map, verify the launch → exit RetroArch → return-to-arcade flow still works. This is *not* a code change — it's a doc + verification task. The flow already works (LaunchCard auto-dismisses 1.5s after launch and FKB's foreground monitor brings it back when RetroArch quits), but we want a written checklist for the smoke test in Task 8.

**Files:**
- Modify: `docs/runbooks/` — add `gamepad-smoke-test.md`

**Step 1: Write the runbook**

Create `docs/runbooks/gamepad-smoke-test.md` with this content:

```markdown
# Gamepad Smoke Test (Living Room Shield TV)

Tests that a Bluetooth gamepad on the Shield navigates the TV menu and arcade
selector flawlessly: select=south face, back=east face / View, navigate=d-pad
or left stick, no double-fire, RetroArch launch + return works.

## Prerequisites
- 8Bitdo SN30 Pro (or any standard-mapped gamepad) paired with Shield via Bluetooth
- FKB running on the Shield, displaying the living-room screen
- ADB connected: `adb connect 10.0.0.11`
- Backend logs tailing: `ssh homeserver.local 'docker logs -f daylight-station' | grep -E 'gamepad|fkb.keyCapture|menu\.|arcade\.'`

## Activation step (Chromium gates the Gamepad API)
Press any button on the controller while the FKB page has focus. Within
backend logs, expect:
- `gamepad.connected { id: '8Bitdo SN30 Pro', mapping: 'standard' }`
- A `fkb.keyCapture { synthetic: true, key: 'Enter' }` if you pressed a face button

## Test matrix
| Action | Button | Expected log events | Expected UI |
|---|---|---|---|
| Navigate up | D-pad ↑ | one `gamepad.emit` `ArrowUp`, one `fkb.keyCapture` synthetic `ArrowUp`, one `menu.scroll.decision` (if scrolling) | exactly one cell up — no double-jump |
| Navigate left/right/down | D-pad | analogous | one cell |
| Select | A button (south face, button 0) | `gamepad.emit Enter` → `menu.select` or `arcade.select` | game launches via LaunchCard |
| Back | B button (east face, button 1) | `gamepad.emit Escape` → `menu.back` or `arcade.back` | one menu level pops |
| Back (alt) | View / Select / Minus button (button 8) | same as above | same |
| Shoulder | LB or RB | NO log events | NO UI change |
| Stick navigate | left stick | initial press + repeat after ~400ms | sustained nav |

## Negative tests
- Press B in arcade selector — should pop back to root, NOT also fire select.
- Mash A — selectCooldown (300ms) should debounce; only one launch fires.
- Press LB/RB while a game is highlighted — nothing should happen.

## RetroArch round-trip
1. Select a game with A. Expect `LaunchCard` modal, 3s countdown, then RetroArch launches.
2. Wait 1.5s — `LaunchCard` should auto-dismiss (state below the modal returns
   to arcade selector, but obscured by RetroArch's foreground).
3. Quit RetroArch (Hotkey + Start, or whatever the exit binding is).
4. FKB should be back in foreground showing the arcade selector — same item highlighted.

## Diagnostic mode
Bump log level to debug to see polling activity:
```js
fully.injectJavascript("window.DAYLIGHT_LOG_LEVEL='debug';location.reload();")
```
Or via FKB REST API:
```bash
FULLY_PW="<rotated-fkb-password-urlencoded>"
curl -s "http://10.0.0.11:2323/?cmd=injectJavascript&code=window.DAYLIGHT_LOG_LEVEL%3D%27debug%27%3Blocation.reload()%3B&password=${FULLY_PW}"
```
```

**Step 2: Commit the runbook**

```bash
git add docs/runbooks/gamepad-smoke-test.md
git commit -m "docs: add gamepad smoke test runbook for Living Room TV"
```

---

## Task 8: Manual verification on the Shield TV

**Why this task:** The CLAUDE.md says "For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete." This is the ground-truth verification.

**Files:** None — manual test only.

**Step 1: Deploy the change to the Shield**

The Shield runs the prod build of `daylight-station`. Manual deploy is via `deploy.sh` (per CLAUDE.md, do NOT run automatically — ask the user to run it).

Tell the user:
> "All code changes are committed. Please run `./deploy.sh` to push to the Shield, then trigger an FKB reload (`fully.loadStartURL` via REST API or just power-cycle FKB) so the WebView picks up the new bundle."

**Step 2: Run the smoke test from `docs/runbooks/gamepad-smoke-test.md`**

Walk through every row in the test matrix. Watch the backend logs in real time. If any row produces unexpected events (e.g., a single button press generates two `gamepad.emit` events, or B fires both `select` AND `escape`), STOP and investigate — the change is not actually shipping the new behavior.

**Step 3: Verify the RetroArch round-trip**

Per the runbook section. The success criterion is: after exiting RetroArch, the user lands back on the same arcade selector with the same game highlighted, and the controller still navigates without re-pairing.

**Step 4: If everything passes, mark the plan complete**

If anything fails, file a bug under `docs/_wip/bugs/YYYY-MM-DD-<bug>.md` and iterate.

---

## Verification Summary

After completing all tasks:

```bash
cd frontend && npx vitest run src/screen-framework/input src/modules/Menu
```

Expected: all green, no skipped tests.

```bash
git log --oneline main..HEAD
```

Expected: 6 commits (Tasks 1-6 each commit code; Task 7 commits the runbook; Task 8 is manual). The history reads:
1. test(gamepad): add baseline test for current button map
2. test(gamepad): add failing tests for fixed button map
3. fix(gamepad): button 1 → Escape, unmap shoulder buttons L1/R1
4. refactor(menu): delete duplicate gamepad poller — framework adapter is SSOT
5. refactor(arcade): delete duplicate gamepad poller — framework adapter is SSOT
6. test(gamepad): integration test — synthetic events reach window listeners
7. docs: add gamepad smoke test runbook for Living Room TV

## Rollback

If the change ships and behaves badly on the Shield:

```bash
git revert <commit-hash-of-button-map-change>
./deploy.sh
```

Reverting just the BUTTON_MAP change (Task 3) restores button 1 → select while keeping the duplicate-poller deletion. If you need to fully restore the old dual-pipeline behavior, revert the refactor commits too — but at that point the original double-fire bug is back.
