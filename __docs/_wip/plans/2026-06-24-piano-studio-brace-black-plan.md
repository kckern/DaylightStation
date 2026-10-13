# Piano Studio Staff — Brace & Left Barline Black Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the grand-staff brace and the left/system barline render solid black on the white-paper staff card, in both the Studio Play tab and the Studio Playback view.

**Architecture:** abcjs draws the brace and the system connector with `fill="currentColor"` / `stroke="currentColor"` (on the SVG element or its wrapping `<g>`). `currentColor` resolves to the CSS `color` of that node. The staff card inherits `--piano-fg` (`#f1f1f4`, near-white), so those elements paint near-white. The fix sets `color` on the shared `.current-chord-staff` render container so every `currentColor` reference resolves to black at the source. Both views use the same `CurrentChordStaff` component, so one SCSS change covers both.

**Tech Stack:** React, abcjs (`renderAbc` with `add_classes: true`), SCSS, Vitest + happy-dom + @testing-library/react.

---

## Root Cause (verified empirically)

A probe rendering `AbcRenderer` in the project's happy-dom test env (notes `{60, 48}`, key C) produced real SVG and showed:

- The grand-staff **brace** is `<path class="abcjs-brace …" fill="currentColor" stroke="currentColor">`.
- The two **measure barlines** are `<g class="abcjs-bar …" fill="currentColor">` whose child `<path data-name="bar">` has no `fill` (inherits from the group).
- Several **staff-group connector / staff-line** paths are unclassed (`class=null`) or `class="abcjs-top-line"` and also carry `currentColor`.

In `abcjs/dist/abcjs-basic.js`:
- `controller.js` (≈ line 23974): `renderer.foregroundColor = params.foregroundColor ? … : "currentColor"` — the global default fill/stroke is literally the string `"currentColor"`.
- `draw/brace.js` `curvyPath()` (≈ line 22012): brace `<path>` gets `stroke: renderer.foregroundColor, fill: renderer.foregroundColor` → `currentColor`, plus `class` = `abcjs-brace`.
- `draw/print-stem.js` `printStem()` (≈ line 22581): the bar is drawn with `klass = null` (called from `voice.js` ≈ line 22865 as `printStem(…, null, "bar")`), so the bar `<path>` itself has **no class** — only `data-name="bar"`. Its colour comes from the enclosing `<g class="abcjs-bar" fill="currentColor">`.

abcjs sets `fill`/`stroke` as **SVG presentation attributes** (`el.setAttribute("fill", …)`, svg.js ≈ lines 26580 / 26731), not inline styles — so any CSS `color`/`fill` rule beats them.

Existing SCSS in `frontend/src/modules/Piano/components/CurrentChordStaff.scss`:

```scss
.current-chord-staff {
  .abcjs-note, .abcjs-beam, .abcjs-stem, .abcjs-ledger, .abcjs-clef,
  .abcjs-staff-extra, .abcjs-note_selected, .abcjs-bar {
    fill: #1a1a1a !important;
    stroke: #1a1a1a !important;
  }
  .abcjs-staff path, .abcjs-staff line {
    stroke: #333 !important;
    stroke-width: 0.5px !important;
  }
}
```

This list does **not** include `.abcjs-brace`, and it does not cover the unclassed/`abcjs-top-line` system-connector paths. Hence the brace and the left/system barline keep painting `currentColor` (= `--piano-fg`, near-white).

**Container colour:** Neither `.current-chord-staff` (in `CurrentChordStaff.scss`) nor the staff cards (`.piano-studio-play__staff`, `.piano-playback__staff` in `frontend/src/Apps/PianoApp.scss`) set a `color`. The SVG inherits `color: var(--piano-fg)` (`#f1f1f4`, defined at `PianoApp.scss:15`) from a Piano-root ancestor. So `currentColor` ≈ `#f1f1f4` on a white card → washed-out.

**Fix strategy (most targeted):** Set `color: #1a1a1a` on `.current-chord-staff`. This makes `currentColor` resolve to black for the brace, the system connector, and any other `currentColor` element abcjs emits — at the source, without enumerating fragile abcjs class names. Keep the existing explicit `fill/stroke` overrides (they still serve as a belt-and-suspenders guarantee for noteheads/bars and won't conflict).

---

## File Structure

- `frontend/src/modules/Piano/components/CurrentChordStaff.scss` — add `color: #1a1a1a;` to the `.current-chord-staff` block. Single responsibility: styling the shared abcjs render container.
- `frontend/src/modules/Piano/components/CurrentChordStaff.brace.test.jsx` (new) — a rendering test that asserts the brace + system-connector elements depend on the container colour (i.e. they are `currentColor`-driven), so a future change that hard-codes a non-black colour or drops the container colour rule is caught. Plus a string-level guard that the SCSS sets a dark `color` on `.current-chord-staff`.

No other files change. `StudioPlay.jsx` and `StudioPlayback.jsx` both render `CurrentChordStaff`; the SCSS change reaches both with no per-view edits.

---

### Task 1: Regression test — brace/connector are currentColor-driven and container is dark

**Files:**
- Create: `frontend/src/modules/Piano/components/CurrentChordStaff.brace.test.jsx`

**Why this shape:** happy-dom does not apply SCSS or compute `currentColor`, so we cannot assert a resolved black pixel in a unit test. Instead we assert two true invariants: (1) abcjs still emits the brace + bars with `currentColor` (so the container-colour fix is what governs them — if a future abcjs upgrade hard-codes a colour, this test flags the changed contract); (2) the component's SCSS sets a dark `color` on `.current-chord-staff`. Together these lock in the fix.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { render } from '@testing-library/react';
import { AbcRenderer } from '../../MusicNotation/renderers/AbcRenderer.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CurrentChordStaff brace & system barline colour', () => {
  it('abcjs renders the grand-staff brace as a currentColor-driven element', () => {
    // A treble + bass note forces a full grand staff (brace + connecting barline).
    const notes = new Map([[60, {}], [48, {}]]);
    const { container } = render(<AbcRenderer notes={notes} keySignature="C" />);

    const brace = container.querySelector('.abcjs-brace');
    expect(brace, 'grand-staff brace should be rendered').toBeTruthy();
    // The brace must inherit its colour (currentColor), not a hard-coded non-black.
    expect(brace.getAttribute('fill')).toBe('currentColor');
    expect(brace.getAttribute('stroke')).toBe('currentColor');
  });

  it('abcjs renders barlines whose colour is governed by the enclosing group', () => {
    const notes = new Map([[60, {}], [48, {}]]);
    const { container } = render(<AbcRenderer notes={notes} keySignature="C" />);

    const bar = container.querySelector('.abcjs-bar');
    expect(bar, 'a barline group should be rendered').toBeTruthy();
    // The bar group carries currentColor; the child path inherits it.
    expect(bar.getAttribute('fill')).toBe('currentColor');
  });

  it('SCSS sets a dark color on .current-chord-staff so currentColor resolves black', () => {
    const scss = readFileSync(path.join(__dirname, 'CurrentChordStaff.scss'), 'utf8');
    // Locate the `.current-chord-staff {` block (not the `-wrapper` block) and
    // assert it sets a dark `color`.
    const blockStart = scss.search(/\.current-chord-staff\s*\{/);
    expect(blockStart, '.current-chord-staff rule should exist').toBeGreaterThan(-1);
    const block = scss.slice(blockStart, blockStart + 600);
    const colorMatch = block.match(/color\s*:\s*(#[0-9a-fA-F]{3,6}|black)\s*;/);
    expect(colorMatch, '.current-chord-staff should set a dark color').toBeTruthy();
    const value = colorMatch[1].toLowerCase();
    expect(['#000', '#000000', 'black', '#111', '#1a1a1a', '#222', '#333']).toContain(value);
  });
});
```

- [ ] **Step 2: Run the test to verify the new SCSS assertion fails (and the abcjs ones pass)**

Run:
```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/components/CurrentChordStaff.brace.test.jsx
```
Expected: the two abcjs render tests PASS; the SCSS-color test FAILS with `.current-chord-staff should set a dark color` (because no `color` is set yet). This proves the test exercises the bug.

- [ ] **Step 3: Commit the test**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/components/CurrentChordStaff.brace.test.jsx
git commit -m "test(piano): guard grand-staff brace + barline render black on white card"
```

---

### Task 2: Fix — set a dark color on the staff render container

**Files:**
- Modify: `frontend/src/modules/Piano/components/CurrentChordStaff.scss` (the `.current-chord-staff` block, currently lines ~14-34)

- [ ] **Step 1: Add the container colour**

Open `frontend/src/modules/Piano/components/CurrentChordStaff.scss`. The `.current-chord-staff` block currently reads:

```scss
.current-chord-staff {
  display: flex;
  align-items: center;
  justify-content: center;

  // Black notes and staff on cream background
  .abcjs-note,
```

Change it to add a `color` declaration immediately after `justify-content: center;`:

```scss
.current-chord-staff {
  display: flex;
  align-items: center;
  justify-content: center;
  // abcjs paints the brace and the system/connecting barline with
  // fill/stroke="currentColor". Pin the container colour to black so those
  // inherited-colour elements read solid black on the white-paper card,
  // instead of inheriting the near-white --piano-fg theme foreground.
  color: #1a1a1a;

  // Black notes and staff on cream background
  .abcjs-note,
```

Leave the rest of the block (the `.abcjs-note … .abcjs-bar` and `.abcjs-staff path/line` rules) unchanged.

- [ ] **Step 2: Run the test to verify it now passes**

Run:
```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/components/CurrentChordStaff.brace.test.jsx
```
Expected: all three tests PASS.

- [ ] **Step 3: Run the broader MusicNotation + abc suite for regressions**

Run:
```bash
cd /opt/Code/DaylightStation && ./node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/MusicNotation frontend/src/modules/Piano/components
```
Expected: all PASS (no behavior change to ABC generation or other renderers).

- [ ] **Step 4: Commit the fix**

```bash
cd /opt/Code/DaylightStation
git add frontend/src/modules/Piano/components/CurrentChordStaff.scss
git commit -m "fix(piano): grand-staff brace + left barline render black on studio staff

abcjs draws the brace and system connector with fill/stroke=currentColor;
the white-paper staff card inherited --piano-fg (near-white), washing them
out. Pin color:#1a1a1a on .current-chord-staff so currentColor resolves
black. Covers both Studio Play and Studio Playback (shared component)."
```

---

### Task 3: Visual verification in both views (manual, on prod kiosk)

**Goal:** Confirm the brace + left/system barline read solid black on the white card in BOTH the Studio Play tab and the Studio Playback view.

> **Deploy gate (CLAUDE.local.md):** before `sudo deploy-daylight`, confirm no active fitness session and no live Player video playing. A redeploy restarts the container.

- [ ] **Step 1: Build and deploy**

```bash
cd /opt/Code/DaylightStation
docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
# Deploy gate check, then:
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```

- [ ] **Step 2: Reload the piano kiosk** so the new bundle is served (FKB cache: force-stop + restart FKB, or `loadStartURL`/`clearCache` per CLAUDE.local.md "Reloading the living room kiosk").

- [ ] **Step 3: Verify Studio Play tab** — open `/piano/studio`, Play tab. Press a chord spanning treble + bass (so a full grand staff renders). Confirm the curly **brace** and the **left/system barline** are solid black, matching the noteheads/clefs.

- [ ] **Step 4: Verify Studio Playback view** — open a saved take's playback view. Confirm the same staff renders the brace + left barline black during playback.

- [ ] **Step 5: Record the result** in this plan (brace black? left bar black? both views?). If anything is still off-colour, capture the offending element's class/`data-name` via the kiosk devtools and revisit — see Open Questions.

---

## Self-Review

**Spec coverage:**
- "Find why brace/barline `stroke`/`fill` isn't black" → Root Cause section (verified via probe + abcjs source).
- "Force black (set the notation SVG colour at the container)" → Task 2 sets `color` on the container, the SSOT for `currentColor`.
- "Verify in both Studio Play and the playback view (same staff component)" → both render `CurrentChordStaff`; Task 2 covers both via shared SCSS; Task 3 verifies both visually.
- Acceptance criteria ("brace and left barline visually black on the white card") → Task 3 steps 3-4.

**Placeholder scan:** No TBD/TODO; the test and SCSS edit show complete code.

**Type/name consistency:** Class name `.current-chord-staff` (component render container, set by `AbcRenderer` default `className`... — note: `CurrentChordStaff.jsx` passes `className="current-chord-staff"` to `AbcRenderer`, confirmed) is used consistently in test and SCSS. abcjs class `.abcjs-brace` / `.abcjs-bar` match the probe output.

---

## Risks / Open Questions

- **happy-dom can't resolve `currentColor`:** the unit test asserts the *contract* (brace is currentColor-driven + SCSS sets a dark container color), not a resolved pixel. The true visual confirmation is Task 3 (manual, on the real kiosk). This is intentional and called out.
- **abcjs upgrade fragility:** if a future abcjs version stops using `currentColor` for the brace (e.g. hard-codes a colour, or renames the class), Task 1's first test will flag the changed contract. The container-colour fix is robust to class renames because it works at the inheritance source, not via per-class overrides.
- **Other Piano surfaces share the component:** `PianoVisualizer.jsx` (fullscreen overlay) and `PianoVideoPlayer.jsx` also render `CurrentChordStaff`. They use different background cards; setting `color:#1a1a1a` makes the brace black there too. Verify these still look correct if they were relying on the (previously washed-out) brace blending into a dark background — none are expected to, since the existing rules already paint notes/bars `#1a1a1a`, but note it during Task 3 if convenient.
- **Stroke vs fill:** the brace sets BOTH `fill` and `stroke` to `currentColor`; the container `color` governs both, so no separate stroke handling is needed. The existing explicit overrides remain as a backstop.
- **Open question (only if Task 3 shows a residual off-colour element):** if after the container fix some sliver of the left connector is still not black, it would be an unclassed staff-group path that doesn't inherit `color` from `.current-chord-staff` (unlikely — SVG `color` inherits down the tree). Resolution would be to additionally enumerate `.current-chord-staff .abcjs-brace, .current-chord-staff path[data-name="bar"]` with explicit `fill/stroke: #1a1a1a !important`. Capture the element first; don't add speculative overrides.
