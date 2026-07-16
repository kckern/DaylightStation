# Media Docked Video Mini-Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the live onboard video docked in the play bar's left slot while browsing, and promote it to the full Now Playing view on click (Plex-style mini-player).

**Architecture:** Reuse the single-Player portal (`PlayerBridge` → `PlayerHostContext`). Two changes: (1) make host claims **priority-aware** via a small registry so the correct view wins when two want the Player; (2) render a **live-video dock** in `MiniPlayer`'s left slot for video content when Now Playing is closed, claiming the host at low priority. The Player instance never remounts, so playback stays continuous across the browse↔Now-Playing transition.

**Tech Stack:** React 18, Vitest + @testing-library/react, global SCSS + Mantine CSS vars. Tests run from repo root via the root vitest config.

**Spec:** `docs/superpowers/specs/2026-07-16-media-docked-video-mini-player-design.md`

## Global Constraints

- **Test runner (from repo root `/opt/Code/DaylightStation`):** `./node_modules/.bin/vitest run --config vitest.config.mjs <file>` — works for `.jsx` and `.js` (jsdom + React plugin come from the root config).
- **TDD required:** failing test first, verify it fails, minimal implementation, verify it passes, commit. One logical change per commit.
- **Preserve existing behavior:** audio playback and the idle bar are unchanged (static thumbnail / "Idle"). The dock appears ONLY for `currentItem.format === 'video'` and ONLY when `view !== 'nowPlaying'`. Now Playing must always win the Player host when it is open.
- **Backward-compatible hook:** `usePlayerHost(ref)` must keep working for existing callers (new params `priority` and `active` default to `1`/`true`).
- **No new deploy in this plan.** Build to verify; deploy is a separate gated step.

---

## File Structure

- `frontend/src/modules/Media/session/playerHostRegistry.js` — **new.** Pure `resolveActiveHost(claims)`: given the active claims, return the winning element (highest priority; ties → most-recent). The unit-tested core.
- `frontend/src/modules/Media/session/PlayerHostProvider.jsx` — **new.** Holds the claim registry; provides `PlayerHostContext` (active element) and `PlayerHostRegistryContext` (`{claim, release}`). Uses `resolveActiveHost`.
- `frontend/src/modules/Media/session/playerHostContext.js` — **modify.** Keep `PlayerHostContext`; replace `PlayerHostSetterContext` with `PlayerHostRegistryContext`.
- `frontend/src/modules/Media/session/usePlayerHost.js` — **modify.** New signature `usePlayerHost(ref, priority = 1, active = true)` using the registry.
- `frontend/src/modules/Media/session/LocalSessionProvider.jsx` — **modify.** Wrap children + `<PlayerBridge/>` in `<PlayerHostProvider>` instead of the inline `useState` host.
- `frontend/src/modules/Media/shell/NowPlayingView.jsx` — **modify.** Claim at priority `2` (`usePlayerHost(hostRef, 2)`).
- `frontend/src/modules/Media/shell/MiniPlayer.jsx` — **modify.** Render the video dock (or thumbnail) and claim the host at priority `1` when showing the dock.
- `frontend/src/modules/Media/shell/MediaShell.scss` — **modify.** `.mini-player-video-dock` + `.mini-player-video-dock-host` styles.
- `frontend/src/Apps/MediaApp.scss` — **modify.** `--media-dock-video-w` layout var.
- Tests:
  - `frontend/src/modules/Media/session/playerHostRegistry.test.js` — **new** (Task 1, pure).
  - `frontend/src/modules/Media/session/PlayerHostProvider.test.jsx` — **new** (Task 1, wiring).
  - `frontend/src/modules/Media/shell/MiniPlayer.test.jsx` — **modify** (Task 2, extend existing).

---

## Task 1: Priority-aware Player host

**Files:**
- Create: `frontend/src/modules/Media/session/playerHostRegistry.js`, `frontend/src/modules/Media/session/PlayerHostProvider.jsx`
- Modify: `frontend/src/modules/Media/session/playerHostContext.js`, `frontend/src/modules/Media/session/usePlayerHost.js`, `frontend/src/modules/Media/session/LocalSessionProvider.jsx` (`:97-108`), `frontend/src/modules/Media/shell/NowPlayingView.jsx` (`:47`)
- Test: `frontend/src/modules/Media/session/playerHostRegistry.test.js`, `frontend/src/modules/Media/session/PlayerHostProvider.test.jsx`

**Interfaces:**
- Produces:
  - `resolveActiveHost(claims: Array<{el: Element|null, priority: number, seq: number}>) => Element|null` — highest `priority` wins; ties broken by highest `seq`; `el==null` claims ignored; empty → `null`.
  - `PlayerHostProvider({children})` — React provider exposing `PlayerHostContext` (active `Element|null`) and `PlayerHostRegistryContext` (`{claim(id, el, priority), release(id)}`).
  - `usePlayerHost(ref, priority = 1, active = true)` — while `active`, registers a claim of `ref.current` at `priority`; releases on `active=false` or unmount.
  - `PlayerHostRegistryContext` (replaces `PlayerHostSetterContext`).
- Consumes: existing `PlayerHostContext` (unchanged; read by `PlayerBridge.jsx`).

- [ ] **Step 1: Write the failing test for `resolveActiveHost`**

Create `frontend/src/modules/Media/session/playerHostRegistry.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { resolveActiveHost } from './playerHostRegistry.js';

const el = (name) => ({ name }); // stand-in DOM nodes

describe('resolveActiveHost', () => {
  it('returns null for an empty claim set', () => {
    expect(resolveActiveHost([])).toBeNull();
  });

  it('ignores claims whose element is null', () => {
    expect(resolveActiveHost([{ el: null, priority: 5, seq: 9 }])).toBeNull();
  });

  it('returns the highest-priority claim', () => {
    const low = el('low'); const high = el('high');
    const active = resolveActiveHost([
      { el: low, priority: 1, seq: 1 },
      { el: high, priority: 2, seq: 2 },
    ]);
    expect(active).toBe(high);
  });

  it('breaks priority ties by most-recent (highest seq)', () => {
    const a = el('a'); const b = el('b');
    const active = resolveActiveHost([
      { el: a, priority: 1, seq: 1 },
      { el: b, priority: 1, seq: 2 },
    ]);
    expect(active).toBe(b);
  });

  it('falls back to the next claim when the top one is absent', () => {
    const low = el('low');
    // Simulates the priority-2 claim having been released (removed from the set).
    expect(resolveActiveHost([{ el: low, priority: 1, seq: 1 }])).toBe(low);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/session/playerHostRegistry.test.js`
Expected: FAIL — `resolveActiveHost` is not defined / module missing.

- [ ] **Step 3: Implement `resolveActiveHost`**

Create `frontend/src/modules/Media/session/playerHostRegistry.js`:

```javascript
// Pure resolver for the Player host. Given the current claims, pick the winner:
// highest priority, ties broken by the most-recently-added claim (highest seq).
// Null-element claims are ignored (a claimant that isn't mounted / isn't active).
export function resolveActiveHost(claims) {
  let best = null;
  for (const c of claims) {
    if (!c || c.el == null) continue;
    if (
      best == null ||
      c.priority > best.priority ||
      (c.priority === best.priority && c.seq > best.seq)
    ) {
      best = c;
    }
  }
  return best ? best.el : null;
}

export default resolveActiveHost;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/session/playerHostRegistry.test.js`
Expected: PASS (5 passed).

- [ ] **Step 5: Update the context module**

Replace the whole body of `frontend/src/modules/Media/session/playerHostContext.js` with:

```javascript
// frontend/src/modules/Media/session/playerHostContext.js
// Where the Player's visual output renders. `PlayerHostContext` holds the active
// host element (null → PlayerBridge keeps the Player in its off-screen park).
// `PlayerHostRegistryContext` lets views claim/release the host at a priority;
// the highest-priority active claim wins (see playerHostRegistry.resolveActiveHost).
import { createContext } from 'react';

export const PlayerHostContext = createContext(null);
export const PlayerHostRegistryContext = createContext({
  claim: () => {},
  release: () => {},
});
```

- [ ] **Step 6: Rewrite `usePlayerHost` to use the registry**

Replace the whole body of `frontend/src/modules/Media/session/usePlayerHost.js` with:

```javascript
// frontend/src/modules/Media/session/usePlayerHost.js
import { useContext, useEffect, useId } from 'react';
import { PlayerHostRegistryContext } from './playerHostContext.js';

/**
 * Claim the Player host while this hook is mounted and `active`. The Player
 * portals into the highest-priority active claim. Releases on `active=false`
 * or unmount. Backward compatible: usePlayerHost(ref) → priority 1, active true.
 *
 * @param {{current: Element|null}} ref  element the Player should portal into
 * @param {number} [priority=1]          higher wins (Now Playing=2, dock=1)
 * @param {boolean} [active=true]        only claim while true
 */
export function usePlayerHost(ref, priority = 1, active = true) {
  const { claim, release } = useContext(PlayerHostRegistryContext);
  const id = useId();
  useEffect(() => {
    if (active) claim(id, ref.current ?? null, priority);
    else release(id);
    return () => release(id);
  }, [ref, priority, active, claim, release, id]);
}

export default usePlayerHost;
```

- [ ] **Step 7: Write the failing wiring test for `PlayerHostProvider`**

Create `frontend/src/modules/Media/session/PlayerHostProvider.test.jsx`:

```jsx
import React, { useRef, useContext } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
import { PlayerHostContext } from './playerHostContext.js';
import { usePlayerHost } from './usePlayerHost.js';

function Claimant({ priority, testid }) {
  const ref = useRef(null);
  usePlayerHost(ref, priority);
  return <div ref={ref} data-testid={testid} />;
}

function ActiveHostProbe() {
  const host = useContext(PlayerHostContext);
  return (
    <span data-testid="active-host">
      {host ? host.getAttribute('data-testid') : 'none'}
    </span>
  );
}

describe('PlayerHostProvider', () => {
  it('portals to the highest-priority claim and falls back when it unmounts', () => {
    const { rerender } = render(
      <PlayerHostProvider>
        <Claimant priority={1} testid="low" />
        <Claimant priority={2} testid="high" />
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('high');

    // Now Playing (high) closes → dock (low) takes over.
    rerender(
      <PlayerHostProvider>
        <Claimant priority={1} testid="low" />
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('low');

    // Everything gone → back to the off-screen park (null → 'none').
    rerender(
      <PlayerHostProvider>
        <ActiveHostProbe />
      </PlayerHostProvider>
    );
    expect(screen.getByTestId('active-host')).toHaveTextContent('none');
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/session/PlayerHostProvider.test.jsx`
Expected: FAIL — `PlayerHostProvider.jsx` missing.

- [ ] **Step 9: Implement `PlayerHostProvider`**

Create `frontend/src/modules/Media/session/PlayerHostProvider.jsx`:

```jsx
// frontend/src/modules/Media/session/PlayerHostProvider.jsx
// Owns the Player host claim registry. Views claim the host via usePlayerHost;
// the highest-priority active claim becomes PlayerHostContext, which PlayerBridge
// portals the single Player instance into.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PlayerHostContext, PlayerHostRegistryContext } from './playerHostContext.js';
import { resolveActiveHost } from './playerHostRegistry.js';

export function PlayerHostProvider({ children }) {
  const claimsRef = useRef(new Map()); // id → { el, priority, seq }
  const seqRef = useRef(0);
  const [activeHost, setActiveHost] = useState(null);

  const recompute = useCallback(() => {
    setActiveHost(resolveActiveHost([...claimsRef.current.values()]));
  }, []);

  const claim = useCallback((id, el, priority) => {
    if (el == null) claimsRef.current.delete(id);
    else claimsRef.current.set(id, { el, priority, seq: ++seqRef.current });
    recompute();
  }, [recompute]);

  const release = useCallback((id) => {
    if (claimsRef.current.delete(id)) recompute();
  }, [recompute]);

  const registry = useMemo(() => ({ claim, release }), [claim, release]);

  return (
    <PlayerHostContext.Provider value={activeHost}>
      <PlayerHostRegistryContext.Provider value={registry}>
        {children}
      </PlayerHostRegistryContext.Provider>
    </PlayerHostContext.Provider>
  );
}

export default PlayerHostProvider;
```

- [ ] **Step 10: Run it to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/session/PlayerHostProvider.test.jsx`
Expected: PASS (1 passed).

- [ ] **Step 11: Wire `PlayerHostProvider` into `LocalSessionProvider`**

In `frontend/src/modules/Media/session/LocalSessionProvider.jsx`:

Change the import at `:8` from:
```javascript
import { PlayerHostContext, PlayerHostSetterContext } from './playerHostContext.js';
```
to:
```javascript
import { PlayerHostProvider } from './PlayerHostProvider.jsx';
```

Delete the `const [playerHostEl, setPlayerHostEl] = useState(null);` line (`:97`). (Leave the other `useState`/`useEffect` imports; they're used elsewhere in the file.)

Replace the JSX return block (`:100-108`) from:
```jsx
    <LocalSessionContext.Provider value={value}>
      <PlayerHostContext.Provider value={playerHostEl}>
        <PlayerHostSetterContext.Provider value={setPlayerHostEl}>
          {children}
          <PlayerBridge />
        </PlayerHostSetterContext.Provider>
      </PlayerHostContext.Provider>
    </LocalSessionContext.Provider>
```
to:
```jsx
    <LocalSessionContext.Provider value={value}>
      <PlayerHostProvider>
        {children}
        <PlayerBridge />
      </PlayerHostProvider>
    </LocalSessionContext.Provider>
```

- [ ] **Step 12: Give Now Playing the higher priority**

In `frontend/src/modules/Media/shell/NowPlayingView.jsx:47`, change:
```javascript
  usePlayerHost(hostRef);
```
to:
```javascript
  usePlayerHost(hostRef, 2);
```
(Leave everything else — `hostRef`, the `useHostMediaElement(hostRef, …)` call, and `<div ref={hostRef} className="now-playing-host" />` — unchanged.)

- [ ] **Step 13: Run the affected suites for regressions**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/session/ frontend/src/modules/Media/shell/NowPlayingView.test.jsx`
Expected: PASS — new registry tests green; `NowPlayingView.test.jsx` and other session tests unaffected. If `NowPlayingView.test.jsx` mocks `usePlayerHost` or the host context, confirm the mock still matches the new export names (`PlayerHostRegistryContext`); update the mock if it referenced `PlayerHostSetterContext`.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/modules/Media/session/playerHostRegistry.js \
        frontend/src/modules/Media/session/playerHostRegistry.test.js \
        frontend/src/modules/Media/session/PlayerHostProvider.jsx \
        frontend/src/modules/Media/session/PlayerHostProvider.test.jsx \
        frontend/src/modules/Media/session/playerHostContext.js \
        frontend/src/modules/Media/session/usePlayerHost.js \
        frontend/src/modules/Media/session/LocalSessionProvider.jsx \
        frontend/src/modules/Media/shell/NowPlayingView.jsx
git commit -m "feat(media): priority-aware Player host claim registry

Replace the single last-writer-wins host ref with a priority registry so
multiple views can claim the one Player instance and the right one wins.
Now Playing claims at priority 2; the coming video dock will claim at 1.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: MiniPlayer live-video dock + styling

**Files:**
- Modify: `frontend/src/modules/Media/shell/MiniPlayer.jsx` (`:7-17` imports, `:22-25` hooks/derived, `:65-67` thumbnail slot), `frontend/src/modules/Media/shell/MediaShell.scss` (mini-player block `:198-262`), `frontend/src/Apps/MediaApp.scss` (`:8-10` vars)
- Test: `frontend/src/modules/Media/shell/MiniPlayer.test.jsx` (extend existing)

**Interfaces:**
- Consumes: `usePlayerHost(ref, priority = 1, active = true)` from Task 1; existing `useNav()` (`{push, view}`), `useSessionController('local')` (`{snapshot}`), `snapshot.currentItem.format`.
- Produces: a `data-testid="mini-player-video-dock"` button in the bar's left slot for video, whose inner `.mini-player-video-dock-host` div is the Player host; clicking it calls `push('nowPlaying', {})`.

- [ ] **Step 1: Confirm the video-format field on `currentItem`**

Run: `grep -rn "format" frontend/src/modules/Media/session/sessionReducer.js frontend/src/modules/Media/session/containerExpansion.js | grep -i "format" | head`
Expected: confirms items carry `format: 'audio' | 'video'` (set by `formatForChild`, `containerExpansion.js:51-76`). The dock uses `currentItem.format === 'video'` with a `mediaType === 'video'` fallback. If `format` is NOT present on the resolved `currentItem`, note it and rely on the `mediaType` fallback (the test below drives `format: 'video'` explicitly either way).

- [ ] **Step 2: Write the failing tests (extend the existing MiniPlayer suite)**

In `frontend/src/modules/Media/shell/MiniPlayer.test.jsx`, add a `format` option to `makeSnapshot` and three new tests.

Change the `makeSnapshot` signature/return so `format` is settable — update the destructure to include `format = undefined,` and the `currentItem` line to:
```javascript
    currentItem: { contentId: 'plex:1', title, duration, thumbnail: '/thumb.jpg', format },
```

Add these tests inside the `describe('MiniPlayer', …)` block:

```javascript
  it('docks the live video (not the thumbnail) for video while browsing', () => {
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'home';
    render(<MiniPlayer />);
    expect(screen.getByTestId('mini-player-video-dock')).toBeInTheDocument();
    expect(document.querySelector('.mini-player-thumb')).toBeNull();
  });

  it('clicking the docked video promotes to Now Playing', () => {
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'home';
    render(<MiniPlayer />);
    fireEvent.click(screen.getByTestId('mini-player-video-dock'));
    expect(push).toHaveBeenCalledWith('nowPlaying', {});
  });

  it('shows the thumbnail (no video dock) for audio, and for video while on Now Playing', () => {
    // audio → thumbnail
    state.snapshot = makeSnapshot(); // no format
    nav.view = 'home';
    const { unmount } = render(<MiniPlayer />);
    expect(screen.queryByTestId('mini-player-video-dock')).toBeNull();
    expect(document.querySelector('.mini-player-thumb')).not.toBeNull();
    unmount();

    // video but on Now Playing → thumbnail (video is in the big pane)
    state.snapshot = makeSnapshot({ format: 'video' });
    nav.view = 'nowPlaying';
    render(<MiniPlayer />);
    expect(screen.queryByTestId('mini-player-video-dock')).toBeNull();
    expect(document.querySelector('.mini-player-thumb')).not.toBeNull();
  });
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/shell/MiniPlayer.test.jsx`
Expected: FAIL — `mini-player-video-dock` not found (dock not implemented). The pre-existing MiniPlayer tests still pass.

- [ ] **Step 4: Implement the dock in `MiniPlayer.jsx`**

Add imports. Change `:7` and the imports block to include `useRef` and `usePlayerHost`:
```javascript
import React, { useRef } from 'react';
```
and add after the existing `usePlaybackPosition` import (`:15`):
```javascript
import { usePlayerHost } from '../session/usePlayerHost.js';
```

After `const item = snapshot?.currentItem;` (`:25`), add:
```javascript
  const dockRef = useRef(null);
  const isVideo = item?.format === 'video' || item?.mediaType === 'video';
  const showVideoDock = isVideo && view !== 'nowPlaying';
  usePlayerHost(dockRef, 1, showVideoDock);
```
(These sit before the `if (!item) return …` early return at `:27`, so the hook is always called — Rules of Hooks satisfied. When idle, `showVideoDock` is false and the hook releases.)

Replace the thumbnail block (`:65-67`):
```jsx
      {item.thumbnail && (
        <img className="mini-player-thumb" src={item.thumbnail} alt="" loading="lazy" />
      )}
```
with:
```jsx
      {showVideoDock ? (
        <button
          type="button"
          data-testid="mini-player-video-dock"
          className="mini-player-video-dock"
          aria-label="Expand video"
          onClick={() => { if (view !== 'nowPlaying') push('nowPlaying', {}); }}
        >
          <div ref={dockRef} className="mini-player-video-dock-host" />
        </button>
      ) : (
        item.thumbnail && (
          <img className="mini-player-thumb" src={item.thumbnail} alt="" loading="lazy" />
        )
      )}
```

- [ ] **Step 5: Run to verify the MiniPlayer tests pass**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Media/shell/MiniPlayer.test.jsx`
Expected: PASS — all pre-existing tests plus the 3 new ones. (`usePlayerHost` no-ops here: no `PlayerHostRegistryContext` provider in this test → default `{claim,release}` no-ops.)

- [ ] **Step 6: Add the dock styling**

In `frontend/src/Apps/MediaApp.scss`, add the var inside `.media-app` (after `:10`, alongside the other layout vars):
```scss
  --media-dock-video-w: 96px;
```

In `frontend/src/modules/Media/shell/MediaShell.scss`, inside the `.mini-player { … }` block (after the `.mini-player-thumb` rule, ~`:230`), add:
```scss
  .mini-player-video-dock {
    flex-shrink: 0;
    width: var(--media-dock-video-w);
    height: calc(var(--media-mini-h) - 12px);
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: var(--mantine-radius-sm);
    overflow: hidden;
    background: var(--mantine-color-dark-8);
    cursor: pointer;
    display: block;

    &:hover { border-color: var(--mantine-color-amber-5); }

    .mini-player-video-dock-host {
      width: 100%;
      height: 100%;
      // Clicks fall through to the wrapping button so the tile always promotes,
      // even when the pointer is over the portaled <video>.
      pointer-events: none;

      video, iframe {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
    }
  }
```

- [ ] **Step 7: Build to verify the SCSS + bundle compile**

Run: `cd frontend && npx vite build 2>&1 | tail -5; cd ..`
Expected: build completes without SCSS/JS errors (chunk-size warnings are pre-existing and fine).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Media/shell/MiniPlayer.jsx \
        frontend/src/modules/Media/shell/MiniPlayer.test.jsx \
        frontend/src/modules/Media/shell/MediaShell.scss \
        frontend/src/Apps/MediaApp.scss
git commit -m "feat(media): dock the live video in the play bar, click to promote

MiniPlayer renders the live video (claiming the Player host at priority 1) in
its left slot for video content while browsing; clicking promotes to Now
Playing. Audio and on-Now-Playing keep the static thumbnail.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after both tasks)

- [ ] **Run every touched suite together:**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Media/session/ \
  frontend/src/modules/Media/shell/
```
Expected: all green (registry + provider + MiniPlayer + NowPlayingView + other shell/session tests).

- [ ] **Full frontend build once more from repo root context** (matches the Docker image build):

```bash
cd frontend && npx vite build 2>&1 | tail -3; cd ..
```
Expected: clean build.

- [ ] **Note for the human:** live end-to-end verification (play a video, browse away, confirm the video docks bottom-left in the play bar and clicking it opens Now Playing with playback continuous) needs a build + deploy, which is gated on the garage-not-in-use check and is out of this plan's scope.

---

## Self-Review

**Spec coverage:**
- Priority-aware host (spec §1) → Task 1 (`resolveActiveHost` + `PlayerHostProvider` + `usePlayerHost(ref, priority, active)` + Now Playing priority 2). ✅
- MiniPlayer video dock, video-only, not on Now Playing, click promotes (spec §2) → Task 2. ✅
- Styling: own container not inheriting `.now-playing-host` fill; `--media-dock-video-w` var; bar height unchanged (spec §3) → Task 2 Step 6. ✅
- Edge cases (spec): audio → thumbnail (Task 2 test 3); idle unchanged (early return, untouched); continuity across transition (single Player never remounts — Task 1 keeps one `PlayerBridge`; priority registry hands off without dropping); fill-rule bleed prevented by scoped `.mini-player-video-dock-host video` rule. ✅
- Testing (spec): priority resolution unit (Task 1 Step 1), provider wiring (Task 1 Step 7), MiniPlayer branching + click (Task 2 Step 2). ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 2 Step 1 is a verification/grep step (confirm the `format` field), not a placeholder — the code carries a `mediaType` fallback and the tests drive `format` explicitly.

**Type/name consistency:** `resolveActiveHost`, `PlayerHostProvider`, `PlayerHostRegistryContext`, `PlayerHostContext`, `usePlayerHost(ref, priority, active)`, `claim(id, el, priority)`, `release(id)`, `.mini-player-video-dock`, `.mini-player-video-dock-host`, `--media-dock-video-w`, and `mini-player-video-dock` testid are spelled identically across Tasks 1 and 2 and the tests. The context rename `PlayerHostSetterContext → PlayerHostRegistryContext` is applied in the context module, the hook, and `LocalSessionProvider` together in Task 1 (no dangling reference).
