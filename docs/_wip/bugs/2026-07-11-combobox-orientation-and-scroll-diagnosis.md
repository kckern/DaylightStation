# Combobox Orientation (F1) & Scroll-Restore (F4) — Diagnosis

**Date:** 2026-07-11
**Purpose:** Replace the audit's *hypotheses* with observed/derived mechanisms before fixing (Tasks 2, 3, 5 of `docs/_wip/plans/2026-07-11-content-combobox-ux-overhaul.md`).
**Method:** Static (code-derived) diagnosis. A live-server repro was blocked (backend down; the only running Vite belongs to the `piano-producer-overhaul` worktree). Live confirmation is deferred to Task 12 (via screenshots per KC's stated preference, or a stood-up dev env).

---

## F1 — Orientation / "where is my current value?"

### Audit hypothesis (now REFUTED for the common case)
The audit (`2026-07-11-content-combobox-ux-risk-audit.md` §1, F1) claimed the committed value falls *outside* the loaded siblings window, so the highlight silently drops to sibling #0.

### What the code actually does
`SiblingsService.#applyWindow` (`backend/src/3_applications/content/services/SiblingsService.mjs:136-206`) **centers** a 21-item window (10 above + ref + 10 below) around the reference item on the initial (no offset/limit) load, and returns `referenceIndex = refIdx - start` (`:197`).

The reference is located by (`:160-163`):
```js
const refIdx = items.findIndex(item => {
  const id = item.id || `${item.source}:${item.localId}`;
  return id === referenceId || id === referenceId.replace(/^[^:]+:/, (m) => m);
});
```
Singalong sibling items carry `id: `singalong:hymn/N`` (`SingalongAdapter.mjs:100,238,265`), and the committed value is `singalong:hymn/1008`, so `id === referenceId` matches → `refIdx` is found → the window centers on 1008 and `referenceIndex ≈ 10`.

**Conclusion:** for any value whose id is present in its adapter's sibling list (the common case), the window IS centered and `referenceIndex` IS correct. The audit's "value absent → highlight #0" mechanism does not apply here.

### Two real, narrower defects (what Tasks 2 & 3 actually fix)

1. **Marker salience (common case).** When the window is centered, the reference row is styled `.current` — a **muted gray left-border** (`ContentCombobox.scss:83-86`) — and, on open, also `.highlighted` blue because `highlight.idx = referenceIndex` with `userNavigated: false`. The gray "current" cue is easy to miss, and the auto-highlight blue is indistinguishable from a *user* selection. Net: the user cannot quickly tell "this row is my current value." → **Task 3** (salient, distinct Current badge/marker).

2. **Genuine-miss path (`refIdx === -1`).** If the id is truly not in the adapter list (cross-source drift, renamed/stale id, alias mismatch), `#applyWindow` takes the `:165` branch and returns **all** items with `referenceIndex: Math.max(-1, 0) = 0` (`:169`). The client then highlights sibling #0 (`useContentCombobox.js:278` also defaults a not-found reference to `0`). Here the audit's concern is real but rare — there is no on-screen signal that the value isn't in the list. → **Task 2** (persistent "Current: … — not in this list" header; and change the client not-found fallback to `idx: -1` so no phantom row is highlighted).

### Incidental finding (cleanup, low priority)
`SiblingsService.mjs:162` — the second `findIndex` clause `id === referenceId.replace(/^[^:]+:/, (m) => m)` replaces the `source:` prefix **with itself** (the replacer returns the matched string `m`), i.e. it evaluates to `id === referenceId` again. It is a **no-op / dead branch**, not the intended prefix-tolerant fallback. Not F1's cause. Worth deleting or fixing to actually strip the prefix if prefix-tolerant matching was intended. (Out of scope for the UX tasks; note for a future cleanup.)

---

## F4 — before-pagination scroll rug-pull

### What the code does
`runPaginate('before')` (`ContentCombobox.jsx:258-284`) restores scroll after a prepend:
```js
const prevScrollHeight = viewport.scrollHeight;          // before await
await paginate(direction);                                // React state updated
requestAnimationFrame(() => {                             // SINGLE rAF
  viewport.scrollTop += viewport.scrollHeight - prevScrollHeight;
});
```
A single `requestAnimationFrame` is not guaranteed to fire *after* React has committed the prepended rows and the browser has laid them out. If it fires early, `viewport.scrollHeight` is stale and the compensation is wrong → viewport jump. `overflowAnchor: 'none'` on the viewport (`:593`) **disables native scroll-anchoring**, so this manual restore is the only thing preventing the jump — no fallback.

Contrast: the sibling `after`-path cooldown just below (`:280-282`) deliberately uses a **double** rAF to outlast layout.

### Conclusion
Confirmed by inspection as a real timing race. Fix (**Task 5**): compute the restore via a pure helper (`computeScrollRestore`) and write it **after commit** — double rAF mirroring the cooldown, or a `useLayoutEffect` keyed on a prepend token. Live magnitude/repro deferred to Task 12 (CPU-throttled).

---

## Impact on the plan
- **Task 2** stands, re-scoped: the orientation header is a defensive fix for the `refIdx === -1` miss path (+ change client not-found fallback to `idx: -1`).
- **Task 3** stands: salience is the primary common-case F1 fix.
- **Task 5** stands as written.
- Backend `SiblingsService` needs **no** change for F1 (centering already correct); the dead `:162` clause is a separate low-priority cleanup.
