# Menu Reopen After Play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing a menu key (e.g. `l` for books) after its content has started playing should reopen the menu, not dispatch a stale `ArrowRight` into the Player.

**Architecture:** `ScreenActionHandler.jsx` tracks the currently open menu in a ref (`currentMenuRef`) and uses it to implement the `actions.menu.duplicate` guard. Today the ref is only cleared inside the `escape` handler, so it remains stale after `handleMediaPlay` / `handleMediaQueue` / `handleMediaQueueOp('play-now')` swap the menu overlay out for the Player. The fix is to clear `currentMenuRef.current` in each of those three call sites, mirroring the pattern the `escape` handler already uses.

**Tech Stack:** React (frontend), vitest + `@testing-library/react`. Tests live at `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` and run via the root vitest config.

---

## File Structure

- **Modify:** `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`
  - Clear `currentMenuRef.current = null` at 3 sites where `showOverlay(Player, …)` replaces the menu:
    - `handleMediaPlay` (around line 109)
    - `handleMediaQueue` (around line 118)
    - `handleMediaQueueOp`, inside the `op === 'play-now'` branch (around line 131)

- **Modify:** `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`
  - Add 3 new cases inside the existing `describe('menu duplicate guard', …)` block that reproduce the bug: open menu → play/queue/queue-op → press same menu key → expect menu to reopen (and no synthetic ArrowRight dispatched).

No new files.

---

## Task 1: Repro test for `media:play` path

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (add new case inside `describe('menu duplicate guard', …)`, around line 392, before the `'allows re-opening same menu after escape dismisses it'` case)

- [ ] **Step 1: Add the failing test**

Open `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx`. Inside the existing `describe('menu duplicate guard', () => { … })` block, add this case (place it right after the existing `'dispatches synthetic ArrowRight keydown when duplicate is "navigate" and same menu is open'` case, before `'allows re-opening same menu after escape dismisses it'`):

```jsx
    it('reopens same menu after media:play replaces it (duplicate guard must not be stale)', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'navigate' } }} />
        </ScreenOverlayProvider>
      );

      // 1. Open the books menu
      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));
      expect(getByTestId('menu-stack').dataset.menu).toBe('books');

      // 2. Select an item → Player replaces MenuStack
      act(() => getActionBus().emit('media:play', { contentId: 'plex:620707' }));
      expect(queryByTestId('menu-stack')).toBeNull();
      expect(getByTestId('player')).toBeTruthy();

      // 3. Clear spy so we can assert about only the second menu:open
      dispatchSpy.mockClear();

      // 4. Press the books menu key again → should reopen the menu
      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));

      expect(getByTestId('menu-stack')).toBeTruthy();
      expect(getByTestId('menu-stack').dataset.menu).toBe('books');

      // 5. And must NOT have dispatched a synthetic ArrowRight (that would seek the Player)
      const arrowCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent && e.key === 'ArrowRight'
      );
      expect(arrowCalls).toHaveLength(0);

      dispatchSpy.mockRestore();
    });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:play"
```

Expected: **FAIL**. Likely failure messages:
- `Unable to find element by data-testid="menu-stack"` (because the duplicate guard's `return` on line 87 short-circuits the second `showOverlay(MenuStack, …)`), **and/or**
- `expected [ [ KeyboardEvent ] ] to have length 0 but got 1` (the synthetic ArrowRight *is* being dispatched).

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "test(screen-framework): failing test for menu reopen after media:play"
```

---

## Task 2: Fix the `handleMediaPlay` path

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:109-116`

- [ ] **Step 1: Clear `currentMenuRef` inside `handleMediaPlay`**

In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, replace the body of `handleMediaPlay` so it reads:

```jsx
  const handleMediaPlay = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    currentMenuRef.current = null;
    dismissOverlay();
    showOverlay(Player, {
      play: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);
```

The only change is the new `currentMenuRef.current = null;` line before `dismissOverlay()`. Do not touch anything else in this function.

- [ ] **Step 2: Re-run the Task 1 test — it should now pass**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:play"
```

Expected: **PASS**.

- [ ] **Step 3: Run the entire file to confirm no existing test regressed**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
```

Expected: all cases green (the existing `'dispatches synthetic ArrowRight keydown when duplicate is "navigate" and same menu is open'` must still pass — that case opens the same menu twice *without* a `media:play` in between, so the ref is still set and the synthetic ArrowRight must still fire).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx
git commit -m "fix(screen-framework): clear currentMenuRef in handleMediaPlay

Without this, pressing a menu key after its content starts playing tripped
the stale duplicate guard and dispatched a synthetic ArrowRight into the
Player instead of reopening the menu."
```

---

## Task 3: Repro test + fix for `media:queue` path

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (add another case in the same `describe` block)
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:118-125`

- [ ] **Step 1: Add the failing test**

Add this case in the same `describe('menu duplicate guard', …)` block, immediately after the Task 1 test:

```jsx
    it('reopens same menu after media:queue replaces it', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'navigate' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));
      act(() => getActionBus().emit('media:queue', { contentId: 'plex:620707' }));

      expect(queryByTestId('menu-stack')).toBeNull();
      expect(getByTestId('player')).toBeTruthy();

      dispatchSpy.mockClear();
      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));

      expect(getByTestId('menu-stack').dataset.menu).toBe('books');
      const arrowCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent && e.key === 'ArrowRight'
      );
      expect(arrowCalls).toHaveLength(0);

      dispatchSpy.mockRestore();
    });
```

- [ ] **Step 2: Run it and confirm it fails**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:queue"
```

Expected: **FAIL** (same symptoms as Task 1 but for the `media:queue` path).

- [ ] **Step 3: Apply the same fix in `handleMediaQueue`**

In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, change `handleMediaQueue` to:

```jsx
  const handleMediaQueue = useCallback((payload) => {
    if (isMediaDuplicate(payload.contentId)) return;
    currentMenuRef.current = null;
    dismissOverlay();
    showOverlay(Player, {
      queue: { contentId: payload.contentId, ...payload },
      clear: () => dismissOverlay(),
    });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);
```

Only the new `currentMenuRef.current = null;` line is added; everything else is unchanged.

- [ ] **Step 4: Re-run the new test — it should pass**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:queue"
```

Expected: **PASS**.

- [ ] **Step 5: Run the whole test file**

Run:

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx \
        frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "fix(screen-framework): clear currentMenuRef in handleMediaQueue"
```

---

## Task 4: Repro test + fix for `media:queue-op play-now` path

**Files:**
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx` (one more case in the same `describe` block)
- Modify: `frontend/src/screen-framework/actions/ScreenActionHandler.jsx:131-143`

- [ ] **Step 1: Add the failing test**

Add immediately after the Task 3 test:

```jsx
    it('reopens same menu after media:queue-op play-now replaces it', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const { getByTestId, queryByTestId } = render(
        <ScreenOverlayProvider>
          <ScreenActionHandler actions={{ menu: { duplicate: 'navigate' } }} />
        </ScreenOverlayProvider>
      );

      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));
      act(() => getActionBus().emit('media:queue-op', {
        op: 'play-now',
        contentId: 'plex:620707',
      }));

      expect(queryByTestId('menu-stack')).toBeNull();
      expect(getByTestId('player')).toBeTruthy();

      dispatchSpy.mockClear();
      act(() => getActionBus().emit('menu:open', { menuId: 'books' }));

      expect(getByTestId('menu-stack').dataset.menu).toBe('books');
      const arrowCalls = dispatchSpy.mock.calls.filter(
        ([e]) => e instanceof KeyboardEvent && e.key === 'ArrowRight'
      );
      expect(arrowCalls).toHaveLength(0);

      dispatchSpy.mockRestore();
    });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:queue-op play-now"
```

Expected: **FAIL** (same symptoms).

- [ ] **Step 3: Apply the fix in `handleMediaQueueOp` (only the `play-now` branch)**

In `frontend/src/screen-framework/actions/ScreenActionHandler.jsx`, change `handleMediaQueueOp` to:

```jsx
  const handleMediaQueueOp = useCallback((payload) => {
    const op = payload?.op;
    if (op === 'play-now') {
      if (isMediaDuplicate(payload.contentId)) return;
      currentMenuRef.current = null;
      dismissOverlay();
      showOverlay(Player, {
        queue: { contentId: payload.contentId, ...payload },
        clear: () => dismissOverlay(),
      });
      return;
    }
    logger().debug('media.queue-op.unhandled', { op, contentId: payload?.contentId });
  }, [showOverlay, dismissOverlay, isMediaDuplicate]);
```

Only the new `currentMenuRef.current = null;` line is added inside the `play-now` branch.

- [ ] **Step 4: Re-run the new test — it should pass**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx \
  -t "reopens same menu after media:queue-op play-now"
```

Expected: **PASS**.

- [ ] **Step 5: Run the full test file one more time**

```bash
./frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
```

Expected: all green. In particular, confirm these existing cases still pass unchanged:
- `'ignores second menu:open with same menuId when duplicate is "ignore"'` (no media play in between — ref should still be sticky)
- `'dispatches synthetic ArrowRight keydown when duplicate is "navigate" and same menu is open'` (same)
- `'allows re-opening same menu after escape dismisses it'` (escape still clears ref)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screen-framework/actions/ScreenActionHandler.jsx \
        frontend/src/screen-framework/actions/ScreenActionHandler.test.jsx
git commit -m "fix(screen-framework): clear currentMenuRef in handleMediaQueueOp play-now"
```

---

## Task 5: Manual verification on the office screen

This is a smoke test against a running dev server or the prod container. Skip if a dev server isn't handy; the unit tests cover the behavior.

- [ ] **Step 1: Make sure a dev server or prod container is serving the office screen**

If running locally:

```bash
lsof -i :3111 || npm run dev
```

If testing against prod, just open `http://{env.prod_host}:3111/screen/office` — the fix requires a rebuild+deploy, which is out of scope for this plan (do it later, manually).

- [ ] **Step 2: Reproduce the original bug path, verify fixed**

In a browser pointing at `/screen/office`:

1. Open devtools console and set `window.DAYLIGHT_LOG_LEVEL = 'debug'`.
2. Press `l` → books menu opens.
3. Select any item with Enter → book starts playing in Player.
4. Press `l` again.

Expected: books menu reopens on top of (or replacing) the Player. No `ArrowRight` is dispatched into the Player. In the console you should see `menu.duplicate-navigate` is **not** emitted after the `media:play`; instead you should see a normal menu open.

- [ ] **Step 3: Regression check — same-menu re-press while the menu is still open**

From a fresh state:
1. Press `l` → books menu opens.
2. Without selecting anything, press `l` again.

Expected: the selection advances to the next item (an `ArrowRight` is dispatched). This is the preserved behavior of `duplicate: 'navigate'` and must still work.

---

## Self-Review Results

- **Spec coverage:** the reported bug has three distinct entry points (`media:play`, `media:queue`, `media:queue-op`) into the same stale-ref condition. All three are covered (Tasks 2, 3, 4) with matching tests.
- **Placeholder scan:** none — every code block is copy-pasteable; every command is concrete.
- **Type consistency:** `currentMenuRef` is always referenced as `currentMenuRef.current`; the setter pattern (`= null`) matches the existing uses inside the escape handler (lines 292, 317).
- **Out of scope (deliberately):** `handleMediaPlayback` has a `secondary` fallback branch (lines 153–164) that can call `showOverlay(Player, …)` or `showOverlay(MenuStack, …)` without updating `currentMenuRef`. That's a separate edge case (only triggered when `playback.when_idle: secondary` is configured and no media is active). Not part of this bug report; leave it for a follow-up if it surfaces.
