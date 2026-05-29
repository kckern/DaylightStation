# FitnessToast — Ephemeral Centered Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable, self-dismissing centered toast in the fitness video view, with the first caller being rider assignment ("User_2 is riding the NiceDay").

**Architecture:** A single-slot, latest-wins toast owned by `FitnessContext` (pure slot helpers + `push`/`dismiss`), rendered by a new presentational `FitnessToast` component mounted in `FitnessPlayerOverlay`. The rider-assignment toast is fired from the existing `rider_select` WS dispatch via a pure `buildRiderToast` mapper — purely additive, never replacing the `ingestData` call that sets the claim.

**Tech Stack:** React (`.jsx`), SCSS, vitest + `@testing-library/react` (jsdom) with `vi.useFakeTimers`.

---

## Design reference

Spec: `docs/superpowers/specs/2026-05-29-fitness-toast-notifications-design.md`

**Locked decisions:** latest-wins single slot; content `{ id, avatarUrl?, icon?, title, subtitle?, durationMs, variant }`; default duration 4000 ms; fade + collapse exit; owned by FitnessContext, rendered in FitnessPlayerOverlay, triggered from the `rider_select` WS dispatch; non-blocking (no video pause, renders above other overlays).

**Refinements discovered during planning (these supersede the spec where noted):**
1. The slot's latest-wins + id-guard logic is extracted to a **pure module** `fitnessToastSlot.js` (testable without React), instead of an untestable provider-internal reducer.
2. `buildRiderToast` takes **resolver functions** `{ resolveUserName, resolveEquipmentName }` (not the raw `fitnessConfiguration`), keeping it pure/testable. The real resolvers (`getDisplayName`, `equipmentConfig`) are supplied at the call site.
3. **TDZ/staleness:** `getDisplayName` is declared *after* the WS effect in `FitnessContext`, so it must NOT go in the WS effect's dep array. The rider→toast handler is reached through a **ref** (`riderToastRef`) populated by a later effect — robust against both the temporal-dead-zone and stale closures, matching the ref pattern the WS effect already uses (`fitnessSessionRef`, `reconnectCountRef`).
4. **Root mount (revised per user direction):** the toast mounts in `FitnessApp.jsx`'s root `GlobalOverlays` component (next to `VoiceMemoOverlay`), NOT in `FitnessPlayerOverlay` — so it shows in any view (menu, screen, player), even with no video playing. Consequently the toast uses `position: fixed` (viewport-centered), independent of any video container.

## Testing in a worktree (read before running any test command)

This worktree has no local `node_modules`. Run vitest via the **main repo's** binary, from the worktree dir:

```bash
WT=/opt/Code/DaylightStation/.claude/worktrees/fitness-toast-notifications
VITEST=/opt/Code/DaylightStation/node_modules/.bin/vitest
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs <relative/path/to/test>
```

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.js` | Pure slot mechanics: defaults, `normalizeToast`, `dismissMatches` | Create |
| `frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js` | Slot unit tests | Create |
| `frontend/src/modules/Fitness/player/overlays/buildRiderToast.js` | Pure rider `{userId,equipmentId}` → toast payload | Create |
| `frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js` | Mapper unit tests | Create |
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx` | Presentational toast + self-timer + countdown + exit | Create |
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss` | Centered layout, countdown bar, fade+collapse, variants | Create |
| `frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx` | Component tests (fake timers) | Create |
| `frontend/src/context/FitnessContext.jsx` | Toast state + push/dismiss + ref-bridged rider_select trigger + value exposure | Modify |
| `frontend/src/Apps/FitnessApp.jsx` | Mount `FitnessToast` in the root `GlobalOverlays` (view-agnostic) | Modify |

---

### Task 1: `fitnessToastSlot.js` — pure slot mechanics

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.js`
- Test: `frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOAST_DURATION_MS,
  DEFAULT_TOAST_VARIANT,
  normalizeToast,
  dismissMatches,
} from './fitnessToastSlot.js';

describe('fitnessToastSlot', () => {
  it('normalizeToast assigns the id and preserves provided fields', () => {
    const out = normalizeToast({ title: 'User_2', subtitle: 'is riding', durationMs: 2000, variant: 'success' }, 7);
    expect(out).toEqual({ id: 7, title: 'User_2', subtitle: 'is riding', durationMs: 2000, variant: 'success' });
  });

  it('normalizeToast applies default duration and variant when omitted', () => {
    const out = normalizeToast({ title: 'Hi' }, 1);
    expect(out.id).toBe(1);
    expect(out.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(out.variant).toBe(DEFAULT_TOAST_VARIANT);
  });

  it('normalizeToast ignores a non-finite durationMs and uses the default', () => {
    const out = normalizeToast({ title: 'Hi', durationMs: 'soon' }, 1);
    expect(out.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
  });

  it('dismissMatches is true only when the current toast id matches', () => {
    expect(dismissMatches({ id: 5 }, 5)).toBe(true);
    expect(dismissMatches({ id: 5 }, 6)).toBe(false);
    expect(dismissMatches(null, 5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js`
Expected: FAIL — module `./fitnessToastSlot.js` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.js`:

```javascript
/**
 * Pure mechanics for the single-slot, latest-wins fitness toast.
 * No React — trivially unit-testable. Consumed by FitnessContext.
 */

export const DEFAULT_TOAST_DURATION_MS = 4000;
export const DEFAULT_TOAST_VARIANT = 'info';

/**
 * Stamp a toast payload with its slot id and fill in defaults.
 * @param {Object} toast - { avatarUrl?, icon?, title, subtitle?, durationMs?, variant? }
 * @param {number} id - monotonic slot id (a new id re-triggers the animation/countdown)
 * @returns {Object} normalized toast with a guaranteed id, durationMs, variant
 */
export function normalizeToast(toast, id) {
  const base = toast && typeof toast === 'object' ? toast : {};
  const durationMs = Number.isFinite(base.durationMs) ? base.durationMs : DEFAULT_TOAST_DURATION_MS;
  const variant = base.variant || DEFAULT_TOAST_VARIANT;
  return { ...base, id, durationMs, variant };
}

/**
 * Whether a dismiss request for `id` should clear the current toast.
 * Guards against a stale exit timer clearing a newer toast that already replaced it.
 * @param {Object|null} currentToast
 * @param {number} id
 * @returns {boolean}
 */
export function dismissMatches(currentToast, id) {
  return Boolean(currentToast) && currentToast.id === id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.js frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js
git commit -m "feat(fitness): pure single-slot toast mechanics (normalize + id-guard dismiss)"
```

---

### Task 2: `buildRiderToast.js` — rider event → toast payload

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/buildRiderToast.js`
- Test: `frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { buildRiderToast } from './buildRiderToast.js';

const resolvers = {
  resolveUserName: (uid) => ({ user_2: 'User_2' }[uid] || uid),
  resolveEquipmentName: (eid) => ({ niceday: 'NiceDay' }[eid] || eid),
};

describe('buildRiderToast', () => {
  it('builds an avatar/title/subtitle payload from a rider_select event', () => {
    const toast = buildRiderToast({ userId: 'user_2', equipmentId: 'niceday' }, resolvers);
    expect(toast).toEqual({
      avatarUrl: '/api/v1/static/img/users/user_2',
      title: 'User_2',
      subtitle: 'is riding the NiceDay',
      variant: 'success',
    });
  });

  it('falls back to raw ids when resolvers do not recognize them', () => {
    const toast = buildRiderToast({ userId: 'guest1', equipmentId: 'mystery' }, resolvers);
    expect(toast.title).toBe('guest1');
    expect(toast.subtitle).toBe('is riding the mystery');
    expect(toast.avatarUrl).toBe('/api/v1/static/img/users/guest1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js`
Expected: FAIL — module `./buildRiderToast.js` does not exist.

- [ ] **Step 3: Implement**

Create `frontend/src/modules/Fitness/player/overlays/buildRiderToast.js`:

```javascript
/**
 * Map a rider_select event to a FitnessToast payload. Pure — name resolution is
 * injected so this stays testable and decoupled from FitnessContext internals.
 *
 * @param {Object} data - { userId, equipmentId }
 * @param {Object} resolvers
 * @param {(userId:string)=>string} resolvers.resolveUserName
 * @param {(equipmentId:string)=>string} resolvers.resolveEquipmentName
 * @returns {{ avatarUrl: string, title: string, subtitle: string, variant: string }}
 */
export function buildRiderToast(data, { resolveUserName, resolveEquipmentName } = {}) {
  const userId = data?.userId;
  const equipmentId = data?.equipmentId;
  const name = (typeof resolveUserName === 'function' && resolveUserName(userId)) || userId;
  const equipmentName = (typeof resolveEquipmentName === 'function' && resolveEquipmentName(equipmentId)) || equipmentId;
  return {
    avatarUrl: `/api/v1/static/img/users/${userId}`,
    title: name,
    subtitle: `is riding the ${equipmentName}`,
    variant: 'success',
  };
}

export default buildRiderToast;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/buildRiderToast.js frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js
git commit -m "feat(fitness): buildRiderToast maps rider_select to a toast payload"
```

---

### Task 3: `FitnessToast.jsx` component + styles

**Files:**
- Create: `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx`
- Create: `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss`
- Test: `frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`

- [ ] **Step 1: Write the failing test**

```javascript
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import FitnessToast, { TOAST_EXIT_MS } from './FitnessToast.jsx';

describe('FitnessToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing when there is no toast', () => {
    const { container } = render(<FitnessToast toast={null} onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the title and subtitle', () => {
    render(<FitnessToast toast={{ id: 1, title: 'User_2', subtitle: 'is riding the NiceDay', durationMs: 4000 }} onDone={() => {}} />);
    expect(screen.getByText('User_2')).toBeTruthy();
    expect(screen.getByText('is riding the NiceDay')).toBeTruthy();
  });

  it('calls onDone with the toast id after durationMs + exit', () => {
    const onDone = vi.fn();
    render(<FitnessToast toast={{ id: 1, title: 'User_2', durationMs: 4000 }} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(1);
  });

  it('resets the timer when a new toast id arrives and fires onDone once for the new id', () => {
    const onDone = vi.fn();
    const { rerender } = render(<FitnessToast toast={{ id: 1, title: 'A', durationMs: 4000 }} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(2000); }); // partway through toast 1
    rerender(<FitnessToast toast={{ id: 2, title: 'B', durationMs: 4000 }} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(4000 + TOAST_EXIT_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`
Expected: FAIL — module `./FitnessToast.jsx` does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx`:

```javascript
import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DEFAULT_TOAST_DURATION_MS } from './fitnessToastSlot.js';
import './FitnessToast.scss';

// Fade + collapse exit duration. Keep in sync with FitnessToast.scss transition.
export const TOAST_EXIT_MS = 320;

/**
 * Ephemeral, centered, self-dismissing notification for the video view.
 * Single-slot: the parent passes the current toast (or null). A new `toast.id`
 * restarts the countdown + animation; on completion the toast fades/collapses
 * and calls onDone(id). Non-blocking — never pauses video or gates governance.
 */
export default function FitnessToast({ toast, onDone }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-toast' }), []);
  const [exiting, setExiting] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const id = toast?.id ?? null;

  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    setImgFailed(false);
    const durationMs = Number.isFinite(toast?.durationMs) ? toast.durationMs : DEFAULT_TOAST_DURATION_MS;
    logger.info('fitness.toast.shown', { id, variant: toast?.variant, durationMs });
    const hideTimer = setTimeout(() => setExiting(true), durationMs);
    const doneTimer = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id });
      if (typeof onDone === 'function') onDone(id);
    }, durationMs + TOAST_EXIT_MS);
    return () => { clearTimeout(hideTimer); clearTimeout(doneTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!toast) return null;

  const { avatarUrl, icon, title, subtitle, variant = 'info', durationMs = DEFAULT_TOAST_DURATION_MS } = toast;
  const className = [
    'fitness-toast',
    `fitness-toast--${variant}`,
    exiting ? 'fitness-toast--exiting' : 'fitness-toast--entered',
  ].join(' ');

  return (
    <div className={className} role="status" aria-live="polite">
      <div className="fitness-toast__body">
        {avatarUrl && !imgFailed ? (
          <img
            className="fitness-toast__avatar"
            src={avatarUrl}
            alt=""
            onError={() => setImgFailed(true)}
          />
        ) : icon ? (
          <div className="fitness-toast__icon">{icon}</div>
        ) : null}
        <div className="fitness-toast__text">
          <div className="fitness-toast__title">{title}</div>
          {subtitle ? <div className="fitness-toast__subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="fitness-toast__countdown">
        {/* key={id} restarts the CSS countdown animation on each new toast */}
        <div
          key={id}
          className="fitness-toast__countdown-bar"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  );
}

FitnessToast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.number,
    avatarUrl: PropTypes.string,
    icon: PropTypes.node,
    title: PropTypes.node,
    subtitle: PropTypes.node,
    variant: PropTypes.string,
    durationMs: PropTypes.number,
  }),
  onDone: PropTypes.func,
};
```

- [ ] **Step 4: Implement the styles**

Create `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss`:

```scss
.fitness-toast {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(1);
  z-index: 2200; // above challenge deck / governance overlays
  pointer-events: none; // non-blocking
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 280px;
  max-width: 70%;
  padding: 18px 24px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.08);
  opacity: 1;
  overflow: hidden;
  // 320ms here must stay in sync with TOAST_EXIT_MS in FitnessToast.jsx
  transition: opacity 320ms ease, transform 320ms ease, max-height 320ms ease, padding 320ms ease;
  max-height: 240px;

  &--entered { opacity: 1; transform: translate(-50%, -50%) scale(1); }

  // fade + collapse
  &--exiting {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.92);
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
  }

  &--success { border-left: 4px solid #22c55e; }
  &--info { border-left: 4px solid #38bdf8; }

  &__body { display: flex; align-items: center; gap: 16px; }

  &__avatar {
    width: 56px; height: 56px; border-radius: 50%; object-fit: cover;
    background: rgba(255, 255, 255, 0.06);
    flex: 0 0 auto;
  }
  &__icon { font-size: 40px; line-height: 1; flex: 0 0 auto; }

  &__text { display: flex; flex-direction: column; gap: 2px; }
  &__title { font-size: 1.5rem; font-weight: 700; }
  &__subtitle { font-size: 1.05rem; opacity: 0.85; }

  &__countdown {
    height: 4px; border-radius: 2px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  &__countdown-bar {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: currentColor;
    opacity: 0.6;
    animation-name: fitness-toast-countdown;
    animation-timing-function: linear;
    animation-fill-mode: forwards;
  }
}

@keyframes fitness-toast-countdown {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx`
Expected: PASS (4 tests). If `@testing-library/react` does not export `act`, import `act` from `react-dom/test-utils` instead and report the deviation.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/player/overlays/FitnessToast.jsx frontend/src/modules/Fitness/player/overlays/FitnessToast.scss frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx
git commit -m "feat(fitness): FitnessToast centered self-dismissing notification component"
```

---

### Task 4: Wire toast state + rider trigger into `FitnessContext`

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

No isolated unit test (the provider is too heavy to mount in isolation); the slot logic and mapper are covered by Tasks 1–2. Verify by reading the diff and by running the full fitness test sweep in Task-5's final step. Each edit below cites an anchor — READ around it first to confirm the surrounding code.

- [ ] **Step 1: Add imports**

Near the top of `frontend/src/context/FitnessContext.jsx`, with the other imports, add:

```javascript
import { normalizeToast, dismissMatches } from '../modules/Fitness/player/overlays/fitnessToastSlot.js';
import { buildRiderToast } from '../modules/Fitness/player/overlays/buildRiderToast.js';
```

(Verify the relative path resolves from `frontend/src/context/` to `frontend/src/modules/...` — it is `../modules/...`.)

- [ ] **Step 2: Add toast state + refs**

Next to `const [voiceMemoOverlayState, setVoiceMemoOverlayState] = useState(VOICE_MEMO_OVERLAY_INITIAL);` (~line 135), add:

```javascript
  const [fitnessToast, setFitnessToast] = useState(null);
  const toastIdRef = useRef(0);
  const riderToastRef = useRef(null);
```

(`useRef` is already imported in this file — confirm; it is used widely.)

- [ ] **Step 3: Add push/dismiss callbacks BEFORE the WS effect**

Place these near the other early `useCallback`s, anywhere comfortably ABOVE the WebSocket `useEffect` (the one whose first subscribe arg is `['fitness', 'vibration', 'rider_select']`, ~line 1216) so `pushFitnessToast` is in scope for that effect and dep-safe:

```javascript
  const pushFitnessToast = useCallback((toast) => {
    toastIdRef.current += 1;
    setFitnessToast(normalizeToast(toast, toastIdRef.current));
  }, []);

  const dismissFitnessToast = useCallback((id) => {
    setFitnessToast((prev) => (dismissMatches(prev, id) ? null : prev));
  }, []);
```

(`useCallback` is already imported — confirm.)

- [ ] **Step 4: Populate the rider→toast handler ref AFTER `getDisplayName`**

`getDisplayName` is defined with `useCallback` around line 1758. IMMEDIATELY AFTER its definition, add an effect that keeps `riderToastRef` current. This avoids a temporal-dead-zone (never reference `getDisplayName` in the WS effect's dep array) and avoids stale closures:

```javascript
  // Keep a current rider→toast handler so the WS dispatch can fire a toast
  // without putting getDisplayName (declared below the WS effect) in its deps.
  useEffect(() => {
    riderToastRef.current = (data) => {
      pushFitnessToast(buildRiderToast(data, {
        resolveUserName: (uid) => getDisplayName(uid)?.displayName || uid,
        resolveEquipmentName: (eid) =>
          (Array.isArray(equipmentConfig) ? equipmentConfig : []).find((e) => e?.id === eid)?.name || eid,
      }));
    };
  }, [getDisplayName, equipmentConfig, pushFitnessToast]);
```

(Confirm `equipmentConfig` is in provider scope here — it is, declared well above ~line 494 and exposed in the value object. If its identifier differs, adapt and report.)

- [ ] **Step 5: Fire the toast from the `rider_select` WS dispatch (fall-through)**

In the WS subscribe callback (~line 1216), find the line `session.ingestData(data);` near the end of the callback. IMMEDIATELY BEFORE it, add:

```javascript
          // Cosmetic rider-assignment toast (additive — must NOT return; the
          // claim is still set by ingestData below).
          if (data?.topic === 'rider_select') {
            riderToastRef.current?.(data);
          }

```

Do NOT add a `return` and do NOT modify the WS effect's dependency array (`[batchedForceUpdate, handleVibrationEvent]`). The `riderToastRef` is read (not closed-over), so no dep change is needed.

- [ ] **Step 6: Expose the toast API in the context value**

In the context value object (the big returned object; `voiceMemoOverlayState,` appears in it ~line 2232), add three properties alongside it:

```javascript
    fitnessToast,
    pushFitnessToast,
    dismissFitnessToast,
```

- [ ] **Step 7: Verify it parses + the existing fitness tests still pass**

Run the existing rider + context-adjacent tests to ensure no regressions (the toast wiring is additive):

```bash
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs \
  frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js \
  frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js \
  frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js \
  frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx
```
Expected: all PASS. Also re-read your full diff of `FitnessContext.jsx` to confirm: (a) no `return` was added in the rider_select branch, (b) `getDisplayName` is NOT in the WS effect deps, (c) the three value-object keys are present.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): toast slot state + rider_select toast trigger in FitnessContext"
```

---

### Task 5: Mount `FitnessToast` at the FitnessApp root (view-agnostic)

**Files:**
- Modify: `frontend/src/Apps/FitnessApp.jsx` (the root `GlobalOverlays` component, ~line 1382)
- Modify: `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss` (position: absolute → fixed)

The toast must work in ANY view (menu, screen, player) — even with no video playing — so it mounts in the root `GlobalOverlays` (which already renders `VoiceMemoOverlay` via `useFitnessContext()`), NOT in the playback-only `FitnessPlayerOverlay`. Because it's now at the app root, it uses `position: fixed` so it centers in the viewport regardless of ancestor positioning. No isolated test (mounting needs the full provider); verify by inspection + the feature test sweep.

- [ ] **Step 1: Switch the toast to viewport-fixed positioning**

In `frontend/src/modules/Fitness/player/overlays/FitnessToast.scss`, change the `.fitness-toast` positioning from `absolute` to `fixed` so it centers in the viewport from the root mount:

```scss
.fitness-toast {
  position: fixed;
  top: 50%;
  left: 50%;
```

(Leave the `transform: translate(-50%, -50%) ...`, z-index, and everything else unchanged.)

- [ ] **Step 2: Import the component in FitnessApp**

With the other imports at the top of `frontend/src/Apps/FitnessApp.jsx` (near `import VoiceMemoOverlay from '../modules/Fitness/player/overlays/VoiceMemoOverlay.jsx';`), add:

```javascript
import FitnessToast from '../modules/Fitness/player/overlays/FitnessToast.jsx';
```

- [ ] **Step 3: Render the toast inside `GlobalOverlays`**

`GlobalOverlays` (~line 1382) currently returns a single `<VoiceMemoOverlay .../>`. Wrap its return in a fragment and add the toast so both render at the root. Replace:

```javascript
  return (
    <VoiceMemoOverlay
      overlayState={fitnessCtx.voiceMemoOverlayState}
      voiceMemos={fitnessCtx.voiceMemos}
      onClose={fitnessCtx.closeVoiceMemoOverlay}
      onOpenReview={fitnessCtx.openVoiceMemoReview}
      onOpenList={fitnessCtx.openVoiceMemoList}
      onOpenRedo={fitnessCtx.openVoiceMemoCapture}
      onRemoveMemo={fitnessCtx.removeVoiceMemoFromSession}
      onAddMemo={fitnessCtx.addVoiceMemoToSession}
      onReplaceMemo={fitnessCtx.replaceVoiceMemoInSession}
      sessionId={fitnessCtx.fitnessSession?.sessionId || fitnessCtx.fitnessSessionInstance?.sessionId}
      playerRef={fitnessCtx.videoPlayerRef}
      preferredMicrophoneId={fitnessCtx.preferredMicrophoneId}
    />
  );
```

with:

```javascript
  return (
    <>
      <VoiceMemoOverlay
        overlayState={fitnessCtx.voiceMemoOverlayState}
        voiceMemos={fitnessCtx.voiceMemos}
        onClose={fitnessCtx.closeVoiceMemoOverlay}
        onOpenReview={fitnessCtx.openVoiceMemoReview}
        onOpenList={fitnessCtx.openVoiceMemoList}
        onOpenRedo={fitnessCtx.openVoiceMemoCapture}
        onRemoveMemo={fitnessCtx.removeVoiceMemoFromSession}
        onAddMemo={fitnessCtx.addVoiceMemoToSession}
        onReplaceMemo={fitnessCtx.replaceVoiceMemoInSession}
        sessionId={fitnessCtx.fitnessSession?.sessionId || fitnessCtx.fitnessSessionInstance?.sessionId}
        playerRef={fitnessCtx.videoPlayerRef}
        preferredMicrophoneId={fitnessCtx.preferredMicrophoneId}
      />
      <FitnessToast toast={fitnessCtx.fitnessToast} onDone={fitnessCtx.dismissFitnessToast} />
    </>
  );
```

(`GlobalOverlays` already guards `if (!fitnessCtx) return null;` above this, so `fitnessCtx` is non-null here. `FitnessToast` self-gates on a null `toast`.)

- [ ] **Step 4: Verify the whole feature set passes**

```bash
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs \
  frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js \
  frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js \
  frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx \
  frontend/src/hooks/fitness/DeviceEventRouter.riderSelect.test.js
```
Expected: all PASS. Re-read the `FitnessApp.jsx` diff to confirm the fragment wrap is correct and `FitnessToast` is rendered with the context's `fitnessToast`/`dismissFitnessToast`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/FitnessApp.jsx frontend/src/modules/Fitness/player/overlays/FitnessToast.scss
git commit -m "feat(fitness): mount FitnessToast at the FitnessApp root (works without video)"
```

---

## Final verification

- [ ] **Run the full toast test set together:**

```bash
cd "$WT" && "$VITEST" run --config /opt/Code/DaylightStation/vitest.config.mjs \
  frontend/src/modules/Fitness/player/overlays/fitnessToastSlot.test.js \
  frontend/src/modules/Fitness/player/overlays/buildRiderToast.test.js \
  frontend/src/modules/Fitness/player/overlays/FitnessToast.test.jsx
```
Expected: all PASS.

- [ ] **Manual E2E (after merge + deploy):** with a fitness session open and the NiceDay bike present, publish a selector press
  (`sudo docker exec daylight-station node -e "const m=require('mqtt');const c=m.connect('mqtt://mosquitto:1883');c.on('connect',()=>{c.publish('zigbee2mqtt-usb/Garage Cycling Selector',JSON.stringify({action:'1_single'}),()=>{c.end();process.exit(0);});});"`)
  and confirm a centered toast ("User_2 is riding the NiceDay") appears, the countdown bar depletes, and it fades/collapses after ~4s. Frontend logs show `fitness.toast.shown` / `fitness.toast.dismissed`.
