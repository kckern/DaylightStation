# CycleGame UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the concrete, code-addressable usability and accessibility defects found in the 2026-06-03 CycleGame design/usability evaluation — point by point.

**Architecture:** Targeted edits to the presentational lobby (`CycleGameHome.jsx`/`.scss`) plus a small shared-constant extraction. No state-machine or container changes. Every behavioral change is TDD'd against the existing colocated vitest suite; SCSS-only changes (contrast) are verified with an explicit WCAG ratio computation rather than a theatrical unit test.

**Tech Stack:** React 18 (`.jsx`), SCSS, vitest + @testing-library/react (jsdom). Component tests are **vitest**, not jest.

---

## Scope & Non-Goals

**In scope (from the audit's prioritized findings, verified real):**
- #2 Ghost selection is keyboard-dead (`onPointerDown`) → Task 1
- #4 Modals don't honor Escape / lack dismiss affordance → Task 2
- #5 Faint text fails WCAG AA contrast → Task 3
- #6 Records "—" scores read as broken → Task 4
- #7 Volume level is color-only (no non-color cue) → Task 5
- #9 Two-tap ghost gesture is undiscoverable → Task 6
- #10 Dead CSS + duplicated `LINE_COLORS` token → Task 7

**Explicitly dropped (verified during planning):**
- **Audit #1 (inert CSS motion under the TV kiosk) — FALSE ALARM.** The global `animation-duration: 0s !important` rule lives in `frontend/src/modules/Menu/Menu.scss` scoped to `.menu-items-container`, **not** `TVApp.scss`. CycleGame renders in the fitness player content area, not inside the menu, so its motion is **not** suppressed. No task. (The audit doc has been corrected.)
- **Audit #6 "add rider names to the grid"** — re-adding names would contradict an intentional, test-asserted decision (`CycleGameHome.test.jsx:55`: names live in the picker, not the slot). We instead delete the orphaned `.cgh-slot__rider-name` CSS (Task 7).
- **Audit #3 (lobby adopts the `_cgTokens.scss` design system) and #8 (equipment iconography)** — these are a visual-cohesion refactor, not a UX-behavior fix. Deferred to a separate Phase 2 (noted at the end). This plan keeps the lobby's existing look and fixes behavior.

**Test command (memorize — used in every task):**
```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
```
Run a single test by appending `-t "<partial test name>"`.

---

### Task 1: Ghost picker — keyboard-accessible selection

**Why:** `GhostPicker` cards fire on `onPointerDown` (`CycleGameHome.jsx:479`). Keyboard activation (Enter/Space on a `<button>`) emits a synthetic *click*, never a pointerdown, so a keyboard/remote user can never select a ghost. WCAG 2.1.1 failure on a core path. The two-tap focus→commit logic in `handleTap` works identically under `onClick`.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx:479`
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx:103-119`

**Step 1: Change the existing two-stage test to drive via `click` (will fail first)**

In `CycleGameHome.test.jsx`, replace the two `fireEvent.pointerDown(card)` calls (lines ~115 and ~117) with `fireEvent.click(card)`:

```jsx
    fireEvent.click(getByTestId('course-ghost')); // open the ghost picker
    const card = getByTestId('ghost-20260602150118');
    fireEvent.click(card); // first tap → focus only (tap-to-scroll pattern)
    expect(onSelectGhost).not.toHaveBeenCalled();
    fireEvent.click(card); // second tap → commit
    expect(onSelectGhost).toHaveBeenCalled();
```

**Step 2: Run the test to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "two-stage"
```
Expected: FAIL — `onSelectGhost` is never called because the handler still listens on `pointerDown`, so `click` does nothing.

**Step 3: Switch the handler to `onClick`**

In `CycleGameHome.jsx`, the ghost card button (~line 479):

```jsx
                        onClick={() => handleTap(c)}
```
(was `onPointerDown={() => handleTap(c)}`)

**Step 4: Run the test to verify it passes**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "two-stage"
```
Expected: PASS. (Because the card is a real `<button>` with `onClick`, native Enter/Space activation now works — `fireEvent.click` is the test proxy for that.)

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "fix(cycle-game): keyboard-accessible ghost selection (onClick not onPointerDown)"
```

---

### Task 2: Modals — Escape to dismiss

**Why:** `RiderPicker` and `GhostPicker` declare `role="dialog"` + `aria-modal` but close only via backdrop click or the × button. No Escape handler (WCAG 2.4.x / Dialog APG expectation). Add a tiny shared hook and wire both.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` (add hook near top imports; call inside both pickers)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

**Step 1: Write the failing tests**

Add to `CycleGameHome.test.jsx` inside the `describe` block:

```jsx
  it('closes the rider picker on Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('rider-picker')).toBeNull();
  });

  it('closes the ghost picker on Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={[]} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    expect(getByTestId('ghost-picker')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('ghost-picker')).toBeNull();
  });
```

**Step 2: Run to verify they fail**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "on Escape"
```
Expected: FAIL — both pickers remain in the DOM after Escape.

**Step 3: Add the hook and wire both pickers**

In `CycleGameHome.jsx`, change the React import to include `useEffect`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
```

Add the hook just below the `uiLog()` helper (after line ~16):

```jsx
/** Dismiss a modal on the Escape key. Cleans up its own listener. */
function useEscapeToClose(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}
```

Call it as the first line inside **both** `RiderPicker` (after its `const`/`useState` setup) and `GhostPicker`:

```jsx
  useEscapeToClose(onClose);
```
- In `RiderPicker`, place it right after the `const showTabs = ...` line (~line 261).
- In `GhostPicker`, place it right after `const [focusedId, setFocusedId] = useState(...)` (~line 423).

**Step 4: Run to verify they pass**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "on Escape"
```
Expected: PASS for both.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): Escape dismisses rider and ghost pickers"
```

> **Note on focus trap/restore (audit #4 remainder):** full focus trapping + restore-to-trigger is deliberately *not* in this task — it needs a vetted focus-trap utility and is higher-risk on the kiosk's remote-driven focus model. Escape + backdrop + × covers the dismiss gap; tracked as Phase 2.

---

### Task 3: Faint text — meet WCAG AA contrast

**Why:** `$cgh-faint: #5b626e` on `$cgh-bg: #0e0f13` is ≈ 3.0:1, below the 4.5:1 AA floor for normal text. It styles the most explanatory copy (value-step hint, empty states, record timestamps). Bump it to a value that passes while staying visually subordinate to `$cgh-muted`.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss:14`

**Step 1: Verify the current value fails (baseline)**

```bash
node -e "const hex=h=>{const n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]};const lin=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};const L=a=>0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2]);const r=(a,b)=>{const x=L(hex(a)),y=L(hex(b)),[h,l]=x>y?[x,y]:[y,x];return((h+0.05)/(l+0.05)).toFixed(2)};console.log('before #5b626e:', r('#5b626e','#0e0f13'));"
```
Expected: ≈ `3.04` (FAIL — under 4.5).

**Step 2: Change the token**

In `CycleGameHome.scss:14`:

```scss
$cgh-faint: #7d8696;
```
(was `#5b626e`)

**Step 3: Verify the new value passes AA**

```bash
node -e "const hex=h=>{const n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255]};const lin=c=>{c/=255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4};const L=a=>0.2126*lin(a[0])+0.7152*lin(a[1])+0.0722*lin(a[2]);const r=(a,b)=>{const x=L(hex(a)),y=L(hex(b)),[h,l]=x>y?[x,y]:[y,x];return((h+0.05)/(l+0.05)).toFixed(2)};console.log('after #7d8696:', r('#7d8696','#0e0f13'));"
```
Expected: ≈ `5.07` (PASS — ≥ 4.5, and still dimmer than `$cgh-muted #8b93a1` ≈ 5.9 so hierarchy is preserved).

**Step 4: Confirm the suite still renders**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
```
Expected: PASS (no behavioral change).

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss
git commit -m "fix(cycle-game): raise faint text to WCAG AA contrast (3.0->5.1:1)"
```

---

### Task 4: Records rail — empty score reads as intentional, not broken

**Why:** A record with no finish time renders a bare `—` under a goal chip, which looks like a rendering bug (audit #6, visible in the screenshot). Render an explicitly-labelled placeholder so "no result yet" is unmistakable.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx:665` (the `cgh-record__score` span)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (add `--empty` modifier)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

**Step 1: Write the failing test**

```jsx
  it('renders an explained placeholder when a record has no score', () => {
    const records = [{
      raceId: 'r-noscore',
      avatars: [{ id: 'milo', src: '/api/v1/static/img/users/milo', name: 'Milo' }],
      goalKind: 'distance', goalLabel: '3 km',
      scoreKind: 'time', scoreLabel: ''
    }];
    const { getByTitle } = render(
      <CycleGameHome bikes={bikes} people={people} records={records} />
    );
    expect(getByTitle('No result recorded')).toBeTruthy();
  });
```

**Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "explained placeholder"
```
Expected: FAIL — no element with that title (current code renders an empty/`—` score with no title).

**Step 3: Implement the placeholder**

In `CycleGameHome.jsx`, replace the score span (~line 665):

```jsx
                    {rec.scoreLabel && rec.scoreLabel !== '—' ? (
                      <span className="cgh-record__score">{rec.scoreLabel}</span>
                    ) : (
                      <span
                        className="cgh-record__score cgh-record__score--empty"
                        title="No result recorded"
                        aria-label="No result recorded"
                      >—</span>
                    )}
```

In `CycleGameHome.scss`, near the existing `.cgh-record__score` rule (~line 679), add:

```scss
.cgh-record__score--empty { color: $cgh-faint; font-style: italic; }
```

**Step 4: Run to verify it passes**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "explained placeholder"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "fix(cycle-game): explained placeholder for records with no result"
```

---

### Task 5: Volume — non-color level cue

**Why:** The 11-segment volume bar encodes level/mute/active purely by color (audit #7, WCAG 1.4.1). Add a numeric readout beside the "Volume" label so level is legible without relying on color. Scoped to the lobby wrapper — the shared `TouchVolumeButtons` component is untouched.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx:628` (the Volume section label)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (label-with-readout layout)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

**Step 1: Write the failing test**

```jsx
  it('shows a numeric volume readout (non-color cue)', () => {
    const { getByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} masterVolume={0.7} />
    );
    expect(getByTestId('cycle-game-volume-readout').textContent).toBe('70%');
    rerender(
      <CycleGameHome bikes={bikes} people={people} records={[]} masterVolume={0.7} masterMuted />
    );
    expect(getByTestId('cycle-game-volume-readout').textContent).toBe('Muted');
  });
```

**Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "numeric volume readout"
```
Expected: FAIL — no `cycle-game-volume-readout` element.

**Step 3: Implement the readout**

In `CycleGameHome.jsx`, replace the Volume label (~line 628):

```jsx
        <div className="cgh-section-label cgh-section-label--with-readout" id="cycle-game-volume-label">
          <span>Volume</span>
          <span className="cgh-volume__readout" data-testid="cycle-game-volume-readout">
            {masterMuted ? 'Muted' : `${Math.round((masterVolume ?? 0) * 100)}%`}
          </span>
        </div>
```

In `CycleGameHome.scss`, near `.cgh-section-label` (~line 122), add:

```scss
.cgh-section-label--with-readout { justify-content: space-between; }
.cgh-volume__readout {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  color: $cgh-accent;
}
```

**Step 4: Run to verify it passes**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "numeric volume readout"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): numeric volume readout (non-color level cue)"
```

---

### Task 6: Ghost picker — discoverable two-tap affordance

**Why:** The focus→commit gesture is invisible until a card is focused; the only hint is a one-line caption (audit #9). Surface a per-card "Tap again to choose" label on the focused card so the second step is self-explanatory. Depends on Task 1 (handler is now `onClick`).

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx` (inside the focused ghost card, ~line 493)
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (style the confirm hint)
- Test: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx`

**Step 1: Write the failing test**

```jsx
  it('reveals a confirm hint on the focused ghost card', () => {
    const candidates = [{
      raceId: '20260602150118', day: '2026-06-02', timeOfDay: '3:01 pm',
      participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/x' }],
      goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
    }];
    const { getByTestId, queryByText, getByText } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={candidates} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    expect(queryByText('Tap again to choose')).toBeNull(); // nothing focused yet
    fireEvent.click(getByTestId('ghost-20260602150118')); // focus
    expect(getByText('Tap again to choose')).toBeTruthy();
  });
```

**Step 2: Run to verify it fails**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "confirm hint"
```
Expected: FAIL — hint text never rendered.

**Step 3: Render the hint on the focused card**

In `CycleGameHome.jsx`, inside the ghost card button, after the `cgh-ghost-card__info` span (~line 497), add:

```jsx
                        {isFocused && (
                          <span className="cgh-ghost-card__confirm">Tap again to choose</span>
                        )}
```

In `CycleGameHome.scss`, near `.cgh-ghost-card` (~line 764), add:

```scss
.cgh-ghost-card__confirm {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: $cgh-accent;
}
```

**Step 4: Run to verify it passes**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx -t "confirm hint"
```
Expected: PASS.

**Step 5: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.jsx frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.test.jsx
git commit -m "feat(cycle-game): per-card confirm hint makes two-tap ghost gesture discoverable"
```

---

### Task 7: Cleanup — dead CSS + single-source rider colors

**Why:** (audit #10) Six styled-but-unrendered CSS blocks signal drift and mislead the next reader; `LINE_COLORS` is hard-duplicated across two components. Pure refactor, no behavior change — existing tests are the regression guard.

**Files:**
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleGameHome.scss` (delete dead rules)
- Create: `frontend/src/modules/Fitness/lib/cycleGame/lineColors.js`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/CycleRaceScreen.jsx:10`
- Modify: `frontend/src/modules/Fitness/widgets/CycleGame/RaceRecap.jsx:15`

**Step 1: Confirm the dead classes are still unreferenced (guards against re-adds in Tasks 1-6)**

```bash
cd frontend/src/modules/Fitness/widgets/CycleGame && for cls in cgh-record__rank cgh-slot__rider-name cgh-ghost-list cgh-ghost-row cgh-ghost-disc cgh-slot--ghost; do echo "$cls -> $(grep -l "$cls" *.jsx 2>/dev/null | grep -v test | wc -l | tr -d ' ') non-test jsx refs"; done; cd -
```
Expected: every class reports `0 non-test jsx refs`.

**Step 2: Create the shared color module**

`frontend/src/modules/Fitness/lib/cycleGame/lineColors.js`:

```js
// Per-rider identity colors for cycle-game lanes, roster, speedometers, recap.
// Single source of truth — index = rider order. Keep in sync with nothing else;
// import this instead of redeclaring the array.
export const LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff'];
```

**Step 3: Import it in both components (delete the local arrays)**

In `CycleRaceScreen.jsx`, remove the local `const LINE_COLORS = [...]` (line 10) and add to the imports:

```jsx
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
```

Do the same in `RaceRecap.jsx` (remove line 15's local array; add the same import).

**Step 4: Delete the dead SCSS blocks**

In `CycleGameHome.scss`, remove these rule blocks entirely:
- `.cgh-record__rank { ... }` (~lines 387-399)
- `.cgh-slot__rider-name { ... }` (~lines 359-365)
- `.cgh-ghost-list { ... }` and `.cgh-ghost-row { ... }` incl. `&__*` (~lines 593-613)
- `.cgh-ghost-row__avatars/__avatar/__meta/__score/__date` (~lines 693-703)
- `.cgh-ghost-disc { ... }` (~lines 585-590)
- `.cgh-slot--ghost { ... }` (~lines 580-583)

**Step 5: Verify nothing regressed — run the full CycleGame suite**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/
```
Expected: all CycleGame test files PASS (CycleGameHome, CycleRaceScreen, RaceRecap, RaceResults, CycleSpeedometer, CountdownStoplight, CycleGameContainer).

**Step 6: Commit**

```bash
git add frontend/src/modules/Fitness/widgets/CycleGame/ frontend/src/modules/Fitness/lib/cycleGame/lineColors.js
git commit -m "refactor(cycle-game): remove dead CSS; single-source rider lane colors"
```

---

## Final Verification

**Step 1: Run the entire CycleGame suite once more**

```bash
./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Fitness/widgets/CycleGame/
```
Expected: all PASS.

**Step 2: Manual smoke (the parts unit tests can't see)** — per @docs/ai-context/testing.md and CLAUDE.md, the dev server / Playwright harness is the way to see it live. Check, in the lobby:
- Tab to a ghost card and press **Enter** twice → it selects (keyboard path).
- Press **Escape** in each picker → it closes.
- Faint hint text ("Pick Distance, Time, or a Ghost…") is comfortably legible.
- A record with no time shows an italic dash, not a broken blank.
- Volume label shows e.g. `70%` / `Muted`.
- Focusing a ghost card shows "Tap again to choose".

**Step 3: Docs** — no reference-doc changes required (behavior of a single widget). If the audit is referenced elsewhere, note that audit finding #1 was retracted.

---

## Phase 2 (deferred — not in this plan)

These are real but are visual-cohesion / larger-risk items, intentionally out of "point-by-point UX behavior":
- **Audit #3 — lobby adopts `_cgTokens.scss`** ("Velodrome Broadcast HUD": Roboto Condensed display, JetBrains Mono telemetry, token palette). A visual redesign pass; needs its own brainstorming + plan.
- **Audit #8 — equipment iconography** (the "Nicoday" wordmark vs. vector glyphs). Data/asset problem, not pure code.
- **Audit #4 remainder — full modal focus trap + restore-to-trigger.** Needs a vetted focus-trap utility and kiosk-remote focus testing.
