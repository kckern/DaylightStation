# WeeklyReview — D-pad + OK keymap

**Status:** spec, awaiting implementation
**Date:** 2026-05-09
**Scope:** `frontend/src/modules/WeeklyReview/`

---

## Context

WeeklyReview runs on the living-room TV under FullyKioskBrowser, controlled by the Nvidia Shield remote. The remote's reliable input vocabulary is **D-pad + OK** only; Esc/Back is intercepted unpredictably by FKB and cannot be trusted as a state-transition affordance.

Today the module's keyhandler (`WeeklyReview.jsx:321-512`) has three branches whose only path forward is Esc:

1. **Preflight `acquiring` overlay** — Esc exits the widget; nothing else does
2. **Fullscreen photo view** — Esc backs to day; all four arrows redundantly cycle photos
3. **TOC main view** — Esc opens the `stopConfirm` modal (the deliberate "save & exit" prompt)

These are bugs under the no-Esc constraint: a user with only the Shield remote can get stuck.

## Audit (full)

Every Esc/Back branch in the current keyhandler:

| State | Esc behavior | D-pad path today | Status |
|---|---|---|---|
| preflight `acquiring` | exit widget | — | ⚠️ trapped |
| modal `disconnect` | swallowed (auto-closes) | n/a | ok |
| modal `stopConfirm` | close | ← + Enter | ok |
| modal `finalizeError` | close | ← + Enter | ok |
| modal `preflightFailed` | exit widget | ←/→ + Enter | ok |
| modal `resumeDraft` | ignored | Enter only | ok |
| bar focus | back to main | ↑ | ok |
| fullscreen photo | back to day | — | ⚠️ trapped |
| day view | back to TOC | ↓ | ok |
| TOC main | open stopConfirm | — | ⚠️ no exit prompt |

Three holes; everything else already has a D-pad-only path.

## Design

Two additions to the central keyhandler cover all three holes. Hole #1 (preflight-acquiring) falls out for free because non-Esc keys already pass through to the main hierarchy during acquisition (`WeeklyReview.jsx:337-342`).

### Change A: double-Enter → exit prompt

Within the main hierarchy (levels `toc` / `day` / `fullscreen`), pressing OK twice within **500 ms** opens the existing `stopConfirm` modal.

Behavior:

- The first Enter fires its normal action immediately (open day, open photo, no-op at fullscreen). No latency penalty on the common single-Enter case.
- A second Enter inside the window:
  1. Reverts the first transition by dispatching `RESTORE_VIEW` with the snapshot captured before the first Enter
  2. Opens the `stopConfirm` modal
  3. Clears the double-tap state
- A second Enter outside the window resets and is treated as a new "first Enter."
- Excluded from the gesture: bar focus (Enter = save+exit there), modal handling (Enter activates focused button).
- Cancelling the prompt (← + Enter, or focusing Cancel and pressing Enter) returns the user to the captured pre-double-tap state.

Window size: **500 ms**. Standard double-click is 400-500 ms; a remote thumb is slightly slower than a mouse, so we sit at the upper end of that range.

### Change B: ↓ at fullscreen → back to day

Today all four arrows at fullscreen call `CYCLE_PHOTO`. We re-purpose ↓ as `BACK` (back to day) — the same semantic ↓ has at every other level (day → toc, bar → main, ultimately the climb-out direction).

Final fullscreen mapping:

| Key | Action |
|---|---|
| ← | prev photo (`CYCLE_PHOTO -1`) |
| → | next photo (`CYCLE_PHOTO +1`) |
| ↑ | next photo (`CYCLE_PHOTO +1`) — kept; harmless redundancy with → |
| ↓ | **back to day** (`BACK`) |
| Enter (single) | no-op |
| Enter (double, within 500 ms) | exit prompt |

`↑` is intentionally left as "next photo" rather than re-purposed. Sacrificing one arrow for back-nav is enough; sacrificing two creates more cognitive load without adding capability.

### Esc fallback retained

Existing Esc handlers stay in place as a defensive fallback. We're adding D-pad + OK paths, not removing Esc paths. If FKB does let an Esc through, it still works.

## Implementation

### Files touched

| File | Change |
|---|---|
| `frontend/src/modules/WeeklyReview/state/viewReducer.js` | Add `RESTORE_VIEW` action |
| `frontend/src/modules/WeeklyReview/state/viewReducer.test.js` | Test for `RESTORE_VIEW` |
| `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` | Double-tap detection in keyhandler; ↓ at fullscreen |
| `tests/live/flow/weekly-review/*.runtime.test.mjs` | New flow tests for double-Enter and ↓ at fullscreen |

### Reducer change (`viewReducer.js`)

Add a new action:

```js
case 'RESTORE_VIEW':
  return action.snapshot ?? state;
```

`RESTORE_VIEW` replaces state wholesale with a captured snapshot. This handles all three first-Enter cases uniformly:

- TOC → day: snapshot is `{ level: 'toc', dayIndex: N, ... }`; restore returns to TOC
- day → fullscreen: snapshot is `{ level: 'day', ... }`; restore returns to day
- fullscreen no-op: snapshot equals current state; restore is a no-op replace

### Keyhandler change (`WeeklyReview.jsx`)

Two new refs near the existing `preflightStatusRef`:

```js
const lastEnterAtRef = useRef(0);
const lastEnterSnapshotRef = useRef(null);
const DOUBLE_ENTER_WINDOW_MS = 500;
```

In the main-hierarchy `if (isEnter)` block (currently `WeeklyReview.jsx:406-425`), wrap the existing logic:

```js
if (isEnter) {
  const now = Date.now();
  const isDouble = (now - lastEnterAtRef.current) < DOUBLE_ENTER_WINDOW_MS;

  if (isDouble) {
    // Second tap of a double-tap pair — revert + open exit prompt
    e.preventDefault();
    e.stopPropagation();
    dispatchView({ type: 'RESTORE_VIEW', snapshot: lastEnterSnapshotRef.current });
    dispatchModal({ type: 'OPEN', modal: 'stopConfirm' });
    lastEnterAtRef.current = 0;
    lastEnterSnapshotRef.current = null;
    return;
  }

  // First tap — capture snapshot, then dispatch normal action
  lastEnterAtRef.current = now;
  lastEnterSnapshotRef.current = view;

  // ... existing OPEN_DAY / OPEN_PHOTO / fullscreen no-op logic unchanged ...
}
```

The `lastEnterAtRef` guards against stale doubles: any non-Enter key, modal open, or focus change does not reset the timer, but the next Enter that lands outside the 500 ms window naturally is treated as a fresh first tap (and the snapshot ref is overwritten).

In the fullscreen switch (currently `WeeklyReview.jsx:441-459`), change the `ArrowDown` case:

```js
case 'ArrowDown':
  e.preventDefault();
  dispatchView({ type: 'BACK' });
  return;
```

`ArrowLeft` keeps `CYCLE_PHOTO -1`; `ArrowUp` and `ArrowRight` keep `CYCLE_PHOTO +1`.

## Tests

### Reducer (unit)

Add to `viewReducer.test.js`:

- `RESTORE_VIEW` with a snapshot replaces state
- `RESTORE_VIEW` with no snapshot is a no-op (returns current state unchanged)

### Behavior (flow / runtime)

Add to `tests/live/flow/weekly-review/`:

- Double-Enter at TOC: opens `stopConfirm`, view is restored to TOC after dismiss
- Double-Enter at day: opens `stopConfirm`, view is restored to day after dismiss
- Double-Enter at fullscreen: opens `stopConfirm`, view stays at fullscreen after dismiss
- Two Enters separated by 600 ms: navigates twice (TOC → day → fullscreen), no prompt
- ↓ at fullscreen: returns to day view (not a photo cycle)
- ←/→ at fullscreen: still cycle photos as before (regression check)

### Verification before completion

Per `superpowers:verification-before-completion`: run the new tests and the existing WeeklyReview flow tests headed in a browser — the keyboard fix is meaningless if the kiosk feel is broken. Manual smoke on the living-room Shield is the final check before claiming done.

## Out of scope

- **`resumeDraft` modal** — currently Enter-only with no decline path. The user has accepted this constraint historically; not changing here.
- **Other kiosk modules** — this spec covers WeeklyReview only. A broader Esc-removal audit across `/screen/*` and `/tv` belongs in its own plan.
- **Removing Esc handlers** — kept as defensive fallback. Removing them is a separate decision.
- **Long-press OK as another gesture** — considered and rejected. Double-tap is sufficient and avoids the timing complexity of distinguishing tap from press.
- **Gamepad-API support** — WeeklyReview is keyboard-driven via FKB; gamepad belongs in modules that already use it (e.g., ArcadeSelector).

## Open questions

None at spec time; all design decisions resolved during brainstorming.
