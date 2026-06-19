# Governance Overlay Bypass Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `GovernanceStateOverlay` lock panel disappear when a governed episode is bypassed (via fingerprint unlock, `?nogovern`, or per-item `nogovern`), so a successful in-player unlock actually clears the lock screen.

**Architecture:** `FitnessPlayer` already computes a bypass-aware `effectiveGovernanceState` (it flips `isGoverned/videoLocked/status` to the unlocked shape when any bypass is active), but it renders the lock UI through a *sibling* component, `FitnessPlayerOverlay`, which reads the **raw** `governanceState` straight from `FitnessContext` and never sees the bypass. We thread the bypass-aware state down as an optional `governanceStateOverride` prop: when provided, the overlay uses it; when omitted, the overlay falls back to context exactly as today. This is a contained, fully testable fix that closes all three bypass paths for the overlay without touching the engine.

**Tech Stack:** React 18, PropTypes, Vitest 4.x (`vitest.config.mjs`), `@testing-library/react`, jsdom (`tests/_infrastructure/frontend-env.mjs`), `vi.mock` for context/audio isolation.

---

## Background / Root Cause (read before starting)

Full bug report: `docs/_wip/bugs/2026-06-18-governance-overlay-persists-after-fingerprint-unlock.md`.

Two facts that drive every task below:

1. **Where the overlay decides to show** — `FitnessPlayerOverlay.jsx`:
   - Line 66: `const governanceState = fitnessCtx?.governanceState || null;` (raw context SSoT)
   - Line 71: `const governanceDisplay = useGovernanceDisplay(governanceState, ...)`
   - Line 79: `const lockScreen = resolveLockScreen({ activeChallenge, governanceDisplay });`
   - Lines 229–235: renders `<GovernanceStateOverlay … />` iff `lockScreen.showGovernanceOverlay`.
2. **Where the bypass lives but never reaches the overlay** — `FitnessPlayer.jsx`:
   - Lines 298–308: `effectiveGovernanceState` = bypass-aware state (`isGoverned:false, status:'unlocked', videoLocked:false, challenge:null, …`) when `governanceBypassed` is true.
   - Lines 1815–1819: renders `<FitnessPlayerOverlay playerRef … onGovernanceUnlock … />` — **does not pass `effectiveGovernanceState`.**

The visibility chain that makes the fix work (verified in `useGovernanceDisplay.js` + `resolveLockScreen.js`):
- `resolveGovernanceDisplay()` returns `null` immediately when `!govState?.isGoverned` (line 14). The bypass state sets `isGoverned:false`, so the display becomes `null`.
- `resolveLockScreen()` only sets `showGovernanceOverlay:true` when `governanceDisplay?.show` is truthy. `null` display ⇒ overlay suppressed.
- Conversely a real locked snapshot (`isGoverned:true, status:'locked'`) yields `show:true` (since `show = rows.length > 0 || status === 'locked' || status === 'pending'`), so the overlay renders. This gives us a clean positive/negative test pair.

**Out of scope (deferred follow-up):** moving the bypass into the `GovernanceEngine` as the true SSoT (the bug report's "Option A"). That is a larger refactor; this plan implements the contained prop-threading fix ("Option B") and records the engine refactor as a documented follow-up.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx` | Renders all in-player overlays incl. the governance lock panel | **Modify** — accept optional `governanceStateOverride` prop; prefer it over context; add PropType |
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx` | Owns playback + computes `effectiveGovernanceState` | **Modify** — pass `governanceStateOverride={effectiveGovernanceState}` to the overlay |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx` | Proves override hides the lock panel; guards the context-fallback path | **Create** |
| `docs/reference/fitness/governance-engine.md` | Reference doc describing governance state flow | **Modify** — correct the stale "throughout the component" claim |

---

## Task 1: Failing test — override hides the lock panel, context fallback still shows it

**Files:**
- Test: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Isolation mocks -------------------------------------------------------
// Audio host plays cue files on mount; stub it (mirrors GovernanceStateOverlay.unlock.test.jsx).
vi.mock('./overlays/GovernanceAudioPlayer.jsx', () => ({ __esModule: true, default: () => null }));
// Render profiler is a dev-only no-op hook; stub so it never touches perf APIs.
vi.mock('@/hooks/fitness/useRenderProfiler.js', () => ({ __esModule: true, useRenderProfiler: () => {} }));
vi.mock('@/lib/api.mjs', () => ({
  __esModule: true,
  DaylightMediaPath: (p) => p,
  DaylightAPI: vi.fn().mockResolvedValue({})
}));

// Controllable context: the test sets `mockGovernanceState` before each render.
let mockGovernanceState = null;
vi.mock('@/context/FitnessContext.jsx', () => ({
  __esModule: true,
  useFitnessContext: () => ({
    governanceState: mockGovernanceState,
    voiceMemoOverlayState: { open: false },
    fitnessSessionInstance: null,
    participantDisplayMap: new Map(),
    zoneMetadata: {},
    activeHeartRateParticipants: [],
    zones: [],
    overlayApp: null,
    closeApp: () => {},
    getDisplayName: (uid) => ({ displayName: uid }),
    pauseMusicPlayer: () => {}
  })
}));

import FitnessPlayerOverlay from './FitnessPlayerOverlay.jsx';

// A real "locked + governed" engine snapshot: useGovernanceDisplay returns show:true for this.
const LOCKED_STATE = {
  isGoverned: true,
  status: 'locked',
  videoLocked: true,
  challenge: null,
  deadline: null,
  requirements: [],
  activeUserCount: 2
};

// The bypass-aware snapshot FitnessPlayer builds when a bypass is active:
// isGoverned:false short-circuits useGovernanceDisplay to null ⇒ overlay suppressed.
const BYPASSED_STATE = {
  isGoverned: false,
  status: 'unlocked',
  videoLocked: false,
  challenge: null,
  deadline: null,
  audioDuck: null
};

function renderOverlay(props) {
  return render(
    <MemoryRouter>
      <FitnessPlayerOverlay playerRef={{ current: null }} showFullscreenVitals={false} {...props} />
    </MemoryRouter>
  );
}

describe('FitnessPlayerOverlay governance override', () => {
  afterEach(() => { cleanup(); mockGovernanceState = null; });

  it('shows the governance lock panel from context when no override is given (regression guard)', () => {
    mockGovernanceState = LOCKED_STATE;
    const { container } = renderOverlay({});
    expect(container.querySelector('.governance-overlay')).not.toBeNull();
  });

  it('hides the governance lock panel when the override reports an unlocked/bypassed state', () => {
    mockGovernanceState = LOCKED_STATE; // context still says LOCKED…
    const { container } = renderOverlay({ governanceStateOverride: BYPASSED_STATE }); // …but override wins.
    expect(container.querySelector('.governance-overlay')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx
```
Expected: The **regression-guard** test passes (context path already works), and the **override** test FAILS — `.governance-overlay` is still present because `FitnessPlayerOverlay` currently ignores `governanceStateOverride` and reads raw context (which is `LOCKED_STATE`). Failure message resembles: `expected <div class="governance-overlay …"> to be null`.

> If the audio/profiler stubs are missing a method the component calls, the failure will be an import/runtime error instead — fix the mock, not the component, then re-run until the failure is the assertion above.

---

## Task 2: Implement the `governanceStateOverride` prop in `FitnessPlayerOverlay`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx:55` (signature), `:66` (state source), `:338-344` (propTypes)

- [ ] **Step 1: Add the prop to the component signature**

Change the signature (line 55) from:

```jsx
const FitnessPlayerOverlay = ({ playerRef, showFullscreenVitals, onGovernanceUnlock = null }) => {
```

to:

```jsx
const FitnessPlayerOverlay = ({ playerRef, showFullscreenVitals, onGovernanceUnlock = null, governanceStateOverride = undefined }) => {
```

- [ ] **Step 2: Prefer the override over raw context**

Change the governance-state source (line 66) from:

```jsx
  const governanceState = fitnessCtx?.governanceState || null;
```

to:

```jsx
  // Prefer the caller's bypass-aware state when provided (FitnessPlayer passes its
  // effectiveGovernanceState so fingerprint/?nogovern/per-item bypasses actually
  // clear the lock panel). `undefined` means "no override" → fall back to the raw
  // context SSoT. A deliberate `null` override is honored (treated as "no state").
  const governanceState = governanceStateOverride !== undefined
    ? governanceStateOverride
    : (fitnessCtx?.governanceState || null);
```

- [ ] **Step 3: Document the prop in propTypes**

Change the propTypes block (lines 338–344) from:

```jsx
FitnessPlayerOverlay.propTypes = {
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  showFullscreenVitals: PropTypes.bool,
  onGovernanceUnlock: PropTypes.func
};
```

to:

```jsx
FitnessPlayerOverlay.propTypes = {
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  showFullscreenVitals: PropTypes.bool,
  onGovernanceUnlock: PropTypes.func,
  // Bypass-aware governance snapshot from FitnessPlayer. When defined it is used in
  // place of fitnessCtx.governanceState; when undefined the overlay reads context.
  governanceStateOverride: PropTypes.object
};
```

- [ ] **Step 4: Run the test to verify both cases pass**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx
```
Expected: PASS (2 passed) — the regression guard still shows the panel from context, and the override case now hides it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx \
        frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx
git commit -m "fix(fitness): honor bypass-aware governance state in player overlay

FitnessPlayerOverlay read the raw FitnessContext governanceState, so an
in-player fingerprint unlock (and ?nogovern / per-item nogovern) released
the video but left the lock panel on screen. Add an optional
governanceStateOverride prop the overlay prefers over context."
```

---

## Task 3: Wire `effectiveGovernanceState` into the overlay from `FitnessPlayer`

**Files:**
- Modify: `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1815-1819`

- [ ] **Step 1: Pass the override prop**

Change the render site (lines 1815–1819) from:

```jsx
      <FitnessPlayerOverlay
        playerRef={playerRef}
        showFullscreenVitals={playerMode === 'fullscreen'}
        onGovernanceUnlock={governanceUnlockHandler}
      />
```

to:

```jsx
      <FitnessPlayerOverlay
        playerRef={playerRef}
        showFullscreenVitals={playerMode === 'fullscreen'}
        onGovernanceUnlock={governanceUnlockHandler}
        governanceStateOverride={effectiveGovernanceState}
      />
```

> `effectiveGovernanceState` is already in scope at this point (defined at line 298). When no bypass is active it equals the raw `governanceState`, so non-bypassed behavior is byte-for-byte unchanged.

- [ ] **Step 2: Run the overlay test again (no regression from the wiring)**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx
```
Expected: PASS (2 passed). (This test renders the overlay directly, so it does not exercise FitnessPlayer — it confirms Task 3 introduced no syntax/prop regression in the overlay.)

- [ ] **Step 3: Run the broader fitness overlay suite to confirm nothing else broke**

Run:
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/overlays/
```
Expected: PASS — existing overlay tests (incl. `GovernanceStateOverlay.unlock.test.jsx`, `EmergencyLockdownOverlay.smoke.test.jsx`) are unaffected. A benign sourcemap warning for `realtime-bpm-analyzer` may appear; it is not a failure.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Fitness/player/FitnessPlayer.jsx
git commit -m "fix(fitness): pass effectiveGovernanceState to player overlay

Thread the bypass-aware governance snapshot to FitnessPlayerOverlay so a
successful fingerprint unlock (or ?nogovern / per-item nogovern) hides the
GovernanceStateOverlay lock panel, matching the already-released video."
```

---

## Task 4: Correct the reference doc

**Files:**
- Modify: `docs/reference/fitness/governance-engine.md` (the line claiming `effectiveGovernanceState` is used "throughout the component")

- [ ] **Step 1: Locate the stale claim**

Run:
```bash
grep -n "throughout the component\|effectiveGovernanceState" docs/reference/fitness/governance-engine.md
```
Expected: prints the line (around line 335) asserting `effectiveGovernanceState` is "used in place of the real governanceState throughout the component."

- [ ] **Step 2: Replace the stale sentence**

Open the file, find the sentence identified in Step 1, and replace it so it reflects the actual flow. Use this wording (adapt surrounding markdown to match the existing prose):

```markdown
`FitnessPlayer` derives a bypass-aware `effectiveGovernanceState` (fingerprint
unlock, `?nogovern`, or per-item `nogovern`) and uses it for its own
playback/autoplay gating. It also passes it to `FitnessPlayerOverlay` via the
`governanceStateOverride` prop, which the overlay prefers over the raw
`FitnessContext.governanceState` when deciding whether to show the lock panel.
Note this is a downstream override, not the engine SSoT: the `GovernanceEngine`
itself has no knowledge of these bypasses. Folding the bypass into the engine
state remains a deferred follow-up.
```

- [ ] **Step 3: Verify the doc no longer contains the stale phrasing**

Run:
```bash
grep -n "throughout the component" docs/reference/fitness/governance-engine.md || echo "stale phrasing removed"
```
Expected: prints `stale phrasing removed`.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/fitness/governance-engine.md
git commit -m "docs(fitness): correct governance override flow in engine reference

effectiveGovernanceState is a downstream override consumed by the player and
(now) the overlay via a prop, not the engine SSoT. Note the engine-level
fold-in as a deferred follow-up."
```

---

## Task 5: Move the bug report to closed state

**Files:**
- Modify: `docs/_wip/bugs/2026-06-18-governance-overlay-persists-after-fingerprint-unlock.md`

- [ ] **Step 1: Append a resolution note**

Add a `## Resolution` section to the end of the bug report:

```markdown
## Resolution (2026-06-18)

Fixed via the contained prop-threading approach (Option B):
- `FitnessPlayerOverlay` accepts an optional `governanceStateOverride` prop and
  prefers it over `FitnessContext.governanceState`.
- `FitnessPlayer` passes its bypass-aware `effectiveGovernanceState` as that prop.

This closes all three bypass paths (fingerprint unlock, `?nogovern`, per-item
`nogovern`) for the lock panel. Covered by
`frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx`.

Deferred follow-up (Option A): fold the bypass into `GovernanceEngine` so the
engine state is the single source of truth and no downstream override is needed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-06-18-governance-overlay-persists-after-fingerprint-unlock.md
git commit -m "docs(fitness): record resolution of governance overlay persistence bug"
```

---

## Final Verification

- [ ] **Run the new test + the overlay suite one last time**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Fitness/player/FitnessPlayerOverlay.governanceOverride.test.jsx \
  frontend/src/modules/Fitness/player/overlays/
```
Expected: all PASS.

- [ ] **Confirm the wiring is present**

```bash
grep -n "governanceStateOverride" \
  frontend/src/modules/Fitness/player/FitnessPlayer.jsx \
  frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx
```
Expected: the prop appears in both files (passed in `FitnessPlayer`, consumed + PropType in `FitnessPlayerOverlay`).

---

## Self-Review Notes

- **Spec coverage:** All three bypass paths (`bypassActive`, `nogovernProp`, `itemNogovern`) flow through `effectiveGovernanceState` (FitnessPlayer:298–308), which Task 3 hands to the overlay — so a single prop fixes all three. ✔
- **Type consistency:** Prop name `governanceStateOverride` is identical in the signature (Task 2.1), the consumer (Task 2.2), the propTypes (Task 2.3), and the render site (Task 3.1). ✔
- **No placeholders:** every code/test step shows complete content; commands include expected output. ✔
- **Deferred scope is explicit:** the engine-level SSoT refactor (Option A) is recorded in both the reference doc (Task 4) and the bug report (Task 5), not silently dropped. ✔
