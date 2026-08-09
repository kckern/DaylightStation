# Sheet Music Native Notation Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dim a deselected staff by fading OSMD's own per-staff SVG group instead of covering it with a white rectangle, and stop drawing expected-but-unstruck noteheads hollow (a hollow head means a half or whole note).

**Architecture:** OSMD emits one `<g class="staffline">` per staff per system, with every mark on that staff — staff lines, clef, noteheads, stems, beams, flags, ledger lines, modifiers — as a child. Toggling one class on those groups and setting `opacity` replaces the whole overlay approach: nothing can escape the dim because nothing is being covered. `StaffDimLayer` stops rendering positioned divs and becomes an effect that toggles that class, following the same DOM-mutation pattern `NoteHighlightLayer` already uses on OSMD's per-note groups.

**Tech Stack:** React 18, OpenSheetMusicDisplay 2.0 (SVG backend, vexflow), SCSS, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Run tests with the main checkout's vitest binary against the worktree config**, from the worktree root: `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs <paths>`. `npm run test:isolated` does not work from a worktree.
- **jsdom applies no SCSS and computes no layout.** Colour, opacity and position cannot be asserted by rendering. Assert the SCSS **source text** (the existing pattern — see `ScorePlayer.test.jsx`'s `.piano-note-hit` block check) and confirm appearance in a browser after deploy.
- **Never use raw `console.*` for diagnostics.** Use the logging framework in `frontend/src/lib/logging/`.
- **0-based staff ids everywhere in app code.** `activeParts`, `staffBoxes.staff`, and `dimmed` are all 0-based (0 = top = RH). OSMD's `g.staffline` id is 1-**based**; convert once, at the boundary.
- **Do not change** what the Learn gate accepts, how it advances, Polish grading, or the wet-ink layer.
- OSMD `g.staffline` id shape, verified against the real Green Hill Zone score: `Piano0-1` (staff 0) and `Piano0-2` (staff 1), 36 groups for 18 systems × 2 staves.

---

### Task 1: `staffGroups()` — find OSMD's per-staff groups

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (add export near `extractPerStaffGeometry`, around line 192)
- Test: `frontend/src/modules/MusicNotation/renderers/osmdRender.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `staffGroups(svgRoot: Element|null) => Array<{staff: number, el: Element}>` — 0-based staff id and the group element. Returns `[]` for null/empty input. Task 2 consumes this.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/modules/MusicNotation/renderers/osmdRender.test.js`. Add `staffGroups` to the existing import list at the top of the file.

```javascript
describe('staffGroups', () => {
  // Mirrors the real OSMD output: one <g class="staffline"> per staff per
  // system, id `{Instrument}{n}-{staffNumber}` with a 1-BASED trailing number.
  const svgWith = (ids) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const id of ids) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'staffline');
      g.setAttribute('id', id);
      svg.appendChild(g);
    }
    return svg;
  };

  it('converts the 1-based id suffix to a 0-based staff id', () => {
    const svg = svgWith(['Piano0-1', 'Piano0-2']);
    expect(staffGroups(svg).map((g) => g.staff)).toEqual([0, 1]);
  });

  it('returns one entry per system, not per staff', () => {
    // Two systems of a grand staff = four groups, staff ids repeating.
    const svg = svgWith(['Piano0-1', 'Piano0-2', 'Piano0-1', 'Piano0-2']);
    expect(staffGroups(svg).map((g) => g.staff)).toEqual([0, 1, 0, 1]);
  });

  it('hands back the element itself so a caller can class it', () => {
    const svg = svgWith(['Piano0-2']);
    expect(staffGroups(svg)[0].el).toBe(svg.querySelector('g.staffline'));
  });

  it('skips a group whose id carries no staff number rather than guessing', () => {
    expect(staffGroups(svgWith(['Piano0-1', 'junk', 'Piano0-2']))).toHaveLength(2);
  });

  it('survives null and an empty sheet', () => {
    expect(staffGroups(null)).toEqual([]);
    expect(staffGroups(svgWith([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/MusicNotation/renderers/osmdRender.test.js -t "staffGroups"
```
Expected: FAIL — `staffGroups is not a function` (it is not exported yet).

- [ ] **Step 3: Write minimal implementation**

Insert into `frontend/src/modules/MusicNotation/renderers/osmdRender.js` immediately after `extractPerStaffGeometry` ends (line 192, before the `/**` block introducing `noteheadEl`):

```javascript
/**
 * Every engraved staff group in the rendered SVG, tagged with the 0-based staff
 * id the rest of the app speaks. OSMD emits one `<g class="staffline">` per staff
 * PER SYSTEM, id shaped `{Instrument}{n}-{staffNumber}` where the trailing number
 * is 1-BASED (`Piano0-1` is staff 0). Everything engraved on that staff — lines,
 * clef, noteheads, stems, beams, flags, ledger lines, modifiers — is a child of
 * the group. That containment is the point: it lets a whole staff be dimmed
 * without an overlay rectangle, which stems and beams legitimately escape.
 * @param {Element|null} svgRoot
 * @returns {Array<{staff:number, el:Element}>} empty when nothing is rendered
 */
export function staffGroups(svgRoot) {
  if (!svgRoot?.querySelectorAll) return [];
  const out = [];
  for (const el of svgRoot.querySelectorAll('g.staffline')) {
    const n = Number(String(el.getAttribute('id') || '').split('-').pop());
    // An unparseable id means we cannot say which staff this is; skipping it
    // dims nothing, while guessing could dim the staff the user is playing.
    if (!Number.isInteger(n) || n < 1) continue;
    out.push({ staff: n - 1, el });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/MusicNotation/renderers/osmdRender.test.js
```
Expected: PASS — the five new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/MusicNotation/renderers/osmdRender.js \
        frontend/src/modules/MusicNotation/renderers/osmdRender.test.js
git commit -m "feat(piano): expose OSMD's per-staff SVG groups

OSMD emits one g.staffline per staff per system holding every mark on that
staff. Surfacing it with a 0-based staff id is what lets a staff be dimmed
by fading its own group instead of covering it with a rectangle."
```

---

### Task 2: `StaffDimLayer` fades the group instead of covering the staff

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.jsx` (full rewrite)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx` (full rewrite)

**Interfaces:**
- Consumes: `staffGroups(svgRoot)` from Task 1.
- Produces: `<StaffDimLayer container={Element|null} dimmed={number[]} layoutToken={unknown} />`, rendering `null`. `container` is the ELEMENT containing the engraved `<svg>` — not a ref. `layoutToken` is any value whose identity changes when the score is re-engraved. The exported `dimBands` function and the `.piano-score-staff-dim` class are **removed**. Task 3 consumes this signature.

> **Amended mid-execution (human ruling).** This task originally specified a
> `containerRef` prop. React commits layout effects bottom-up, so an ancestor
> host element's ref is **not yet attached** when a child's `useLayoutEffect`
> runs on first mount — verified by probe (first mount `false`, later commit
> `true`). The component would silently no-op; production only escaped it
> because `layoutFresh` delays mounting to a later commit. Passing the element
> removes the ordering dependency entirely.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `StaffDimLayer.test.jsx` with:

```jsx
import { render } from '@testing-library/react';
import { useRef } from 'react';
import StaffDimLayer from './StaffDimLayer.jsx';

// Mirrors the real engraved DOM: OSMD renders its <svg> inside the renderer's
// host div, one g.staffline per staff per system, 1-based id suffix.
function Harness({ dimmed, layoutToken = 1, ids = ['Piano0-1', 'Piano0-2'] }) {
  const ref = useRef(null);
  return (
    <div ref={ref}>
      <div className="musicxml-renderer__svg">
        <svg>
          {ids.map((id, i) => <g key={i} className="staffline" id={id} />)}
        </svg>
      </div>
      <StaffDimLayer containerRef={ref} dimmed={dimmed} layoutToken={layoutToken} />
    </div>
  );
}

const dimmedIds = (c) => [...c.querySelectorAll('g.staffline.is-dimmed')].map((g) => g.id);

describe('StaffDimLayer', () => {
  it('dims only the deselected staff, by class on OSMD\'s own group', () => {
    const { container } = render(<Harness dimmed={[1]} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
  });

  it('dims every system of that staff, not just the first', () => {
    const { container } = render(
      <Harness dimmed={[0]} ids={['Piano0-1', 'Piano0-2', 'Piano0-1', 'Piano0-2']} />,
    );
    expect(dimmedIds(container)).toEqual(['Piano0-1', 'Piano0-1']);
  });

  it('renders no element of its own — nothing is covered', () => {
    const { container } = render(<Harness dimmed={[1]} />);
    expect(container.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });

  it('clears the class when the staff is reselected', () => {
    const { container, rerender } = render(<Harness dimmed={[1]} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
    rerender(<Harness dimmed={[]} />);
    expect(dimmedIds(container)).toEqual([]);
  });

  it('re-applies after a re-engrave replaces the SVG', () => {
    // A new layoutToken stands for a fresh engrave (zoom, flow, transpose).
    const { container, rerender } = render(<Harness dimmed={[1]} layoutToken={1} />);
    container.querySelector('g.staffline.is-dimmed').classList.remove('is-dimmed');
    rerender(<Harness dimmed={[1]} layoutToken={2} />);
    expect(dimmedIds(container)).toEqual(['Piano0-2']);
  });

  it('does nothing when nothing is deselected or nothing is engraved', () => {
    const { container } = render(<Harness dimmed={[]} ids={[]} />);
    expect(dimmedIds(container)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx
```
Expected: FAIL — the current component ignores `containerRef` and renders positioned divs, so no `g.staffline.is-dimmed` is ever found.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `StaffDimLayer.jsx` with:

```jsx
import { useLayoutEffect } from 'react';
import { staffGroups } from '../../../../MusicNotation/renderers/osmdRender.js';

const DIM = 'is-dimmed';

/**
 * StaffDimLayer — dims DESELECTED staves by fading OSMD's own per-staff group
 * rather than covering the staff.
 *
 * The overlay this replaces painted translucent white rectangles over each
 * staff band. Musical ink is not rectangular: stems, beams, ledger lines and
 * slurs all legitimately extend past the band, so they escaped it, and the
 * band's straight edges cut across them. Fading `g.staffline` instead takes
 * every mark on that staff with it, because they are all its children.
 *
 * Group opacity composites the group ONCE rather than per element, so
 * overlapping strokes do not darken each other — the staff reads as genuinely
 * lighter ink instead of a film laid on top.
 *
 * Renders nothing, and needs no z-index: dimming the engraving itself means
 * live overlays (cursor, wet ink, note chips) are untouched, so they no longer
 * have to be stacked above a mask to avoid being muted by it.
 *
 * @param {object} p
 * @param {{current: Element|null}} p.containerRef - any ancestor of the engraved <svg>
 * @param {number[]} [p.dimmed] - 0-based staff ids to dim
 * @param {unknown} [p.layoutToken] - identity changes on re-engrave; a fresh
 *   engrave replaces the SVG and with it every class set here, so the effect
 *   must re-run. Zoom, flow and transpose all force one.
 */
export default function StaffDimLayer({ containerRef, dimmed = [], layoutToken = null }) {
  useLayoutEffect(() => {
    const svg = containerRef?.current?.querySelector('svg');
    if (!svg) return undefined;
    const want = new Set(dimmed);
    const touched = [];
    for (const { staff, el } of staffGroups(svg)) {
      if (!want.has(staff)) continue;
      el.classList.add(DIM);
      touched.push(el);
    }
    // Clear exactly what we set. The SVG outlives this component across mode
    // changes, so leaving the class behind would strand a dimmed staff.
    return () => { for (const el of touched) el.classList.remove(DIM); };
  }, [containerRef, dimmed, layoutToken]);

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx
```
Expected: PASS — all six tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx
git commit -m "feat(piano): dim a staff by fading its own group, not covering it

Stems, beams and ledger lines escaped the rectangular mask and its straight
edges cut across them. Classing OSMD's g.staffline takes every mark on the
staff with it, and group opacity reads as lighter ink rather than a film."
```

---

### Task 3: Wire it into ScorePlayer and replace the stylesheet rule

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx:1939-1942`
- Modify: `frontend/src/Apps/PianoApp.scss:2843-2851` (the `.piano-score-staff-dim` block and its comment)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` (renderer mock ~line 168, dim test ~line 3645)
- Modify: `docs/reference/piano/sheet-music-player.md`

**Interfaces:**
- Consumes: `<StaffDimLayer container dimmed layoutToken />` from Task 2 — `container` is an **element**, not a ref (see the amendment note on Task 2).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Give the renderer mock a real SVG to dim**

The mock currently renders no SVG, so nothing can be classed. Mirror the real
structure (`MusicXmlRenderer.jsx:185-190`: host div `.musicxml-renderer__svg`
inside `.musicxml-renderer`, OSMD's `<svg>` inside the host, `children` as a
sibling of the host).

In `ScorePlayer.test.jsx`, replace the mock's return (line 168):

```jsx
      return <div data-testid="renderer" className="musicxml-renderer">{children}</div>;
```

with:

```jsx
      return (
        <div data-testid="renderer" className="musicxml-renderer">
          {/* Mirrors the engraved DOM: OSMD renders its <svg> into the host div,
              one g.staffline per staff per system with a 1-based id suffix. */}
          <div className="musicxml-renderer__svg">
            <svg>
              <g className="staffline" id="Piano0-1" />
              <g className="staffline" id="Piano0-2" />
            </svg>
          </div>
          {children}
        </div>
      );
```

- [ ] **Step 2: Write the failing test**

In `ScorePlayer.test.jsx`, replace the whole `describe('ScorePlayer — staff dim layer (Task 8)', ...)` block (around line 3645) with:

```jsx
describe('ScorePlayer — staff dim (Task 8)', () => {
  afterEach(() => { cleanup(); });

  const dimmedIds = () => [...document.querySelectorAll('g.staffline.is-dimmed')].map((g) => g.id);

  it('dims the deselected staff in Learn and clears when reselected', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    enterLearn();
    await act(async () => {});
    expect(dimmedIds()).toEqual([]);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // deselect LH
    // The LOWER staff specifically — a count alone would pass if we dimmed the
    // hand the player is actually using.
    expect(dimmedIds()).toEqual(['Piano0-2']);

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); }); // reselect LH
    expect(dimmedIds()).toEqual([]);
  });

  it('covers nothing — no mask element is rendered', async () => {
    renderPlayer();
    await act(async () => {});
    enterLearn();
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Left hand' })); });
    expect(document.querySelectorAll('.piano-score-staff-dim')).toHaveLength(0);
  });

  it('PianoApp.scss fades the staff group and keeps no mask rule', () => {
    // jsdom computes no stylesheet, so assert the source (same pattern as the
    // .piano-note-hit colour check above).
    const scss = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    expect(scss).toMatch(/g\.staffline\.is-dimmed\s*\{[^}]*opacity/);
    expect(scss).not.toContain('.piano-score-staff-dim');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx -t "staff dim"
```
Expected: FAIL — ScorePlayer still passes `staffBoxes`/`dimmed` and renders mask divs; no `is-dimmed` class exists and the SCSS still defines `.piano-score-staff-dim`.

- [ ] **Step 4: Point ScorePlayer at the new props**

In `ScorePlayer.jsx`, replace lines 1939-1942:

```jsx
            <StaffDimLayer
              staffBoxes={layout.staffBoxes}
              dimmed={dimmedStaves}
            />
```

with:

```jsx
            <StaffDimLayer
              container={scrollRef.current}
              dimmed={dimmedStaves}
              layoutToken={layout}
            />
```

`scrollRef` is the existing scroll container ref declared at `ScorePlayer.jsx:268`
and attached to `.piano-score-player__scroll`, which contains the renderer. Pass
`scrollRef.current` — the **element**, not the ref (see the amendment note on
Task 2). This render is already gated on `layoutFresh`, which only becomes true
after a layout has been published, so the scroll div mounted in an earlier commit
and `scrollRef.current` is a real element here. `layout` gets a fresh identity on
every engrave, which is exactly when the class needs re-applying.

- [ ] **Step 5: Replace the stylesheet rule**

In `frontend/src/Apps/PianoApp.scss`, replace the block at lines 2843-2851:

```scss
// Deselected-staff mask (wave-3 A): paper at 65% ⇒ engraved ink reads ~0.35.
// z2 — under the range tint (3), cursor (5) and wet ink; wrong notes on a
// dimmed staff still render at full strength above this.
.piano-score-staff-dim {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  background: rgba(255, 255, 255, 0.65); // the engraved sheet's paper white
  border-radius: 4px;
}
```

with:

```scss
// Deselected staff (wave-3 A) — dimmed NATIVELY: fade OSMD's own per-staff
// group instead of covering the staff with a rectangle. Every mark on the
// staff (lines, clef, noteheads, stems, beams, flags, ledgers, modifiers) is a
// child of this group, so nothing escapes the way stems and beams escaped a
// band-shaped mask, and there are no straight edges cutting across curved ink.
//
// Group opacity composites the group ONCE rather than per element, so
// overlapping strokes do not darken each other: the staff reads as genuinely
// lighter ink, not as a translucent film laid over it.
//
// No z-index, deliberately. The engraving itself is dimmed, so the cursor,
// wet ink and note chips are unaffected — they no longer need to be stacked
// above a mask to avoid being muted by it.
.musicxml-renderer__svg g.staffline.is-dimmed { opacity: 0.32; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ \
  frontend/src/modules/MusicNotation/
```
Expected: PASS, all files. If any other spec referenced `.piano-score-staff-dim`, update it to the class assertion above — that class no longer exists anywhere.

- [ ] **Step 7: Update the reference doc**

In `docs/reference/piano/sheet-music-player.md`, replace this paragraph:

```markdown
**Staff dimming** (Listen/Learn/Polish, grand-staff scores): a deselected
staff renders under a translucent mask rather than disappearing, using real
per-staff geometry (not a bounding-box guess) — so the shape of what you
aren't playing stays visible for context. A wrong note struck on a dimmed
staff still renders at full strength above the mask; the stacking order,
bottom to top, is dim mask → range tint → cursor band → engraved ink → wet
ink, so nothing live is ever muted by the dim layer.
```

with:

```markdown
**Staff dimming** (Listen/Learn/Polish, grand-staff scores): a deselected
staff is faded rather than hidden, so the shape of what you aren't playing
stays visible for context. The fade is applied to the engraving itself — the
staff's own group in the rendered notation — not to an overlay laid on top of
it. Everything on that staff fades together, including the stems, beams and
ledger lines that reach outside the staff, and the fade has no edges of its
own to notice. Because the ink itself is dimmed, live overlays — the cursor,
wet ink, note chips — are unaffected and need no stacking order to stay clear
of it.
```

Also update the `StaffDimLayer.jsx` row of the Key files table:

```markdown
| `StaffDimLayer.jsx` | translucent mask over deselected staves, from per-staff geometry |
```

becomes:

```markdown
| `StaffDimLayer.jsx` | fades deselected staves by classing the engraving's own per-staff group |
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx \
        frontend/src/Apps/PianoApp.scss \
        docs/reference/piano/sheet-music-player.md
git commit -m "feat(piano): retire the staff mask overlay for a native fade

Deletes the positioned white rectangles and the z-index they forced on every
live overlay. The dim now rides on the engraving's own staff group, so stems
and beams cannot escape it and it has no edges."
```

---

### Task 4: Expected-but-unstruck noteheads stop being hollow

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss:2823-2839` (the `.piano-note-pending` block and its keyframes)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`
- Modify: `docs/reference/piano/sheet-music-player.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `ScorePlayer.test.jsx`, directly after the `.piano-note-hit` SCSS test (the one asserting `#6b4423`), inside the same `describe`:

```jsx
  it('PianoApp.scss never draws a pending notehead hollow — that reads as a half note', () => {
    const scss = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    const block = scss.match(/\.piano-note-pending\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(block).toBeTruthy();
    // A hollow head means a half or whole note. An outlined quarter note is a
    // notation error, whatever it is trying to signal.
    expect(block).not.toMatch(/fill:\s*none/);
    expect(block).toMatch(/fill:\s*var\(--nh-color/);
    // The pulse is what now distinguishes pending from a struck note, so it
    // must never reach full strength.
    const frames = scss.match(/@keyframes piano-note-pending-pulse\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(frames).toBeTruthy();
    expect(frames).not.toMatch(/opacity:\s*1\b/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx -t "hollow"
```
Expected: FAIL — the block currently contains `fill: none` and the keyframes peak at `opacity: 1`.

- [ ] **Step 3: Write the implementation**

In `frontend/src/Apps/PianoApp.scss`, replace lines 2823-2833:

```scss
  // Expected at this step but not yet struck (Learn's all-notes rule). Outlined
  // and pulsing rather than filled, so "you still owe me the left hand" is legible
  // without competing with the hit colour.
  .piano-note-pending {
    path, rect, ellipse, text {
      fill: none;
      stroke: var(--nh-color, #23262b);
      stroke-width: 1.2;
    }
    animation: piano-note-pending-pulse 1.1s ease-in-out infinite;
  }
```

with:

```scss
  // Expected at this step but not yet struck (Learn's all-notes rule). FILLED
  // and pulsing, never outlined: a hollow notehead means a half or whole note,
  // so outlining a quarter note states the wrong duration — a notation error
  // whatever it is signalling. The PULSE carries "you still owe me this one"
  // instead, and its ceiling stays below full strength so a pending note is
  // never mistaken for one already struck.
  .piano-note-pending {
    path, rect, ellipse, text { fill: var(--nh-color, #23262b); }
    animation: piano-note-pending-pulse 1.1s ease-in-out infinite;
  }
```

Then replace the keyframes at lines 2836-2839:

```scss
@keyframes piano-note-pending-pulse {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1; }
}
```

with:

```scss
@keyframes piano-note-pending-pulse {
  0%, 100% { opacity: 0.3; }
  50%      { opacity: 0.65; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```
Expected: PASS, whole directory.

- [ ] **Step 5: Update the reference doc**

The doc currently says nothing about pending notes — verified, there is no
occurrence of "pending" or "outlined" in the file. Add this paragraph to
`docs/reference/piano/sheet-music-player.md` in the Learn section, immediately
after the paragraph beginning `**Wrong-note feedback (kid-UX, deliberately
light-touch):**` and before the `## The loop group and range handles` heading:

```markdown
**Notes the step is still waiting on.** Learn advances only once every
active-staff note of a step has been struck, so a note that is expected but
hasn't arrived yet pulses at reduced strength — it is never drawn hollow. A
hollow notehead means a half or whole note, so outlining a quarter note would
state the wrong duration. The pulse carries "still owed" instead, and its
ceiling stays below full strength so a waiting note is never mistaken for one
already played.
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx \
        docs/reference/piano/sheet-music-player.md
git commit -m "fix(piano): pending noteheads pulse instead of going hollow

A hollow head means a half or whole note, so an outlined quarter note stated
the wrong duration. The pulse carries 'still owed' instead, capped below full
strength so it stays distinct from a struck note."
```

---

### Task 5: Full suite, build, deploy, and verify visually

**Files:** none modified.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Run the whole Piano suite for regressions**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/ frontend/src/modules/MusicNotation/
```
Expected: PASS. The pre-change baseline is 2946 tests across 257 files in
`frontend/src/modules/Piano/` — the count should be at or above that, with no
failures. Investigate any failure before continuing; do not proceed on red.

- [ ] **Step 2: Merge to main**

This worktree is on branch `sheetmusic-learn-hand-deadlock` and `main` is
checked out in the primary repo directory, so merge from there by path:

```bash
git -C /opt/Code/DaylightStation merge --ff-only sheetmusic-learn-hand-deadlock
git -C /opt/Code/DaylightStation log --oneline -1
```
Expected: a fast-forward. If it is not a fast-forward, stop — someone else has
moved main, and the branch needs rebasing first.

- [ ] **Step 3: Check the deploy gate — HALT if either signal is active**

This is its own step and must never be chained to the deploy command.

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```

Clear to deploy means ALL of: render-line count `0`, no `"videoState":"playing"`
(`paused` or absent is fine), `"sessionActive":false`, `"rosterSize":0`. If a
workout is live or a video is playing, WAIT — a redeploy restarts the container
and interrupts it.

- [ ] **Step 4: Build and deploy**

```bash
cd /opt/Code/DaylightStation && ./scripts/build-daylight.sh
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify the CSS actually shipped**

`/build.txt` stamps the current commit even when earlier layers are cached
stale, so check the served asset, not the build stamp:

```bash
curl -s http://localhost:3111/build.txt
sudo docker exec daylight-station sh -c \
  'grep -o "staffline.is-dimmed{[^}]*}" frontend/dist/assets/*.css; \
   grep -c "piano-score-staff-dim" frontend/dist/assets/*.css'
```
Expected: the `is-dimmed` rule with its opacity is present, and the
`piano-score-staff-dim` count is `0` in every asset.

- [ ] **Step 6: Look at it**

jsdom applies no styles, so appearance has to be confirmed in a browser. Open a
grand-staff score (Green Hill Zone), enter Learn, and deselect the left hand.

Check specifically:
1. **No rectangle.** No visible band edge anywhere, especially between the staves.
2. **Stems and beams fade with their staff** — nothing renders at full strength outside the staff lines.
3. **The brace and barlines.** `vf-connector` (the brace and the barlines spanning both staves) lives inside the *lower* staff's group, so dimming the left hand also dims them. If half-faded barlines look wrong, add `.musicxml-renderer__svg g.staffline.is-dimmed .vf-connector { opacity: 1; }` — but only if it actually reads badly, not preemptively.
4. **Pending notes** read as faint pulsing filled heads, never as half notes.
5. **Zoom in and out**, and change key, to force re-engraves — the dim must survive each one.

- [ ] **Step 7: Reload the piano kiosk**

The tablet caches its bundle and will keep serving the old one. Run from inside
the container so the password is encoded properly rather than through shell curl:

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.245:2323/?' + qs).then(r=>r.text()).then(console.log);
"
```

- [ ] **Step 8: Commit any connector fix**

Only if step 6.3 required the `vf-connector` rule:

```bash
git add frontend/src/Apps/PianoApp.scss
git commit -m "fix(piano): keep the brace and cross-staff barlines at full strength

They live inside the lower staff's group, so dimming the left hand faded
structure that belongs to both staves."
```

---

## Self-Review

**Spec coverage.** The two approved items are covered: native staff dimming
(Tasks 1-3) and retiring the hollow notehead (Task 4), with verification in
Task 5. The live input viz and gate-stall telemetry are deliberately out of
scope for this plan — they remain in
`docs/superpowers/specs/2026-08-09-sheetmusic-live-input-viz-design.md`.

**Placeholder scan.** No TBD/TODO. Every code step carries the literal code.
The one conditional step (the `vf-connector` rule) states its exact CSS and the
exact observation that would justify it.

**Type consistency.** `staffGroups(svgRoot) => [{staff, el}]` is defined in
Task 1 and consumed under those names in Task 2. `StaffDimLayer`'s props
(`containerRef`, `dimmed`, `layoutToken`) are defined in Task 2 and passed under
those names in Task 3. `dimBands` and `.piano-score-staff-dim` are removed in
Tasks 2-3 and asserted absent in Task 3's SCSS check.

**Known removals.** `dimBands`, `PAD_UNITS`, the `.piano-score-staff-dim` rule,
and the z-index it forced on other layers all disappear. `extractPerStaffGeometry`
stays — the wet-ink layer still needs `staffBoxes` for glyph placement.
