# Fitness Emergency-Lockdown Fail-Safe Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop a routine admin fingerprint scan (e.g. an arcade game-unlock) from being misread as a parent emergency shutdown — both by preventing the ceremony from ever committing accidentally, and by preventing it from even *appearing* when a scan is really leftover from an unlock modal.

**Architecture:** Two layers of defense in the Fitness kiosk's emergency-lockdown state machine.
1. **Fail-safe ceremony (DONE, needs commit):** the ceremony's idle-window elapse now *cancels to normal* instead of auto-committing; locking requires a deliberate 3s press-and-hold. Because `triggerCeremony()` is local-only frontend state (nothing is committed server-side until `commit()` POSTs `/emergency/commit`), backing out is a bare local transition.
2. **Entry-point cooldown guard (NEW):** the ceremony is not even *opened* by an admin scan that lands within a short cooldown of an unlock/identify modal being active — that scan is leftover context, not an emergency gesture.

**Tech Stack:** React (JSX) + Vitest/@testing-library. Frontend at `frontend/src/modules/Fitness/`. Backend emergency endpoints in `backend/src/4_api/v1/routers/fitness.mjs` (unchanged by this plan). Prod is built from `homeserver.local:/opt/Code/DaylightStation`.

**Incident reference:** 2026-07-11 17:52 — KC's right-thumb game-unlock scan opened the ceremony (no unlock modal was the active lock at that instant) and auto-committed after 10s → 30-min LOCKED + HA `script.garage_deactivate`. See memory `reference_fitness_emergency_lockdown_failsafe`.

---

## Root cause (for context)

`frontend/src/modules/Fitness/identity/IdentityProvider.jsx`, `handleIdentity` branch (2): when no unlock modal is the active lock (`activeLockRef.current` is null), ANY `msg.authz.admin` detection in `PHASE_NORMAL` fired `triggerCeremony()`. There is no distinct emergency gesture, and (pre-fix) the ceremony auto-committed on the ~10s idle-window elapse. A game-unlock scan arriving a beat after its modal closed fell straight through to the emergency ceremony.

---

## Task 1: Fail-safe ceremony — VERIFY & COMMIT (already implemented)

**Status:** Implemented in the working tree, all tests green. This task verifies and commits it before layering Task 2 on top.

**Files (already changed):**
- Modify: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js` — added local-only `dismissCeremony()` (TRIGGERING→NORMAL, no HTTP); exported it.
- Modify: `frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx` — 2 tests for `dismissCeremony()`.
- Modify: `frontend/src/modules/Fitness/identity/IdentityProvider.jsx` — pass `dismissCeremony` through context value.
- Modify: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx` — `TriggeringScreen` rewritten: idle window elapse → `dismissCeremony()`; commit requires a `HOLD_MS`=3000 press-and-hold on `.emergency-confirm`; dropped auto powerdown SFX.
- Modify: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.scss` — `.emergency-confirm` hold button (replaces dead `.emergency-progress`).
- Modify: `frontend/src/Apps/FitnessApp.jsx` — removed now-dead `emergencyAudioPath` memo + prop.
- Create: `frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.failsafe.test.jsx` — 3 behavioral tests (timeout→no commit, hold→commit, early release→no commit).

**Step 1: Run the full emergency test set, confirm green**

Run:
```bash
npx vitest run \
  frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx \
  frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.failsafe.test.jsx \
  frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.smoke.test.jsx \
  frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx \
  backend/src/4_api/v1/routers/fitness.emergency.test.mjs
```
Expected: `Test Files 5 passed`, `Tests 49 passed`.

**Step 2: Commit the fail-safe layer**

```bash
git add frontend/src/modules/Fitness/hooks/useEmergencyLockdown.js \
        frontend/src/modules/Fitness/hooks/useEmergencyLockdown.test.jsx \
        frontend/src/modules/Fitness/identity/IdentityProvider.jsx \
        frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.jsx \
        frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.scss \
        frontend/src/modules/Fitness/player/overlays/EmergencyLockdownOverlay.failsafe.test.jsx \
        frontend/src/Apps/FitnessApp.jsx
git commit -m "fix(fitness): fail-safe emergency ceremony — hold-to-confirm, idle window cancels

An idle admin scan opened a DEFCON ceremony that auto-committed a 30-min
lockdown (+ HA garage_deactivate) after 10s. Invert to fail-safe: the idle
window now cancels to normal; locking requires a deliberate 3s press-and-hold.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Entry-point cooldown guard (NEW)

**Why:** Task 1 makes an accidental *lock* impossible, but the alarming "HOLD TO SHUT DOWN" overlay still flashes over the kids' game every time an admin scan lands just as a game-unlock modal closes. This guard stops the ceremony from opening at all when a scan is leftover unlock context.

**Approach:** In `IdentityProvider`, stamp a `lastUnlockActivityRef` timestamp whenever an unlock/identify modal is registered, cleared, or handled while active. In `handleIdentity` branch (2), skip `triggerCeremony()` (only the `PHASE_NORMAL` open) if that stamp is within `UNLOCK_COOLDOWN_MS`. A truly cold idle admin scan still opens the (now harmless, fail-safe) ceremony.

**Files:**
- Modify: `frontend/src/modules/Fitness/identity/IdentityProvider.jsx`
- Test: `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`

**Step 1: Read the existing test harness**

Read `frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx` (top ~55 lines). Note: it mocks `useEmergencyLockdown` with a shared `emergency` object exposing `triggerCeremony: vi.fn()`, pushes synthetic events via `emit({...})`, and `beforeEach` resets `emergency.phase='normal'` + `vi.clearAllMocks()`. The `Probe` component captures the identity API via `onReady`.

**Step 2: Add `dismissCeremony` to the emergency mock**

In `IdentityProvider.test.jsx`, add `dismissCeremony: vi.fn()` to the `emergency` mock object (line ~7) so the provider's context value is complete:

```js
const emergency = {
  phase: 'normal', lockedUntil: null, lockedBy: null,
  commit: vi.fn(), abort: vi.fn(), release: vi.fn(),
  triggerCeremony: vi.fn(), dismissCeremony: vi.fn(),
};
```

**Step 3: Write the failing test**

Add to `IdentityProvider.test.jsx`:

```js
test('admin scan within the unlock cooldown does NOT open the emergency ceremony', () => {
  let api;
  render(<IdentityProvider><Probe onReady={(x) => { api = x; }} /></IdentityProvider>);

  // A game-unlock modal opens and then closes (granted → consumer clears it).
  act(() => { api.registerAdmin('emulator'); });
  act(() => { api.clearUnlock(); });

  // A leftover/duplicate admin finger read lands immediately after — this is the
  // incident vector. It must be treated as unlock leftover, not an emergency.
  emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });

  expect(emergency.triggerCeremony).not.toHaveBeenCalled();
});
```

**Step 4: Run the test, verify it FAILS**

Run: `npx vitest run frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx -t "within the unlock cooldown"`
Expected: FAIL — `triggerCeremony` was called once (the guard doesn't exist yet).

**Step 5: Implement the cooldown guard**

In `frontend/src/modules/Fitness/identity/IdentityProvider.jsx`:

(a) Add a module constant near the top (after the imports/logger):
```js
// A scan that lands within this window of an unlock/identify modal being active
// is leftover unlock context, NOT the emergency gesture — don't open the ceremony.
const UNLOCK_COOLDOWN_MS = 4000;
```

(b) Add a ref alongside the other refs (near `activeLockRef`):
```js
const lastUnlockActivityRef = useRef(0);
```

(c) In `handleIdentity`, when a modal is active (`if (lock) { ... }` branch), stamp activity at the top of that branch so a following stray read is inside the cooldown:
```js
if (lock) {
  lastUnlockActivityRef.current = Date.now();
  // ...existing branch (1) body...
}
```

(d) In branch (2), guard the `PHASE_NORMAL` open only (leave TRIGGERING/LOCKED unchanged):
```js
if (phase === PHASE_NORMAL) {
  if (Date.now() - lastUnlockActivityRef.current < UNLOCK_COOLDOWN_MS) {
    logger().info('emergency-ceremony-suppressed', { userId: msg.userId ?? null, reason: 'unlock-cooldown' });
    return;
  }
  logger().info('emergency-ceremony-start', { userId: msg.userId ?? null });
  emergencyRef.current?.triggerCeremony?.();
} else if (phase === PHASE_TRIGGERING) {
  // ...unchanged...
```

(e) Stamp in `registerUnlock` (after `activeLockRef.current = lock;`) and in `clearUnlock` (at the top):
```js
lastUnlockActivityRef.current = Date.now();
```

**Step 6: Run the test, verify it PASSES**

Run: `npx vitest run frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx -t "within the unlock cooldown"`
Expected: PASS.

**Step 7: Write the complementary test — a cold idle scan STILL opens the ceremony**

Add:
```js
test('a cold admin scan (no recent unlock activity) still opens the ceremony', () => {
  vi.useFakeTimers();
  try {
    render(<IdentityProvider><Probe onReady={() => {}} /></IdentityProvider>);
    // Advance well past the cooldown from the initial lastUnlockActivityRef (0).
    vi.advanceTimersByTime(UNLOCK_COOLDOWN_MS + 1000);
    emit({ matched: true, userId: 'kc', finger: 'right-thumb', authz: { admin: true, locks: ['emergency'] } });
    expect(emergency.triggerCeremony).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
```
Note: `UNLOCK_COOLDOWN_MS` must be importable or re-declared in the test — if it is not exported from the module, hardcode `5000` in the `advanceTimersByTime` call instead and drop the `+ 1000`. Prefer exporting the constant from `IdentityProvider.jsx` (`export const UNLOCK_COOLDOWN_MS = 4000;`) and importing it in the test.

Since `lastUnlockActivityRef` starts at `0` and the test's "now" is far past it, the guard passes and the ceremony opens. Verify the existing test `'no modal + emergency-authorized → starts ceremony'` still passes (it emits with no prior unlock activity and real timers — `Date.now() - 0` is enormous, so it is not suppressed).

**Step 8: Run the whole IdentityProvider suite**

Run: `npx vitest run frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx`
Expected: all pass (existing 9 + 2 new).

**Step 9: Commit**

```bash
git add frontend/src/modules/Fitness/identity/IdentityProvider.jsx \
        frontend/src/modules/Fitness/identity/IdentityProvider.test.jsx
git commit -m "fix(fitness): suppress emergency ceremony for scans within unlock cooldown

A game-unlock/identify scan landing just after its modal closed no longer
opens the shutdown ceremony over the game. A cold idle admin scan still does
(and is harmless under the fail-safe hold-to-confirm).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: End-to-end coverage of the emergency flow (recommended)

**Why:** The unit tests cover logic; a flow test covers the real overlay mounting under the fitness app. Optional if time-boxed, but valuable for a safety feature.

**Files:**
- Create: `tests/live/flow/fitness/emergency-lockdown.runtime.test.mjs`

**Step 1: Write a Playwright flow test using the URL seam**

The overlay honors `?emergency=triggering` (see `useEmergencyLockdown.js` `readUrlSeam`). Drive:
```js
// Pseudocode — match the harness style of the sibling files in tests/live/flow/fitness/.
import { test, expect } from '@playwright/test';
import { getAppBaseUrl } from '../../../_lib/configHelper.mjs'; // confirm exact helper name

test('triggering ceremony auto-cancels when left alone (fail-safe)', async ({ page }) => {
  await page.goto(`${await getAppBaseUrl()}/fitness?emergency=triggering`);
  await expect(page.locator('.emergency-overlay--triggering')).toBeVisible();
  // Wait past CEREMONY_WINDOW_MS (10s) with no interaction.
  await expect(page.locator('.emergency-overlay--triggering')).toBeHidden({ timeout: 15000 });
  // No lock screen appeared.
  await expect(page.locator('.emergency-overlay--locked')).toHaveCount(0);
});
```

**Step 2: Read a sibling test first**

Read one existing file under `tests/live/flow/fitness/` (e.g. `fitness-happy-path.runtime.test.mjs`) to match its import paths, base-URL helper, and dev-server assumptions. Do NOT hardcode ports — use the configHelper SSOT (`docs/ai-context/testing.md`).

**Step 3: Run it**

Run: `npx playwright test tests/live/flow/fitness/emergency-lockdown.runtime.test.mjs --reporter=line`
Expected: PASS (dev server auto-started by `playwright.config.mjs`).

**Step 4: Commit**

```bash
git add tests/live/flow/fitness/emergency-lockdown.runtime.test.mjs
git commit -m "test(fitness): e2e — emergency ceremony auto-cancels when left alone

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Verify end-to-end and deploy

**Step 1: Full frontend Fitness sweep**

Run: `npx vitest run frontend/src/modules/Fitness/identity frontend/src/modules/Fitness/hooks frontend/src/modules/Fitness/player/overlays`
Expected: all pass (the `realtime-bpm-analyzer` sourcemap warning is benign — see memory `reference_fitness_chart_viz_verify`).

**Step 2: Visual check the new triggering UI**

Start the dev server (check it isn't already running: `lsof -i :3111`), open `http://localhost:<appPort>/fitness?emergency=triggering`, confirm the "HOLD TO SHUT DOWN" screen renders with the `.emergency-confirm` hold button and a Cancel affordance; hold the button ~3s and confirm it advances to LOCKED. Use a vision agent / screenshot to verify rather than asking KC to look (memory `feedback_dont_ask_check_yourself`).

**Step 3: Sync with the deployed source BEFORE deploying**

Per `CLAUDE.local.md` / memory `feedback_pull_from_deployed_source_first`, local `main` is often behind the homeserver deploy tree:
```bash
git fetch origin && git log --oneline origin/main..HEAD
ssh homeserver.local 'cd /opt/Code/DaylightStation && git branch --show-current && git log --oneline origin/main..HEAD | head'
```
If the homeserver is ahead, integrate its branch before pushing so there is one source of truth.

**Step 4: Deploy (requires KC authorization)**

Do NOT auto-deploy. Present the commits and let KC run the deploy (prod is built from `homeserver.local:/opt/Code/DaylightStation`). After deploy, live-verify on the garage Firefox kiosk that a game-unlock scan no longer flashes the ceremony, and that a cold admin scan opens a harmless hold-to-confirm.

**Step 5: Update the memory**

Update `reference_fitness_emergency_lockdown_failsafe` to record Task 2 (cooldown guard) and mark committed/deployed status.

---

## Notes / decisions

- **Powerdown SFX dropped on trigger.** It announced a shutdown that had not been confirmed. If KC wants the drama, re-add it on *commit* (in `TriggeringScreen`'s hold-complete branch), not on trigger — a separate, optional follow-up.
- **`UNLOCK_COOLDOWN_MS` = 4000** is a first guess. A deliberate emergency trigger within 4s of using a game unlock is delayed, which is acceptable for a rare action; tune if it ever feels sluggish.
- **Backend unchanged.** The HA `script.garage_deactivate` already fires only *after* `commit` (log: 17:52:10, post-commit at 17:52:05), so the fail-safe (no accidental commit) already prevents the accidental garage kill. No backend change needed.
- **DRY/YAGNI:** did not add a dedicated on-screen "arm emergency" affordance (the third option KC declined) — fail-safe + cooldown covers the incident without new chrome.
