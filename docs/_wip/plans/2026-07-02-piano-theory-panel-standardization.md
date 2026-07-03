# Piano Theory Panel Standardization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One shared, layout-safe theory panel (circle of fifths · live grand staff · chord name) used by both the Videos sidebar and the Studio top pane, with bounding boxes that can never balloon or vanish, placed with plain flexbox.

**Architecture:** Fix the root cause in the `ChordStaffRenderer` sizing contract (absolutely-positioned SVG + aspect-aware engraving driven by a ResizeObserver), then collapse the two near-duplicate composites (`StudioTriptych`, `PianoChordColumn`) into a single `TheoryPanel` component with `layout="row" | "column"`, with its own co-located SCSS. A Playwright runtime test asserts real bounding boxes so this class of regression can't silently return.

**Tech Stack:** React 18, VexFlow (SVG backend), SCSS, Playwright runtime tests (`tests/live/flow/`), Vitest unit tests.

---

## Diagnosis (verified 2026-07-02, local dev @ 1920×1200)

### Studio: "empty pane, stems on high notes, circle/chord gone" — REPRODUCED

Measured with Playwright (`getBoundingClientRect`), commit `6abae80c3`:

| Element | Box | Expected |
|---|---|---|
| `.piano-studio-toppane` | 1872 × **256** (clips, `overflow:hidden`) | — |
| `.piano-triptych` | 1870 × 190 | fine |
| `.piano-triptych__circle/center/chord` | each **2653 px tall** | ≤ 190 |
| `.current-chord-staff svg` (viewBox `0 0 100 192`) | 1382 × **2653** | ≤ 190 tall |
| `.piano-circle-of-fifths` | at y=1395 — **~1200 px below the card's clip edge** | visible |

**Root cause:** `.piano-triptych` is a CSS grid with a single **implicit auto row**. Percentage
heights (`height:100%` on `__center`, on `.current-chord-staff-wrapper`, and on the SVG) cannot
resolve against an auto row, so the SVG falls back to its **viewBox intrinsic aspect ratio**:
width 1382 × (192/100) = 2653 px tall. The auto row grows to content, all three grid items become
2653 px tall, and `align-items:center` centers their content ~1200 px below the 256 px card window.
The card's `overflow:hidden` hides everything except the very top of the engraving — which is why
only high-note stems/ledger lines (drawn near the top of the viewBox) ever peek into view.

This is the exact failure mode the comment in `CurrentChordStaff.scss` warns about ("the host must
have a DEFINITE height"). The definite-height chain is a fragile, implicit contract that every
consumer has to re-implement — the Videos flex column happens to get it right
(`flex:1` + `min-height:0`), the Studio grid breaks it.

### Videos sidebar: "too narrow, too much empty space left/right" — CONFIRMED BY GEOMETRY

The sidebar (`.piano-video-player__staff`) takes **all leftover width** right of the aspect-sized
video (~550 px at 1920×1200). Inside it:
- circle of fifths is a fixed **160 px** prop (`circleSize` default),
- the staff SVG's viewBox is ~**100 × 192** (one clef + keysig + one chord, portrait aspect ~0.52).
  Under `preserveAspectRatio: meet` in a ~550-wide × ~500-tall slot it is **height-bound**, renders
  ~260 px wide, and leaves ~150 px of dead white on each side,
- the chord plaque is a small fixed card.

Nothing scales with the column, so the panel reads as three small objects floating in whitespace.

### Structural problems (why this keeps happening)

1. **No sizing contract on the notation component.** `ChordStaffRenderer` requires a definite-height
   ancestor chain; nothing enforces it, and failure is catastrophic (2653 px blowout) instead of safe.
2. **Duplicate composites.** `StudioTriptych` (grid, row) and `PianoChordColumn` (flex, column) wire
   the same three children with different, hand-rolled layout plumbing.
3. **Scattered style ownership.** `.current-chord-staff-wrapper` is re-styled in 4 different places
   in `PianoApp.scss` (lines ~333, ~739, ~772, ~1401) — per-consumer patches instead of a component
   that sizes like a normal block element.
4. **Fixed-px content in fluid slots.** `CircleOfFifths` takes a px `size` prop that sets both its
   coordinate system AND its rendered size; the chord plaque doesn't scale either.

## Design principles for the fix

- **The SVG never drives layout.** Inside the renderer host, the SVG is `position:absolute; inset:0`.
  Worst case in a broken container is now *small*, never a 2653 px balloon.
- **The engraving fills its box.** The renderer observes its host box (ResizeObserver) and widens the
  stave to match the box's aspect ratio (clamped), so a wide slot gets wide staff lines — no dead
  side-gutters — and the chord is centered on the stave.
- **One composite, two layouts.** `TheoryPanel` owns the flex plumbing (definite heights via flexbox
  stretch, `min-width/height: 0` on flex children) so consumers just drop it into a sized box.
- **Fluid sub-components.** Circle and chord plaque scale off the panel slot (CSS `aspect-ratio` +
  percentage widths), not px props.
- **Bounding boxes are tested.** A Playwright runtime test measures real boxes on the Studio page
  and fails if any theory element escapes its pane.

---

### Task 0: Branch

```bash
git checkout -b piano/theory-panel-standardization
```

(Worktree optional per CLAUDE.md; this touches piano-only frontend files.)

---

### Task 1: Studio hotfix — give the triptych a definite grid row

Smallest change that makes Studio usable again; ships even if later tasks slip.

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-triptych`, ~line 748)

**Step 1: Apply the one-line fix**

```scss
.piano-triptych {
  display: grid;
  grid-template-columns: 14rem 1fr 14rem;
  grid-template-rows: 100%;   // ADD — definite row so children's height:100% resolves
  ...
}
```

**Step 2: Verify visually (dev server + Playwright probe)**

Run the probe (screenshot + boxes) against `/piano/studio`, dismiss the connect gate
("Continue without piano"), press-and-hold a high key on the on-screen keyboard:
- circle of fifths, empty grand staff, and chord plaque all visible inside the white card;
- `.current-chord-staff svg` height ≤ card height.

**Step 3: Commit**

```bash
git commit -am "fix(piano): studio triptych grid row was auto — staff ballooned 2653px, circle/chord pushed out of view"
```

---

### Task 2: Aspect-aware engraving geometry (TDD)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/chordStaff.js`
- Test: `frontend/src/modules/MusicNotation/renderers/chordStaff.test.js`

**Step 1: Write failing tests for `computeChordStaffLayout`**

```js
import { computeChordStaffLayout } from './chordStaff.js';

describe('computeChordStaffLayout', () => {
  const LOGICAL_H = 192; // TOP_ROOM + STAFF_GAP + BASS_STAFF_H + BOTTOM_ROOM

  it('falls back to content-sized stave when no aspect given', () => {
    const { staveW, logicalW, logicalH } = computeChordStaffLayout(0, null);
    expect(staveW).toBe(44 + 0 * 10 + 40);
    expect(logicalW).toBe(staveW + 16); // PAD * 2
    expect(logicalH).toBe(LOGICAL_H);
  });

  it('widens the stave to fill a wide box', () => {
    const aspect = 550 / 500; // videos sidebar-ish
    const { logicalW, logicalH } = computeChordStaffLayout(0, aspect);
    expect(logicalW / logicalH).toBeCloseTo(aspect, 1);
  });

  it('never goes below the content minimum (tall/narrow boxes)', () => {
    const { staveW } = computeChordStaffLayout(4, 0.2);
    expect(staveW).toBe(44 + 4 * 10 + 40);
  });

  it('clamps ultra-wide boxes so staves stay musical', () => {
    const { staveW } = computeChordStaffLayout(0, 10);
    expect(staveW).toBeLessThanOrEqual(560);
  });

  it('tolerates garbage aspect values', () => {
    for (const a of [NaN, Infinity, -1, 0]) {
      expect(computeChordStaffLayout(0, a).staveW).toBe(84);
    }
  });
});
```

**Step 2: Run to verify failure**

`npx vitest run frontend/src/modules/MusicNotation/renderers/chordStaff.test.js` → FAIL (not exported).

**Step 3: Implement**

```js
const MIN_NOTE_AREA = 40;
const MAX_STAVE_W = 560; // logical units — don't engrave absurd staves on ultra-wide slots

/** Stave/viewBox geometry for a given key-sig accidental count and host box aspect (w/h). */
export function computeChordStaffLayout(accCount, aspect) {
  const logicalH = TOP_ROOM + STAFF_GAP + BASS_STAFF_H + BOTTOM_ROOM;
  const minStaveW = 44 + accCount * 10 + MIN_NOTE_AREA;
  const valid = Number.isFinite(aspect) && aspect > 0;
  const target = valid ? Math.round(logicalH * aspect) - PAD * 2 : minStaveW;
  const staveW = Math.min(MAX_STAVE_W, Math.max(minStaveW, target));
  return { staveW, logicalW: staveW + PAD * 2, logicalH };
}
```

In `renderChordStaff`, accept `aspect` and replace the inline `staveW`/`logicalW`/`logicalH` math
with a `computeChordStaffLayout(accCount, aspect)` call. Center the chord on the (now wider) stave:
after `format([v], noteAreaW)`, apply the same `setXShift` to the treble and bass notes so the two
hands stay vertically aligned:

```js
const xShift = Math.max(0, (noteAreaW - 40) / 2);
[tNote, bNote].forEach((n) => n && n.setXShift(xShift));
```

**Step 4: Run tests** → PASS (including the pre-existing chordStaff tests).

**Step 5: Commit** — `feat(notation): aspect-aware chord staff — engraving fills its box, chord centered`

---

### Task 3: Bulletproof the renderer host (SVG can never drive layout)

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/ChordStaffRenderer.jsx`
- Create: `frontend/src/modules/MusicNotation/renderers/ChordStaffRenderer.scss`
- Modify: `frontend/src/modules/MusicNotation/renderers/chordStaff.js` (SVG attrs block)
- Modify: `frontend/src/modules/Piano/components/CurrentChordStaff.scss` (delete superseded rules)

**Step 1: Component-owned base styles** (`ChordStaffRenderer.scss`, imported by the JSX):

```scss
// Sizing contract: the host is a normal block element that fills whatever box its
// container gives it. The SVG is absolutely positioned so it can NEVER contribute
// to layout size — a container that fails to size the host yields a small/empty
// staff (min-height floor), never a viewport-height balloon.
.chord-staff {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
}
```

**Step 2: ResizeObserver → aspect state** in `ChordStaffRenderer.jsx`:

```jsx
export function ChordStaffRenderer({ notes, keySignature = 'C', className = 'chord-staff' }) {
  const ref = useRef(null);
  const [aspect, setAspect] = useState(null);
  const notesKey = notes ? [...notes.keys()].sort((a, b) => a - b).join(',') : '';

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      // Bucket to 0.05 so live-resize noise doesn't thrash VexFlow re-renders.
      const next = Math.round((width / height) * 20) / 20;
      setAspect((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const host = ref.current;
    if (host) renderChordStaff(host, { notes, keySignature, aspect });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesKey, keySignature, aspect]);

  return <div className={className} ref={ref} />;
}
```

Note the className default stays `chord-staff`; `CurrentChordStaff` passes
`current-chord-staff` — change it to pass `chord-staff current-chord-staff` so the
base contract always applies.

**Step 3: Trim the now-superseded rules** in `CurrentChordStaff.scss` (keep the wrapper's
padding/overflow; delete the svg sizing comment block — the renderer owns it now).

**Step 4: Sanity-run the existing component tests**
`npx vitest run frontend/src/modules/MusicNotation` → PASS. (happy-dom has no real layout;
the `typeof ResizeObserver` guard keeps unit tests green.)

**Step 5: Visual check of ALL existing consumers** (probe script or by hand):
- `/piano/studio` (StudioTopPane + triptych) — Task 1 already fixed the row.
- Studio → Recordings → open a take (`StudioPlayback` uses the same top pane).
- `PianoVisualizer` (fullscreen visualizer staff, styled at `PianoApp.scss:328`).
- Videos course player sidebar.

**Step 6: Commit** — `fix(notation): chord-staff host owns its bounding box (absolute SVG + aspect fill)`

---

### Task 4: `TheoryPanel` — one composite, two layouts (TDD)

**Files:**
- Create: `frontend/src/modules/Piano/components/TheoryPanel.jsx`
- Create: `frontend/src/modules/Piano/components/TheoryPanel.scss`
- Test: `frontend/src/modules/Piano/components/TheoryPanel.test.jsx`
- Modify: `frontend/src/modules/Piano/components/CircleOfFifths.scss` (fluid sizing)

**Step 1: Failing render tests** (pattern-match `StudioPlay.test.jsx` for providers/mocks):

```jsx
import { render } from '@testing-library/react';
import { TheoryPanel } from './TheoryPanel.jsx';

describe('TheoryPanel', () => {
  const notes = new Map([[60, {}], [64, {}], [67, {}]]);

  it.each(['row', 'column'])('renders circle, staff, and chord slots (%s layout)', (layout) => {
    const { container } = render(<TheoryPanel activeNotes={notes} layout={layout} />);
    expect(container.querySelector(`.theory-panel--${layout}`)).toBeTruthy();
    expect(container.querySelector('.theory-panel__circle .piano-circle-of-fifths')).toBeTruthy();
    expect(container.querySelector('.theory-panel__staff .chord-staff')).toBeTruthy();
    expect(container.querySelector('.theory-panel__chord .piano-chord-name')).toBeTruthy();
  });

  it('defaults to row layout', () => {
    const { container } = render(<TheoryPanel activeNotes={new Map()} />);
    expect(container.querySelector('.theory-panel--row')).toBeTruthy();
  });
});
```

**Step 2: Run** → FAIL (module doesn't exist).

**Step 3: Implement JSX** — the union of today's `StudioTriptych` + `PianoChordColumn` logic
(memoized `midiNotes`/`pitchClasses`/`detectKey`), rendering the class structure above. No `size`
props on `CircleOfFifths` (viewBox stays its logical default; display size is CSS).

**Step 4: Implement SCSS** — flexbox only, definite heights by construction:

```scss
// TheoryPanel — circle of fifths · live grand staff · chord name.
// Contract: give the panel a sized box; it never overflows it. All internal
// slots are flex items with min-width/height:0 so percentage chains resolve.
.theory-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;

  &__circle, &__chord { display: flex; align-items: center; justify-content: center; }
  &__staff { flex: 1 1 0; min-width: 0; min-height: 0; display: flex; }

  // Fluid circle: the slot box decides the size; the SVG fills an aspect-locked box.
  &__circle-box { aspect-ratio: 1; height: 100%; max-height: 14rem; max-width: 100%;
    .piano-circle-of-fifths { width: 100%; height: 100%; display: block; } }

  &--row {
    flex-direction: row;
    align-items: stretch;
    gap: 1.25rem;
    // Fixed-basis sides ("no rug pull" when the chord name changes width).
    .theory-panel__circle, .theory-panel__chord { flex: 0 0 clamp(11rem, 16vw, 15rem); }
  }

  &--column {
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    .theory-panel__circle { flex: 0 0 auto; width: 100%;
      .theory-panel__circle-box { height: auto; width: min(70%, 18rem); } }
    .theory-panel__staff { width: 100%; }
    .theory-panel__chord { flex: 0 0 auto; width: 100%;
      .piano-chord-name__plaque { width: min(80%, 20rem); } }
  }
}
```

(`CircleOfFifths.scss`: drop any px assumptions; the `size` prop remains only the viewBox
coordinate space. `ChordNamePanel.scss`: let the plaque accept a width from the slot.)

**Step 5: Run tests** → PASS. **Commit** — `feat(piano): TheoryPanel — shared circle/staff/chord composite (row + column)`

---

### Task 5: Swap consumers, delete the duplicates

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlay.jsx` (lines 47-49)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Studio/StudioPlayback.jsx` (lines 167-169)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.jsx` (line 240)
- Delete: `frontend/src/modules/Piano/components/StudioTriptych.jsx`
- Delete: `frontend/src/modules/Piano/components/PianoChordColumn.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` — delete `.piano-triptych` block (~748-774) and the
  `.piano-chord-column` block (~1389-1408); delete the per-consumer
  `.current-chord-staff-wrapper` overrides that TheoryPanel/renderer now own (audit lines ~333,
  ~739, ~772, ~1401 — keep only ones serving non-panel consumers like PianoVisualizer if still needed)
- Modify: any tests referencing the deleted components (`grep -rn "Triptych\|ChordColumn" frontend/src --include="*.test.jsx"`)

**Steps:** swap imports/JSX one consumer at a time; run that mode's tests
(`npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Studio`, `.../Videos`) between
swaps; then delete the two components + dead SCSS; full
`npx vitest run frontend/src/modules/Piano frontend/src/modules/MusicNotation`; commit —
`refactor(piano): StudioTriptych + PianoChordColumn → shared TheoryPanel`.

---

### Task 6: Videos sidebar polish (the "too narrow / dead whitespace" fix)

Most of the fix falls out of Tasks 2-5 (aspect-fill staff, fluid circle/chord). Remaining:

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-video-player__staff`, ~1378)

**Step 1:** Keep the sidebar flexible but bound the padding and let the panel own internals:

```scss
&__staff {
  flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden;
  box-sizing: border-box; padding: 0.75rem;
  background: #fff; border-left: 1px solid var(--piano-border);
}
```

**Step 2:** Probe at 1920×1200 with a lecture open (or the probe script pointing at a course URL):
- staff staves now span most of the column width (no big white gutters),
- circle ≈ 60-70% of column width, chord plaque proportionate,
- nothing overflows; keyboard footer unaffected.

If the staff reads *too tall* now that it's wider, cap the staff slot in the column layout
(`.theory-panel--column .theory-panel__staff { max-height: 55%; }`) — this is the "shrink the
staff a little" lever, in exactly one place.

**Step 3: Commit** — `fix(piano): video sidebar theory panel fills its width (no dead gutters)`

---

### Task 7: Bounding-box regression test (Playwright runtime)

**Files:**
- Create: `tests/live/flow/piano/piano-theory-panel.runtime.test.mjs`
  (follow an existing `tests/live/flow/**/*.runtime.test.mjs` for the config/URL helpers —
  ports come from `tests/_lib/configHelper.mjs`, never hardcoded)

**Test spec (Test Discipline: no conditional skips — if the page doesn't render, FAIL):**

1. Viewport 1920×1200 → `/piano/studio`; click `.piano-connect-gate__skip` if present.
2. Measure `.piano-studio-toppane` box `P` and boxes of `.theory-panel__circle svg`,
   `.theory-panel__staff svg`, `.piano-chord-name__plaque`.
3. Assert each element box is non-degenerate (w·h > 0) and fits inside `P` (±2 px tolerance).
4. `mouse.down()` on a far-right key of `.piano-keyboard` (high note), 300 ms hold →
   re-measure staff svg → still inside `P` (this is the exact 2026-07 regression).
5. Assert the staff svg fills ≥ 60% of the staff slot's width (the aspect-fill guarantee —
   catches a silent fall-back to the narrow portrait engraving).

**Run:** `npx playwright test tests/live/flow/piano/piano-theory-panel.runtime.test.mjs --reporter=line`

**Commit** — `test(piano): runtime bounding-box guard for the theory panel`

---

### Task 8: Docs + wrap-up

- Add `docs/reference/piano/theory-panel.md`: the sizing contract (host must be a sized box; SVG
  never drives layout; aspect-fill behavior; the two layouts), consumer list, and a pointer to the
  runtime test. No instance-specific values.
- Update `docs/docs-last-updated.txt` per CLAUDE.md freshness flow.
- Full test pass: `npx vitest run frontend/src/modules/Piano frontend/src/modules/MusicNotation`
  + the Playwright test + probe screenshots of Studio (rest / chord / high note) and a Videos lecture.
- Merge per repo policy (merge to main directly, delete branch, record in
  `docs/_archive/deleted-branches.md`). Prod note: the container bakes `dist` — deploy via the
  normal homeserver build; verify on the tablet afterwards (FKB reload if the SPA is stale).

---

## Out of scope (explicitly)

- Other `Notation` renderers (`abc`, `svg`, `musicxml`) — different code paths, no reported issues.
- The JS-computed video stack width in `PianoVideoPlayer` (works; only the sidebar contents change).
- EngagementGate staff styling (the big beige target staff in the video player) — separate renderer (`svg`).

## Verification evidence collected during planning

- `scratchpad/studio-rest.png` — empty white top pane (matches user report).
- `scratchpad/studio-highnote.png` — giant notehead/stem only, at 1920×1200.
- Box dump: triptych items 2653 px tall inside a 256 px card; svg viewBox `0 0 100 192`
  rendered at 1382×2653; circle at y≈1395 (invisible); root font-size 16px (no rem scaling factor).
