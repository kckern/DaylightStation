# Bug: Governance lock overlay does not vanish after a successful in-player fingerprint unlock

- **Date:** 2026-06-18
- **Area:** Fitness · Governance · in-player unlock
- **Severity:** High (the headline feature of the in-player unlock button is non-functional — the lock screen stays on top of now-playing video)
- **Status:** Root cause confirmed; fix proposed, not yet implemented

---

## Symptom

While a **governed episode** is playing and `GovernanceStateOverlay` is showing the
lock panel, the user taps the lock/unlock affordance (`LockIcon` button on the
overlay), the `UnlockPrompt` opens, and a fingerprint **matches successfully**.

Expected: the lock screen (`GovernanceStateOverlay`) vanishes and the video is
released.

Actual: the `UnlockPrompt` closes and the **video begins playing**, but the
`GovernanceStateOverlay` lock panel **remains on screen on top of the playing
video** and never disappears.

---

## Root cause

**The runtime fingerprint bypass is applied to a *local copy* of governance state
that the lock overlay never reads.** It is a single-source-of-truth violation: the
override happens *downstream* of the actual SSoT (the GovernanceEngine), and the
overlay is rendered by a sibling component that reads the SSoT directly.

### The two state objects

1. **`session.governanceEngine.state`** — the real engine snapshot. Exposed to all
   consumers as `fitnessCtx.governanceState`:

   ```js
   // frontend/src/context/FitnessContext.jsx:2274
   const governanceState = session?.governanceEngine?.state || { status: 'idle' };
   ```

   Its `isGoverned` / `status` / `videoLocked` fields are computed by the engine
   itself (`GovernanceEngine.js:1894 isGoverned: this._mediaIsGoverned()`,
   `:1917 videoLocked: ...`). **The engine has no knowledge of any bypass.**

2. **`effectiveGovernanceState`** — a *local override* computed inside
   `FitnessPlayer` when a bypass is active:

   ```js
   // frontend/src/modules/Fitness/player/FitnessPlayer.jsx:298-308
   const effectiveGovernanceState = governanceBypassed
     ? { ...governanceState, videoLocked: false, isGoverned: false,
         status: 'unlocked', audioDuck: null, challenge: null, deadline: null }
     : governanceState;
   ```

### Why the overlay never sees the override

`GovernanceStateOverlay` is **not** rendered by `FitnessPlayer`. It is rendered by
the sibling `FitnessPlayerOverlay`, which derives its state from **context (the raw
engine snapshot)** — not from `FitnessPlayer`'s `effectiveGovernanceState`:

```js
// frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx:66,71,79,229
const governanceState   = fitnessCtx?.governanceState || null;          // RAW engine state
const governanceDisplay = useGovernanceDisplay(governanceState, ...);   // built from RAW
const lockScreen        = resolveLockScreen({ activeChallenge, governanceDisplay });
const primaryOverlay = lockScreen.showGovernanceOverlay
  ? <GovernanceStateOverlay display={governanceDisplay} onUnlock={onGovernanceUnlock} /> : null;
```

`FitnessPlayer` passes the overlay **only** `playerRef`, `showFullscreenVitals`, and
`onGovernanceUnlock` — it never passes `effectiveGovernanceState` down:

```js
// frontend/src/modules/Fitness/player/FitnessPlayer.jsx:1815-1819
<FitnessPlayerOverlay
  playerRef={playerRef}
  showFullscreenVitals={playerMode === 'fullscreen'}
  onGovernanceUnlock={governanceUnlockHandler}
/>
```

And the overlay's visibility gate reads `isGoverned` straight off the raw snapshot:

```js
// frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:14
if (!govState?.isGoverned) return null;   // govState === raw engine state
```

So when the fingerprint matches:

```js
// frontend/src/modules/Fitness/player/FitnessPlayer.jsx:340-344
if (result?.matched) {
  setBypassActive(true);       // flips effectiveGovernanceState → unlocked (LOCAL only)
  setUnlockPromptOpen(false);  // closes UnlockPrompt
  clearUnlock();
}
```

`bypassActive` flips `effectiveGovernanceState` to unlocked, which **does** release
the things `FitnessPlayer` itself owns (autoplay gate at `:1294`, audio duck at
`:734`, player CSS class at `:373-384`, cycle dim, the directly-rendered
`GovernanceCountdown` at `:1927`). That is why the **video starts playing**.

But `session.governanceEngine.state` is unchanged — it still reports
`isGoverned: true, status: 'locked', videoLocked: true`. `FitnessPlayerOverlay`
reads that, `useGovernanceDisplay` returns `show: true`, `resolveLockScreen` returns
`showGovernanceOverlay: true`, and **`GovernanceStateOverlay` keeps rendering**.

### One-line summary

> The unlock button releases the *video* but not the *lock screen*, because the
> bypass override lives in `FitnessPlayer.effectiveGovernanceState` while the lock
> screen is rendered by `FitnessPlayerOverlay` off the raw engine state in context.

---

## Reproduction

1. Play a governed episode (a show/episode whose `type` is in `governed_types` or
   whose label is in `governed_labels`) with active HR participants below the
   required zone, so `GovernanceStateOverlay` shows the lock panel.
2. Ensure `locks.governance_bypass` is configured non-empty (so the overlay's
   `LockIcon` unlock button is wired — `FitnessPlayer.jsx:360`).
3. Tap the unlock `LockIcon` → `UnlockPrompt` opens.
4. Present an enrolled finger → match succeeds.
5. **Observe:** `UnlockPrompt` closes, video plays, but the governance lock panel
   stays on screen.

### Log signature

In the session JSONL (`media/logs/fitness/*.jsonl`) the grant fires but no
corresponding engine unlock follows:

```
governance.unlock_tap        { lock: 'governance_bypass', contentId: ... }
governance.bypass_granted    { userId: ..., contentId: ... }
# …no governance.phase change to 'unlocked' / no isGoverned:false on the engine…
```

The absence of any engine-side phase transition after `bypass_granted` is the
tell: the grant never reached the SSoT.

---

## How this was introduced

`git log` attributes the in-player unlock button and its bypass wiring to a single
commit:

```
73abc83c9 feat(fitness): skip/unlock button on governance overlay + FitnessPlayer bypass wiring
```

This is a **new-feature defect, not a regression** of previously-working behavior.
The feature was wired to flip `FitnessPlayer`'s local `effectiveGovernanceState`,
but the overlay it is meant to dismiss already lived in the sibling
`FitnessPlayerOverlay`, sourcing the raw engine state from context. The wiring
therefore never closed the loop on the overlay.

### The reference doc encodes the stale assumption

`docs/reference/fitness/governance-engine.md:335` claims:

> `FitnessPlayer` creates `effectiveGovernanceState` with `videoLocked: false,
> isGoverned: false, status: 'unlocked'`, used in place of the real
> `governanceState` **throughout the component**.

That "throughout the component" assumption was true when the lock overlay was
rendered inside `FitnessPlayer`. Once overlay rendering was extracted into
`FitnessPlayerOverlay` (reading context), the override no longer covers it. The doc
should be corrected as part of the fix.

---

## Blast radius (other paths with the same defect)

The same override-downstream-of-SSoT pattern means **all three** bypass mechanisms
fail to hide `GovernanceStateOverlay`, because none of them reach the engine or
context:

| Bypass mechanism | Reaches engine/context? | Releases video? | Hides overlay? |
|---|---|---|---|
| In-player fingerprint (`bypassActive`) | No (local only) | Yes | **No** ← reported bug |
| Per-item `currentItem.nogovern` (from FitnessShow governance_bypass) | No (local only) | Yes | **No** |
| Sticky `?nogovern` prop | No (local only) | Yes | **No** if media is genuinely governed |

`?nogovern` "appears" to work in tests because the test content typically isn't
governed by the engine (so `isGoverned` is already false and the overlay never
shows), and because the governance test helpers assert on
`window.__fitnessGovernance.phase`, not on the *visible overlay* — see the
"Overlay vs Phase Discrepancy" gotcha already documented at
`governance-engine.md:273-291`. This bug is the inverse of that gotcha: phase/engine
says locked while the bypass thinks it's unlocked.

---

## Fix options

### Option A — Make the bypass a first-class engine state (recommended, SSoT-correct)

Teach `GovernanceEngine` about a runtime bypass so its own snapshot reports
unlocked, and **delete** the `effectiveGovernanceState` override entirely. Every
consumer (FitnessPlayer autoplay/audio/CSS, the overlay via context, the countdown)
then reads one consistent state.

- Add e.g. `engine.setRuntimeBypass(active)` that, while active, forces
  `isGoverned:false, videoLocked:false, status:'unlocked'` (and nulls
  `challenge`/`deadline`/`audioDuck`) in the emitted snapshot.
- There is **existing precedent**: the engine already has a suspend mechanism for
  ungoverned CycleGame takeovers (`GovernanceEngine.js:1204` "Suspend/resume
  governance for an ungoverned screen takeover"). The bypass should mirror/reuse
  that path rather than inventing a parallel one.
- Route all three bypass sources (in-player fingerprint, per-item `nogovern`,
  sticky `?nogovern`) through this single engine entry point.
- Pro: fixes the reported bug **and** the two latent siblings; restores the
  "GovernanceEngine is the sole authority" invariant (`FitnessPlayer.jsx:285`).
- Con: larger change; must ensure the engine re-emits a snapshot (version bump /
  `updateSnapshot`) so context re-renders.

### Option B — Drill the override into the overlay (localized, lower-risk)

Pass `effectiveGovernanceState` from `FitnessPlayer` into `FitnessPlayerOverlay`
and have the overlay prefer it over `fitnessCtx.governanceState` for **all** of its
derived values (`governanceState`, `governanceDisplay`, `activeChallenge`,
challenge overlays — all currently sourced from context at
`FitnessPlayerOverlay.jsx:66-79`).

- Pro: small, surgical, no engine changes.
- Con: leaves the SSoT violation in place; only fixes the in-player path unless the
  `nogovern` flags are also surfaced into `effectiveGovernanceState` (they already
  are, via `shouldBypassGovernance`, so this would actually fix all three render
  paths too — but only for this one overlay consumer, not for any future consumer
  reading context).

**Recommendation:** Option A. It is the only fix that keeps a single source of
truth and closes the two latent siblings, at the cost of a slightly larger change.

---

## Verification plan (post-fix)

1. **Automated:** Extend the in-player unlock test (or add one) that locks a
   governed episode, drives a matched fingerprint, and asserts **both** that the
   video is playing **and** that `GovernanceStateOverlay` is gone — i.e. assert on
   the visible overlay, not only on `window.__fitnessGovernance.phase`. This is the
   exact gap that let the bug ship.
2. **Manual on garage display:** lock a governed episode, tap unlock, match a
   finger, confirm the lock panel disappears.
3. **Regression:** confirm `?nogovern` and the FitnessShow per-show
   `governance_bypass` (🔒 → 🔓) also clear the overlay for genuinely-governed
   content.
4. Update `docs/reference/fitness/governance-engine.md:335` to describe the new
   bypass mechanism and drop the stale "throughout the component" claim.

---

## Key files

| File | Role in this bug |
|---|---|
| `frontend/src/modules/Fitness/player/FitnessPlayer.jsx:281-360` | Defines `bypassActive`, `effectiveGovernanceState`, `openGovernanceUnlock`; local override only |
| `frontend/src/modules/Fitness/player/FitnessPlayerOverlay.jsx:66-79,229-235` | Renders `GovernanceStateOverlay` off **raw** context state |
| `frontend/src/context/FitnessContext.jsx:2274` | `governanceState = session.governanceEngine.state` (the SSoT exposed to the overlay) |
| `frontend/src/modules/Fitness/hooks/useGovernanceDisplay.js:14` | `if (!govState?.isGoverned) return null` — gate driven by raw state |
| `frontend/src/modules/Fitness/player/overlays/resolveLockScreen.js:42-51` | `governanceDisplay.show` → `showGovernanceOverlay: true` |
| `frontend/src/hooks/fitness/GovernanceEngine.js:1894,1917,1204` | Computes `isGoverned`/`videoLocked`; has a suspend precedent to mirror |
| `frontend/src/modules/Fitness/player/overlays/UnlockPrompt.jsx` | Presentational prompt (correct; not the defect) |
| `docs/reference/fitness/governance-engine.md:335` | Stale "throughout the component" claim to correct |

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

### Known residual seam (cosmetic, not a playback gate)

The final review of this fix found another consumer that still reads the raw
`FitnessContext.governanceState`: the `FitnessGovernance` sidebar status panel
(`FitnessSidebar.jsx` reads `governanceState?.isGoverned`). After a bypass it
keeps showing the "governed/locked" striped status bar even though the video
plays freely. It is **informational only** — it does not render
`GovernanceStateOverlay` and cannot block playback — so it is out of scope for
this fix. It is the same bug class as the overlay seam and would be resolved
wholesale by Option A; until then it could be patched the same way (thread
`effectiveGovernanceState` into `FitnessSidebar`).
