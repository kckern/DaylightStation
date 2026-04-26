# Keyboard Double-Click Detection — Trusted Events Only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ArrowLeft`/`ArrowRight` double-click-to-prev/next detector in `keyboardManager.js` must only escalate on **real user keypresses**, not on synthetic `KeyboardEvent`s that the framework dispatches internally (e.g. from the office keypad's `9`/`0` → rew/fwd bridge).

**Architecture:** `ScreenActionHandler.handleMediaPlayback` dispatches `new KeyboardEvent('keydown', { key: 'ArrowLeft' })` to translate keypad-button presses into seek-backward actions inside the Player. `useAdvancedKeyboardHandler` has a built-in double-click detector (350ms window) that promotes two rapid ArrowLeft/ArrowRight presses to `previousTrack`/`nextTrack`. The detector currently doesn't distinguish synthetic events from real ones, so rapid `9` presses can trigger `previousTrack` (observed: `queue-skip direction:restart-current` in production logs at 2026-04-25T02:10:59.737Z). The fix is a single-word guard — only run the detector when `event.isTrusted === true` (the browser sets this to `false` on any event created via `new KeyboardEvent(...)`).

**Tech Stack:** React hooks, vitest + `@testing-library/react`, jsdom (in `tests/_infrastructure/frontend-env.mjs`). Tests are colocated with source in `frontend/src/lib/keyboard/` and run via the root `vitest.config.mjs`.

---

## File Structure

- **Modify:** `frontend/src/lib/keyboard/keyboardManager.js:238` — single-line guard change on the double-click branch.
- **Create:** `frontend/src/lib/keyboard/keyboardManager.test.jsx` — new vitest file covering the trusted/untrusted behavior. No test file exists for this module today, so we start fresh.

No other files change. The fix is deliberately narrow: do not disable double-click globally, do not mark events at the dispatch side, do not touch `ScreenActionHandler.jsx`. The browser's built-in `isTrusted` boolean is exactly the right signal.

---

## Task 1: Write the failing tests

**Files:**
- Create: `frontend/src/lib/keyboard/keyboardManager.test.jsx`

- [ ] **Step 1: Create the test file**

Write this as `frontend/src/lib/keyboard/keyboardManager.test.jsx`:

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAdvancedKeyboardHandler } from './keyboardManager.js';

/**
 * Minimal harness: renders a throwaway component that calls the hook.
 * @param {object} config - forwarded to useAdvancedKeyboardHandler
 */
function Harness({ config }) {
  useAdvancedKeyboardHandler(config);
  return null;
}

/**
 * Dispatch a KeyboardEvent on window.
 * `trusted` simulates a real user keypress — jsdom creates events with
 * isTrusted=false by default, so we override the property via
 * Object.defineProperty. Real browsers only set isTrusted=true for
 * events originating from actual user input, which is exactly the
 * distinction the production fix relies on.
 */
function dispatchKey(key, { trusted = true } = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (trusted) {
    Object.defineProperty(event, 'isTrusted', { value: true, configurable: true });
  }
  window.dispatchEvent(event);
}

describe('useAdvancedKeyboardHandler double-click detection', () => {
  let actionHandlers;
  const config = () => ({
    keyMappings: {
      ArrowLeft: 'seekBackward',
      ArrowRight: 'seekForward',
    },
    actionHandlers,
    enableDoubleClick: true,
    doubleClickDelay: 350,
  });

  beforeEach(() => {
    actionHandlers = {
      seekBackward: vi.fn(),
      seekForward: vi.fn(),
      previousTrack: vi.fn(),
      nextTrack: vi.fn(),
    };
  });

  it('promotes two rapid *trusted* ArrowLeft presses to previousTrack', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: true });
    dispatchKey('ArrowLeft', { trusted: true });

    expect(actionHandlers.previousTrack).toHaveBeenCalledTimes(1);
  });

  it('promotes two rapid *trusted* ArrowRight presses to nextTrack', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowRight', { trusted: true });
    dispatchKey('ArrowRight', { trusted: true });

    expect(actionHandlers.nextTrack).toHaveBeenCalledTimes(1);
  });

  it('does NOT promote rapid *synthetic* ArrowLeft presses (e.g. from keypad rew button)', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: false });
    dispatchKey('ArrowLeft', { trusted: false });
    dispatchKey('ArrowLeft', { trusted: false });

    expect(actionHandlers.previousTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekBackward).toHaveBeenCalledTimes(3);
  });

  it('does NOT promote rapid *synthetic* ArrowRight presses (e.g. from keypad fwd button)', () => {
    render(<Harness config={config()} />);

    dispatchKey('ArrowRight', { trusted: false });
    dispatchKey('ArrowRight', { trusted: false });
    dispatchKey('ArrowRight', { trusted: false });

    expect(actionHandlers.nextTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekForward).toHaveBeenCalledTimes(3);
  });

  it('does NOT promote a mixed trusted+synthetic burst', () => {
    // If the first press is a real user ArrowLeft and the second is a synthetic
    // rew dispatch, the synthetic one should not latch onto the trusted first
    // press to form a "double-click".
    render(<Harness config={config()} />);

    dispatchKey('ArrowLeft', { trusted: true });
    dispatchKey('ArrowLeft', { trusted: false });

    expect(actionHandlers.previousTrack).not.toHaveBeenCalled();
    expect(actionHandlers.seekBackward).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests — they should fail**

From repo root:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/lib/keyboard/keyboardManager.test.jsx
```

Expected: the 5 new cases run. The two "does NOT promote …" cases (and the mixed one) **FAIL**, because today the double-click detector fires on any event matching the key, regardless of `isTrusted`. The two "promotes two rapid *trusted* …" cases should pass even now (they match the existing behavior).

Typical failure message:

```
AssertionError: expected "previousTrack" to not be called
```

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/src/lib/keyboard/keyboardManager.test.jsx
git commit -m "test(keyboard): failing tests for trusted-only double-click detection"
```

---

## Task 2: Guard the double-click detector on `event.isTrusted`

**Files:**
- Modify: `frontend/src/lib/keyboard/keyboardManager.js:238`

- [ ] **Step 1: Apply the one-line fix**

Open `frontend/src/lib/keyboard/keyboardManager.js`. Find the line (currently line 238):

```js
      if (enableDoubleClick && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
```

Change it to:

```js
      if (enableDoubleClick && event.isTrusted && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
```

That's the only change.

- [ ] **Step 2: Re-run the tests — all five should now pass**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/lib/keyboard/keyboardManager.test.jsx
```

Expected: 5 passing, 0 failing.

- [ ] **Step 3: Run the wider frontend test surface to catch regressions**

Run the two test files in the codebase that exercise keyboard plumbing adjacent to this change:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  frontend/src/screen-framework/input/adapters/KeyboardAdapter.test.js \
  frontend/src/lib/keyboard/keyboardManager.test.jsx
```

Expected: all green. None of those tests should care about `isTrusted` — they assert that actions are emitted, and the fix is strictly narrower than "always run the detector."

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/keyboard/keyboardManager.js
git commit -m "fix(keyboard): only apply double-click prev/next escalation on trusted events

The office keypad's 9 (rew) and 0 (fwd) buttons dispatch synthetic
ArrowLeft/ArrowRight KeyboardEvents via ScreenActionHandler.handleMediaPlayback.
Rapid keypad presses (<350ms apart) were tripping the double-click detector
and promoting rew → previousTrack (queue-skip restart-current), clobbering
the playhead. Real user arrow-key double-taps still work — browsers set
event.isTrusted=true only for genuine user input."
```

---

## Task 3: Manual verification against the running stack

This repros the exact bug the user reported. Skip if no dev server / prod stack is reachable; unit tests cover the logic.

- [ ] **Step 1: Get a build of the fix running against the office screen**

Either:
- Run a dev server locally and open `http://localhost:{env.ports.app}/screen/office`, **or**
- Build a Docker image with the fix and restart the prod container (user-initiated; out of scope for this plan).

- [ ] **Step 2: Play something and try to reproduce the original bug**

1. Open devtools console and set `window.DAYLIGHT_LOG_LEVEL = 'debug'`.
2. Press `l` → books menu.
3. Pick any item → Player starts (e.g. Three Little Pigs, plex:620707).
4. Wait for playhead > 10 seconds so `restart-current` would otherwise be visible.
5. Press `9` three times in under ~700ms.

Expected behavior:
- Console shows 3 `numpad.key { key: "9", action: "media:playback" }` events.
- Each one shows a `playback.seek { source: "bump" }` going backward by the seek increment.
- There is **no** `playback.player.user-action { action: "queue-skip", direction: "restart-current" }`.
- Playhead never snaps to `0`.

- [ ] **Step 3: Confirm regular keyboard double-tap still works**

On a keyboard (not the keypad), press the physical **Left Arrow** key twice rapidly.

Expected: `queue-skip direction: restart-current` (or `previous`) fires, because `isTrusted=true` on real user keydowns. This is the behavior we intentionally preserve.

---

## Self-Review Results

- **Spec coverage:**
  - User stated fix target ("`keyboardManager.js` should only apply that if it is actually left and right arrow keys") → Task 2 adds `event.isTrusted` guard exactly at the spot that checks for `ArrowLeft`/`ArrowRight`.
  - User's separation concern ("we have separate buttons for that on the office keypad, lets keep them separate") → preserved by design: the keypad's `5`/`4` keys already emit the `prev`/`back` commands directly; disabling double-click escalation for synthetic events means the only way to trigger `previousTrack` is the dedicated key or a real double-tap.
- **Placeholder scan:** none — every code block is concrete; every command is runnable.
- **Type consistency:** the hook parameters (`enableDoubleClick`, `doubleClickDelay`, `actionHandlers`, `keyMappings`) and handler names (`seekBackward`, `seekForward`, `previousTrack`, `nextTrack`) match the definitions inside `keyboardManager.js` (lines 9–28, 155–157, 237–252).
- **Out of scope (deliberately):**
  - Not touching the gamepad adapter. Its synthetic events already carry `__gamepadSynthetic` and the arrow-direction double-tap story there is independent.
  - Not changing `keyboardConfig.js` component profiles (leaving `enableDoubleClick: true` for `player`/`contentScroller`). Real keyboard users still get the feature.
  - Not coupled to the separate "menu reopen after play" bug (`docs/superpowers/plans/2026-04-24-menu-reopen-after-play.md`). That one is about stale `currentMenuRef`; this one is about `isTrusted`. Land them independently.
