# Piano Studio Top Pane — Modular, Fixed-Height Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Studio top pane (the grand-staff card) into a self-contained, content-swappable `StudioTopPane` component with a fixed, taller height and generous top/bottom margins so tall stems and ledger-line notes are never clipped, and shrink the waterfall to give the top pane that room — used identically by both `StudioPlay` and `StudioPlayback`.

**Architecture:** Today both `StudioPlay.jsx` and `StudioPlayback.jsx` hand-roll the same `<div className="…__staff"><CurrentChordStaff/></div>` markup, and `PianoApp.scss` duplicates the `&__staff` / `&__waterfall` flex rules under `.piano-studio-play` and `.piano-playback`. The staff pane is `flex: 0 0 auto` (content-sized), so a chord with long stems or ledger lines overflows its short box. This plan introduces one shared presentational component, `StudioTopPane`, that owns a single fixed-height white-paper card with a centered content slot (defaulting to `CurrentChordStaff`). Its `children` prop is the content slot, so the future music-theory triptych (sibling doc) can drop straight in without touching either view. SCSS moves to a shared `.piano-studio-toppane` block with a fixed height and large vertical padding; both views drop their bespoke `&__staff` rules and the waterfall loses a fixed slice of vertical share to the now-taller top pane.

**Tech Stack:** React (function components, presentational), SCSS (BEM-ish `piano-*` blocks in `frontend/src/Apps/PianoApp.scss`), abcjs via `AbcRenderer`, vitest + @testing-library/react for the render test.

**Cross-references:**
- Composes with the brace-black fix — `docs/_wip/plans/2026-06-24-piano-studio-brace-black-plan.md` (sets `color: #1a1a1a` on `.current-chord-staff`). That fix targets `CurrentChordStaff`'s own SCSS, which this plan leaves untouched; the two are orthogonal and can land in either order. If both are in flight, the only shared file is `PianoApp.scss`, but they touch different blocks (`.current-chord-staff` lives in `CurrentChordStaff.scss`, not `PianoApp.scss`), so there is no edit conflict.
- Sets up the triptych — `docs/_wip/audits/2026-06-24-piano-studio-theory-triptych-circle-of-fifths-chord-naming.md`. The `children` content slot and the `align` prop (`center` default) are the seam the triptych composes into; this plan deliberately does NOT build the triptych.

---

## Component Boundary (the modular contract)

New file: `frontend/src/modules/Piano/components/StudioTopPane.jsx`

```jsx
/**
 * StudioTopPane — the fixed-height white-paper card at the top of the Studio
 * Play and Playback views. Presentational: it owns the card chrome (fixed
 * height, white background, border, radius) and a centered content slot. By
 * default it renders the live grand staff; pass `children` to swap the content
 * (the future music-theory triptych composes in here).
 *
 * @param {React.ReactNode} [children] - content slot; defaults to <CurrentChordStaff/>
 * @param {Map} [activeNotes] - forwarded to the default CurrentChordStaff when no children
 * @param {'center'|'stretch'} [align='center'] - how content sits inside the pane
 * @param {string} [className] - extra class on the card (e.g. a view modifier)
 */
export function StudioTopPane({ children, activeNotes, align = 'center', className = '' }) {
  return (
    <div className={`piano-studio-toppane piano-studio-toppane--${align}${className ? ' ' + className : ''}`}>
      <div className="piano-studio-toppane__content">
        {children ?? <CurrentChordStaff activeNotes={activeNotes} />}
      </div>
    </div>
  );
}
```

Contract notes:
- **Content slot:** `children` is the single swap point. Default (no `children`) = the existing `CurrentChordStaff` lit by `activeNotes`. The triptych later passes its own subtree as `children` (or a future `variant` prop chooses it) — no change to `StudioTopPane`'s shell needed.
- **Fixed height:** the card height is owned by SCSS on `.piano-studio-toppane`, not by content. Content overflow is absorbed by vertical padding, not clipped.
- **Centering:** `align="center"` (default) centers the content slot both axes; `align="stretch"` is reserved for the triptych's full-width three-column layout.
- **Both views import it identically** — there is exactly one source of truth for the top-pane markup and chrome.

---

## File Structure

- **Create:** `frontend/src/modules/Piano/components/StudioTopPane.jsx` — the shared modular top pane.
- **Create:** `frontend/src/modules/Piano/components/StudioTopPane.test.jsx` — render/contract test (vitest).
- **Modify:** `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx` — replace inline `__staff` div with `<StudioTopPane>`.
- **Modify:** `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlayback.jsx` — same swap.
- **Modify:** `frontend/src/Apps/PianoApp.scss` — add `.piano-studio-toppane` block; remove the now-dead `.piano-studio-play__staff` and `.piano-playback__staff` rules; reduce each waterfall's vertical share.

---

## SCSS plan (concrete values)

The studio shell `.piano-mode--studio` is a fixed-height flex column (`display:flex; flex-direction:column; overflow:hidden`), so the stack is: tabs (fixed) → view (`flex:1`) → [top pane, waterfall, keys]. Today the staff card is `flex:0 0 auto` with `margin: 0.75rem 1.5rem` and short content padding (`.current-chord-staff-wrapper { padding: 0.5rem 0 }`), and the waterfall is `flex:1 1 auto`.

New `.piano-studio-toppane` block (single source of truth, replaces both `&__staff` rules):

```scss
// Studio top pane — fixed-height white-paper card. Tall enough that a chord
// with long stems / ledger lines never clips; content is centered with generous
// top/bottom room. Shared by Studio Play and Playback; the music-theory triptych
// swaps in via its content slot.
.piano-studio-toppane {
  flex: 0 0 auto;
  // Fixed height (was content-sized). ~3 staff-heights of vertical room so high
  // and low notes both fit inside the centered single staff.
  height: 16rem;
  margin: 0.75rem 1.5rem;
  background: #fff;
  border: 1px solid var(--piano-border);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;

  &--center { align-items: center; justify-content: center; }
  &--stretch { align-items: stretch; justify-content: stretch; }

  &__content {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    // Generous top/bottom margins so stems digging down / ledger notes up are
    // never clipped at the card edges.
    padding: 2rem 0;
    box-sizing: border-box;
    // The default content is the live grand staff.
    .current-chord-staff-wrapper { width: 100%; padding: 0; }
  }
}
```

Notes on the values:
- `height: 16rem` is "taller than today" — the old card was content-sized (typically ~8–10rem of staff + 0.5rem pad). A fixed 16rem with `padding: 2rem 0` leaves ~12rem of inner space for the staff, which comfortably clears a two-octave-spanning chord with ledger lines and downstems.
- The old `.current-chord-staff-wrapper { padding: 0.5rem 0 }` override inside the staff block is replaced by the pane's `padding: 2rem 0` (and the wrapper padding is zeroed to avoid double-padding). `CurrentChordStaff.scss` already has its own `padding: 3rem 0` for the fullscreen-visualizer context; inside this card the more-specific `.piano-studio-toppane__content .current-chord-staff-wrapper` rule wins and sets `padding: 0`, so the card's own `2rem` is the single source of vertical room.

Waterfall — shrink it. The waterfall keeps `flex: 1 1 auto` (it fills whatever the top pane and keys leave), so making the top pane fixed-taller automatically shrinks the waterfall — that IS the "give the top pane room" mechanism. To guarantee the waterfall doesn't grow unbounded on tall screens and to honor "the waterfall doesn't need to be quite so high", add an explicit cap on its grow share by giving it a `max-height` ceiling tied to the column. Concretely, change both waterfall rules from `flex: 1 1 auto` to keep `flex: 1 1 auto` but the now-taller fixed top pane already claims the space; no further numeric change is required for the core requirement. (Open question Q2 covers whether to additionally cap waterfall height.)

---

### Task 1: Write the failing render/contract test for StudioTopPane

**Files:**
- Create: `frontend/src/modules/Piano/components/StudioTopPane.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StudioTopPane } from './StudioTopPane.jsx';

const map = (entries) => new Map(entries);

describe('StudioTopPane', () => {
  it('renders the fixed-height pane shell with a centered content slot by default', () => {
    const { container } = render(<StudioTopPane activeNotes={map([])} />);
    const pane = container.querySelector('.piano-studio-toppane');
    expect(pane).toBeTruthy();
    // default alignment modifier present
    expect(pane.classList.contains('piano-studio-toppane--center')).toBe(true);
    // content slot exists and, with no children, holds the default grand staff
    const content = pane.querySelector('.piano-studio-toppane__content');
    expect(content).toBeTruthy();
    expect(content.querySelector('.current-chord-staff-wrapper')).toBeTruthy();
  });

  it('swaps in arbitrary content via the children slot (no default staff)', () => {
    const { container } = render(
      <StudioTopPane>
        <div data-testid="triptych-stub">triptych</div>
      </StudioTopPane>,
    );
    const content = container.querySelector('.piano-studio-toppane__content');
    expect(content.querySelector('[data-testid="triptych-stub"]')).toBeTruthy();
    // children replace the default staff — no auto staff when content is provided
    expect(content.querySelector('.current-chord-staff-wrapper')).toBeNull();
  });

  it('applies the stretch alignment modifier when requested', () => {
    const { container } = render(<StudioTopPane align="stretch" activeNotes={map([])} />);
    const pane = container.querySelector('.piano-studio-toppane');
    expect(pane.classList.contains('piano-studio-toppane--stretch')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/StudioTopPane.test.jsx`
Expected: FAIL — `Failed to resolve import "./StudioTopPane.jsx"` (the component does not exist yet).

---

### Task 2: Create the StudioTopPane component

**Files:**
- Create: `frontend/src/modules/Piano/components/StudioTopPane.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { CurrentChordStaff } from './CurrentChordStaff.jsx';

/**
 * StudioTopPane — the fixed-height white-paper card at the top of the Studio
 * Play and Playback views. Presentational: it owns the card chrome (fixed
 * height, white background, border, radius) and a centered content slot. By
 * default it renders the live grand staff; pass `children` to swap the content
 * (the future music-theory triptych composes in here — see
 * docs/_wip/audits/2026-06-24-piano-studio-theory-triptych-circle-of-fifths-chord-naming.md).
 *
 * @param {React.ReactNode} [children] - content slot; defaults to <CurrentChordStaff/>
 * @param {Map} [activeNotes] - forwarded to the default CurrentChordStaff when no children
 * @param {'center'|'stretch'} [align='center'] - how content sits inside the pane
 * @param {string} [className] - extra class on the card (e.g. a view modifier)
 */
export function StudioTopPane({ children, activeNotes, align = 'center', className = '' }) {
  return (
    <div className={`piano-studio-toppane piano-studio-toppane--${align}${className ? ` ${className}` : ''}`}>
      <div className="piano-studio-toppane__content">
        {children ?? <CurrentChordStaff activeNotes={activeNotes} />}
      </div>
    </div>
  );
}

export default StudioTopPane;
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/StudioTopPane.test.jsx`
Expected: PASS — all three tests green.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/components/StudioTopPane.jsx \
        frontend/src/modules/Piano/components/StudioTopPane.test.jsx
git commit -m "feat(piano): extract modular StudioTopPane component"
```

---

### Task 3: Use StudioTopPane in StudioPlay

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`

- [ ] **Step 1: Add the import**

Replace this line:

```jsx
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
```

with:

```jsx
import { StudioTopPane } from '../../../components/StudioTopPane.jsx';
```

- [ ] **Step 2: Replace the inline staff div**

Replace this block:

```jsx
      <div className="piano-studio-play__staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
```

with:

```jsx
      <StudioTopPane activeNotes={activeNotes} />
```

- [ ] **Step 3: Verify there are no remaining references**

Run: `grep -n 'CurrentChordStaff\|piano-studio-play__staff' frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx`
Expected: no output (both references removed).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx
git commit -m "refactor(piano): StudioPlay uses StudioTopPane"
```

---

### Task 4: Use StudioTopPane in StudioPlayback

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlayback.jsx`

- [ ] **Step 1: Add the import**

Replace this line:

```jsx
import { CurrentChordStaff } from '../../../components/CurrentChordStaff.jsx';
```

with:

```jsx
import { StudioTopPane } from '../../../components/StudioTopPane.jsx';
```

- [ ] **Step 2: Replace the inline staff div**

Replace this block:

```jsx
      <div className="piano-playback__staff">
        <CurrentChordStaff activeNotes={activeNotes} />
      </div>
```

with:

```jsx
      <StudioTopPane activeNotes={activeNotes} />
```

- [ ] **Step 3: Verify there are no remaining references**

Run: `grep -n 'CurrentChordStaff\|piano-playback__staff' frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlayback.jsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlayback.jsx
git commit -m "refactor(piano): StudioPlayback uses StudioTopPane"
```

---

### Task 5: Add the shared `.piano-studio-toppane` SCSS and remove dead staff rules

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss`

- [ ] **Step 1: Remove the dead `.piano-studio-play__staff` rule**

In the `.piano-studio-play` block, delete this rule (currently around lines 667–679):

```scss
  // Music notation always reads on white paper, even in the charcoal theme.
  &__staff {
    flex: 0 0 auto;
    margin: 0.75rem 1.5rem;
    background: #fff;
    border: 1px solid var(--piano-border);
    border-radius: var(--r-md);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    .current-chord-staff-wrapper { width: 100%; padding: 0.5rem 0; }
  }
```

- [ ] **Step 2: Remove the dead `.piano-playback__staff` rule**

In the `.piano-playback` block, delete this rule (currently around lines 717–728):

```scss
  &__staff {
    flex: 0 0 auto;
    margin: 0.75rem 1.5rem;
    background: #fff;
    border: 1px solid var(--piano-border);
    border-radius: var(--r-md);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    .current-chord-staff-wrapper { width: 100%; padding: 0.5rem 0; }
  }
```

- [ ] **Step 3: Add the shared block immediately above `.piano-studio-play`**

Insert this new block just before the `.piano-studio-play {` rule:

```scss
// ── Studio top pane (shared by Play + Playback) ───────────────────────────────
// Fixed-height white-paper card: tall enough that a chord with long stems /
// ledger lines never clips; content centered with generous top/bottom room. The
// music-theory triptych composes in via the content slot (align="stretch").
.piano-studio-toppane {
  flex: 0 0 auto;
  height: 16rem;            // fixed + taller than the old content-sized card
  margin: 0.75rem 1.5rem;
  background: #fff;
  border: 1px solid var(--piano-border);
  border-radius: var(--r-md);
  overflow: hidden;
  display: flex;

  &--center { align-items: center; justify-content: center; }
  &--stretch { align-items: stretch; justify-content: stretch; }

  &__content {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 0;         // generous top/bottom margins → no stem/ledger clip
    box-sizing: border-box;
    // Inside the card the staff wrapper fills width with no extra vertical pad
    // (the card's own 2rem owns the vertical room).
    .current-chord-staff-wrapper { width: 100%; padding: 0; }
  }
}
```

- [ ] **Step 4: Verify the dead rules are gone and the new block exists**

Run: `grep -n 'piano-studio-play__staff\|piano-playback__staff\|piano-studio-toppane' frontend/src/Apps/PianoApp.scss`
Expected: only `.piano-studio-toppane` matches; no `__staff` matches under play/playback.

- [ ] **Step 5: Build the frontend to confirm SCSS compiles**

Run: `cd frontend && npx vite build 2>&1 | tail -20`
Expected: build completes with no SCSS error referencing `piano-studio-toppane`. (A full `vite build` from repo root via the Docker flow also works; this step only needs to confirm the stylesheet compiles.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): fixed-height shared studio top pane; shrink waterfall share"
```

---

### Task 6: Full verification — tests + visual check

**Files:** none (verification only)

- [ ] **Step 1: Run the piano component tests**

Run: `./node_modules/.bin/vitest run --config vitest.config.mjs frontend/src/modules/Piano/components/`
Expected: PASS — `StudioTopPane.test.jsx`, `PianoKeyboard.render.test.jsx`, and any other component tests stay green. Capture the final `Test Files … passed` / `Tests … passed` summary line (a piped tail can mask the real exit — grep the pass/fail line).

- [ ] **Step 2: Build + deploy + visual confirm (kckern-server)**

Build and deploy per `CLAUDE.local.md` (confirm BOTH deploy gates are clear first: no active fitness session, no playing Player video). After deploy, open `/piano/studio` (Play tab) and a saved take (Playback) and confirm against the acceptance criteria:
- A chord with long downstems and a ledger-line note (e.g. a low bass-clef cluster + a high treble note) is fully visible inside the top card — nothing clipped at the top or bottom edge.
- The single staff is visually centered in the card.
- Vertical order is: taller staff card → shorter waterfall → keyboard.

The Studio kiosk renders in garage Firefox is NOT the surface here (that's the fitness app); Studio runs on the living-room/general piano kiosk. Reload whichever kiosk shows `/piano/studio` after deploy to pick up the new bundle.

- [ ] **Step 3: Commit any follow-up tweaks**

If the visual check shows the 16rem height needs adjustment (see Open Questions), tweak `height` / `padding` on `.piano-studio-toppane` and re-deploy; commit with a message noting the tuned value.

---

## Self-Review

**Spec coverage:**
- "Fixed-height top pane, taller than today" → Task 5 `height: 16rem` (was content-sized).
- "Adequate top/bottom margin, no stem/ledger clip" → Task 5 `__content { padding: 2rem 0 }`.
- "Centered single staff by default" → `align="center"` default (Task 2) + `&--center` (Task 5); verified Task 1 + Task 6.
- "Shrink the waterfall" → the waterfall stays `flex: 1 1 auto` and the now-taller fixed top pane claims the space, shrinking it (Task 5 narrative; Open Q2 on an explicit cap).
- "Modular / content-swappable" → `children` content slot (Task 2), proven by the swap test (Task 1).
- "Both Play and Playback consistent" → Tasks 3 + 4 use the same component; SCSS deduped to one block (Task 5).
- "Sets up triptych; do NOT build it" → `align="stretch"` modifier + `children` slot reserved; no triptych code.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the command + expected output.

**Type/name consistency:** `StudioTopPane`, props `children` / `activeNotes` / `align` / `className`, classes `.piano-studio-toppane`, `--center` / `--stretch`, `__content` — used identically across the test (Task 1), the component (Task 2), the consumers (Tasks 3–4), and the SCSS (Task 5).

---

## Risks & Open Questions

- **Q1 — exact height.** `16rem` is a reasoned default (≈12rem inner room after padding clears a wide ledger-spanning chord). The true ceiling is the available column height on the target kiosk; if 16rem crowds the keyboard on a short screen, prefer reducing the waterfall's `min-height` over shrinking the top pane. Tune in Task 6 Step 3 against the real display.
- **Q2 — explicit waterfall cap.** This plan relies on the taller fixed top pane to passively shrink the `flex: 1 1 auto` waterfall. If, on tall screens, the waterfall still looks "too high," add `max-height` (or convert the waterfall to a `flex` share like `flex: 1 1 40%`) in a follow-up. Left out of the core change to avoid over-fitting before the visual check.
- **Q3 — `.piano-mode__staff` is a different surface.** There is a separate `.piano-mode__staff` rule (~line 320) used by non-studio piano modes; it is intentionally untouched. Do not consolidate it into `.piano-studio-toppane` — different context (min-height card, not fixed-height).
- **Q4 — brace-black ordering.** If the brace-black plan has not landed, the brace/left-barline may render near-white inside the new white card. That is the brace-black plan's concern, not this one; this plan does not regress it (it leaves `CurrentChordStaff` / `CurrentChordStaff.scss` untouched). Land both; order independent.
- **Q5 — abcjs vertical scaling.** `AbcRenderer` renders at `scale=1.5` with `paddingtop:0 / paddingbottom:0`; the SVG height is content-driven, so a taller card with `overflow:hidden` + centered content is the right clip-safety mechanism (the card no longer shrink-wraps the SVG). No abcjs option change is needed.
