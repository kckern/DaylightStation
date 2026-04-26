# Gamepad Input Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gamepad input on the TV menu fire exactly once per physical press, by (Phase 1) deduping/filtering `navigator.getGamepads()` results, then (Phase 2) consolidating all gamepad polling into a single source — `GamepadAdapter` — and removing redundant per-component polling loops in `Menu.jsx` and `ArcadeSelector.jsx`.

**Architecture:**
- Phase 1 introduces a tiny shared utility (`gamepadFiltering.js`) used at every existing polling site. Filters out non-gamepad HID devices (e.g. wireless mouse receivers misclassified as gamepads on Android) and dedupes by `id` (a single physical 8Bitdo SN30 Pro currently enumerates twice on Shield TV).
- Phase 2 deletes the per-component poll loops in `Menu.jsx` and `ArcadeSelector.jsx`. `GamepadAdapter` becomes the single owner of `navigator.getGamepads()`. Components react to synthetic `keydown` events (Enter/Arrow/Escape) the adapter already dispatches.
- Phase 2 also empirically remaps `BUTTON_MAP` in `GamepadAdapter` so B (button index 1) emits Escape (back) instead of Enter (select), preserving today's Menu/Arcade back-button behaviour.

**Tech Stack:**
- React 18, jest 29 with `@jest/globals`, ESM (`.mjs`).
- `frontend/src/screen-framework/input/` is the existing input abstraction (`InputManager`, `KeyboardAdapter`, `NumpadAdapter`, `RemoteAdapter`, `GamepadAdapter`, `ActionBus`).
- Diagnostic logging via `frontend/src/lib/logging/Logger.js` (already used everywhere).
- Manual verification via `sudo docker logs daylight-station --since 60s` filtered by `gamepad|menu\.gamepad|arcade\.gamepad`.

---

## File Structure

| Path | Role | Phase |
|------|------|-------|
| `frontend/src/screen-framework/input/gamepadFiltering.js` | NEW. Pure utility: `isPlausibleGamepad(gp)` + `getActiveGamepads()`. Single place that knows about mouse-receiver filtering and per-id dedupe. | 1 |
| `tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs` | NEW. Unit tests for the utility. | 1 |
| `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` | MODIFY. Replace `_findGamepad` raw enumeration with `getActiveGamepads()`. Phase 2 also remaps button 1 to Escape and adds a temporary `gamepad.button-pressed` info log for empirical button discovery. | 1 + 2 |
| `frontend/src/modules/Menu/Menu.jsx` | MODIFY (Phase 1) → DELETE polling effect (Phase 2). Phase 1 wraps gamepad enumeration with `getActiveGamepads()`. Phase 2 deletes the entire `useEffect` that polls gamepads (lines ~915-1026 in current file) and removes the now-unused refs. | 1 + 2 |
| `frontend/src/modules/Menu/ArcadeSelector.jsx` | MODIFY (Phase 1) → DELETE polling effect (Phase 2). Phase 1 swaps enumeration. Phase 2 deletes the polling `useEffect` plus its `gamepadStateRef` sync. | 1 + 2 |

---

## Phase 1 — Filter + Dedupe

### Task 1: Create the filtering utility with tests

**Files:**
- Create: `frontend/src/screen-framework/input/gamepadFiltering.js`
- Test: `tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs`:

```js
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { isPlausibleGamepad, getActiveGamepads } from '../../../../../frontend/src/screen-framework/input/gamepadFiltering.js';

const fakePad = (overrides = {}) => ({
  id: '8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)',
  buttons: new Array(17).fill(null).map(() => ({ pressed: false })),
  axes: [0, 0, 0, 0],
  ...overrides,
});

describe('isPlausibleGamepad', () => {
  test('rejects null/undefined', () => {
    expect(isPlausibleGamepad(null)).toBe(false);
    expect(isPlausibleGamepad(undefined)).toBe(false);
  });

  test('accepts an 8Bitdo SN30 Pro shape', () => {
    expect(isPlausibleGamepad(fakePad())).toBe(true);
  });

  test('rejects a wireless mouse receiver misclassified as gamepad', () => {
    expect(isPlausibleGamepad(fakePad({
      id: 'wireless wireless 2.4G Mouse (Vendor: 093a Product: 2510)',
      buttons: new Array(16).fill(null).map(() => ({ pressed: false })),
    }))).toBe(false);
  });

  test('rejects a keyboard misclassified as gamepad', () => {
    expect(isPlausibleGamepad(fakePad({ id: 'Logitech USB Keyboard' }))).toBe(false);
  });

  test('rejects devices with too few buttons or axes', () => {
    expect(isPlausibleGamepad(fakePad({
      buttons: new Array(3).fill(null).map(() => ({ pressed: false })),
    }))).toBe(false);
    expect(isPlausibleGamepad(fakePad({ axes: [0] }))).toBe(false);
  });
});

describe('getActiveGamepads', () => {
  let originalGetGamepads;

  beforeEach(() => {
    originalGetGamepads = global.navigator?.getGamepads;
    if (!global.navigator) global.navigator = {};
  });

  afterEach(() => {
    if (originalGetGamepads) global.navigator.getGamepads = originalGetGamepads;
    else delete global.navigator.getGamepads;
  });

  test('returns empty array when no navigator.getGamepads', () => {
    delete global.navigator.getGamepads;
    expect(getActiveGamepads()).toEqual([]);
  });

  test('filters out null slots', () => {
    global.navigator.getGamepads = () => [null, fakePad(), null];
    expect(getActiveGamepads()).toHaveLength(1);
  });

  test('filters out non-gamepad devices', () => {
    global.navigator.getGamepads = () => [
      fakePad({ id: 'wireless 2.4G Mouse' }),
      fakePad(),
    ];
    const result = getActiveGamepads();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)');
  });

  test('dedupes the same physical controller enumerated twice', () => {
    global.navigator.getGamepads = () => [
      fakePad(),
      fakePad(), // same id — duplicate slot
      fakePad({ id: 'Some Other Controller' }),
    ];
    const result = getActiveGamepads();
    expect(result).toHaveLength(2);
    const ids = result.map(g => g.id);
    expect(ids).toContain('8Bitdo SN30 Pro (Vendor: 2dc8 Product: 6101)');
    expect(ids).toContain('Some Other Controller');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs`
Expected: FAIL — module not found (`Cannot find module '.../gamepadFiltering.js'`).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/screen-framework/input/gamepadFiltering.js`:

```js
// frontend/src/screen-framework/input/gamepadFiltering.js
//
// Shared filter + dedupe for navigator.getGamepads() consumers.
//
// Why this exists:
// 1. Some HID receivers (mice, keyboards, touchpads) get classified as
//    gamepads by Chromium on Android/Shield TV and pollute getGamepads()
//    with phantom devices that have no real face buttons. Polling them
//    is wasted work and risks accidental input if a button index lights
//    up from scroll-wheel / pointer events.
// 2. A single physical controller can enumerate twice (e.g. an 8Bitdo
//    SN30 Pro on Shield TV appears at index 1 AND index 2 simultaneously).
//    Naively iterating navigator.getGamepads() then makes one physical
//    button press fire its handler twice.

const NON_GAMEPAD_PATTERNS = /mouse|keyboard|touchpad|trackball|presenter/i;

export function isPlausibleGamepad(gp) {
  if (!gp) return false;
  if (NON_GAMEPAD_PATTERNS.test(gp.id)) return false;
  // Real gamepads have at least a 4-button face cluster + a stick or d-pad axis pair
  if (gp.buttons.length < 4 || gp.axes.length < 2) return false;
  return true;
}

/**
 * Returns one entry per physical gamepad: filters out misclassified HID
 * devices and dedupes slots that share an `id`.
 *
 * Dedupe rationale: when the same `id` shows up at two indices the
 * overwhelming likelihood is one physical device enumerated twice (kernel
 * quirk, XInput shim, or duplicate HID interface). The rare case of two
 * literal identical controllers gets last-write-wins, which is acceptable
 * for a household TV remote.
 */
export function getActiveGamepads() {
  const raw = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? navigator.getGamepads()
    : [];
  const seen = new Set();
  const out = [];
  for (const gp of raw) {
    if (!isPlausibleGamepad(gp)) continue;
    if (seen.has(gp.id)) continue;
    seen.add(gp.id);
    out.push(gp);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screen-framework/input/gamepadFiltering.js \
        tests/isolated/frontend/screen-framework/input/gamepadFiltering.test.mjs
git commit -m "feat(input): add gamepad filter + dedupe utility

Filters out non-gamepad HID devices (mouse receivers misclassified by
Chromium) and dedupes a single physical controller enumerated twice."
```

---

### Task 2: Use the utility inside `GamepadAdapter._findGamepad`

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js:90-99`

- [ ] **Step 1: Add the import**

At the top of `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` (after the existing logger import on line 2), add:

```js
import { getActiveGamepads } from '../gamepadFiltering.js';
```

- [ ] **Step 2: Replace `_findGamepad` to use filtered/deduped list**

Find this block (currently at lines 90-99):

```js
  _findGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.preferredIndex !== null && gamepads[this.preferredIndex]) {
      return gamepads[this.preferredIndex];
    }
    for (const gp of gamepads) {
      if (gp) return gp;
    }
    return null;
  }
```

Replace with:

```js
  _findGamepad() {
    const gamepads = getActiveGamepads();
    if (this.preferredIndex !== null) {
      // preferredIndex refers to the raw navigator slot; honour it only if
      // the slot corresponds to a real gamepad after filtering.
      const all = navigator.getGamepads ? navigator.getGamepads() : [];
      const preferred = all[this.preferredIndex];
      if (preferred && gamepads.find(g => g.id === preferred.id)) return preferred;
    }
    return gamepads[0] || null;
  }
```

- [ ] **Step 3: Manual verification**

The change is internal — no automated test (the existing GamepadAdapter has no test harness for live polling). Sanity-check by searching for other `navigator.getGamepads()` usages in the adapter:

Run: `grep -n "navigator.getGamepads" frontend/src/screen-framework/input/adapters/GamepadAdapter.js`
Expected: only the line inside the `if (this.preferredIndex !== null)` branch, plus none elsewhere — confirming we replaced the primary polling path.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.js
git commit -m "fix(GamepadAdapter): filter + dedupe gamepads via shared utility

Skips mouse-receiver pseudo-gamepads (e.g. 'wireless 2.4G Mouse' on
Shield TV) and prevents picking the wrong device when the real gamepad
is at index 1+ but a phantom occupies index 0."
```

---

### Task 3: Use the utility inside `Menu.jsx` polling loop

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx` (the gamepad polling effect, currently around line 915 — search for `// --- Gamepad API polling`)

- [ ] **Step 1: Add the import**

At the top of `frontend/src/modules/Menu/Menu.jsx`, find the existing imports and add:

```js
import { getActiveGamepads } from '../../screen-framework/input/gamepadFiltering.js';
```

- [ ] **Step 2: Replace the `navigator.getGamepads()` call inside the poll loop**

Inside the `function poll()` body (currently around line 943), find:

```js
    function poll() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of gamepads) {
        if (!gp) continue;
```

Replace with:

```js
    function poll() {
      const gamepads = getActiveGamepads();
      for (const gp of gamepads) {
```

(Drop the `if (!gp) continue;` line — `getActiveGamepads` already filters nulls.)

- [ ] **Step 3: Smoke-test build**

Run: `cd /opt/Code/DaylightStation && npx vite build --logLevel warn 2>&1 | tail -20`
Expected: build completes with no errors. Warnings (chunk size, deprecated APIs) are acceptable.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "fix(Menu): dedupe + filter gamepads in poll loop

Prevents a single 8Bitdo SN30 Pro from firing twice when the kernel
enumerates it on two indices, and skips wireless-mouse pseudo-gamepads."
```

---

### Task 4: Use the utility inside `ArcadeSelector.jsx` polling loop

**Files:**
- Modify: `frontend/src/modules/Menu/ArcadeSelector.jsx` (gamepad polling effect at line 248)

- [ ] **Step 1: Add the import**

At the top of `frontend/src/modules/Menu/ArcadeSelector.jsx`, add:

```js
import { getActiveGamepads } from '../../screen-framework/input/gamepadFiltering.js';
```

- [ ] **Step 2: Replace `navigator.getGamepads()` inside `poll()`**

Inside `function poll()` (around line 268-273 in current file), find:

```js
    function poll() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const s = gamepadStateRef.current;

      for (const gp of gamepads) {
        if (!gp) continue;
```

Replace with:

```js
    function poll() {
      const gamepads = getActiveGamepads();
      const s = gamepadStateRef.current;

      for (const gp of gamepads) {
```

- [ ] **Step 3: Add seed-from-current-state to ArcadeSelector poll**

Still inside `poll()`, immediately after the `const id = gp.index;` line and BEFORE the existing `if (!prevButtons[id]) prevButtons[id] = ...` lines, add a seed-on-first-observation block. Find:

```js
        const id = gp.index;
        if (!prevButtons[id]) prevButtons[id] = new Array(gp.buttons.length).fill(false);
        if (!prevAxes[id]) prevAxes[id] = new Array(gp.axes.length).fill(0);
```

Replace with:

```js
        const id = gp.index;
        // Seed from live state on first observation: a button held when this
        // component mounts (e.g. user is still holding A from the previous
        // menu's confirm) must NOT register as a fresh press.
        if (!prevButtons[id]) {
          prevButtons[id] = gp.buttons.map(b => !!b?.pressed);
          prevAxes[id] = Array.from(gp.axes);
          continue; // skip edge detection this frame; state recorded.
        }
```

- [ ] **Step 4: Smoke-test build**

Run: `cd /opt/Code/DaylightStation && npx vite build --logLevel warn 2>&1 | tail -20`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Menu/ArcadeSelector.jsx
git commit -m "fix(ArcadeSelector): dedupe gamepads + seed prevButtons on first poll

Two fixes:
- Same dedupe/filter as Menu.jsx so an 8Bitdo enumerated twice no
  longer fires arcade.gamepad-select twice for one press.
- Initial poll for any gamepad now seeds prevButtons from the live
  pressed state instead of treating all buttons as 'just released'.
  This stops a held A press from auto-selecting whatever sits at
  index 0 the moment the arcade selector mounts (Bomberman 64 in
  the regression report)."
```

---

### Task 5: Deploy and verify Phase 1 on Shield TV

**Files:** none modified — verification only.

- [ ] **Step 1: Build and deploy to the production container**

Run from `/opt/Code/DaylightStation`:

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
```

Expected: image builds (~2-5 min). Look for `Successfully tagged kckern/daylight-station:latest`.

```bash
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

Expected: container restarts, new image runs.

- [ ] **Step 2: Confirm the new build is live**

Run: `sudo docker exec daylight-station cat /build.txt`
Expected: BUILD_TIME within the last 5 minutes; COMMIT_HASH matches `git rev-parse --short HEAD`.

- [ ] **Step 3: Reload the Shield TV browser to pick up new JS**

```bash
sudo docker exec daylight-station node -e "
const yaml=require('js-yaml');const fs=require('fs');
const auth=yaml.load(fs.readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs=new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.11:2323/?'+qs).then(r=>r.text()).then(console.log);
"
```

Expected: JSON response with `"status":"OK"` (or similar). The TV reloads.

- [ ] **Step 4: Manual press test + log capture**

Ask the user to navigate to the Games menu and press A on the 8Bitdo SN30 Pro **once**. Then run:

```bash
sudo docker logs daylight-station --since 60s 2>&1 \
  | grep -E 'menu\.gamepad-select|arcade\.gamepad-select|nav\.push'
```

Expected — for one A press:
- Exactly **one** `menu.gamepad-select` event for "Games" (was: 2 before fix)
- Exactly **one** `nav.push` for the games menu (was: 2 before fix)
- **Zero** `arcade.gamepad-select` events firing automatically on mount (was: 1 spurious select before fix)

If any of those expectations fail, do not proceed to Phase 2 — diagnose the discrepancy first.

- [ ] **Step 5: Commit a verification note**

If verification passed, capture the result in the existing memory system rather than a new doc. Update `MEMORY.md` only if a non-obvious fact emerged (e.g. "8Bitdo SN30 Pro on Shield TV reliably enumerates twice"). Otherwise no commit needed — the previous commits are the ship-ready unit.

---

## Phase 2 — Single source of truth for gamepad input

Phase 2 makes `GamepadAdapter` the only thing that calls `navigator.getGamepads()`. Components delete their own poll loops and react to the synthetic `keydown` events the adapter already dispatches. Before deleting anything, we confirm the empirical SN30 Pro button mapping (because the browser reports `mapping: ""`, not `"standard"`, so W3C indices may not apply).

### Task 6: Add empirical button-press logging to `GamepadAdapter`

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` (the `_emit` method around line 179, plus the unmapped-button block around line 156)

The goal: every button transition (mapped or unmapped) emits an `info`-level log so we can see in `docker logs` exactly which raw index the user pressed.

- [ ] **Step 1: Promote the unmapped-button log to info and include button label**

Find (line ~156):

```js
      if (pressed && !wasPressed) {
        logger().warn('gamepad.unmapped-button', { buttonIndex: idx, gamepadId: gp.id });
      }
```

Replace with:

```js
      if (pressed && !wasPressed) {
        logger().info('gamepad.button-pressed', {
          buttonIndex: idx, mapped: false, gamepadId: gp.id,
        });
      }
```

- [ ] **Step 2: Add a mapped-button info log inside `_emit`**

Find the `_emit` method (line ~179):

```js
  _emit(mapping, buttonIndex) {
    logger().debug('gamepad.emit', { key: mapping.key, action: mapping.action, buttonIndex: buttonIndex ?? null });
```

Replace the debug call with:

```js
  _emit(mapping, buttonIndex) {
    if (buttonIndex != null) {
      logger().info('gamepad.button-pressed', {
        buttonIndex, mapped: true, key: mapping.key, action: mapping.action,
      });
    }
```

(Keep the rest of `_emit` unchanged — `actionBus.emit` and synthetic `KeyboardEvent` dispatch.)

- [ ] **Step 3: Smoke build**

Run: `cd /opt/Code/DaylightStation && npx vite build --logLevel warn 2>&1 | tail -5`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.js
git commit -m "chore(GamepadAdapter): info-level button-press log for empirical mapping

Temporary diagnostic so we can see in docker logs exactly which raw
button index a physical 8Bitdo button corresponds to."
```

---

### Task 7: Discover the SN30 Pro mapping empirically

**Files:** none modified — empirical procedure.

- [ ] **Step 1: Deploy the diagnostic build**

Repeat Task 5 Steps 1–3 (docker build, deploy, FKB reload) with the latest commit.

- [ ] **Step 2: Run the press protocol and record the indices**

Ask the user to navigate to the TV root menu, then press these buttons in sequence on the 8Bitdo SN30 Pro, with a 2-second pause between each:

1. **A** (right face button — Nintendo orientation: bottom-right)
2. **B** (bottom face button — Nintendo orientation: bottom-left)
3. **X** (top face button)
4. **Y** (left face button)
5. **L1** (left shoulder)
6. **R1** (right shoulder)
7. **Select** (small button left of Home)
8. **Start** (small button right of Home)
9. **D-pad Up**
10. **D-pad Down**

Then collect the log:

```bash
sudo docker logs daylight-station --since 90s 2>&1 \
  | grep gamepad.button-pressed
```

Record the `buttonIndex` for each physical button in a temporary table (write it directly into the next task as the source for `BUTTON_MAP`).

Expected pattern: 4 face buttons populate indices 0-3 in some permutation; shoulders 4-5; select/start 8-9 (or 16/17); d-pad either dedicated button indices 12-15 OR axes-only on `axes[2]/axes[3]`.

- [ ] **Step 3: Note any surprises in MEMORY.md**

If the SN30 Pro reports d-pad as axes only (no buttons 12-15), or if face buttons are not in 0-3 order, note it. This affects Task 8.

---

### Task 8: Update `BUTTON_MAP` to match SN30 Pro reality + add Escape on B

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js:10-23`

- [ ] **Step 1: Replace `BUTTON_MAP`**

Find the existing `BUTTON_MAP` (lines 10-23). Replace using the indices recorded in Task 7. The default below assumes Standard mapping (most common case); ADJUST the comments and indices to match Task 7's findings.

```js
const BUTTON_MAP = {
  // Face cluster — A confirms, B cancels (Nintendo-style 8Bitdo layout).
  // Verified empirically on SN30 Pro / Shield TV (see Task 7 log capture).
  0:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // A (confirm)
  1:  { key: 'Escape', action: 'escape', payload: {},                       repeats: false }, // B (back)
  2:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // X — also confirm (UX: any face button works)
  3:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // Y — also confirm
  4:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // L1
  5:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // R1
  8:  { key: 'Escape', action: 'escape', payload: {},                       repeats: false }, // Select
  9:  { key: 'Enter',  action: 'select', payload: {},                       repeats: false }, // Start
  12: { key: 'ArrowUp',    action: 'navigate', payload: { direction: 'up' },    repeats: true },
  13: { key: 'ArrowDown',  action: 'navigate', payload: { direction: 'down' },  repeats: true },
  14: { key: 'ArrowLeft',  action: 'navigate', payload: { direction: 'left' },  repeats: true },
  15: { key: 'ArrowRight', action: 'navigate', payload: { direction: 'right' }, repeats: true },
};
```

(If Task 7 showed the SN30 Pro at non-standard indices, swap them here. The KEY decision: button-1 must emit `Escape` so back-navigation works after we delete the per-component poll loops.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.js
git commit -m "feat(GamepadAdapter): map B button to Escape, lock in SN30 Pro layout

Preserves today's Menu/Arcade back-button behaviour after Phase 2
deletes the per-component gamepad polling. Indices verified
empirically — see Task 7 of the gamepad-input-reliability plan."
```

---

### Task 9: Delete the gamepad poll loop in `ArcadeSelector.jsx`

**Files:**
- Modify: `frontend/src/modules/Menu/ArcadeSelector.jsx` (delete lines ~227-352 — the entire `useEffect` for gamepad polling AND the `gamepadStateRef` block above it)

- [ ] **Step 1: Verify ArcadeSelector's `handleKeyDown` already covers all button actions**

Read `frontend/src/modules/Menu/ArcadeSelector.jsx` lines ~169-220. Confirm:
- `Arrow*` keys → spatial nav (`findNearest`) ✓
- `Escape`/`GoBack`/`BrowserBack` → close ✓
- Any other non-modifier key → select ✓

The synthetic events from `GamepadAdapter` will be `Enter`, `Escape`, `ArrowUp/Down/Left/Right` — all already handled.

- [ ] **Step 2: Delete the polling block**

In `frontend/src/modules/Menu/ArcadeSelector.jsx`, delete:

- The `gamepadStateRef = useRef({...})` declaration (currently around line 230-238).
- The keep-in-sync `useEffect` immediately after it (lines ~241-246).
- The gamepad-polling `useEffect` (lines ~248-352).
- The `getActiveGamepads` import added in Phase 1 Task 4 (now unused).

Also delete the `selectCooldownRef` declaration if it's only referenced inside the deleted polling block — but DO leave it if `handleKeyDown` still uses it (it does; see line 207). So keep `selectCooldownRef`.

- [ ] **Step 3: Smoke build**

Run: `cd /opt/Code/DaylightStation && npx vite build --logLevel warn 2>&1 | tail -10`
Expected: build succeeds. Watch for any "is declared but its value is never read" warnings — those indicate leftover refs to delete.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Menu/ArcadeSelector.jsx
git commit -m "refactor(ArcadeSelector): drop own gamepad polling, rely on GamepadAdapter

GamepadAdapter dispatches synthetic Enter/Arrow/Escape keydowns that
ArcadeSelector's handleKeyDown already handles. Removing the per-
component poll eliminates the auto-select-on-mount race entirely."
```

---

### Task 10: Delete the gamepad poll loop in `Menu.jsx`

**Files:**
- Modify: `frontend/src/modules/Menu/Menu.jsx` (delete the entire `useEffect` around lines 915-1026 plus the unused refs added in earlier conversation work)

- [ ] **Step 1: Verify Menu's `handleKeyDown` covers gamepad-via-synthetic**

Read `frontend/src/modules/Menu/Menu.jsx` around lines 850-913. Confirm:
- Arrow handling for grid nav ✓
- `Escape`/`GoBack`/`BrowserBack` for close ✓
- `Enter`/`Space`/`GamepadA`/etc → select with cooldown ✓ (line 895-908)

- [ ] **Step 2: Delete the polling effect and now-unused refs**

In `frontend/src/modules/Menu/Menu.jsx`, delete:

- The entire `// --- Gamepad API polling` `useEffect` block (currently around line 915 through ~line 1026).
- The refs added during the in-conversation Phase 1.5 work that exist solely for the polling effect:
  - `setSelectedIndexRef`
  - `findKeyForItemRef`
  - `navigateToRef` (the `useRef` declaration AND the assignment after `navigateTo` is defined)
  - `columnsRef`
- The `getActiveGamepads` import added in Phase 1 Task 3 (now unused).

KEEP: `activeIndexRef`, `itemsRef`, `onSelectRef`, `handleCloseRef` — these are still used by `handleKeyDown`.

- [ ] **Step 3: Smoke build**

Run: `cd /opt/Code/DaylightStation && npx vite build --logLevel warn 2>&1 | tail -10`
Expected: build succeeds with no "unused variable" warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Menu/Menu.jsx
git commit -m "refactor(Menu): drop own gamepad polling, rely on GamepadAdapter

Removes the rAF poll loop, its supporting refs, and the dependency on
the filtering utility. handleKeyDown already responds to the synthetic
Enter/Arrow/Escape events GamepadAdapter dispatches — no behavioural
change beyond eliminating duplicate fires."
```

---

### Task 11: Demote the empirical button log + verify Phase 2 on Shield TV

**Files:**
- Modify: `frontend/src/screen-framework/input/adapters/GamepadAdapter.js` (revert Task 6's info-level promotion to debug)

- [ ] **Step 1: Demote `gamepad.button-pressed` back to debug**

In `frontend/src/screen-framework/input/adapters/GamepadAdapter.js`, find the two `logger().info('gamepad.button-pressed', ...)` calls added in Task 6 and change `info` → `debug` on both:

```js
        logger().debug('gamepad.button-pressed', {
          buttonIndex: idx, mapped: false, gamepadId: gp.id,
        });
```

```js
      logger().debug('gamepad.button-pressed', {
        buttonIndex, mapped: true, key: mapping.key, action: mapping.action,
      });
```

Diagnostic kept at debug level so it's available when needed but doesn't pollute prod logs.

- [ ] **Step 2: Build, deploy, reload FKB**

Repeat Task 5 Steps 1–3.

- [ ] **Step 3: Manual end-to-end gamepad sweep**

Ask the user to:
1. From the TV root menu, press **A** → Games menu opens.
2. In Games (arcade selector), press **D-pad Right** twice → selection moves twice, no autoplay.
3. Press **A** → game launches.
4. Press **B** → returns to Games menu.
5. Press **B** → returns to root menu.

Capture logs:

```bash
sudo docker logs daylight-station --since 120s 2>&1 \
  | grep -E 'menu\.select|menu\.gamepad-back|arcade\.|launch\.intent|nav\.(push|pop)'
```

Expected for the 5-step sequence above:
- 1× `nav.push` (Games menu)
- 1× `arcade-selector mounted` followed by **0** auto-fires
- 2× spatial `arcade.select` (or whatever the keydown path logs) — actually arrow nav does not log `select`; just verify the highlighted tile changed via the `random-init` followed by selection-change events.
- 1× `launch.intent` for the chosen game
- 2× `nav.pop` for the two B presses

Critically: each press should produce exactly **one** action — no doubles, no auto-selects.

- [ ] **Step 4: Commit the demotion**

```bash
git add frontend/src/screen-framework/input/adapters/GamepadAdapter.js
git commit -m "chore(GamepadAdapter): demote button-pressed log to debug

Empirical mapping captured; diagnostic kept available at debug level
for future controller additions but no longer in prod logs."
```

- [ ] **Step 5: Update memory if anything surprising emerged**

If Task 7 revealed a non-standard mapping for the SN30 Pro, OR if the Shield TV consistently double-enumerates other controllers (PS4, Joy-Con), capture that as a `reference` memory under `~/.claude/projects/-opt-Code-DaylightStation/memory/`. Otherwise skip.

---

## Self-Review

**Spec coverage**:
- (1) Filter + dedupe at every polling site → Tasks 1-4 (utility + 3 consumers).
- (2) Consolidate to single source → Tasks 9-10 (delete component polls), with Task 8 ensuring back-button behaviour survives the consolidation.
- Verification → Task 5 (Phase 1) and Task 11 (Phase 2). Both include explicit success/failure criteria observable in `docker logs`.

**Placeholder scan**: No "TBD" / "TODO". Every code block is concrete. Task 7 has an empirical step where the executor records actual indices; Task 8 has a default-but-adjust pattern that explicitly says ADJUST. Acceptable because Task 7 procedure is fully specified and Task 8 says exactly which line to swap.

**Type consistency**: `getActiveGamepads()` and `isPlausibleGamepad(gp)` named consistently across utility (Task 1), GamepadAdapter (Task 2), Menu.jsx (Task 3), ArcadeSelector.jsx (Task 4). Imports always relative paths matching the file's location. `BUTTON_MAP` keyed on integers in Task 8 matches the lookup in `_pollGamepad` (already present in the existing file). `gamepad.button-pressed` event name used identically in Task 6 promote and Task 11 demote.

**Risk note for executor**: Tasks 5 and 7 require physical access to the Shield TV (button presses) and a willing user. Tasks 1-4 and 6, 8-10 are pure code and can ship one after another autonomously. Pause for user-in-the-loop at Tasks 5, 7, and 11.
