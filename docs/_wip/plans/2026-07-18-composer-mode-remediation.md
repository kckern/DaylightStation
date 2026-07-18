# Composer Mode Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix every finding in `docs/_wip/audits/2026-07-18-composer-mode-ux-slop-audit.md` — wet-ink instant note feedback, no more staff teardown per keypress, caret + manuscript-paper blank sheet, touch delete, a real Play transport, and one SVG icon language.

**Architecture:** The core change splits the editor's render pipeline into two planes, per the spec (`docs/reference/piano/composer.md` §2.1): a **settled score** that OSMD engraves rarely (measure-exit / 600 ms idle / structural edits), and a **wet-ink PendingLayer** that paints appended notes instantly via lightweight inline SVG positioned from staff geometry newly published by the OSMD layout extract. Everything else is targeted component/SCSS surgery inside `frontend/src/modules/Piano/PianoKiosk/modes/Composer/`.

**Tech Stack:** React 18 (jsx, hooks), OSMD 2.0 via `MusicNotation/renderers/osmdRender.js`, Vitest (root `vitest.config.mjs`, custom frontend env), SCSS, structured logging via `frontend/src/lib/logging/`.

---

## Ground rules for the executor

- **Worktree, not main.** Task 0 creates it. Per-task commits on the feature branch are authorized (household policy: auto-commits OK on isolated feature branches; no push, no merge to main without KC).
- **Run all tests from the repo root** with an explicit path: `npx vitest run frontend/src/modules/...`. Never run vitest with a bare directory glob from a subfolder (known trap: stray dot-directories match vitest's default glob).
- **Logging framework only** — no raw `console.*`. Pattern: `getLogger().child({ component })`, events like `composer.wetink.settle`. See CLAUDE.md → Logging.
- **Icons are SVG only.** No Unicode glyphs, no emoji, anywhere in this mode (household directive). Task 12 is the icon pass; earlier tasks that add buttons use placeholder text labels and get their icon in Task 12.
- **The spec is the contract.** When a task cites `composer.md` §2.1, read that section first.
- Docs: this plan updates `docs/reference/piano/composer.md` (Task 15) — keep it placeholder-clean (no hostnames/ports).

---

### Task 0: Worktree + baseline

**Files:** none (git only)

**Step 1: Create the worktree** (REQUIRED SUB-SKILL: superpowers:using-git-worktrees)

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
git fetch origin && git log --oneline origin/main..HEAD | head   # sync check per CLAUDE.local.md
git worktree add ../DaylightStation-composer-fix -b feature/composer-mode-remediation
cd ../DaylightStation-composer-fix
ln -s ../DaylightStation/node_modules node_modules   # household worktree playbook — do NOT npm install
```

**Step 2: Baseline — the whole Composer + renderer suite must pass before you touch anything**

```bash
npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer frontend/src/modules/MusicNotation/renderers
```
Expected: all green. If not, STOP and report — do not build on a red baseline.

---

## Phase 1 — Input feel (audit P0: A1/A2/A3)

### Task 1: Fix the broken `deleteBack` (found while auditing — NumpadSubtract is a no-op at end of bar)

`mapKey` routes both `NumpadSubtract` ("delete the note BEFORE the caret") and `Delete` ("delete AT the caret") to the same `deleteAtCaret`, which calls `deleteNote(state, s.caret)`. The caret is an insertion point that sits AFTER the last entered note, so at end-of-measure `caret.noteIdx === notes.length` → `deleteNote`'s range guard makes it a no-op. Net: the documented "backspace" key does nothing in the most common state.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/editor.js` (add `deleteBeforeCaret`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/index.js` (export it)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/useComposerInput.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/editor.test.js`, `useComposerInput.test.js`

**Step 1: Write the failing tests** (in `editor.test.js`, mirror the file's existing `initEditor(makeEmptyScore())` setup style)

```js
describe('deleteBeforeCaret', () => {
  it('deletes the note just entered (caret at end of measure)', () => {
    let s = initEditor(makeEmptyScore());
    s = insertNote(s, { step: 'C', octave: 4, alter: 0 }, { type: 'quarter' });
    s = insertNote(s, { step: 'D', octave: 4, alter: 0 }, { type: 'quarter' });
    const out = deleteBeforeCaret(s);
    expect(out.score.parts[0].measures[0].notes.map((n) => n.pitch.step)).toEqual(['C']);
    expect(out.caret).toEqual({ measureIdx: 0, noteIdx: 1 });
  });
  it('walks back across a barline when the caret is at a measure start', () => { /* fill measure 1, caret in measure 2 at noteIdx 0, expect last note of measure 1 deleted */ });
  it('is a no-op reference-identity at the very start of the score', () => {
    const s = initEditor(makeEmptyScore());
    expect(deleteBeforeCaret(s)).toBe(s);
  });
});
```

**Step 2:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer/model/editor.test.js` — expect FAIL (`deleteBeforeCaret is not a function`).

**Step 3: Implement** in `editor.js` next to `deleteNote` (reuse it):

```js
/** Delete the note immediately BEFORE the caret (the "backspace" of note entry).
 *  Caret at a measure start walks back across the barline to the previous
 *  measure's last note. At the absolute start there is nothing before the
 *  caret → same-reference no-op (so history records no empty change). */
export function deleteBeforeCaret(state) {
  const { measureIdx, noteIdx } = state.caret;
  if (noteIdx > 0) return deleteNote(state, { measureIdx, noteIdx: noteIdx - 1 });
  const measures = state.score.parts[0]?.measures || [];
  for (let m = measureIdx - 1; m >= 0; m--) {
    const len = measures[m]?.notes?.length || 0;
    if (len > 0) return deleteNote(state, { measureIdx: m, noteIdx: len - 1 });
  }
  return state;
}
```

Export from `model/index.js` alongside `deleteNote`. In `useComposerInput.js`: add a `deleteBack` callback (`applyCommand(s, deleteBeforeCaret)`), and route `case 'deleteBack'` to it (leaving `deleteAt` on `deleteAtCaret`). Also add `case 'Backspace': return { kind: 'deleteBack' };` to `mapKey` and a `{ label: '⌫', code: 'Backspace', does: 'Delete the note before the caret' }` row to `KEY_LEGEND` (Edit group).

**Step 4:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer` — expect PASS (the KEY_LEGEND drift-guard test in `useComposerInput.test.js` will fail until the legend row is added — that's the guard working).

**Step 5: Commit** — `git commit -m "fix(composer): deleteBack actually deletes before the caret; map Backspace"`

---

### Task 2: Pure wet-ink diff — `pendingAppendDiff`

The wet-ink plane needs one pure decision function: given the settled (last-engraved) score and the live score, either "live is settled + N notes appended in one measure" (paint them as wet ink) or "anything else" (settle now).

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetInk.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetInk.test.js`

**Step 1: Write the failing tests**

```js
import { pendingAppendDiff } from './wetInk.js';
import { makeEmptyScore } from './model/index.js';
import { initEditor, insertNote } from './model/editor.js';

const C4 = { step: 'C', octave: 4, alter: 0 };
function withNotes(n) {
  let s = initEditor(makeEmptyScore());
  for (let i = 0; i < n; i++) s = insertNote(s, C4, { type: 'quarter' });
  return s.score;
}

describe('pendingAppendDiff', () => {
  it('identical scores → empty pending', () => {
    const a = withNotes(2);
    expect(pendingAppendDiff(a, a)).toEqual({ measureIdx: null, notes: [] });
  });
  it('one appended note → that note as pending, right measure', () => {
    const settled = withNotes(1), live = withNotes(2);
    const d = pendingAppendDiff(settled, live);
    expect(d.measureIdx).toBe(0);
    expect(d.notes).toHaveLength(1);
  });
  it('a deletion → null (must settle)', () => {
    expect(pendingAppendDiff(withNotes(2), withNotes(1))).toBeNull();
  });
  it('a changed existing note → null (must settle)', () => { /* mutate settled[0] pitch in a clone */ });
  it('appends spread across two measures → null (must settle)', () => { /* fill a 4/4 bar then add a 5th note */ });
});
```

**Step 2:** Run — expect FAIL (module missing).

**Step 3: Implement** `wetInk.js`:

```js
// wetInk.js — pure decision core of the PendingLayer (spec §2.1).
// pendingAppendDiff(settled, live) answers ONE question: is `live` exactly
// `settled` plus zero-or-more notes APPENDED to a single measure? If yes,
// those notes can paint instantly as wet ink and OSMD can wait. Anything
// else (delete, edit, undo, multi-measure growth) returns null → the caller
// must settle (engrave) immediately. Kid-scale scores → JSON compare is fine.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function pendingAppendDiff(settled, live) {
  const sm = settled?.parts?.[0]?.measures || [];
  const lm = live?.parts?.[0]?.measures || [];
  if (lm.length < sm.length) return null;
  let found = null;
  for (let m = 0; m < lm.length; m++) {
    const sNotes = sm[m]?.notes || [];
    const lNotes = lm[m]?.notes || [];
    if (lNotes.length < sNotes.length) return null;
    if (!same(sNotes, lNotes.slice(0, sNotes.length))) return null;
    if (lNotes.length > sNotes.length) {
      if (found) return null; // grew in two measures → settle
      found = { measureIdx: m, notes: lNotes.slice(sNotes.length) };
    }
  }
  return found || { measureIdx: null, notes: [] };
}
```

**Step 4:** Run — expect PASS. **Step 5: Commit** — `feat(composer): pendingAppendDiff wet-ink decision core`

---

### Task 3: Publish staff geometry from the OSMD layout extract

The PendingLayer and the blank-staff caret both need to know where the staff lines ARE. The extract (`osmdRender.js`) currently reports notehead boxes only — nothing on an empty staff.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js`
- Test: `frontend/src/modules/MusicNotation/renderers/osmdRender.test.js` (follow its existing OSMD-mock patterns)

**Step 1: Read first.** Read `osmdRender.js:200-280` (the `finalize` that returns `{ events, notes, tempoEntries, steps, measures }`) and the mock setup at the top of `osmdRender.test.js`. You are adding one more key to that return object.

**Step 2: Write the failing test** — a mock `osmd` whose `GraphicSheet.MusicPages[0].MusicSystems[]` carries `StaffLines[].PositionAndShape.AbsolutePosition {x,y}` and `.Size {width}`; assert `extractStaffGeometry(osmd)` returns:

```js
[{ system: 0, top: <px>, left: <px>, right: <px>, lineSpacing: <px> }]
```

**Step 3: Implement** in `osmdRender.js`:

```js
// OSMD engraves in its own unit space: 1 unit = one staff space, rendered at
// 10 px/unit × osmd.Zoom. Staff-line Y positions come from the graphical
// model, not the DOM, so this works on a NOTE-LESS staff (blank draft) too.
// Defensive throughout: any missing OSMD internal → [] and the consumers
// (PendingLayer, blank-staff caret) degrade to their pre-existing behavior.
const OSMD_UNIT_PX = 10;
export function extractStaffGeometry(osmd) {
  try {
    const zoom = osmd?.Zoom ?? osmd?.zoom ?? 1;
    const px = (u) => u * OSMD_UNIT_PX * zoom;
    const systems = osmd?.GraphicSheet?.MusicPages?.[0]?.MusicSystems || [];
    const out = [];
    systems.forEach((sys, i) => {
      const sl = sys?.StaffLines?.[0];
      const pos = sl?.PositionAndShape?.AbsolutePosition;
      const size = sl?.PositionAndShape?.Size;
      if (!pos) return;
      out.push({ system: i, top: px(pos.y), left: px(pos.x), right: px(pos.x + (size?.width ?? 0)), lineSpacing: px(1) });
    });
    return out;
  } catch { return []; }
}
```

Then add `staves: extractStaffGeometry(osmd)` to BOTH extract return sites (`finalize`'s return and `extractLayoutSliced`'s empty-cursor return should return `staves: extractStaffGeometry(osmd)` too — an empty cursor is exactly the blank-staff case that needs it). `MusicXmlRenderer` passes the result through untouched (it spreads `res`), so no renderer change.

**Step 4:** `npx vitest run frontend/src/modules/MusicNotation/renderers` — PASS, including all pre-existing tests (SheetMusic consumes the same extract — the new key must be purely additive).

**Step 5: ✅ The px/unit constant is ALREADY VERIFIED — 2026-07-18. Use these numbers; do not re-derive.**

Measured by engraving a real score in headless Chromium against OSMD 2.0 and comparing the graphical model to the rendered DOM:

| Check | Result |
|---|---|
| `px = units × 10 × Zoom` | **Exact at every zoom tested** — zoom 1.0 → 10.0000 px/unit; zoom 1.4 → 13.9994; zoom 0.75 → 7.5000 |
| Staff line spacing | **exactly 1 OSMD unit** (10 px at zoom 1) — so `lineSpacing: px(1)` in the sketch is correct |
| Origin check | model `x=12, y=6.35` → rendered `left=120, top=63.5` — both axes convert identically |
| **Blank draft (whole-measure rest, no notes)** | **Staff geometry IS available** — `modelY=6.35`, 5 rendered lines, spacing 10 px. This is what makes the Task 6 blank-staff caret possible. |

OSMD also exports its own `unitInPixels` from `VexFlowMusicSheetDrawer`, which corroborates the constant. Keep `OSMD_UNIT_PX = 10` as a named constant with a comment citing this verification rather than importing OSMD's internal — the internal is not part of the public surface.

The verification script is at `<scratchpad>/osmd-units2.mjs` if it needs re-running after an OSMD upgrade. **Do re-run it if OSMD's version ever changes.**

**Step 6: Commit** — `feat(notation): publish per-system staff geometry from the OSMD extract`

---

**✅ TASK 3 COMPLETE — commit `e7beff780`, verified against REAL OSMD (not just mocks).**

The implementer correctly flagged that unit tests over a hand-built mock cannot prove the OSMD property names are right: if any name were wrong, every test would still pass while `extractStaffGeometry` silently returned `[]` in production. That gap was closed by running the shipped function verbatim against live OSMD engraves in headless Chromium and comparing to DOM ground truth:

| Scenario | Result |
|---|---|
| Blank draft (whole rest, no notes) @ zoom 1 / 1.4 | 1 system; `top` 63.5 / 88.9 vs DOM 63.5 / 88.9 ✅ — **this is what makes the Task 6 blank-staff caret possible** |
| One bar of notes @ zoom 1 / 1.4 | `top`/`left` match DOM exactly ✅ |
| 24 bars (multi-system wrap) @ zoom 1 / 1.4 | 7 and 9 systems returned respectively, geometry matches ✅ |
| Errors | none — property names confirmed correct against OSMD 2.0 |

Resolved open questions:
- **`staves` does not reach the `osmdRender()` / `osmdReRender()` wrappers** (they rebuild a fixed subset and already drop `measures`). This is a **non-issue**: those two wrappers have **zero external callers** — verified by grep across `frontend/src`. `MusicXmlRenderer` uses `osmdEngrave` / `osmdRepaint` + `extractLayoutSliced`, all of which publish `staves`. Do not "fix" the wrappers.
- **A third file was modified** (`osmdRender.sliced.test.js`) because it asserted the extract shape with an exhaustive `toEqual`, which any additive key must break. It was made **stricter** (`staves: []` added, assertion still exhaustive) rather than loosened to `toMatchObject` — the right call; the new key is now pinned too.

Downstream check: `frontend/src/modules/Piano/PianoKiosk` — 182 files, 1638 tests, all passing. SheetMusic (the other consumer of this extract) is unaffected.

---

### Task 4: PendingLayer — wet-ink notes paint instantly

> **Dependency:** do **Task 7 (`pitchToMidi`) before this task** — the layer maps model pitches to MIDI for staff positioning. Task numbering groups by theme, not strict execution order; the dependency graph at the bottom is authoritative.

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/PendingLayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/PendingLayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/Composer.scss`

**Step 1: Read first.** `frontend/src/modules/MusicNotation/model/pitch.js` — `getStaffPosition(midi)` returns `{ position, clef }` where `position` counts half-steps of staff height (bottom line = 0). Confirm the semantics from its own tests before using it.

**Step 2: Write the failing test.** Given `staves=[{system:0, top:100, left:40, right:900, lineSpacing:10}]`, `anchorX=200`, and two pending notes (C5 quarter, E5 eighth), assert: renders 2 `.composer-wet-note` elements; first at `left: 200px`; each carries a `transform`/`top` consistent with `bottomLine(140) - position * 5`; hollow vs filled head by type; each has the accent class.

**Step 3: Implement.** A `position:absolute` overlay (sibling of `CaretLayer` inside `MusicXmlRenderer`'s children). For each pending note `i`:

```jsx
// PendingLayer.jsx — the spec §2.1 wet-ink plane. Pending (not-yet-engraved)
// notes paint as accent-colored noteheads with a stem, positioned from the
// published staff geometry + a synthetic advance (spec: "last engraved x +
// accumulated pending widths"). No OSMD involvement — this is why a keypress
// paints in < 1 frame regardless of engrave cost.
export function PendingLayer({ staves, anchorX, anchorSystem = 0, pending = [] }) {
  const staff = staves?.[anchorSystem];
  if (!staff || !pending.length) return null;
  const bottomLineY = staff.top + staff.lineSpacing * 4;
  const half = staff.lineSpacing / 2;
  const advance = staff.lineSpacing * 2.4;
  return pending.map((n, i) => {
    const midi = pitchToMidi(n.pitch);            // Task 7 helper; rests: render a small block at the middle line
    const { position } = getStaffPosition(midi);
    const y = bottomLineY - position * half;
    const x = Math.min(anchorX + i * advance, staff.right - advance); // never paint past the paper edge
    return <WetNote key={i} x={x} y={y} type={n.type} dots={n.dots} lineSpacing={staff.lineSpacing} />;
  });
}
```

`WetNote` is a small inline SVG (ellipse rotated −20°, hollow for half/whole, stem line, dot circle when `dots`) — copy the geometry from `DurationPalette.jsx`'s `NoteGlyph`, parameterized by `lineSpacing`. SCSS: `.composer-wet-note { position:absolute; color: var(--piano-accent, #2ec46f); opacity:.85; pointer-events:none; transition: opacity 120ms; }`. Ledger lines: when `position < 0 || position > 8`, draw short horizontal strokes every full line — do it now, kids write middle C constantly.

`anchorX` is computed by the caller (Task 5): the right edge of the last engraved step in the caret's measure (`steps[last].notes[0].x + width`), else the measure's start (`staff.left + lineSpacing * 8` — past clef+time signature) on a blank/empty measure.

**Step 4:** Run the Composer suite — PASS. **Step 5: Commit** — `feat(composer): wet-ink PendingLayer`

---

**✅ TASK 4 COMPLETE — commit `bee25de57`, verified by REAL RENDERING, not just jsdom.**

The implementer correctly reported that its tests only checked jsdom attribute values and its own arithmetic — nothing was visually confirmed. That gap was closed by bundling the actual component with esbuild, mounting it over a live OSMD engrave in headless Chromium at the real extracted geometry, and inspecting screenshots.

Findings:
- **Glyph quality is good.** The hand-drawn ♯ and ♭ are well-formed and legible at kiosk sizes; hollow vs filled noteheads, the missing stem on a whole note, and dot placement are all correct.
- **Stem direction follows convention** — up-right below the middle line, down-left at/above it — verified across an ascending 4-note run.
- **Ledger lines are correct in both directions**, confirmed programmatically rather than by eye: C4 (pos −2) → 1 ledger; A3 (pos −4) → 2; E4 (pos 0) and F5 (pos 8, top line) → 0; A5 (pos 10) → 1 **above**; C6 (pos 12) → 2 above. A ledger for a note sitting *on* a ledger line is drawn at the notehead's own y, so it looks absent in a screenshot — check the DOM, not the picture.
- **The brief I wrote had an error the implementer caught:** A5 is position **10**, not 12 (12 is C6). Its arithmetic was right.
- **Wet ink is only distinguishable from engraved notation via CSS.** With `Composer.scss` absent, `color` falls back to inherited black and wet ink renders identically to OSMD's output. Not a realistic failure mode, but it means the "provisional" affordance lives entirely in `.composer-wet-note`'s accent color — don't let that rule get dropped or overridden.

⚠️ **Carried into Task 5:** in a contrived render (7 pending notes with `anchorX` near the end of a narrow staff) the notes collided into an unreadable pile. The `staff.right` clamp worked as designed, but clamping many notes into little space stacks them. Realistically `pendingAppendDiff` bounds wet ink to one bar, so only ~1–3 notes are ever pending — but **Task 5 owns `anchorX`, so Task 5 must confirm with a real screenshot that a nearly-full bar doesn't produce overlap.**

---

### Task 5: `useWetInk` — the settle policy + EditorSurface split into two planes

This is the task that stops the teardown-per-keypress. After it, OSMD engraves only on: structural change (diff null), measure exit, 600 ms idle, or unmount.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetInk.js` (add the hook)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/EditorSurface.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetInk.test.js`, `EditorSurface.test.jsx`

**Wet ink is structurally bounded to ONE BAR — verified 2026-07-18.** A concern was raised that continuous fast entry would reset the idle timer forever and let wet ink accumulate without limit. It cannot, and the reason is worth knowing: `ensureMeasure` (`model/editor.js:119-123`) is called from three paths in `insertElement`, including an **exact-fill** branch (`total === room`). So the note that exactly fills a bar creates the next measure immediately — before any straddle. A new measure is a structural change, `pendingAppendDiff` returns `null`, and the score settles. In 4/4 with quarters that is every 4 notes; with sixteenths, every 16. Either way the settled score stays ≤ one bar behind the model, exactly as spec §2.1 promises. The 600 ms idle timer handles the *pause* case; the bar boundary handles the *continuous* case. Neither alone is sufficient — keep both.

**Step 1: Write the failing hook tests** (renderHook + fake timers, same harness style as `useAutosave.test.js`):

- append note → `settledScore` unchanged, `pending.notes.length === 1`
- advance fake timers 600 ms → `settledScore === liveScore`, pending empty (idle settle)
- append then delete (diff null) → settles immediately, no timer needed
- append in measure 0, then append lands in measure 1 (bar overflow) → settles immediately (measure exit)
- every settle logs `composer.wetink.settle` with a `reason` of `'idle' | 'structural' | 'measure-exit'`

**Step 2: Implement** in `wetInk.js`:

```js
export function useWetInk({ score, caretMeasureIdx, idleMs = 600, logger }) {
  const [settled, setSettled] = useState(score);
  const timerRef = useRef(null);
  const settle = useCallback((reason) => {
    clearTimeout(timerRef.current);
    setSettled(score);
    logger?.info('composer.wetink.settle', { reason });
  }, [score, logger]);
  const diff = useMemo(() => pendingAppendDiff(settled, score), [settled, score]);

  useEffect(() => {
    if (settled === score) return undefined;
    if (diff === null) { settle('structural'); return undefined; }
    if (diff.measureIdx !== null && diff.measureIdx !== caretMeasureIdx) { settle('measure-exit'); return undefined; }
    timerRef.current = setTimeout(() => settle('idle'), idleMs);
    return () => clearTimeout(timerRef.current);
  }, [score, diff, caretMeasureIdx, settle, idleMs]);

  return { settledScore: settled, pending: diff ?? { measureIdx: null, notes: [] } };
}
```

(Initial-draft nuance: when `score` identity changes because a different song loaded, EditorSurface remounts on `open.key` — the hook's state resets with it. No extra handling.)

**Step 3: Wire EditorSurface.** Replace the direct serialize with the split:

```js
const { settledScore, pending } = useWetInk({ score: editorState.score, caretMeasureIdx: editorState.caret.measureIdx, idleMs: config.wetink_idle_ms || 600, logger });
const musicXml = useMemo(() => serializeForDisplay({ ...editorState, score: settledScore }), [settledScore]);
```

(`serializeForDisplay` must take its score from the argument only — it already does.) Compute `anchorX` from `steps` + `editorState.caret.measureIdx` (last engraved step whose `measure === caretMeasureIdx`, else measure-start fallback from Task 4), find `anchorSystem` from that step's y vs `staves[].top` bands, and mount inside the renderer:

```jsx
<MusicXmlRenderer musicXml={musicXml} flow="wrapped" scale={zoom} onLayout={onLayout}>
  <CaretLayer ... />
  <PendingLayer staves={layout.staves} anchorX={anchorX} anchorSystem={anchorSystem} pending={pending.notes} />
</MusicXmlRenderer>
```

Keep `staves` in the existing `steps` state (rename to `layout`, store the whole extract). **Autosave keeps consuming `editorState`** (the live model) — wet ink is a render split only; saving does not wait for engraving. IMPORTANT: the caret must not drift while notes are pending — `caretStepIndex` counts the MODEL, `steps` counts the last ENGRAVE. While `pending.notes.length > 0`, hand `CaretLayer` a synthetic x: after the last wet note (`anchorX + pending.notes.length * advance`). Extend `CaretLayer` with an optional `override={{x, top, height}}` prop rather than forking its math.

**Step 4: Update `EditorSurface.test.jsx`** expectations: an appended-note edit must NOT change the `musicXml` passed to the (mocked) renderer until timers advance; a delete must change it immediately.

**Step 5:** `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Composer` — PASS.

**Step 6: Feel it** (REQUIRED SUB-SKILL: superpowers:verification-before-completion). Dev server up, Composer open, hold a numpad duration and mash notes: wet-ink noteheads must appear instantly per press; the engraved staff must redraw only at bar exit / pauses. This is the whole point of the plan — do not proceed on "tests pass" alone.

**Step 7: Commit** — `feat(composer): two-plane render — wet ink + settled engrave (spec §2.1)`

---

### Task 6: Blank-staff caret + empty-state invitation

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/CaretLayer.jsx`, `EditorSurface.jsx`, `Composer.scss`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/CaretLayer.test.jsx`

**Step 1: Failing tests.** `CaretLayer` with `steps=[]` but `staves=[{top:100,left:40,right:900,lineSpacing:10}]` renders a caret at the entry point (`x ≈ left + lineSpacing*8`, height spanning the staff plus a line above/below). With both empty → renders null (unchanged).

**Step 2: Implement.** Give `CaretLayer` the `staves` prop; when `steps` is empty, position from staff geometry instead of returning null. Add empty-state copy to `EditorSurface` — shown only when the score has no notes AND nothing is pending:

```jsx
{!scoreHasNotes(editorState.score) && !pending.notes.length && (
  <p className="composer-page__hint">Pick a note length, then play a key on the piano. Turn on Write so the piano writes here.</p>
)}
```

Style it quiet (muted ink gray, centered under the first system, no box) — an invitation on the paper, not a banner.

**Step 3:** Run suite — PASS. **Step 4: Commit** — `feat(composer): caret and invitation on the blank staff`

---

### ~~Task 7: `pitchToMidi` model helper~~ — ❌ **CANCELLED 2026-07-18. Do not implement.**

**The function already exists.** `frontend/src/modules/MusicNotation/parseMusicXml.js:9-14` exports a `pitchToMidi({step, octave, alter = 0})` that is semantically identical to what this task specified (same step table, same formula, same default). It is **already imported** by `model/note.js:2` and `model/editor.js:10` — so adding the specified export to `note.js` would be a duplicate binding (a SyntaxError, not a failing test).

Verified: the round-trip `pitchToMidi(midiToPitch(n)) === n` holds for **all 128 MIDI values**, including 0 (`C-1`) and 127 (`G9`); the three spot cases (C4→60, A4→69 with `alter` defaulted, F♯3→54) all pass against the existing function.

**Downstream tasks (4 and 9) import it directly:**
```js
import { pitchToMidi } from '@/modules/MusicNotation/parseMusicXml.js';
```
That is the established convention here — `model/note.js` and `model/editor.js` both already do exactly this. **Do NOT add a barrel re-export**: it would create a second way to import the same symbol for no benefit. Note the deliberate asymmetry (`midiToPitch` lives in `model/editor.js`, `pitchToMidi` in the shared MusicNotation layer); `useComposerInput.js:13` documents why `midiToPitch` is intentionally not barrel-exported. Leave that seam alone.

*Process note: this task existed because the plan was written without grepping for an existing implementation. When a task says "add a small helper," grep for it first.*

---

## Phase 2 — Complete the edit loop (audit P1: A4/A5/A6)

### Task 8: Palette gains ⌫ Delete; arm toggle becomes "Write"

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/DurationPalette.jsx`, `useComposerInput.js` (expose `deleteBack` from the hook), `EditorSurface.jsx` (thread it), `ComposerHelp.jsx` copy if it names "Play/Armed"
- Test: `DurationPalette` assertions live in `Composer.test.jsx` / `EditorSurface.test.jsx` — find the existing palette render tests and extend them

**Step 1: Failing tests:** palette renders a button `aria-label="Delete the last note (Backspace)"` wired to `deleteBack`; the arm toggle's accessible name says **Write** in both states (`aria-pressed` carries on/off — the LABEL no longer flips to a different word); nothing in the palette renders the string "Play".

**Step 2: Implement.** In `DurationPalette`:
- New button after Rest: label text `Delete` for now (SVG ⌫ arrives in Task 12), `onClick={deleteBack}`, class `composer-palette__mod composer-palette__mod--delete`.
- Arm toggle: label becomes `Write` (constant), the state dot alone carries on/off (it already fills on armed). `aria-label`: armed ? `'Write is on — the piano writes notes here (numpad 4)'` : `'Write is off — play freely (numpad 4)'`.
- `useComposerInput` returns `deleteBack` (it exists from Task 1's routing — export it).

**Step 3:** Run suite, PASS. **Step 4: Verify by hand:** tap Delete on the tablet-sized viewport; last note disappears, wet ink included (a delete is structural → settles → correct). **Step 5: Commit** — `feat(composer): touch delete + Write toggle relabel`

---

### Task 9: Real ▶ Play — timeline from the model + shared transport

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/playTimeline.js` + `playTimeline.test.js`
- Move (git mv, imports updated): `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useScoreTransport.js` + its test → `frontend/src/modules/Piano/PianoKiosk/score/` (spec §2.2 "promote to shared, never fork-copy")
- Modify: `EditorSurface.jsx` (transport button + wiring)

**Step 1: Promote the transport.** `git mv` the two files, `grep -rn "useScoreTransport" frontend/src` and update every import (SheetMusic's ScorePlayer at minimum). Run the moved test + the SheetMusic suite: `npx vitest run frontend/src/modules/Piano/PianoKiosk` — PASS before continuing. Commit the move alone: `refactor(piano): promote useScoreTransport to shared score/`.

**Step 2: Failing timeline tests.** `buildComposerTimeline(score)` — pure, model-in/events-out:

- quarter at 100 bpm → note_on at t=0, note_off at t=540 (600 ms × 0.9 gate)
- dotted half → 1800 ms × 0.9
- chord notes (`chord:true`) share the previous note's onset
- rests advance time, emit nothing
- `startAtMeasure: 1` drops earlier events and re-zeroes t
- output sorted by t, every on has its off

**Step 3: Implement:**

```js
// playTimeline.js — flat [{t, type:'note_on'|'note_off', note, velocity}] from
// the MODEL (not the OSMD extract): playable before/without engraving, and
// kid-scale scores make exactness cheap. Consumed by the shared useScoreTransport.
import { pitchToMidi } from './model/index.js';
const QUARTERS = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
const GATE = 0.9;

export function buildComposerTimeline(score, { velocity = 80, startAtMeasure = 0 } = {}) {
  const msPerQ = 60000 / (score.tempo || 100);
  const events = [];
  let tQ = 0, lastOnsetQ = 0;
  (score.parts?.[0]?.measures || []).forEach((m, mi) => {
    for (const n of m.notes || []) {
      const q = (QUARTERS[n.type] ?? 1) * (n.dots ? 1.5 : 1);
      const onsetQ = n.chord ? lastOnsetQ : tQ;
      if (!n.chord) { lastOnsetQ = tQ; tQ += q; }
      if (n.rest || mi < startAtMeasure) continue;
      const note = pitchToMidi(n.pitch);
      events.push({ t: onsetQ * msPerQ, type: 'note_on', note, velocity });
      events.push({ t: (onsetQ + q * GATE) * msPerQ, type: 'note_off', note });
    }
  });
  const t0 = events.length ? Math.min(...events.map((e) => e.t)) : 0;
  return events.map((e) => ({ ...e, t: e.t - t0 })).sort((a, b) => a.t - b.t || (a.type === 'note_off' ? -1 : 1));
}
```

**Step 4: Wire the button.** In `EditorSurface`: `const { sendNoteAt, sendNoteOffAt, sendPanic } = usePianoMidi();` then

```js
const timeline = useMemo(() => buildComposerTimeline(editorState.score, { startAtMeasure: editorState.caret.measureIdx }), [editorState.score, editorState.caret.measureIdx]);
const transport = useScoreTransport({
  timeline,
  onSchedule: (ev, dueWallMs) => ev.type === 'note_on' ? sendNoteAt(ev.note, ev.velocity, dueWallMs) : sendNoteOffAt(ev.note, dueWallMs),
  onDone: () => logger.info('composer.play.done', {}),
});
```

▶/⏸ button in the toolbar (text `Play`/`Pause` until Task 12 icons), left of the save status. **Stop/pause must `sendPanic()`** — the transport's docblock says dispatched future sends can't be recalled (read `useScoreTransport.js`'s header before wiring; follow ScorePlayer's `silenceScheduled` pattern in `modes/SheetMusic/ScorePlayer.jsx`). Playing while `armed` must not write: playback goes OUT via Web MIDI, note-IN comes from the physical piano only — verify there's no echo loopback on the kiosk (jam-7e6 routes bleToDin; if the piano echoes, disarm during playback: `if (transport.playing) skip insert` in the note-on subscriber, one line, test it).

**Step 5:** Suite green; hand-verify on dev (notes sound on the configured MIDI out or log `midi.out.*`). NumpadEnter → toggle transport (add to `mapKey` + KEY_LEGEND: spec assigns `NumpadEnter` play/pause). **Step 6: Commit** — `feat(composer): Play transport from the caret (model timeline + shared transport)`

---

### Task 10: A blank sheet that looks like manuscript paper

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/EditorSurface.jsx` (`serializeForDisplay`)
- Test: `EditorSurface.test.jsx`

**Step 1: Failing tests** (`serializeForDisplay` is exported for tests — export it if not):
- blank score → serialized XML contains **4** measures, each a whole-measure rest
- score with 6 filled measures → 7 in the display (one empty bar of runway ahead)
- score with 2 filled measures → 4 (padded to the minimum)
- saved payload (via useAutosave path) still derives from `serializeFromEditor` — padding never persists

**Step 2: Implement** — generalize the existing bar-1 trick:

```js
const DISPLAY_MIN_BARS = 4;
// Manuscript-paper display: pad the engraved sheet to ≥ DISPLAY_MIN_BARS and
// always keep one empty bar of runway after the music. Padding is whole-measure
// rests, render-only — the saved score never contains them (autosave reads the
// model, not this).
function serializeForDisplay(editorState, minBars = DISPLAY_MIN_BARS) {
  const score = editorState.score;
  const src = score.parts[0].measures;
  const lastFilled = src.reduce((acc, m, i) => ((m.notes || []).length ? i : acc), -1);
  const count = Math.max(minBars, lastFilled + 2);
  const measures = Array.from({ length: count }, (_, i) => {
    const m = src[i];
    if (m && (m.notes || []).length) return m;
    return { number: i + 1, notes: [makeRest({ type: 'whole' })] };
  });
  const parts = [{ ...score.parts[0], measures }, ...score.parts.slice(1)];
  return serializeFromEditor({ ...editorState, score: { ...score, parts } });
}
```

(Keep `minBars` overridable from `config.composer.display_min_bars`.) Note `caretStepIndex` counts the MODEL and the renderer's steps exclude rests — padded bars add zero steps, so caret math is untouched; state that in a test.

**Step 3:** Suite green; visually confirm: fresh draft shows a ruled 4-bar system, not a fragment. **Step 4: Commit** — `feat(composer): blank sheet renders as manuscript paper (display-only rest bars)`

---

## Phase 3 — Give the score the screen (audit P2: A7/B3/A8/A9)

### Task 11: Zoom the engraving, size the paper, fold ComposerBar into the toolbar

**Files:**
- Modify: `EditorSurface.jsx`, `Composer.jsx`, `Composer.scss`
- Delete: `ComposerBar.jsx` (its Help stays — moves with the button)
- Test: `Composer.test.jsx`, `EditorSurface.test.jsx`

**Step 1: Verify before deleting** (per household rule): confirm `Gallery.jsx` renders its own "New song" CTA (`composer-gallery__cta`) — `grep -n "cta\|onNew" Gallery.jsx`. It receives `onNew` from `Composer.jsx:117`; if the CTA is missing, add it there first.

**Step 2: Failing tests:** editor toolbar contains Songs and Help buttons (right side, before save status); `composer-bar` class renders nowhere; renderer receives `scale` = `config.composer.zoom ?? 1.4`.

**Step 3: Implement.**
- `EditorSurface` toolbar right side: `Songs` button (needs `onSongs` prop threaded from `Composer.jsx`) + Help toggle (move `ComposerHelp` + its open state in from ComposerBar). Delete `ComposerBar.jsx` and its render in `Composer.jsx`.
- `scale={config.zoom ?? 1.4}` on `MusicXmlRenderer`. The staff-geometry px math (Task 3) reads `osmd.Zoom`, so wet ink scales with it — re-run the Task 3 Step-5 spot check at the new zoom.
- SCSS: `.composer-page { max-width: none; width: 100%; }` inside the padded editor surface; drop the `.composer-bar` block; `.composer-editor` keeps its own scroll.

**Step 4:** Suite green. Screenshot the editor at 1280×800 (tablet aspect) — the paper should now own the viewport below the toolbar. **Step 5: Commit** — `feat(composer): full-width zoomed paper; navigation folded into the toolbar`

---

### Task 12: SVG icon set — kill every Unicode glyph (haiku fetch sub-tasks)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/icons.jsx` + `icons.test.jsx`
- Modify: `DurationPalette.jsx`, `EditorSurface.jsx`, `ComposerHelp.jsx`, `Gallery.jsx`, `Composer.scss`

**Step 1: Fetch the notation glyphs.** ⚠️ **This step was already attempted on 2026-07-18 and BOTH candidate files were rejected. Read these findings before spending any more effort here.**

| Candidate | Verdict | Why |
|---|---|---|
| File:Crotchet_rest_plain-svg.svg (PD) | ❌ **Rejected — wrong glyph form** | Renders as an **archaic** quarter rest (a mirrored eighth-rest shape), not the modern squiggle. OSMD engraves MODERN rests on the staff, so this button icon would contradict the notation directly beside it — actively miseducating a kid learning to read rests. Verified by rendering, not by reading the filename ("plain" means the historical simplified form). |
| File:Music-dot.svg (PD) | ❌ **Rejected — not worth importing** | The entire file is `<circle cx="1" cy="1" r="1"/>`. Hand-write `<circle cx="12" cy="12" r="3" fill="currentColor"/>`. |

**Two process lessons, both confirmed the hard way:**
1. **A cleanup agent's transform math cannot be trusted unrendered.** The first pass returned a confident, plausible-looking `translate(0.5,1) scale(0.85,0.5)` that was doubly wrong: it dropped the file's essential `translate(0,-1006.4394)` layer offset AND its `scale(-1,1)` mirror, placing the glyph at y≈505 — entirely outside the 24×24 viewBox — and squashing it non-uniformly. It would have shipped as an invisible icon.
2. **`getBBox()` returns coordinates BEFORE the element's own transform**, so composing a fit-transform from it double-counts any inner translate. Measure, then verify by rendering.

**If you still want a Commons glyph**, the working recipe (verified) is: get the true bbox by loading the SVG in Playwright and calling `getBBox()` on the group, then compose `translate(tx,ty) scale(s) <original inner transforms>` where `s = 24*0.88/max(w,h)` and tx/ty center the *post-inner-transform* box. **Then render it to PNG at 24/48/96px on both a dark and a light background and LOOK at it** before accepting. For reference, the corrected transform for the crotchet file was `translate(5.790,1.437) scale(0.4600) translate(0,-1006.4394)` with the path keeping its own `scale(-1,1)` — it renders correctly; it is simply the wrong *form* of rest.

**Recommended path: hand-draw the modern quarter rest** in the house style (`NoteGlyph` in `DurationPalette.jsx` is the pattern — inline SVG, `currentColor`, stroke width 1.7). It is the one intricate glyph in the set; budget for iterating on it and verify it visually against an OSMD-engraved quarter rest side by side. Do not ship a rest icon that disagrees with the engraving.

**Step 2: Hand-draw the non-notation icons** in `icons.jsx`, one exported component each, all `viewBox="0 0 24 24"`, `stroke="currentColor"`/`fill="currentColor"`, stroke width 1.7 (matching `NoteGlyph`): `IconUndo`, `IconRedo` (curved arrows), `IconBackspace` (⌫ shape: left-pointing pentagon + ×), `IconPlay` (triangle), `IconPause` (two bars), `IconSongs` (three-line list), `IconInfo` (circle + i), `IconPlus`. Include the two Commons-derived components (`IconQuarterRest`, `IconDot`) with a source-URL comment. Test: each renders an `<svg>` with `aria-hidden="true"` and no text nodes.

**⚠️ Carried in from the Task 8 palette pass — Delete and Rest are mistakable, and one of them is destructive.**

They now sit adjacent in the palette at identical size with identical neutral chrome, distinguished only by the words "Rest" and "Delete". A kid aiming for Delete who hits Rest *inserts* a note-shaped thing instead of removing one — the opposite of the intent, on the control that exists specifically to recover from mistakes.

The icon pass largely fixes this for free: a rest glyph and a ⌫ icon are far more distinguishable at a glance than two similar-length words. **Also give Delete spatial separation** from the Rest cluster (a gap or divider), and consider a restrained danger tint. Do not make it alarming — deleting a note is routine and reversible via undo — just make it unmistakable.

**Step 3: Replace every Unicode glyph** — the greps must come back empty within the Composer directory:

```bash
grep -rn "↶\|↷\|☰\|ⓘ\|♩\|＋\|⌫" frontend/src/modules/Piano/PianoKiosk/modes/Composer/
```

Rest button: `IconQuarterRest` (keep a visible "Rest" text label beside it — the kid is learning the symbol; icon + word teaches). Dot button: `NoteGlyph quarter` + `IconDot` composed. Undo/redo, Songs, Help, Delete, Play: their icons. Gallery's `＋` → `IconPlus`.

**Step 4:** Suite green; grep empty; visual pass at tablet size. **Step 5: Commit** — `feat(composer): one SVG icon language (Commons PD glyphs + house-drawn set)`

---

### Task 13: Keycap badges, 48 px targets, legible disabled states (B4/A8)

**Files:** `Composer.scss`, `DurationPalette.jsx`

**Step 1: Failing test:** duration buttons render the numpad digit inside an element with class `composer-palette__keycap` (not bare text).

**Step 2: Implement.**
- Badge → keycap: `.composer-palette__keycap { border: 1px solid var(--piano-border, #3a3a48); border-radius: 4px; padding: 0 4px; font: 700 0.65rem 'Roboto Condensed'; background: var(--piano-bg, #0e0e12); }` — reads as a physical key, not a fingering number. On the active (accent-filled) button, invert: dark border/ink on the green.
- Targets: `.composer-palette__dur, .composer-palette__mod, .composer-palette__arm { min-width: 3.4rem; min-height: 3.4rem; }` (≈54 px); toolbar history buttons `min-width/height: 3.25rem`; glyph size 24→28.
- Disabled: `opacity: 0.55` plus `border-style: dashed` so "there but inert" is legible on the dark surface.

**Step 3:** Suite green; screenshot check. **Step 4: Commit** — `feat(composer): keycap hints + kid-sized touch targets`

---

### Task 14: Name your song from the editor (A9)

**Files:**
- Modify: `Composer.jsx`, `EditorSurface.jsx`, `useAutosave.js` (+ its test), `Composer.scss`

**Step 1: Read first.** `useAutosave.js` — how `title` enters the save payload and what triggers a save. The rename must ride the existing save path, not invent one.

**Step 2: Failing tests:** toolbar shows the title, or `Name your song` when blank; committing a new name calls the save path with the new title (fake-timer the idle); `Composer.jsx` updates `open.title` via an `onRename` callback so the breadcrumb picks it up.

**Step 3: Implement.** Title button in the toolbar (left of Songs); tap swaps to an inline `<input>` (autoFocus, Enter/blur commits, Escape cancels). `EditorSurface` gets `onRename`; `Composer.jsx` passes `(t) => setOpen((o) => ({ ...o, title: t }))`. `useAutosave` treats a title change as dirtying (extend its deps/payload; add the test). Keep the input plain — this is the one text field in the mode.

**Step 4:** Suite green; hand-verify rename → gallery shows the new name. **Step 5: Commit** — `feat(composer): rename from the editor`

---

## Phase 4 — Buffered engrave + gate + docs

### Task 15: Double-buffered engrave (no flash even when OSMD does run)

Do this AFTER Task 5: engraves are now rare, so this is polish on the remaining once-a-bar redraw. Opt-in — SheetMusic behavior untouched.

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (`osmdEngrave` opts), `MusicXmlRenderer.jsx` (`bufferedEngrave` prop), `EditorSurface.jsx` (pass it)
- Test: `osmdRender.test.js`, `MusicXmlRenderer.test.jsx`

**Step 1: Read `osmdEngrave`** (`osmdRender.js` ~line 430-471) — find where it clears/attaches to the host.

**Step 2: Failing test** (follow the file's mock pattern): with `{ buffered: true }`, the host's existing children are still present until the new engrave completes, then are replaced atomically (`host.replaceChildren(...)` — assert the host is never observed empty between paints).

**Step 3: Implement:** when `opts.buffered`, engrave into a detached staging `div` (same width forced via inline style so OSMD lays out identically), then `host.replaceChildren(...stage.childNodes)` on success; on failure leave the old paint in place and rethrow (the renderer's `failed` path shows the old sheet + error, never a blank). Thread `bufferedEngrave` through `MusicXmlRenderer` into both the engrave call and (check whether `osmdRepaint` also clears — if so, same treatment). EditorSurface passes `bufferedEngrave`.

**Step 4:** Renderer + Composer + SheetMusic suites all green (`npx vitest run frontend/src/modules/MusicNotation frontend/src/modules/Piano/PianoKiosk`). **Step 5: Commit** — `feat(notation): opt-in double-buffered engrave (no blank flash)`

---

### Task 16: The spec's P0 gate, docs, and finish

**Step 1: Full suite + verify skill.** `npx vitest run frontend/src` scoped runs green; then use the project **verify** skill (drive the real flow: enter notes, delete, play, rename, gallery round-trip on the dev server).

**Step 1b: Judge the SETTLE JUMP on the tablet — known, measured, and deliberately accepted.**

When wet ink dries, both the note and the caret shift. Measured in Chromium during Task 5 (real numbers, not estimates):

| | wet caret | engraved caret | jump |
|---|---|---|---|
| before the caret-convention fix | 526.3 | 532.0 | 5.7 px |
| after the fix (correct convention) | 514.5 | 532.0 | **17.4 px** |

The fix *increased* the visible jump, and that is still the right trade. Measured attribution:
- **~11.6 px — the note itself moves as it dries.** The wet layer advances a fixed 2.4 staff spaces per note; OSMD spaces proportionally to duration and then justifies the bar. This happens regardless of caret math.
- **~5.8 px — the two carets measure different glyphs.** The engraved caret derives from the layout extract's box for the whole stavenote (notehead + stem, ~18 px); the wet caret measures the notehead alone (~12 px).

The old formula's smaller jump was **coincidence** — an overshoot that partly cancelled the note's own movement. That cancellation depends on note duration and bar justification, so it would not generalize; it merely hid the shift in one case. The caret is now provably correct against the glyph actually drawn.

**If the jump reads as jarring on the tablet, the lever is the wet layer's fixed advance, NOT the caret.** A duration-proportional wet advance would narrow it, though a layer that doesn't engrave can never fully predict OSMD's bar justification. Do not "fix" this by padding the caret constant — that reintroduces a wrong convention to mask an unrelated effect, and a code comment now says so.

**Step 2: Run the aged-page gate as written** (`composer.md` §2.1/§14) — this needs the kiosk tablet, so it may be a KC-assisted step: page open > 30 minutes, continuous entry; gate = wet-ink note visible < 100 ms after keypress, engraved settle < 1 s after idle; instrument via the kiosk beat probe (`pbctl` — see CLAUDE.local.md) and the `composer.wetink.settle` / `composer.editor.layout` log events. **Record the numbers in the audit doc.** If the aged-page engrave is catastrophic (> ~2 s), the spec's sanctioned fallback is a coarser engrave cadence (line-exit / explicit pause) — a config change (`wetink_idle_ms`), not a redesign.

**Step 3: Docs.**
- Update `docs/_wip/audits/2026-07-18-composer-mode-ux-slop-audit.md`: mark each finding fixed with commit refs; paste the gate numbers.
- Update `docs/reference/piano/composer.md`: §2.1 status → implemented; note the transport promotion (`PianoKiosk/score/`) and the `Backspace`/`NumpadEnter` keymap additions.
- `git rev-parse HEAD > docs/docs-last-updated.txt` per CLAUDE.md freshness rule.

**Step 4: Finish the branch** (REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch). Merge to main is KC's call — present the diff, the test count, and the gate numbers. On-kiosk verification before merge is the household norm for kiosk-facing work (see the sheetmusic overhaul precedent).

---

## Task order & dependencies

```
0 → 1 → 2 → 3 → 4 → 5 → 6        (Phase 1, strictly ordered)
5 → 8, 10                         (palette/display build on the split surface)
7 → 4 (pitchToMidi used by PendingLayer) and → 9
9 needs 7; 11 → 12 → 13 (toolbar settles before icons before sizing)
14 anytime after 11; 15 after 5; 16 last
```

Solo-executable exceptions: Task 7 can run any time after 0; Task 12's haiku fetch agents can be dispatched early (results keep).
