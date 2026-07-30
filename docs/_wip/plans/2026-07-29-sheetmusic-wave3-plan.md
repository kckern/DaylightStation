# Sheet Music Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the wave-3 sheet-music design (docs/_wip/plans/2026-07-29-sheetmusic-wave3-design.md, rev 3): one hands model, Learn transport + state matrix, practice history, wet-ink correctness gate, loop group + range handles, Polish tempo tiers, Listen/Perform simplification, and the §J shared-control batch.

**Architecture:** All frontend work lives in `frontend/src/modules/Piano/PianoKiosk/` (SheetMusic mode + transport primitives + Composer wet-ink extraction); one backend addition (practice endpoints in `piano.mjs` + `YamlPianoStudioDatastore`). `ScorePlayer.jsx` (1514 lines) is the state hub almost every task touches — tasks are ordered so each lands with its own green test cycle.

**Tech Stack:** React 18 + vitest 4.1.5 (frontend colocated tests), Express 5 + vitest (backend router tests), OSMD 2.0, SCSS in `frontend/src/Apps/PianoApp.scss` + `transport/Transport.scss`.

## How to run tests (worktree)

From the worktree root `/opt/Code/DaylightStation/.claude/worktrees/sheetmusic-wave3`:

```bash
node_modules/.bin/vitest run <path/to/file.test.jsx>       # single file — the inner loop
node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```

Do NOT pass `--reporter=basic` (invalid in vitest 4 — crashes). The root `node_modules` is symlinked to the main checkout; this works as-is (verified: `focusRange.test.js` 11 passed). Backend router tests run under the same vitest binary (verify with the existing `piano.preset.test.mjs` before writing the new one — Task 11 Step 0).

## Global Constraints

- **Measure identity is the 0-based INDEX into `measures[]`** (`{index, number, firstStep, lastStep}`), never the printed number. Practice-record keys, `focus.{inMeasure,outMeasure}`, tier math — all indices.
- **Loop/focus is Learn-only state.** Entering Listen or Polish clears `focus` AND `loopOn`. Polish grades whole-piece runs only.
- **≥1-hand floor in all modes.** `HandsControl` has one variant; value vocabulary `both|rh|lh` (no `none`).
- **Icon names (corrected from the design doc's shorthand):** set-in `loop-in`, set-out `loop-out`, toggle `loop-toggle`, clear `clear-loop`. `loop-a`/`loop-b` do not exist; `repeat` is a different glyph the icon MANIFEST forbids reusing for A–B loops.
- **Audio guards are a predicate, never a literal mode check:** `sendsAudio = mode === 'listen' || machineLearn`. Every former `mode === 'listen'` flush/panic site switches to it (Task 9 enumerates all six).
- **Practice thresholds:** learned = **3 passes** per measure per hands bucket; auto-range window = **4 measures**; reveal-keys arms after **3 consecutive wrongs** on one step.
- **Tempo tiers (bucketed at run start):** slow `< 0.8` · medium `[0.8, 1.0)` · full `= 1.0` (±1e-6) · overclocked `> 1.0`. Overclocked stored/displayed score = `round(100 × mean × 1.25)`.
- **Tempo ladder:** `60 · 70 · 80 · 90 · 100 · 110 · 125 · 150 · 175` (%), 100 dead-center of the 3×3 grid.
- **Key abbreviations:** `DM` / `F#m` — `M` = major, `m` = minor. Sheet cells abbreviated; footer keeps the long form.
- **Touch targets ≥48px** (handles, ToggleSwitch track). Handle drags: `touch-action: none` + pointer capture **on the handle only**.
- **Staff dimming:** deselected staves under a translucent mask, ~0.35 effective ink strength (mask = paper at 65% alpha). Z-order (bottom→top): dim mask (z2) · range tint (z3) · cursor (z5) · wet ink (z5, after cursor in DOM) — `__busy`(6)/`__progress`(7) stay above.
- **Guest/no-user: no practice reads or writes.** Gate on `isPersistentUser(currentUser)` exactly like `usePianoPreferences.js:27`.
- **`scoreKey` (practice files):** lowercase slug of the content id, `/^[a-z0-9-]{1,120}$/` — FileIO appends `.yml` by extension-sniffing, so dots are forbidden (piano.mjs:213-216 precedent).
- **React.memo discipline in the bar:** never default object/array props in the `ScoreTransportBar` shell; new step-dependent props go to the shell's readout, never to memoized children.
- **No Unicode glyphs in kiosk JSX** (`transport/noUnicodeGlyphs.test.js` enforces; LoopControl/LoopSheet are NOT grandfathered, so deleting them is clean).
- **Telemetry retired with features:** `score.listen.mypart`, `score.listen.part`, `score.loop.toggle`, `score.focus.select-*`. Replacements are named per task.
- **Docs:** update `docs/reference/piano/sheet-music-player.md` (endstate style, no class names per feedback memory) and the route-table header comment in `piano.mjs:21-57` when routes change.

## File Structure (created / modified / deleted)

**New files**
```
frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.jsx (+test)
frontend/src/modules/Piano/PianoKiosk/transport/LoopGroup.jsx (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.jsx (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnInkLayer.jsx (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.jsx (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRange.js (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/measureAtPoint.js (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/polishTiers.js (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/practiceKey.js (+test)
frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js (+test)
frontend/src/modules/MusicNotation/model/spellMidi.js (+test)
frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetGlyphs.jsx (+test)
backend/src/4_api/v1/routers/piano.practice.test.mjs
```

**Heavily modified:** `ScorePlayer.jsx` (+ its two test files), `ScoreTransportBar.jsx` (+test), `HandsControl.jsx` (+test), `sheetMusicConfig.js`, `scoreSettings.js`, `osmdRender.js` (+test), `PianoVideoChrome.jsx`, `lectureMeta.js`, `KeySheet.jsx`, `TempoSheet.jsx`, `ViewSheet.jsx`, `FocusRangeLayer.jsx`, `SelectBanner.jsx`, `piano.mjs`, `YamlPianoStudioDatastore.mjs`, `PianoApp.scss`, `Transport.scss`.

**Deleted:** `LoopControl.jsx` (+test), `transport/LoopSheet.jsx` (+test); `deriveResumeSeconds` (function); `myStaves`/`mypart`/two-tap `selecting` machinery inside surviving files.

---

### Task 1: ToggleSwitch primitive + ViewSheet keyboard row

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss` (append)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewSheet.jsx:64-70` (keyboard row)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewSheet.test.jsx`

**Interfaces:**
- Produces: `ToggleSwitch({ label, checked, onChange, disabled = false, className = '' })` — default export. `role="switch"`, `aria-checked`, fires `onChange(!checked)`.
- Consumes: nothing new. ViewSheet's `onToggleKeyboard` is a zero-arg toggle — pass it directly (the boolean arg is ignored).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.test.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import ToggleSwitch from './ToggleSwitch.jsx';

describe('ToggleSwitch', () => {
  it('is a switch with aria-checked reflecting checked', () => {
    const { rerender } = render(<ToggleSwitch label="Keyboard" checked={false} onChange={vi.fn()} />);
    const sw = screen.getByRole('switch', { name: 'Keyboard' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    rerender(<ToggleSwitch label="Keyboard" checked onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Keyboard' })).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange with the flipped value', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Keyboard" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders the label on the left and a track element', () => {
    render(<ToggleSwitch label="Keyboard" checked onChange={vi.fn()} />);
    const sw = screen.getByRole('switch');
    expect(sw.firstChild).toHaveTextContent('Keyboard');
    expect(sw.querySelector('.piano-toggle__track')).not.toBeNull();
    expect(sw.classList.contains('is-on')).toBe(true);
  });

  it('disabled switch does not fire', () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Keyboard" checked={false} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`ToggleSwitch.jsx` doesn't exist)

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.test.jsx`

- [ ] **Step 3: Implement the component**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.jsx
import React from 'react';

/**
 * ToggleSwitch — kiosk on/off switch row: text label on the left, sliding
 * track on the right. The whole row is one ≥48px tap target (touch UI: no
 * tiny thumbs to hit). First consumer: the View sheet's Keyboard row.
 */
export default function ToggleSwitch({ label, checked, onChange, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      className={`piano-toggle${checked ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => onChange?.(!checked)}
    >
      <span className="piano-toggle__label">{label}</span>
      <span className="piano-toggle__track" aria-hidden="true"><span className="piano-toggle__thumb" /></span>
    </button>
  );
}
```

Append to `transport/Transport.scss`:

```scss
// ToggleSwitch — label-left switch row (wave-3 J). Track ≥48px wide; the whole
// row is the tap target, so the thumb never needs to be hit precisely.
.piano-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 3rem;
  padding: 0.25rem 0.5rem;
  background: none;
  border: none;
  color: var(--piano-fg);
  font: inherit;
  cursor: pointer;

  &__track {
    width: 3rem;
    height: 1.5rem;
    border-radius: 0.75rem;
    background: var(--piano-border);
    position: relative;
    transition: background 120ms ease;
    flex-shrink: 0;
  }
  &__thumb {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--piano-surface);
    transition: transform 120ms ease;
  }
  &.is-on &__track { background: var(--piano-accent, #2ec46f); }
  &.is-on &__thumb { transform: translateX(1.5rem); }
  &:disabled { opacity: 0.4; cursor: default; }
}
```

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Swap the ViewSheet keyboard row**

In `ViewSheet.jsx`, add `import ToggleSwitch from '../../transport/ToggleSwitch.jsx';` and replace the keyboard row (lines 64-70):

```jsx
      <div className="piano-score-view-row">
        <ToggleSwitch
          label="Keyboard"
          checked={keyboardVisible}
          onChange={onToggleKeyboard}
        />
      </div>
```

Update `ViewSheet.test.jsx`: any assertion on the old `Keyboard: Shown` / `Keyboard: Hidden` `TransportButton` becomes:

```jsx
  it('keyboard row is a switch reflecting visibility', () => {
    render(<ViewSheet open onClose={vi.fn()} flow="wrapped" onToggleFlow={vi.fn()} scale={1} onScale={vi.fn()} keyboardVisible onToggleKeyboard={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Keyboard' })).toHaveAttribute('aria-checked', 'true');
  });

  it('tapping the keyboard switch fires the toggle', () => {
    const onToggleKeyboard = vi.fn();
    render(<ViewSheet open onClose={vi.fn()} flow="wrapped" onToggleFlow={vi.fn()} scale={1} onScale={vi.fn()} keyboardVisible={false} onToggleKeyboard={onToggleKeyboard} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Keyboard' }));
    expect(onToggleKeyboard).toHaveBeenCalled();
  });
```

(Read the existing file first and preserve its render helper if it has one.)

- [ ] **Step 6: Run both test files — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/transport/ToggleSwitch.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewSheet.test.jsx`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(piano): ToggleSwitch primitive; View sheet keyboard row becomes a switch (wave-3 J)"
```

---

### Task 2: Key abbreviations in sheet cells

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/keyLabel.js` (+`abbrevKey`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/keyLabel.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.jsx:21-24` (cells only — footer at :39 keeps the long form)
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`

**Interfaces:**
- Produces: `abbrevKey(label: string|null) → string|null` — `"D major"` → `"DM"`, `"F# minor"` → `"F#m"`; null/undefined pass through.
- Consumes: `soundingKeyLabel(fifths, mode, semitones)` (unchanged, still the long-form SSOT).

- [ ] **Step 1: Write the failing tests** — append to `keyLabel.test.js`:

```js
import { keyLabel, abbrevKey } from './keyLabel.js';

describe('abbrevKey', () => {
  it('abbreviates major to M and minor to m', () => {
    expect(abbrevKey('D major')).toBe('DM');
    expect(abbrevKey('F# minor')).toBe('F#m');
    expect(abbrevKey('Bb major')).toBe('BbM');
  });
  it('passes null/undefined through', () => {
    expect(abbrevKey(null)).toBe(null);
    expect(abbrevKey(undefined)).toBe(undefined);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`abbrevKey` not exported)

- [ ] **Step 3: Implement** — append to `keyLabel.js`:

```js
/** Compact key form for tight sheet cells: "D major" → "DM", "F# minor" → "F#m". */
export function abbrevKey(label) {
  if (!label) return label;
  return label.replace(/ major$/, 'M').replace(/ minor$/, 'm');
}
```

(Also add `abbrevKey` to the default export object.)

- [ ] **Step 4: Wire into KeySheet cells.** In `KeySheet.jsx`, import `{ abbrevKey }` from `../modes/SheetMusic/keyLabel.js` and change the cell builder (:21-24):

```js
  const cell = (n) => {
    const name = soundingKeyLabel(keyFifths, keyMode, n);
    return name ? { label: abbrevKey(name), sub: label(n) } : { label: label(n) };
  };
```

The footer (`Sounding key: {sounding}`, :39) is untouched.

- [ ] **Step 5: Update `KeySheet.test.jsx`** — wherever it asserts a long-form cell (e.g. `getByText('F# minor')` inside the grid), assert the abbreviated form (`F#m`) in cells and keep one assertion that the footer still shows the long form:

```jsx
  it('cells show abbreviated keys, footer keeps the long form', () => {
    render(<KeySheet open onClose={vi.fn()} value={2} onPick={vi.fn()} keyFifths={0} keyMode="major" />);
    expect(screen.getByText('DM')).toBeInTheDocument();           // +2 from C major
    expect(screen.getByText(/Sounding key: D major/)).toBeInTheDocument();
  });
```

(Read the existing test file first; adjust existing assertions rather than duplicating coverage.)

- [ ] **Step 6: Run — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/keyLabel.test.js frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`

- [ ] **Step 7: Commit** — `git commit -m "feat(piano): abbreviated key names in Key sheet cells (wave-3 J)"`

---

### Task 3: Tempo ladder + header crumb icon gap

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.jsx:8-12` (`TEMPO_STEPS`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss:219-249` (`.piano-chrome__crumb` block)

**Interfaces:**
- Produces: `TEMPO_STEPS` = 9 entries `0.6 … 1.75`, `1` at array index 4 (dead-center of the 3×3 grid: rows are `slice(0,3)/(3,6)/(6,9)`).
- Consumes: `nearestStep(steps, val)` unchanged. `ScorePlayer.onTempo` clamp (0.25–2) already admits 1.75 — no change there.

- [ ] **Step 1: Failing test** — in `TempoSheet.test.jsx` update/add:

```jsx
import { TEMPO_STEPS } from './TempoSheet.jsx';

it('ladder is 60-175 with 100% dead-center', () => {
  expect(TEMPO_STEPS.map((s) => s.value)).toEqual([0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75]);
  expect(TEMPO_STEPS[4].value).toBe(1); // center cell of the middle row
});
```

Also update any existing test asserting `50%` exists or the old 9-step values.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — replace `TEMPO_STEPS` in `TempoSheet.jsx`:

```js
export const TEMPO_STEPS = [
  { label: '60%', value: 0.6 }, { label: '70%', value: 0.7 }, { label: '80%', value: 0.8 },
  { label: '90%', value: 0.9 }, { label: '100%', value: 1 }, { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 }, { label: '150%', value: 1.5 }, { label: '175%', value: 1.75 },
];
```

- [ ] **Step 4: Run TempoSheet + ViewSheet tests — expect PASS** (ViewSheet imports `nearestStep`; its SIZE grid is unaffected but run it anyway).

- [ ] **Step 5: Crumb icon SCSS.** In `PianoApp.scss`, `.piano-chrome__crumb` (≈:219): add flex layout + gap, and remove the bespoke thumb margin:

```scss
    &__crumb {
      display: inline-flex;          // icon/thumb + label on one baseline (wave-3 J)
      align-items: center;
      gap: 0.35em;
      min-width: 0;
      background: none; border: none;
      color: var(--piano-muted); font: inherit; font-size: 1.1rem;
      cursor: pointer; padding: 0.25rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      &:hover { color: var(--piano-fg); }
    }
```

and in `&__crumb-thumb` delete `margin-right: 0.35em;` (the gap now provides it).

- [ ] **Step 6: Visual sanity** — no unit test for SCSS; confirm the frontend builds: `cd frontend && npx vite build --logLevel error` (or rely on the Task 25 build). Keep this step cheap.

- [ ] **Step 7: Commit** — `git commit -m "feat(piano): tempo ladder 60-175 centered on 100; crumb icon gap + inline-flex (wave-3 J)"`

---

### Task 4: Guest zero-start for unenriched videos

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.js:40-63`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js:51-75`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/SingalongPlayer.jsx:12,67`
- Check: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.resume.test.jsx` (should stay green — its cases use per-user records)

**Interfaces:**
- Produces: `resumeSecondsFor(item)` → completed → 0; `item.userPlayhead` if present; otherwise **0** (device-playhead fallback dies). `deriveResumeSeconds` is deleted.
- Consumes: `lectureStatus`/`lectureUserStatus`/`isUserScoped` unchanged.

- [ ] **Step 1: Rewrite the pinning test.** In `lectureMeta.test.js`, replace the `'falls back to device signals when no per-user playhead'` case (:64-67):

```js
  it('unenriched items start from zero — device playhead is never a resume source', () => {
    expect(resumeSecondsFor({ watchSeconds: 120 })).toBe(0);
    expect(resumeSecondsFor({ watchSeconds: 120, duration: 1800, watchProgress: 40 })).toBe(0);
    expect(resumeSecondsFor({})).toBe(0);
  });
```

Delete any direct `deriveResumeSeconds` tests.

- [ ] **Step 2: Run — expect FAIL** (currently returns 120)

- [ ] **Step 3: Implement.** In `lectureMeta.js` replace the body of `resumeSecondsFor` and delete `deriveResumeSeconds`:

```js
export function resumeSecondsFor(item) {
  // Watched check still reads device-level status for unenriched items — a
  // "finished" flag only ever produces a restart-from-zero, never a leak.
  const watched = isUserScoped(item) ? lectureUserStatus(item).watched : lectureStatus(item).watched;
  if (watched) return 0;
  if (item?.userPlayhead != null) return item.userPlayhead;
  // Wave-3 J: no per-user record → start at the top. The device playhead
  // (watchSeconds/watchProgress) belonged to whoever used the kiosk last and
  // must never position someone else's playback.
  return 0;
}
```

- [ ] **Step 4: Fix the Singalong duplicate.** In `SingalongPlayer.jsx:67` the expression `: (lecture?.userPlayhead != null ? lecture.userPlayhead : deriveResumeSeconds(lecture))` becomes `: (lecture?.userPlayhead != null ? lecture.userPlayhead : 0)`; remove `deriveResumeSeconds` from the import at :12.

- [ ] **Step 5: Run the three test files — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/lectureMeta.test.js frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoPlayer.resume.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/Singalong/`

- [ ] **Step 6: Commit** — `git commit -m "fix(piano): guest zero-start — device playhead never seeds video resume (wave-3 J)"`

---

### Task 5: Per-staff geometry extraction

**Files:**
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.js` (new export + 3 payload sites at :292, :327, :379)
- Modify: `frontend/src/modules/MusicNotation/renderers/osmdRender.test.js` (mirror the existing geometry block at :73-138)

**Interfaces:**
- Produces: `extractPerStaffGeometry(osmd) → Array<{system:number, staff:number, top:number, left:number, right:number, lineSpacing:number}>` — one entry per (system, staff), `staff` = OSMD `ParentStaff.idInMusicSheet` (the SAME id `steps[].notes[].staff` carries — this is the join key with `activeParts`). Falls back to the StaffLines array index `j` when `ParentStaff` is absent (test mocks). Published on every layout payload as `staffBoxes` (additive — `staves` keeps its current single-staff-per-system shape for Composer).
- Consumes: `OSMD_UNIT_PX = 10`, existing `MusicSystems[i].StaffLines[j].PositionAndShape` chain. The staff's bottom line is `top + lineSpacing * 4` (consumers derive it — same convention as `staves`).

- [ ] **Step 1: Failing tests** — append to `osmdRender.test.js`, reusing its `staffLine`/`sheet` mock helpers (:73-84). Extend the mock helper to accept a `staffId`:

```js
const staffLineWithId = ({ x, y, width, staffId }) => ({
  PositionAndShape: { AbsolutePosition: { x, y }, Size: { width } },
  ParentStaff: staffId == null ? undefined : { idInMusicSheet: staffId },
});

describe('extractPerStaffGeometry', () => {
  it('emits one entry per staff per system with the OSMD staff id', () => {
    const sys = { StaffLines: [
      staffLineWithId({ x: 12, y: 6, width: 100, staffId: 0 }),
      staffLineWithId({ x: 12, y: 14, width: 100, staffId: 1 }),
    ] };
    const out = extractPerStaffGeometry(sheet([sys], 1));
    expect(out).toEqual([
      { system: 0, staff: 0, top: 60, left: 120, right: 1120, lineSpacing: 10 },
      { system: 0, staff: 1, top: 140, left: 120, right: 1120, lineSpacing: 10 },
    ]);
  });

  it('falls back to the StaffLines index when ParentStaff is absent', () => {
    const sys = { StaffLines: [staffLineWithId({ x: 0, y: 0, width: 10 }), staffLineWithId({ x: 0, y: 8, width: 10 })] };
    expect(extractPerStaffGeometry(sheet([sys], 1)).map((s) => s.staff)).toEqual([0, 1]);
  });

  it('scales by Zoom and skips malformed staves', () => {
    const sys = { StaffLines: [staffLineWithId({ x: 12, y: 6, width: 100, staffId: 0 }), {}] };
    const out = extractPerStaffGeometry(sheet([sys], 0.75));
    expect(out).toEqual([{ system: 0, staff: 0, top: 45, left: 90, right: 840, lineSpacing: 7.5 }]);
  });

  it('returns [] for garbage', () => {
    expect(extractPerStaffGeometry(undefined)).toEqual([]);
    expect(extractPerStaffGeometry({})).toEqual([]);
  });
});
```

Also extend the existing "layout extract publishes staff geometry" test (:140-160) to assert `staffBoxes` is present (an array) on both no-cursor early returns.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** in `osmdRender.js`, directly below `extractStaffGeometry`:

```js
/**
 * Per-staff geometry: one entry per (system, staff). `staff` is OSMD's
 * ParentStaff.idInMusicSheet — the same id the extracted notes carry
 * (steps[].notes[].staff), so consumers can join against activeParts.
 * Same unit space as extractStaffGeometry; bottom line = top + 4*lineSpacing.
 * @returns {Array<{system:number,staff:number,top:number,left:number,right:number,lineSpacing:number}>}
 */
export function extractPerStaffGeometry(osmd) {
  try {
    const zoom = osmd?.Zoom ?? osmd?.zoom ?? 1;
    const px = (u) => u * OSMD_UNIT_PX * zoom;
    const systems = osmd?.GraphicSheet?.MusicPages?.[0]?.MusicSystems || [];
    const out = [];
    systems.forEach((sys, i) => {
      (sys?.StaffLines || []).forEach((sl, j) => {
        const box = sl?.PositionAndShape;
        const pos = box?.AbsolutePosition;
        if (!pos) return; // malformed staff — skip it, keep the rest
        out.push({
          system: i,
          staff: sl?.ParentStaff?.idInMusicSheet ?? j,
          top: px(pos.y),
          left: px(pos.x),
          right: px(pos.x + (box.Size?.width ?? 0)),
          lineSpacing: px(1),
        });
      });
    });
    return out;
  } catch (err) {
    logger().warn('osmd.staff-geometry-failed', { error: err?.message, per: 'staff' });
    return [];
  }
}
```

Add `staffBoxes: extractPerStaffGeometry(osmd)` beside `staves:` at all three payload sites (:292 finalize, :327 and :379 early returns).

- [ ] **Step 4: Run the whole osmdRender suite — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/MusicNotation/renderers/`

- [ ] **Step 5: Commit** — `git commit -m "feat(notation): per-staff geometry (staffBoxes) on the layout payload (wave-3 A dep)"`

---

### Task 6: HandsControl loses the `mypart` variant

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/HandsControl.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/HandsControl.test.jsx` (mypart tests at :36-42, :56-59 are DELIBERATE deletIONS per the design's contract-deletion list)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (drop `handsVariant`, `roles`, `ROLE_TITLES`, the Listen chip branch)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx` (mypart case at :71-72)

**Interfaces:**
- Produces: `HandsControl({ value, onChange })` — value ∈ `both|rh|lh` only; group label always `"Hands"`; the ≥1-hand floor applies unconditionally (toggling the last lit hand is inert). `variant` prop gone.
- Produces: `ScoreTransportBar` prop surface shrinks: `handsVariant` and `roles` removed; part chips render one on/off shape in every mode (Listen included). `onCyclePart(staff)` keeps its signature.
- Consumes: Task 7 rewires ScorePlayer to stop passing the removed props (this task updates the bar + its own tests; ScorePlayer still compiles because extra props are simply unused — but remove the two props from the ScorePlayer call site HERE to keep the tree warning-free).

- [ ] **Step 1: Update HandsControl tests.** Delete the two mypart tests; add the unconditional floor test:

```jsx
  it('always refuses to turn off the last lit hand', () => {
    const onChange = vi.fn();
    render(<HandsControl value="rh" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Right hand' })); // would be 'none'
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Left hand' }));
    expect(onChange).toHaveBeenCalledWith('both');
  });

  it('group is always labelled Hands', () => {
    render(<HandsControl value="both" onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Hands' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run — expect FAIL** (floor currently only applies to `variant="hands"`; label branch exists)

- [ ] **Step 3: Simplify the component:**

```jsx
import React, { memo } from 'react';
import TransportButton from '../../transport/TransportButton.jsx';

/**
 * HandsControl — grand-staff "active hands" toggles (wave-3 A: ONE semantic in
 * every mode — Listen performs the active hands, Learn/Polish practice them).
 * At least one hand stays on: an empty selection is meaningless everywhere.
 * value ∈ both|rh|lh. Memoized so it doesn't reconcile on step advances.
 */
const toPair = (value) => ({ lh: value === 'both' || value === 'lh', rh: value === 'both' || value === 'rh' });
const toValue = ({ lh, rh }) => (lh && rh ? 'both' : lh ? 'lh' : 'rh');

const HandsControl = memo(function HandsControl({ value, onChange }) {
  const pair = toPair(value);
  const toggle = (hand) => {
    const next = { ...pair, [hand]: !pair[hand] };
    if (!next.lh && !next.rh) return; // floor: one hand stays on
    onChange?.(toValue(next));
  };
  return (
    <div className="piano-score-hands" role="group" aria-label="Hands">
      <TransportButton icon="hand-left" ariaLabel="Left hand" on={pair.lh} aria-pressed={pair.lh} className="piano-score-hands__opt" onPress={() => toggle('lh')} />
      <TransportButton icon="hand-right" ariaLabel="Right hand" on={pair.rh} aria-pressed={pair.rh} className="piano-score-hands__opt" onPress={() => toggle('rh')} />
    </div>
  );
});

export default HandsControl;
```

- [ ] **Step 4: Shrink the bar.** In `ScoreTransportBar.jsx`:
  - Delete `ROLE_TITLES` (:11-15).
  - In `ScoreViewControls`: drop props `roles` and `handsVariant`; `renderPartChip` keeps ONLY the on/off branch (delete the `mode === 'listen'` role-chip branch at :180-193); `<HandsControl value={handsValue} onChange={onHandsChange} />` (no variant).
  - In the shell's prop list and the `<ScoreViewControls>` call: remove `roles` and `handsVariant`.
- [ ] **Step 5: Update `ScoreTransportBar.test.jsx`.** Replace the :71-72 mypart case with a Listen on/off chip check:

```jsx
  it('Listen renders the same Hands control as Learn/Polish (one semantic)', () => {
    render(<ScoreTransportBar {...base} mode="listen" grandStaff handsValue="both" onHandsChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Hands' })).toBeInTheDocument();
  });
```

Sweep the file for `handsVariant`/`roles` props in other renders and delete them.

- [ ] **Step 6: Trim the ScorePlayer call site** (compile-hygiene only — full rewire is Task 7): at `ScorePlayer.jsx:1475-1477` delete the `handsVariant={handsVariant}` and `roles={roles}` lines from the `<ScoreTransportBar>` props. Leave the local variables; Task 7 removes them.

- [ ] **Step 7: Run — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/HandsControl.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx`

- [ ] **Step 8: Commit** — `git commit -m "refactor(piano): HandsControl single variant — active hands everywhere (wave-3 A)"`

---

### Task 7: ScorePlayer hands unification — myStaves retirement + Listen simplification

The heart of §A. Listen's kiosk performance follows `activeParts` (active staff → role `play`, inactive → `mute`); the play-along machinery dies; the keyboard hides in Listen by default.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreSettings.js` (strip `myStaves` on read)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreSettings.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx` + `ScorePlayer.telemetry.test.jsx` (mypart surface at :164-166, :311-329, :758+, :1061-1090, :1188-1206, :1268-1449 per the grep map)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/playParts.js` (delete dead `cyclePart`)

**Interfaces:**
- Produces (inside ScorePlayer, used by later tasks):
  - `roles = { [staff]: activeParts[staff] ? 'play' : 'mute' }` — feeds `buildPlayTimeline`'s `isAudible` (checks `=== 'play'`, so `'mute'` silences correctly).
  - `handsValue` from `activeParts` only; `onHandsChange(v)` single branch: `setActiveParts({ 0: v !== 'lh', 1: v !== 'rh' })`, plus Listen timeline-rebuild handling (below).
  - Persisted schema shrinks: `saveScoreSettings(scoreMeta.id, { mode, tempoMult, activeParts, clickOn })`.
- Consumes: `loadScoreSettings` strip-on-read (extended here); `defaultActiveParts` (all staves on — Listen/Polish "both on" default comes free).

**Behavior spec (each is a test):**
1. Listen sends note events ONLY for active staves; toggling a hand off mutes that staff's notes (previously `you`-role behavior, now plain mute — nothing is highlighted-as-yours).
2. Listen NEVER count-ins (count-in is Polish-only): `countUserIn = mode === 'polish'`.
3. Keyboard hidden in Listen by default (`autoKb.listen = false`); the View-sheet toggle still overrides.
4. `targetNotes` in Listen = `null` (no play-along targets); the Listen MIDI-participation subscription (:646-655) is gone — a struck key in Listen lights nothing.
5. Persisted `myStaves` is discarded on read and never rewritten; a legacy record with `myStaves: []` (the old `'none'`) yields both-hands-on Listen.
6. ≥1 floor holds in Listen (chips path too: `onCyclePart` refuses to empty the last active staff in every mode).
7. Toggling hands in Listen mid-playback pauses/flushes/resumes (the `pauseForRebuild('part')` + `silenceScheduled()` pair — keep the MECHANISM, retire the `disruptListenPlayback` name and its `score.listen.*` events; emit `score.hands` / `score.active-part` in all modes).

- [ ] **Step 1: scoreSettings strip-on-read.** Failing test in `scoreSettings.test.js`:

```js
  it('strips the retired myStaves field on read and never rewrites it', () => {
    window.localStorage.setItem('daylight.piano.sm.x', JSON.stringify({ v: 1, myStaves: [0], mode: 'listen' }));
    expect(loadScoreSettings('x')).toEqual({ mode: 'listen' });
    saveScoreSettings('x', { tempoMult: 1 });
    expect(JSON.parse(window.localStorage.getItem('daylight.piano.sm.x')).myStaves).toBeUndefined();
  });
```

Implement: in `loadScoreSettings`, `const { v, focus, myStaves, ...rest } = obj;` (extend the :24 destructure + comment). Run → PASS.

- [ ] **Step 2: Rewrite the ScorePlayer mypart tests to the new contract.** This is the bulk of the task. Work through `ScorePlayer.test.jsx` top-down; the recon grep map lists every `My part` site. The shape of the rewrites:
  - "kiosk must NOT send my staff" (≈:1061) → becomes "kiosk must NOT send a DESELECTED staff": click `Left hand` off, play, assert no `sendNoteAt` for staff-1 midis.
  - count-in-in-Listen cases (:1065, :1329) → Listen always plays immediately; count-in tests move wholly to Polish.
  - `score.listen.mypart` telemetry probe (:164-166 in the telemetry test) → expect `score.hands` instead.
  - Listen keyboard auto-show tests → keyboard absent by default in Listen; present after View-sheet toggle.
  - Any test seeding `restored.myStaves` → seeds `activeParts` instead.
- [ ] **Step 3: Run the two ScorePlayer test files — expect the rewritten cases to FAIL against current code.**

- [ ] **Step 4: Implement in `ScorePlayer.jsx`:**
  - Delete `myStaves` state (:255) and its restore; `roles` memo becomes:
    ```js
    const roles = useMemo(
      () => Object.fromEntries(parts.map((p) => [p.staff, activeParts[p.staff] ? 'play' : 'mute'])),
      [parts, activeParts],
    );
    ```
  - `AUTO_KB` gains `listen: false`; `autoKb` = `AUTO_KB[mode] ?? true` (drop the myStaves ternary at :265).
  - Delete the Listen participation subscription effect (:646-655) and `youMidisAt` import; `targetNotes`: Listen branch → `null`.
  - `countUserIn = mode === 'polish'` (:1204); remove `myStaves` from `toggleRun` deps.
  - `onCyclePart`: one branch for ALL modes (the current else-branch with the ≥1 floor); when `mode === 'listen'`, additionally `pauseForRebuild('part'); silenceScheduled();` before logging. Event: `score.active-part` everywhere.
  - `onHandsChange`: single body `setActiveParts({ 0: v !== 'lh', 1: v !== 'rh' })`; in Listen also the rebuild pair; log `score.hands` everywhere. Delete `disruptListenPlayback` (:1234-1237), `handsVariant` (:1260), the Listen branch of `handsValue` (:1261-1263).
  - Persistence effect (:512-514): drop `myStaves`.
  - `playParts.js`: delete `cyclePart` + its `CYCLE` (dead since wave 2 — confirmed no live importer besides ScorePlayer's now-removed import; update `playParts.test.js`).
- [ ] **Step 5: Run the full SheetMusic suite — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): one hands model — Listen performs active hands, play-along machinery retired (wave-3 A)"`

---

### Task 8: Staff dimming layer

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (mount + `dimmedStaves`)
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-score-staff-dim`, z-index 2)

**Interfaces:**
- Produces: `StaffDimLayer({ staffBoxes = [], dimmed = [] })` default export; named export `dimBands(staffBoxes, dimmed) → Array<{left, top, width, height}>` (pure, tested directly).
- Consumes: `layout.staffBoxes` (Task 5). `dimmed` = staff ids where `!activeParts[staff]` (all three interactive modes; Perform never dims).

**Band math (`dimBands`):** group `staffBoxes` by `system`, sort each group by `top`. For a dimmed staff: bottom line = `top + 4*lineSpacing`; band top = midpoint between the previous staff's bottom line and this staff's top line (or `top - 1.5*lineSpacing` for the first staff of a system); band bottom = midpoint to the next staff's top (or `bottom + 1.5*lineSpacing` for the last) — this covers ledger-line territory without bleeding into the neighbour staff. `left/width` from the box. Rest-only stretches need no special case: the staff box comes from OSMD staff lines, not notes (the design's fallback chain only matters if `staffBoxes` is empty — then render nothing).

- [ ] **Step 1: Failing tests**

```jsx
// StaffDimLayer.test.jsx
import { render } from '@testing-library/react';
import StaffDimLayer, { dimBands } from './StaffDimLayer.jsx';

const GRAND = [
  { system: 0, staff: 0, top: 100, left: 50, right: 550, lineSpacing: 10 },
  { system: 0, staff: 1, top: 200, left: 50, right: 550, lineSpacing: 10 },
  { system: 1, staff: 0, top: 400, left: 50, right: 550, lineSpacing: 10 },
  { system: 1, staff: 1, top: 500, left: 50, right: 550, lineSpacing: 10 },
];

describe('dimBands', () => {
  it('covers the dimmed staff from the inter-staff midpoint(s)', () => {
    const bands = dimBands(GRAND, [1]);
    // system 0: staff 1 band runs from midpoint(140, 200)=170 to bottom 240 + 15 pad
    expect(bands).toEqual([
      { left: 50, top: 170, width: 500, height: 255 - 170 },
      { left: 50, top: 470, width: 500, height: 555 - 470 },
    ]);
  });
  it('first staff pads upward instead of splitting', () => {
    const [band] = dimBands(GRAND.slice(0, 2), [0]);
    expect(band.top).toBe(100 - 15);            // top - 1.5*lineSpacing
    expect(band.top + band.height).toBe(170);   // midpoint to staff 1
  });
  it('empty inputs render nothing', () => {
    expect(dimBands([], [0])).toEqual([]);
    expect(dimBands(GRAND, [])).toEqual([]);
  });
});

it('renders one mask div per band', () => {
  const { container } = render(<StaffDimLayer staffBoxes={GRAND} dimmed={[1]} />);
  expect(container.querySelectorAll('.piano-score-staff-dim')).toHaveLength(2);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```jsx
// StaffDimLayer.jsx
import React from 'react';

/**
 * StaffDimLayer — translucent paper mask over DESELECTED staves (wave-3 A).
 * Sits UNDER the range tint and cursor (z2 < tint z3 < cursor z5), so active
 * overlays — including wrong-note wet ink — always render at full strength
 * above it. Pure: geometry in, absolutely-positioned divs out.
 */
const PAD_UNITS = 1.5; // ledger territory above the first / below the last staff

export function dimBands(staffBoxes = [], dimmed = []) {
  if (!staffBoxes.length || !dimmed.length) return [];
  const want = new Set(dimmed);
  const bySystem = new Map();
  for (const b of staffBoxes) {
    if (!bySystem.has(b.system)) bySystem.set(b.system, []);
    bySystem.get(b.system).push(b);
  }
  const bands = [];
  for (const staves of bySystem.values()) {
    staves.sort((a, b) => a.top - b.top);
    staves.forEach((s, i) => {
      if (!want.has(s.staff)) return;
      const bottom = s.top + s.lineSpacing * 4;
      const prev = staves[i - 1];
      const next = staves[i + 1];
      const top = prev ? (prev.top + prev.lineSpacing * 4 + s.top) / 2 : s.top - s.lineSpacing * PAD_UNITS;
      const end = next ? (bottom + next.top) / 2 : bottom + s.lineSpacing * PAD_UNITS;
      bands.push({ left: s.left, top, width: s.right - s.left, height: end - top });
    });
  }
  return bands;
}

export default function StaffDimLayer({ staffBoxes = [], dimmed = [] }) {
  return (
    <>
      {dimBands(staffBoxes, dimmed).map((b, i) => (
        <div key={i} className="piano-score-staff-dim" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
      ))}
    </>
  );
}
```

SCSS (near `.piano-score-measure-grade` in `PianoApp.scss`):

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

- [ ] **Step 4: Mount in ScorePlayer** (inside `<MusicXmlRenderer>`, FIRST child so DOM order matches the z-band):

```jsx
          {mode !== 'perform' && layoutFresh && (
            <StaffDimLayer
              staffBoxes={layout.staffBoxes}
              dimmed={dimmedStaves}
            />
          )}
```

with, next to `stepBoxes` (:1375):

```js
  // Staves the user has deselected — dimmed in every interactive mode (wave-3 A).
  const dimmedStaves = useMemo(
    () => parts.filter((p) => !activeParts[p.staff]).map((p) => p.staff),
    [parts, activeParts],
  );
```

Add a ScorePlayer test: render in Learn with LH toggled off → `document.querySelectorAll('.piano-score-staff-dim').length > 0`; toggle back on → 0. (Requires the layout fixture to include `staffBoxes` — extend the test's `onLayout` fixture payload with two staves.)

- [ ] **Step 5: Run — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/StaffDimLayer.test.jsx frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): dim deselected staves in Listen/Learn/Polish (wave-3 A)"`

---

### Task 9: Learn state matrix — transport in Learn, sendsAudio predicate, transition rules

The §B core. Three Learn states: **no range** (machine playback of active hands), **range + loop ON** (gate: follow tracker, silent, Play disabled), **range + loop OFF** (machine playback, whole piece). Also §0's mode-clear rule: entering Listen or Polish clears `focus` + `loopOn`.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (`ScoreTransportButtons` gating prop)
- Modify: both ScorePlayer test files + `ScoreTransportBar.test.jsx`

**Interfaces (new derived state inside ScorePlayer, relied on by Tasks 10/12/18/20):**
```js
const learnGate = mode === 'learn' && !!focus && loopOn;          // gate state (row 2)
const machineLearn = mode === 'learn' && !learnGate;              // rows 1 & 3
const sendsAudio = mode === 'listen' || machineLearn;             // audio-plane predicate
```
- `ScoreTransportButtons` prop `isLearn` becomes `playLocked` (bool). Label unchanged: `"Learn advances as you play"`.
- New handler `stopForMatrixChange()` — stop + silence + never auto-play; used by loop toggle / endpoint set / range clear.

**Behavior spec (each is a test):**
1. Learn with no range: Play enabled; pressing Play performs active hands through the piano (sendNoteAt fires), cursor advances on the transport; wrong-note gate OFF (no shake on mismatched note_on).
2. Learn range + loop ON: Play disabled; follow tracker drives (existing behavior); kiosk silent.
3. Learn range + loop OFF: Play enabled; transport plays the WHOLE piece (no wrap at the out-point); brackets still visible (FocusRangeLayer reads `focus`).
4. Toggling the loop ON stops any running transport, silences, jumps the cursor to the in-point, does NOT auto-play.
5. Toggling the loop OFF stops the follow state cleanly; cursor stays put.
6. Entering Listen or Polish clears `focus` and `loopOn` (Polish grades whole-piece only); entering Perform unchanged.
7. Every former `mode === 'listen'` audio guard obeys `sendsAudio` — with Learn machine playback running: a tap-seek flushes (panic fires), reset flushes, pause flushes, loop-wrap N/A (no range), onDone flushes.
8. Learn free metronome (`learnClick`) unchanged in all three states.

- [ ] **Step 1: Write the failing tests.** Add a new `describe('Learn state matrix (wave-3 B)')` in `ScorePlayer.test.jsx` modeled on the existing Listen playback tests (they already stub `usePianoMidi` and drive the transport with fake timers — reuse the same fixture; read the top ~150 lines of the test file for the harness). Minimum set: specs 1-7 above. Sketch of the two pivotal ones:

```jsx
    it('Learn without a range performs active hands through the piano', () => {
      renderPlayer({ mode: 'learn' });                 // fixture helper: seeds restored.mode
      fireEvent.click(screen.getByRole('button', { name: 'Play' })); // NOT disabled
      act(() => vi.advanceTimersByTime(600));
      expect(midi.sendNoteAt).toHaveBeenCalled();      // machine playback, audible
    });

    it('setting the loop back on locks Play and silences the kiosk', () => {
      renderPlayer({ mode: 'learn' });
      pickRange();                                     // helper: sets focus via the armed flow (or setFocus test hook)
      expect(screen.getByRole('button', { name: 'Learn advances as you play' })).toBeDisabled();
      act(() => vi.advanceTimersByTime(600));
      expect(midi.sendNoteAt).not.toHaveBeenCalled();
    });
```

(Exact helper names come from the existing file — verify before writing; the file already has `renderPlayer` and MIDI mocks.)

- [ ] **Step 2: Run — expect FAIL** (Play is unconditionally disabled in Learn today; timeline is `[]`)

- [ ] **Step 3: Implement in `ScorePlayer.jsx`:**
  - Derive `learnGate`/`machineLearn`/`sendsAudio` right after the `range` memo. NOTE: `learnGate` must use `focus`, not `range` (range is the gated step-span).
  - `range` memo (:213-216): condition becomes `focus && loopOn && mode === 'learn' && layout.measures` (loop machinery is Learn-only now; Listen/Polish never have focus anyway — belt and braces).
  - Transport timeline (:336-337):
    ```js
    timeline: mode === 'polish' ? playTimeline
      : (mode === 'listen' || machineLearn) ? playTimeline
      : [],
    ```
    and `playTimeline` (:285-290) builds the NOTE timeline for Listen **and machineLearn** (`buildPlayTimeline(events, layout.notes, tempoMap, roles)`), silent step timeline for Polish.
  - Sweep the six audio guards to `sendsAudio`: onEvent wrap flush (:370), onDone loop branch flush (:401), onDone tail flush (:427), tap-seek flush (:945), reset (:1112), toggleRun pause (:1191). `flushPlaybackNow` (:332-334) keeps its `polish|listen` telemetry gate but ALSO flushes for machineLearn runs — change its condition to `mode === 'polish' || sendsAudio` with mode label `mode`.
  - `useFollowTracker` enabled: `learnGate` (was `mode === 'learn'`).
  - Follow-gate side effects (`onFollowWrong` shake, reveal) only run when the tracker runs — nothing else to gate.
  - Play gating: pass `playLocked={learnGate}` to the bar; in `ScoreTransportButtons` replace `isLearn` logic with `playLocked` (disabled + label). Learn machine states show normal Play/Pause.
  - Transition rules:
    ```js
    const stopForMatrixChange = useCallback(() => {
      countIn.cancel();
      clearWrapDwell();
      resumeAfterRef.current = null;
      if (transportRef.current?.playing) transportRef.current.pause();
      setRunActive(false);
      silenceScheduled();               // safe when silent: soundingRef empty → no panic
    }, [countIn, clearWrapDwell, silenceScheduled]);
    ```
    Call it from `onToggleLoop` (which also, when turning ON with a focus, jumps: `setStep(rangeSteps(layout.measures, focus)[0])`), from `onClearFocus` (cursor stays — do NOT jump), and from the focus-set effect (:958-970 already jumps to the in-point; add `stopForMatrixChange()` at its top; keep the no-autoplay property — nothing in it plays).
  - `onMode` (:1022-1057): replace `if (id === 'perform') setFocus(null)` with:
    ```js
    // Loop/focus is Learn-only state (wave-3 §0): only Learn keeps a range.
    if (id !== 'learn') { setFocus(null); setLoopOn(false); }
    ```
    Entering Learn keeps the existing home-step behavior (auto-range lands in Task 14).
  - `loopOn` initial state: `useState(false)` — a fresh session has no range, and §F's endpoint flow starts loop-off. Update the :129-137 comment.
  - Count-in: already Polish-only after Task 7 — machineLearn plays immediately (assert in tests).
  - onDone (:391-450): the loop-restart branch keys off `rangeRef.current` — in machineLearn `range` is null by construction (loop off), so no change needed; the completion branch's `silenceScheduled` gate becomes `sendsAudio`.
- [ ] **Step 4: Run both ScorePlayer test files + bar tests — expect PASS.** Fix fallout: existing Learn tests that assumed "Play permanently disabled in Learn" now need a range+loop fixture; existing tests asserting `loopOn` defaults true (fresh pick loops immediately) still pass because `onPickSection`/drill set `setLoopOn(true)` explicitly — verify.

- [ ] **Step 5: Full SheetMusic suite green**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): Learn state matrix — transport playback in Learn, sendsAudio predicate, Learn-only loop (wave-3 B)"`

---

### Task 10: Listen metronome — session-local + tempo-map guard

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (`listenClick` state, `clickActive`, guard)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (`clickDisabled` prop replaces the hardcoded Listen rule)
- Modify: `ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx`

**Interfaces:**
- Produces: bar prop `clickDisabled` (bool) — replaces `ScorePracticeCluster`'s internal `metronomeDisabled = mode === 'listen'` (:84).
- Consumes: `tempoMap` (already memoized). Guard: `const clickAllowed = tempoMap.length === 1;`.

**Spec:** Listen's metronome is session-local (`listenClick`, `useState(false)`, never persisted — mirrors `learnClick`), free-running like Learn's. It is only offered when the tempo map has a single entry; multi-entry scores show the button disabled-in-place (existing gating pattern). Polish behavior unchanged (`clickOn` persisted, armed during runs). Learn unchanged.

- [ ] **Step 1: Failing tests.**
  - Bar: `clickDisabled` disables the metronome button in any mode; without it, Listen's metronome is ENABLED (was hardcoded-disabled — flip the existing assertion at the bar test's Listen block).
  - ScorePlayer: in Listen with a single-entry tempo map, tapping Metronome starts the click scheduler (assert via the `useMetronomeClick` contract — mock `createClickScheduler` the way `useMetronomeClick.test.js` does, or assert the button's `aria-pressed` flips and stays session-local: switch mode away and back → off again). With `layout.tempoEntries` containing two entries, the button is disabled.
- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement.**
  - ScorePlayer: `const [listenClick, setListenClick] = useState(false);` (comment: session-local, mirrors learnClick — audit M2 discipline). `clickActive`: `mode === 'learn' ? learnClick : mode === 'listen' ? listenClick : clickOn`. `useMetronomeClick.enabled` adds `|| (mode === 'listen' && listenClick && clickAllowed)`. `onToggleClick`: three-way. Pass `clickDisabled={mode === 'listen' && !clickAllowed}` to the bar.
  - Bar: `ScorePracticeCluster` takes `clickDisabled = false`; delete the internal `metronomeDisabled`; button `disabled={clickDisabled}`, `is-on`/`aria-pressed` respect it as before.
- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): Listen metronome — session-local, guarded by a single-entry tempo map (wave-3 G)"`

---

### Task 11: Practice history — backend endpoints + datastore

**Files:**
- Modify: `backend/src/4_api/v1/routers/piano.mjs` (routes + route-table header comment at :21-57)
- Modify: `backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs` (`getPractice`/`savePractice`)
- Create: `backend/src/4_api/v1/routers/piano.practice.test.mjs` (copy the `piano.preset.test.mjs` harness — it is the ONLY router test on the current `pianoContainer` contract; the older siblings are broken on main)

**Interfaces:**
- Produces:
  - `GET  /api/v1/piano/users/:userId/practice/:scoreKey` → `{}` or the stored record; 400 `{error:'Invalid user'}` unknown user; 400 `{error:'Invalid score key'}` on a key failing `/^[a-z0-9-]{1,120}$/`.
  - `PUT  …/practice/:scoreKey` → merged record (measures merged per-key, polish merged per-bucket, `updatedAt` server-stamped ISO). **Fingerprint replace rule:** if `body.fingerprint` and `current.fingerprint` both exist and differ (either field), the body REPLACES the record (stale measures must not survive a re-scored file).
  - Datastore: `getPractice(userId, scoreKey) → object|null(unknown user)`, `savePractice(userId, scoreKey, record) → boolean` — YAML at `users/{id}/apps/piano/practice/{scoreKey}.yml` via `#userPianoDir(userId, 'practice')` (varargs already support this; `saveYaml` mkdirs recursively).
- Consumes: `ds` = `pianoContainer.studioDatastore`; `asyncHandler`; `loadYaml`/`saveYaml` from `#system/utils/FileIO.mjs`.

**Record shape (documented in the route comment, mirrors design §C):**
```yaml
fingerprint: { measureCount: 24, xmlBytes: 48213 }
measures:                      # keys are measure INDICES (0-based), as strings
  "4": { rh: {attempts: 3, passes: 2}, lh: {attempts: 1, passes: 0}, both: {attempts: 0, passes: 0} }
polish:
  both: { slow: 78, medium: 84, full: 61, overclocked: null }
  rh:   { slow: null, medium: null, full: 95, overclocked: null }
  lh:   { slow: null, medium: null, full: null, overclocked: null }
updatedAt: 2026-07-29T18:00:00.000Z
```

- [ ] **Step 0: Confirm the harness.** Run the existing preset test to pin the invocation: `node_modules/.bin/vitest run backend/src/4_api/v1/routers/piano.preset.test.mjs` — expect PASS. (If it needs a different runner, mirror whatever makes it pass; do not invent a new harness.)

- [ ] **Step 1: Write the failing test** — `piano.practice.test.mjs`, copying preset's FileIO mock (in-memory `files` map) and stub `configService` (`getUserDir: (id) => \`/data/users/${id}\``, roster `['kc']`):

```js
// Follows piano.preset.test.mjs: in-memory FileIO, express app around createPianoRouter.
describe('piano practice endpoints', () => {
  it('GET returns {} for a fresh score and 400 for an unknown user', async () => {
    expect((await request(app).get('/piano/users/kc/practice/files-x')).body).toEqual({});
    expect((await request(app).get('/piano/users/nobody/practice/files-x')).status).toBe(400);
  });

  it('rejects unsafe score keys', async () => {
    expect((await request(app).get('/piano/users/kc/practice/Bad.Key')).status).toBe(400);
    expect((await request(app).put('/piano/users/kc/practice/a/b').send({})).status).toBe(404); // slash = different route
  });

  it('PUT merges measures per-key and stamps updatedAt', async () => {
    await request(app).put('/piano/users/kc/practice/files-x')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 0: { rh: { attempts: 1, passes: 1 } } } });
    const r2 = await request(app).put('/piano/users/kc/practice/files-x')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 1: { rh: { attempts: 1, passes: 0 } } } });
    expect(Object.keys(r2.body.measures)).toEqual(['0', '1']);   // merged, not replaced
    expect(r2.body.updatedAt).toBeTruthy();
    expect(files['/data/users/kc/apps/piano/practice/files-x']).toBeTruthy();
  });

  it('PUT merges polish per-bucket', async () => {
    await request(app).put('/piano/users/kc/practice/files-x').send({ polish: { rh: { full: 95 } } });
    const r = await request(app).put('/piano/users/kc/practice/files-x').send({ polish: { both: { slow: 70 } } });
    expect(r.body.polish.rh.full).toBe(95);
    expect(r.body.polish.both.slow).toBe(70);
  });

  it('a changed fingerprint REPLACES the record', async () => {
    await request(app).put('/piano/users/kc/practice/files-y')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 0: { rh: { attempts: 3, passes: 3 } } } });
    const r = await request(app).put('/piano/users/kc/practice/files-y')
      .send({ fingerprint: { measureCount: 9, xmlBytes: 101 }, measures: { 2: { rh: { attempts: 1, passes: 0 } } } });
    expect(r.body.measures['0']).toBeUndefined();  // stale measures discarded
    expect(r.body.measures['2']).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (routes don't exist)

- [ ] **Step 3: Implement.** Datastore (below the preferences pair, :158-170 pattern):

```js
  // ── Practice history (per-user, per-score; wave-3 sheet music) ──────────────
  getPractice(userId, scoreKey) {
    const dir = this.#userPianoDir(userId, 'practice');
    if (!dir) return null;
    return loadYaml(path.join(dir, scoreKey)) || {};
  }

  savePractice(userId, scoreKey, record) {
    const dir = this.#userPianoDir(userId, 'practice');
    if (!dir) return false;
    saveYaml(path.join(dir, scoreKey), record);
    return true;
  }
```

Router (below the preferences pair; extend the :21-57 route table comment):

```js
  // ── Practice history (per-user, per-score sheet-music record) ───────────────
  // scoreKey is a dot-free slug (FileIO appends .yml by sniffing the extension,
  // so a dot would corrupt the filename — same rule as PRODUCER_ID_RE).
  const PRACTICE_KEY_RE = /^[a-z0-9-]{1,120}$/;
  const mergeBuckets = (cur = {}, patch = {}) => {
    const out = { ...cur };
    for (const b of Object.keys(patch)) out[b] = { ...(cur?.[b] || {}), ...(patch[b] || {}) };
    return out;
  };

  router.get('/users/:userId/practice/:scoreKey', (req, res) => {
    const { userId, scoreKey } = req.params;
    if (!PRACTICE_KEY_RE.test(scoreKey)) return res.status(400).json({ error: 'Invalid score key' });
    const rec = ds.getPractice(userId, scoreKey);
    if (rec === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(rec);
  });

  router.put('/users/:userId/practice/:scoreKey', asyncHandler((req, res) => {
    const { userId, scoreKey } = req.params;
    if (!PRACTICE_KEY_RE.test(scoreKey)) return res.status(400).json({ error: 'Invalid score key' });
    const current = ds.getPractice(userId, scoreKey);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // A different fingerprint means the score file changed shape — the old
    // per-measure record describes measures that no longer exist. Replace.
    const fpChanged = body.fingerprint && current.fingerprint
      && (body.fingerprint.measureCount !== current.fingerprint.measureCount
        || body.fingerprint.xmlBytes !== current.fingerprint.xmlBytes);
    const merged = fpChanged
      ? { ...body, updatedAt: new Date().toISOString() }
      : {
        ...current,
        ...body,
        measures: { ...(current.measures || {}), ...(body.measures || {}) },
        polish: mergeBuckets(current.polish, body.polish),
        updatedAt: new Date().toISOString(),
      };
    ds.savePractice(userId, scoreKey, merged);
    logger.info?.('piano.practice.save', { userId, scoreKey });
    res.json(merged);
  }));
```

- [ ] **Step 4: Run — expect PASS.** Also re-run `piano.preset.test.mjs` (same file untouched, shared container — cheap regression).

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): practice-history endpoints + datastore (wave-3 C)"`

---

### Task 12: practiceKey + usePracticeRecord hook

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/practiceKey.js` (+test)
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.js` (+test)

**Interfaces:**
- Produces:
  - `practiceKeyOf(contentId) → string` — lowercase, `[^a-z0-9]+` → `-`, trimmed of leading/trailing `-`, sliced to 120. `files:docs/sheet-music/fur-elise.musicxml` → `files-docs-sheet-music-fur-elise-musicxml`.
  - `bucketOf(grandStaff, activeParts) → 'both'|'rh'|'lh'` — non-grand-staff always `'both'`; grand staff: both active → `both`, only staff 0 → `rh`, only staff 1 → `lh`.
  - `usePracticeRecord({ scoreId, fingerprint })` → `{ record, loaded, recordCycle, recordTierBest }` where:
    - `record` — the loaded record (`{}` while loading/guest); fingerprint-mismatched server records are treated as empty locally (the first PUT carries the new fingerprint and the server replaces).
    - `recordCycle({ measureIndices, wrongMeasures, bucket })` — one completed gate cycle: for every index in `measureIndices` increment `attempts`; increment `passes` where `!wrongMeasures.has(index)`. Optimistic local update + one PUT `{ fingerprint, measures: <touched entries only> }`.
    - `recordTierBest({ bucket, tier, score })` — `polish[bucket][tier] = max(current, score)`; no-op if not an improvement. PUT `{ fingerprint, polish: { [bucket]: { [tier]: score } } }`.
  - Guest/no-user (`!isPersistentUser(currentUser)`): `record = {}`, `loaded` true for guest, and both writers are no-ops — copy the `usePianoPreferences.js:26-33` gate verbatim.
- Consumes: `DaylightAPI` (`frontend/src/lib/api.mjs` — GET must pass NO body or it auto-promotes to POST), `usePianoUser()`, `isPersistentUser`, endpoints from Task 11.

- [ ] **Step 1: Failing tests.**

`practiceKey.test.js`:

```js
import { practiceKeyOf, bucketOf } from './practiceKey.js';

describe('practiceKeyOf', () => {
  it('slugs a content id to a dot-free lowercase key', () => {
    expect(practiceKeyOf('files:docs/sheet-music/Fur-Elise.musicxml'))
      .toBe('files-docs-sheet-music-fur-elise-musicxml');
  });
  it('trims and caps at 120', () => {
    expect(practiceKeyOf(':x:')).toBe('x');
    expect(practiceKeyOf('a'.repeat(200)).length).toBe(120);
  });
});

describe('bucketOf', () => {
  it('grand staff maps hands to buckets', () => {
    expect(bucketOf(true, { 0: true, 1: true })).toBe('both');
    expect(bucketOf(true, { 0: true, 1: false })).toBe('rh');
    expect(bucketOf(true, { 0: false, 1: true })).toBe('lh');
  });
  it('non-grand-staff collapses to both', () => {
    expect(bucketOf(false, { 0: true, 1: false, 2: true })).toBe('both');
  });
});
```

`usePracticeRecord.test.js` — copy the mock harness from `usePianoPreferences.test.js` (fake `DaylightAPI` with an in-memory server; mocked `usePianoUser`). Cases:
1. loads the record for a persistent user (GET path `api/v1/piano/users/kc/practice/<key>`);
2. guest: no GET fired, `loaded` true, `recordCycle` fires no PUT;
3. `recordCycle({measureIndices:[4,5], wrongMeasures:new Set([5]), bucket:'rh'})` → local record shows `4:{rh:{attempts:1,passes:1}}`, `5:{rh:{attempts:1,passes:0}}` and the PUT body contains ONLY measures 4 and 5 plus the fingerprint;
4. fingerprint mismatch on load (server record has `fingerprint.measureCount` ≠ prop) → `record` is `{}` (server data ignored);
5. `recordTierBest` keeps the max (existing 95, new 80 → no PUT; new 97 → PUT).

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement.**

```js
// practiceKey.js
/**
 * practiceKey — identity + hands-bucket helpers for the practice record (§C).
 * The slug must satisfy the backend's /^[a-z0-9-]{1,120}$/ (dots corrupt YAML
 * filenames — FileIO appends .yml by inspecting the trailing extension).
 */
export function practiceKeyOf(contentId) {
  return String(contentId || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Hands bucket for the practice record: non-grand-staff collapses to 'both'. */
export function bucketOf(grandStaff, activeParts) {
  if (!grandStaff) return 'both';
  const rh = !!activeParts?.[0];
  const lh = !!activeParts?.[1];
  return rh && lh ? 'both' : rh ? 'rh' : 'lh';
}

export default { practiceKeyOf, bucketOf };
```

```js
// usePracticeRecord.js — follows usePianoPreferences' load/gate/optimistic-PUT idiom.
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../../../../lib/api.mjs';
import { usePianoUser } from '../../PianoUserContext.jsx';
import { GUEST_PROFILE, isPersistentUser } from '../../pianoUser.js';
import { practiceKeyOf } from './practiceKey.js';

const fpMatches = (a, b) => !!a && !!b && a.measureCount === b.measureCount && a.xmlBytes === b.xmlBytes;

/**
 * usePracticeRecord — per-user, per-score practice history (wave-3 C).
 * Guests / no-user: no reads, no writes — the record stays {} and the
 * heuristic runs history-less (the backend 400s guest anyway).
 */
export default function usePracticeRecord({ scoreId, fingerprint }) {
  const { currentUser } = usePianoUser();
  const key = useMemo(() => practiceKeyOf(scoreId), [scoreId]);
  const [record, setRecord] = useState({});
  const [loaded, setLoaded] = useState(false);
  const recordRef = useRef(record); recordRef.current = record;
  const fpRef = useRef(fingerprint); fpRef.current = fingerprint;

  useEffect(() => {
    setRecord({}); setLoaded(false);
    if (!isPersistentUser(currentUser)) {
      setLoaded(currentUser === GUEST_PROFILE.id);
      return undefined;
    }
    let cancelled = false;
    DaylightAPI(`api/v1/piano/users/${currentUser}/practice/${key}`)
      .then((res) => {
        if (cancelled) return;
        // A record for a different engraving describes measures that no longer
        // exist — run history-less; the first write replaces it server-side.
        setRecord(res && fpMatches(res.fingerprint, fpRef.current) ? res : {});
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) { setRecord({}); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [currentUser, key]);

  const put = useCallback((patch) => {
    if (!isPersistentUser(currentUser)) return;
    DaylightAPI(`api/v1/piano/users/${currentUser}/practice/${key}`, patch, 'PUT').catch(() => {});
  }, [currentUser, key]);

  /** One completed, non-voided gate cycle: attempts for every measure in the
   *  range; a pass wherever the cycle logged no wrong for that measure. */
  const recordCycle = useCallback(({ measureIndices, wrongMeasures, bucket }) => {
    if (!isPersistentUser(currentUser) || !measureIndices?.length) return;
    const touched = {};
    const next = { ...recordRef.current, fingerprint: fpRef.current, measures: { ...(recordRef.current.measures || {}) } };
    for (const m of measureIndices) {
      const k = String(m);
      const cur = next.measures[k]?.[bucket] || { attempts: 0, passes: 0 };
      const entry = { attempts: cur.attempts + 1, passes: cur.passes + (wrongMeasures?.has(m) ? 0 : 1) };
      next.measures[k] = { ...(next.measures[k] || {}), [bucket]: entry };
      touched[k] = next.measures[k];
    }
    setRecord(next);
    put({ fingerprint: fpRef.current, measures: touched });
  }, [currentUser, put]);

  /** Tier best for the current hands bucket; only improvements write. */
  const recordTierBest = useCallback(({ bucket, tier, score }) => {
    if (!isPersistentUser(currentUser)) return;
    const cur = recordRef.current?.polish?.[bucket]?.[tier];
    if (Number.isFinite(cur) && cur >= score) return;
    const polish = { ...(recordRef.current.polish || {}) };
    polish[bucket] = { ...(polish[bucket] || {}), [tier]: score };
    setRecord({ ...recordRef.current, polish });
    put({ fingerprint: fpRef.current, polish: { [bucket]: { [tier]: score } } });
  }, [currentUser, put]);

  return { record, loaded, recordCycle, recordTierBest };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/practiceKey.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/usePracticeRecord.test.js`

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): usePracticeRecord — per-user practice history hook (wave-3 C)"`

---

### Task 13: Learn cycle instrumentation — attempts & passes

Attempt = completed loop cycle (in→out wrap) with the gate active. Pass credit is per-measure: a measure passes when zero `onWrong` events landed in it during the cycle.

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.js` (+`onWrap`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (cycle tracking + voiding)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Interfaces:**
- Produces: `useFollowTracker` new callback `onWrap()` — fires when advancement wraps from the range's out-point back to its in-point (`nextStepInRange` returned `lo` from `hi`). Existing callers unaffected (optional prop).
- Produces (ScorePlayer internals): `cycleWrongsRef` (Set of measure indices with ≥1 wrong this cycle), `cycleVoidRef` (bool). Voiders (each sets `cycleVoidRef.current = true` until the next wrap): tap-seek, hand-toggle change, range change (set/nudge/clear), transpose change, mode exit (exit discards outright).
- Consumes: `usePracticeRecord.recordCycle` (Task 12), `bucketOf` (Task 12), `measureIndexOfStep` (:220), `focus` for `measureIndices` (`inMeasure..outMeasure` inclusive).

- [ ] **Step 1: Failing tracker test** — in `useFollowTracker.test.js` (reuse its existing fixture steps/subscribe fake):

```js
  it('fires onWrap when the range wraps out→in', () => {
    const onWrap = vi.fn();
    // range [0, 1]: satisfy step 0, then step 1 → wrap back to 0
    renderTracker({ range: [0, 1], onWrap });
    strike(fixtureMidiAt(0));
    strike(fixtureMidiAt(1));
    expect(onWrap).toHaveBeenCalledTimes(1);
  });
```

(Adapt `renderTracker`/`strike` to the file's existing helpers — read it first.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `onWrap`.** In `useFollowTracker.js`: add `onWrap` prop + ref; in the satisfied branch:

```js
          const next = r
            ? nextStepInRange(stepRef.current, r)
            : stepRef.current + 1;
          if (r && next === r[0] && stepRef.current >= r[1]) onWrapRef.current?.();
          onStepRef.current?.(next);
```

- [ ] **Step 4: ScorePlayer wiring (failing tests first).** New tests: with a 2-measure range and gate active, completing the range once calls `recordCycle` with both measure indices and the wrong-measures set; a tap-seek mid-cycle voids (no `recordCycle` on the next wrap, but the one after counts); guest (no user) → never calls the API (covered by the hook, but assert no crash). Mock `usePracticeRecord`'s module in the ScorePlayer tests (`vi.mock('./usePracticeRecord.js', ...)`) to observe calls without network.

Implementation sketch in `ScorePlayer.jsx`:

```js
  const fingerprint = useMemo(
    () => ({ measureCount: meta.measures, xmlBytes: scoreMeta.musicXml?.length || 0 }),
    [meta.measures, scoreMeta.musicXml],
  );
  const { record: practice, recordCycle, recordTierBest } = usePracticeRecord({ scoreId: scoreMeta.id, fingerprint });

  const cycleWrongsRef = useRef(new Set());
  const cycleVoidRef = useRef(false);
  const voidCycle = useCallback(() => { cycleVoidRef.current = true; }, []);

  const onFollowWrong = useCallback((midi) => {
    /* existing shake/ink/streak behavior (Tasks 9/18) */
    cycleWrongsRef.current.add(measureIndexOfStep(stepRef.current));
  }, [/* … */ measureIndexOfStep]);

  const onFollowWrap = useCallback(() => {
    const f = focusRef.current;                 // add focusRef alongside rangeRef
    const voided = cycleVoidRef.current;
    const wrongs = cycleWrongsRef.current;
    cycleVoidRef.current = false;
    cycleWrongsRef.current = new Set();
    if (voided || !f) return;
    const indices = [];
    for (let m = f.inMeasure; m <= f.outMeasure; m++) indices.push(m);
    recordCycle({ measureIndices: indices, wrongMeasures: wrongs, bucket: bucketOf(grandStaff, activeParts) });
    logger.info('score.learn.cycle', { in: f.inMeasure, out: f.outMeasure, wrongs: wrongs.size });
  }, [recordCycle, grandStaff, activeParts, logger]);
```

Wire `onWrap: onFollowWrap` into the `useFollowTracker` call. Voiders: call `voidCycle()` from the tap-seek branch of `onScoreClick`, from `onHandsChange`/`onCyclePart`, from the focus-set effect, from `onNudge`, from `onTranspose`, and reset both refs on mode change (`onMode`) and range change. (Mode exit mid-cycle = discard: the reset in `onMode` covers it.)

- [ ] **Step 5: Run — expect PASS**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/useFollowTracker.test.js frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): Learn cycle attempts/passes feed the practice record (wave-3 C)"`

---

### Task 14: Auto-range heuristic + Learn landing

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/learnRange.js` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (Learn-entry auto-range)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Interfaces:**
- Produces (pure):
  ```js
  pickLearnRange({ sections, measures, steps, activeParts, passesByMeasure,
                   windowSize = 4, passThreshold = 3 })
    → { inMeasure, outMeasure, reason: 'frontier'|'section'|'density'|'fallback'|'whole' }
  ```
  - `passesByMeasure`: `number[]` aligned to `measures` (min across the selected bucket's passes; caller derives from the practice record — measures absent from the record count 0).
  - Cue order: (1) **frontier** — first `windowSize` window whose minimum pass count over measures-with-expected-notes is `< passThreshold` (requires a practice record: pass `passesByMeasure: null` to skip); (2) **section** — the first rehearsal section (mapped via `sectionToRange`); (3) **density** — first `windowSize` window where EVERY measure has ≥1 expected note for the active hands; (4) **fallback** — first `windowSize` consecutive non-empty measures (any staff), clipped to the piece; if none, **whole** piece `{0, measures.length-1}`.
- Consumes: `sectionToRange` (focusRange.js), `expectedMidisAtStep` (activeParts.js), practice record (Task 12), `layout.measures`/`layout.steps`.

- [ ] **Step 1: Failing tests** — `learnRange.test.js` with a small synthetic fixture:

```js
import { pickLearnRange } from './learnRange.js';

// 8 measures, 1 step each; measures 0-1 are rest-only (no notes), the rest have RH notes.
const measures = Array.from({ length: 8 }, (_, i) => ({ index: i, number: i + 1, firstStep: i, lastStep: i }));
const steps = measures.map((m) => ({ notes: m.index < 2 ? [] : [{ midi: 60 + m.index, staff: 0 }] }));
const RH = { 0: true, 1: false };

describe('pickLearnRange', () => {
  it('frontier: first window where any measure is short of the pass threshold', () => {
    const passes = [3, 3, 3, 3, 2, 3, 3, 3]; // measure 4 not learned
    const r = pickLearnRange({ sections: [], measures, steps, activeParts: RH, passesByMeasure: passes });
    expect(r).toEqual({ inMeasure: 4, outMeasure: 7, reason: 'frontier' });
  });
  it('fully-learned history falls through to sections', () => {
    const passes = Array(8).fill(3);
    const r = pickLearnRange({ sections: [{ label: 'A', startMeasure: 3, endMeasure: 5 }], measures, steps, activeParts: RH, passesByMeasure: passes });
    expect(r).toEqual({ inMeasure: 2, outMeasure: 4, reason: 'section' });
  });
  it('no history, no sections: density floor skips the rest-heavy intro', () => {
    const r = pickLearnRange({ sections: [], measures, steps, activeParts: RH, passesByMeasure: null });
    expect(r.inMeasure).toBe(2);
    expect(r.reason).toBe('density');
  });
  it('all-rest piece falls back to the whole piece', () => {
    const restSteps = measures.map(() => ({ notes: [] }));
    const r = pickLearnRange({ sections: [], measures, steps: restSteps, activeParts: RH, passesByMeasure: null });
    expect(r).toEqual({ inMeasure: 0, outMeasure: 7, reason: 'whole' });
  });
});
```

(Note: `sections` use measure NUMBERS — `startMeasure: 3` is measure index 2. That asymmetry is exactly what `sectionToRange` handles.)

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```js
// learnRange.js — pure auto-range heuristic for the Learn landing (wave-3 B).
import { sectionToRange } from './focusRange.js';
import { expectedMidisAtStep } from './activeParts.js';

const clip = (m, max) => Math.max(0, Math.min(m, max));

/** Measures with ≥1 expected note for the ACTIVE hands. */
function hasActiveNotes(measure, steps, activeParts) {
  for (let i = measure.firstStep; i <= measure.lastStep; i++) {
    if (expectedMidisAtStep(steps?.[i], activeParts || {}).size > 0) return true;
  }
  return false;
}
function hasAnyNotes(measure, steps) {
  for (let i = measure.firstStep; i <= measure.lastStep; i++) {
    if ((steps?.[i]?.notes || []).length > 0) return true;
  }
  return false;
}

export function pickLearnRange({ sections = [], measures = [], steps = [], activeParts = {}, passesByMeasure = null, windowSize = 4, passThreshold = 3 }) {
  const n = measures.length;
  if (!n) return { inMeasure: 0, outMeasure: 0, reason: 'whole' };
  const last = n - 1;
  const active = measures.map((m) => hasActiveNotes(m, steps, activeParts));

  // 1 · history frontier: first window holding an under-practiced playable measure.
  if (Array.isArray(passesByMeasure)) {
    for (let i = 0; i <= Math.max(0, n - 1); i++) {
      const end = clip(i + windowSize - 1, last);
      let short = false;
      for (let m = i; m <= end; m++) {
        if (active[m] && (passesByMeasure[m] ?? 0) < passThreshold) { short = true; break; }
      }
      if (short) return { inMeasure: i, outMeasure: end, reason: 'frontier' };
    }
  }

  // 2 · first rehearsal section.
  for (const s of sections) {
    const r = sectionToRange(s, measures);
    if (r) return { ...r, reason: 'section' };
  }

  // 3 · density floor: first window where EVERY measure is playable by the active hands.
  for (let i = 0; i + windowSize - 1 <= last; i++) {
    let ok = true;
    for (let m = i; m < i + windowSize; m++) if (!active[m]) { ok = false; break; }
    if (ok) return { inMeasure: i, outMeasure: i + windowSize - 1, reason: 'density' };
  }

  // 4 · first non-empty run (any staff), else the whole piece.
  const firstNotes = measures.findIndex((m) => hasAnyNotes(m, steps));
  if (firstNotes >= 0) return { inMeasure: firstNotes, outMeasure: clip(firstNotes + windowSize - 1, last), reason: 'fallback' };
  return { inMeasure: 0, outMeasure: last, reason: 'whole' };
}

export default { pickLearnRange };
```

(Nuance the frontier scan flags: the window START walks measure-by-measure so the frontier lands where trouble starts, not on a window boundary. The test above pins `inMeasure: 4`.)

- [ ] **Step 4: Wire the Learn landing.** In ScorePlayer: entering Learn with NO existing `focus` picks the range once layout + practice record are ready:

```js
  // Learn landing (wave-3 B): pick the frontier window when Learn is entered
  // without a range. Runs once per Learn entry — the pickedRef arms on entry
  // and disarms after the pick (or when the user sets a range themselves).
  const learnAutoRef = useRef(false);
  useEffect(() => { if (mode === 'learn' && !focus) learnAutoRef.current = true; else if (mode !== 'learn') learnAutoRef.current = false; }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!learnAutoRef.current || mode !== 'learn' || focus || !layout.measures?.length || !practiceLoaded) return;
    learnAutoRef.current = false;
    const bucket = bucketOf(grandStaff, activeParts);
    const passes = practice?.measures
      ? layout.measures.map((m) => practice.measures[String(m.index)]?.[bucket]?.passes ?? 0)
      : null;
    const picked = pickLearnRange({ sections, measures: layout.measures, steps: layout.steps, activeParts, passesByMeasure: passes });
    focusOriginRef.current = 'auto';
    setFocus({ kind: 'custom', inMeasure: picked.inMeasure, outMeasure: picked.outMeasure });
    setLoopOn(true); // the landing IS the gate state — ready to play
    logger.info('score.learn.auto-range', { ...picked });
  }, [mode, focus, layout.measures, layout.steps, practiceLoaded, practice, activeParts, grandStaff, sections, logger]);
```

(`practiceLoaded` = the hook's `loaded`. The focus-set effect from Task 9 stops/positions the cursor — no extra work.) Add ScorePlayer tests: entering Learn on a fresh score sets a focus with `loopOn` true and logs `score.learn.auto-range`; a user-set range beforehand is never overwritten.

- [ ] **Step 5: Run — expect PASS**, full SheetMusic suite.

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): Learn auto-range landing — frontier/section/density heuristic (wave-3 B)"`

---

### Task 15: Hand preference (§E)

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.js` (+`learn.defaultHands`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/sheetMusicConfig.test.js`
- Modify: `frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js` (projection passthrough test — the resolver gotcha)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (seeding + content clamp)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Interfaces:**
- Produces: `SHEET_MUSIC_DEFAULTS.learn = { defaultHands: 'both' }`; resolved as `{ ...defaults.learn, ...(raw.learn || {}) }`. Resolution chain at the consumer: `prefs.learnHands` (per-user `preferences.yml`) → `smCfg.learn.defaultHands` (household `piano.yml`) → `'both'` — implemented as `getPref('learnHands', smCfg.learn.defaultHands)` via `usePianoPreferences` (the idiomatic client-side chain; no backend resolver exists or is added).
- Consumes: `usePianoPreferences()` (existing hook — this is its first production consumer besides Flashcards' direct calls).

**Seeding rule:** applies on Learn entry for a score with NO persisted `activeParts` (`restored.activeParts` absent) and only for grand-staff scores. **Content clamp:** if the preferred hand's staff has no notes anywhere in the piece, fall back to the content-bearing hand(s) — a preference must never select an empty staff and deadlock the gate.

- [ ] **Step 1: Failing tests.**
  - `sheetMusicConfig.test.js`: `resolveSheetMusicConfig({}).learn.defaultHands === 'both'`; `resolveSheetMusicConfig({ learn: { defaultHands: 'rh' } }).learn.defaultHands === 'rh'`.
  - `PianoConfig.test.js` (the projection gotcha — new keys silently dropped unless threaded): `resolvePianoConfig({ sheetmusic: { learn: { defaultHands: 'rh' } } }, 'default').sheetmusic.learn.defaultHands === 'rh'` (passes via the whole-node spread today — the test PINS it so a future field-wise rewrite can't drop it).
  - ScorePlayer: fresh grand-staff score + `learnHands: 'lh'` pref → entering Learn shows LH-only active (`Right hand` toggle un-pressed); with an LH staff that has zero notes, seeding falls back to RH; a score with persisted activeParts ignores the preference.
- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement.**
  - `sheetMusicConfig.js`: add `learn: { defaultHands: 'both' }` to defaults and `learn: { ...SHEET_MUSIC_DEFAULTS.learn, ...(isObj(r.learn) ? r.learn : {}) }` to the resolver.
  - ScorePlayer: `const { getPref } = usePianoPreferences();` and in the Learn-entry effect (BEFORE the auto-range effect of Task 14 in source order, so hands settle first):

```js
  // Hand preference (wave-3 E): user → household → both, applied once per score
  // when Learn is entered with no persisted hands choice. Clamped to staves
  // that actually carry notes — a preference must never dead-end the gate.
  const seededHandsRef = useRef(false);
  useEffect(() => {
    if (mode !== 'learn' || seededHandsRef.current || !grandStaff) return;
    if (restored.activeParts && typeof restored.activeParts === 'object') { seededHandsRef.current = true; return; }
    if (!layout.notes?.length) return;
    seededHandsRef.current = true;
    const pref = getPref('learnHands', smCfg.learn.defaultHands);
    if (pref !== 'rh' && pref !== 'lh') return; // 'both' is already the default
    const staffHasNotes = (s) => layout.notes.some((nte) => nte.staff === s);
    const want = pref === 'rh' ? 0 : 1;
    const target = staffHasNotes(want) ? want : staffHasNotes(want === 0 ? 1 : 0) ? (want === 0 ? 1 : 0) : null;
    if (target == null) return;
    setActiveParts({ 0: target === 0, 1: target === 1 });
  }, [mode, grandStaff, layout.notes, restored.activeParts, getPref, smCfg]);
  useEffect(() => { seededHandsRef.current = false; }, [scoreMeta.id]);
```

- [ ] **Step 4: Run — expect PASS** (sheetMusicConfig, PianoConfig, ScorePlayer files).

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): learn hand preference — user → household → both, content-clamped (wave-3 E)"`

---

### Task 16: spellMidi + soundingFifths (pure)

**Files:**
- Create: `frontend/src/modules/MusicNotation/model/spellMidi.js` (+test)

**Interfaces:**
- Produces:
  - `spellMidi(midi, fifths = 0) → { step:'A'..'G', alter:-1|0|1, octave }` — key-aware: a pitch class belonging to the key's 7 diatonic letters spells diatonically; anything else spells sharps-default. Output shape matches Composer's `pending[].pitch` exactly (PendingLayer contract).
  - `soundingFifths(fifths, semitones) → number` — the sounding key signature after a transpose: `((fifths + semitones * 7) % 12 + 12) % 12`, folded into `[-5..6]` (subtract 12 above 6). `semitones = 0` returns `fifths` unchanged (written spelling wins, ±7 fifths preserved).
  - `keyAlterations(fifths) → { C..B: -1|0|1 }` (exported for tests).
- Consumes: nothing (pure). NOT built on `pitch.js`'s `getStaffPosition` (clef-guessing + coin-flip spelling — the exact disqualifiers PendingLayer documents).

- [ ] **Step 1: Failing tests**

```js
// frontend/src/modules/MusicNotation/model/spellMidi.test.js
import { spellMidi, soundingFifths, keyAlterations } from './spellMidi.js';

describe('keyAlterations', () => {
  it('sharps in fifths order, flats in reverse', () => {
    expect(keyAlterations(2)).toMatchObject({ F: 1, C: 1, G: 0 });   // D major: F#, C#
    expect(keyAlterations(-3)).toMatchObject({ B: -1, E: -1, A: -1, D: 0 }); // Eb major
  });
});

describe('spellMidi', () => {
  it('spells diatonic pitches per the key', () => {
    expect(spellMidi(70, -2)).toEqual({ step: 'B', alter: -1, octave: 4 }); // Bb in Bb major
    expect(spellMidi(66, 2)).toEqual({ step: 'F', alter: 1, octave: 4 });   // F# in D major
    expect(spellMidi(65, 6)).toEqual({ step: 'E', alter: 1, octave: 4 });   // E# in F# major (pc 5)
  });
  it('spells non-diatonic pitches sharps-default', () => {
    expect(spellMidi(61, 0)).toEqual({ step: 'C', alter: 1, octave: 4 });   // C# in C major
    expect(spellMidi(63, 0)).toEqual({ step: 'D', alter: 1, octave: 4 });   // D#, not Eb
  });
  it('octave math survives letter wrap (Cb)', () => {
    expect(spellMidi(59, -7)).toEqual({ step: 'C', alter: -1, octave: 4 }); // Cb4 = midi 59
  });
});

describe('soundingFifths', () => {
  it('zero transpose is identity (written spelling wins)', () => {
    expect(soundingFifths(7, 0)).toBe(7);
  });
  it('moves by 7 fifths per semitone, folded to -5..6', () => {
    expect(soundingFifths(0, 2)).toBe(2);    // C +2 → D
    expect(soundingFifths(0, -1)).toBe(5);   // C -1 → B (5 sharps; fold prefers the sharp side)
    expect(soundingFifths(1, 1)).toBe(-4);   // G +1 → Ab
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```js
// spellMidi.js — key-aware MIDI → MusicXML-style pitch spelling (wave-3 D).
// PendingLayer deliberately refuses midi round-trips because generic helpers
// guess the clef and coin-flip the accidental; this helper is the missing
// bridge: spell from the SOUNDING key signature, sharps-default otherwise.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SHARP_SPELL = [
  { step: 'C', alter: 0 }, { step: 'C', alter: 1 }, { step: 'D', alter: 0 },
  { step: 'D', alter: 1 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 },
  { step: 'F', alter: 1 }, { step: 'G', alter: 0 }, { step: 'G', alter: 1 },
  { step: 'A', alter: 0 }, { step: 'A', alter: 1 }, { step: 'B', alter: 0 },
];

/** Per-letter alteration of a key signature (-1 flat, 0 natural, 1 sharp). */
export function keyAlterations(fifths) {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const n = Math.max(-7, Math.min(7, Math.trunc(fifths) || 0));
  if (n > 0) for (let i = 0; i < n; i++) map[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) map[FLAT_ORDER[i]] = -1;
  return map;
}

/** Sounding key signature after a transpose (fifths move 7 per semitone). */
export function soundingFifths(fifths, semitones) {
  const f = Math.trunc(fifths) || 0;
  const s = Math.trunc(semitones) || 0;
  if (!s) return f;
  let out = (((f + s * 7) % 12) + 12) % 12;
  if (out > 6) out -= 12;
  return out;
}

/** Spell a midi number in the given key. Diatonic → the key's spelling; else sharps. */
export function spellMidi(midi, fifths = 0) {
  const pc = ((midi % 12) + 12) % 12;
  const alts = keyAlterations(fifths);
  for (const step of LETTERS) {
    if ((((LETTER_PC[step] + alts[step]) % 12) + 12) % 12 === pc) {
      const alter = alts[step];
      return { step, alter, octave: (midi - LETTER_PC[step] - alter) / 12 - 1 };
    }
  }
  const s = SHARP_SPELL[pc];
  return { step: s.step, alter: s.alter, octave: (midi - LETTER_PC[s.step] - s.alter) / 12 - 1 };
}

export default { spellMidi, soundingFifths, keyAlterations };
```

(Octave identity: `midi = (octave + 1) * 12 + LETTER_PC[step] + alter`, so the division is exact by construction — Cb4: `(59 - 0 - (-1))/12 - 1 = 4`. ✓)

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat(notation): spellMidi — key-aware MIDI spelling + soundingFifths (wave-3 D)"`

---

### Task 17: Wet-ink glyph extraction (Composer)

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/wetGlyphs.jsx` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Composer/PendingLayer.jsx` (consume the extraction; DOM output unchanged)
- Check: `PendingLayer.test.jsx` stays green UNCHANGED (that's the refactor's proof)

**Interfaces:**
- Produces: `WetNoteGlyph({ x, staff, pitch, clef, type = 'quarter', dots = 0, classPrefix = 'composer-wet-note', className = '' })` — renders one `<g>` containing ledger lines, stem, accidental, notehead, dots for ONE note, using the exact math currently inline in PendingLayer (`yFor`, rx/ry/stemLen from `staff.lineSpacing`, ledger loop, rotate(-20) ellipse, hollow half/whole heads, data-acc sharp/flat groups). `staff` = `{ top, left, right, lineSpacing }`. Child class names are `${classPrefix}__ledger|stem|acc|head|dot`.
- Also exports the currently-private helpers for reuse: `staffPositionOf(pitch, clef)`, `WET_ADVANCE_UNITS`, `WET_RX_UNITS` (re-exported so PendingLayer's public constants keep their import site).
- Consumes: nothing new — this is a MOVE of PendingLayer's L63-179 + L191-215 into a shared file. **Rests stay in PendingLayer** (LearnInk never draws rests).

- [ ] **Step 1: Baseline.** Run `PendingLayer.test.jsx` — expect PASS (this is the ratchet; 222 lines of DOM assertions become the extraction's regression suite).

- [ ] **Step 2: Write the new-surface test** (thin — the real coverage is PendingLayer's):

```jsx
// wetGlyphs.test.jsx
import { render } from '@testing-library/react';
import { WetNoteGlyph, staffPositionOf } from './wetGlyphs.jsx';

const STAVE = { top: 100, left: 50, right: 500, lineSpacing: 10 };

it('staffPositionOf matches PendingLayer conventions (treble E4 = 0, bass G2 = 0)', () => {
  expect(staffPositionOf({ step: 'E', octave: 4, alter: 0 }, { sign: 'G' })).toBe(0);
  expect(staffPositionOf({ step: 'G', octave: 2, alter: 0 }, { sign: 'F' })).toBe(0);
});

it('renders a prefixed head + stem for a middle-of-staff note', () => {
  const { container } = render(
    <svg><WetNoteGlyph x={120} staff={STAVE} clef={{ sign: 'G' }} pitch={{ step: 'B', octave: 4, alter: 0 }} classPrefix="piano-learn-ink" /></svg>,
  );
  expect(container.querySelector('.piano-learn-ink__head')).not.toBeNull();
  expect(container.querySelector('.piano-learn-ink__stem')).not.toBeNull();
});

it('draws ledger lines below the staff (C4 in treble → one ledger)', () => {
  const { container } = render(
    <svg><WetNoteGlyph x={120} staff={STAVE} clef={{ sign: 'G' }} pitch={{ step: 'C', octave: 4, alter: 0 }} /></svg>,
  );
  expect(container.querySelectorAll('.composer-wet-note__ledger')).toHaveLength(1);
});
```

- [ ] **Step 3: Run — expect FAIL**, then extract. Move PendingLayer's private `STEP_DIATONIC`/`absDiatonic`/`bottomLineDiatonic`/`staffPosition` (rename export `staffPositionOf`), the per-note glyph block (ledgers L111-127, stem L132-148, accidental L150+191-215, head L152-165, dots L167-179) into `wetGlyphs.jsx` as `WetNoteGlyph`. Parameterize every class with `classPrefix`. PendingLayer keeps: props/bail, `anchorX + i * advance` layout, `maxX` clamp, rests — and maps non-rest notes to `<WetNoteGlyph …/>`. `WET_ADVANCE_UNITS`/`WET_RX_UNITS` move to wetGlyphs and are re-exported from PendingLayer (its test imports them from PendingLayer — check first; keep whichever import site the tests use).

- [ ] **Step 4: Run BOTH test files — `PendingLayer.test.jsx` must pass with zero edits.** If an assertion fails, the extraction changed DOM output — fix the extraction, never the test.

- [ ] **Step 5: Commit** — `git commit -m "refactor(piano): extract WetNoteGlyph from PendingLayer for shared wet ink (wave-3 D prep)"`

---

### Task 18: LearnInkLayer + ink wiring + punishment budget

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LearnInkLayer.jsx` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (ink event state, wrong-note placement, reveal-keys budget)
- Modify: `frontend/src/Apps/PianoApp.scss` (`.piano-learn-ink` + fade/flash animations)
- Modify: `ScorePlayer.test.jsx`

**Interfaces:**
- Produces: `LearnInkLayer({ inks = [], staffBoxes = [], clefs = {}, keyFifths = 0 })`:
  - `inks`: `[{ id, midi, staff, system, x, kind: 'wrong'|'hit'|'neutral' }]` — parent owns lifecycle (append on note, remove on timeout).
  - Renders ONE `<svg className="piano-learn-ink">` (PendingLayer's single-node discipline); each ink is a `WetNoteGlyph` with `classPrefix="piano-learn-ink"` wrapped in `<g className={\`piano-learn-ink__note is-${kind}\`}>` — per-kind color via CSS `currentColor` on the group (red for wrong, accent flash for hit, muted for neutral).
  - `clefs`: `{ [staffId]: { sign } }` — 0-based staff id → clef (derived from `parsed.parts[0].clefs`, which is keyed by 1-based MusicXML staff number: `clefs[staff + 1]`).
  - Glyphs render `type="quarter"` (filled head, stem) — duration is meaningless for struck notes.
- Produces (ScorePlayer): `pushInk(midi, kind)` — computes staff (single active hand → that staff; both → staff of the nearest expected midi at the current step; no expected notes → staff 0), system (the staffBox whose vertical band contains `current.top`), x = `current.x`. Ink auto-expires: wrong 900ms, hit 350ms, neutral 500ms.
- Reveal-keys budget: `revealKeys` arms only after **3 consecutive wrongs on the same step** (`wrongStreakRef`, reset on step change AND on any hit).
- Consumes: `spellMidi` + `soundingFifths` (Task 16), `WetNoteGlyph` (Task 17), `layout.staffBoxes` (Task 5), `learnGate`/`machineLearn` (Task 9).

**Behavior spec:**
1. Gate state: `onFollowHit` pushes a `hit` ink; `onFollowWrong(midi)` pushes a `wrong` ink at the played pitch + shake — and NO immediate reveal.
2. Third consecutive wrong on one step → `revealKeys` true (dim keyboard hint) — stuck support, not punishment. StuckPrompt dwell timer untouched.
3. Machine states (Learn rows 1/3): every user `note_on` renders a `neutral` ink at the played pitch; never red, never a shake.
4. Ink pitch is spelled in the SOUNDING key (transpose-aware): with transpose +2 on a C-major piece, played D5 renders on the D-major spelling grid.
5. Listen/Polish/Perform render no ink layer.

- [ ] **Step 1: Failing layer tests** (`LearnInkLayer.test.jsx`):

```jsx
import { render } from '@testing-library/react';
import LearnInkLayer from './LearnInkLayer.jsx';

const BOXES = [
  { system: 0, staff: 0, top: 100, left: 50, right: 500, lineSpacing: 10 },
  { system: 0, staff: 1, top: 200, left: 50, right: 500, lineSpacing: 10 },
];
const CLEFS = { 0: { sign: 'G' }, 1: { sign: 'F' } };

it('renders one svg with a glyph per ink, kind-classed', () => {
  const inks = [
    { id: 1, midi: 61, staff: 0, system: 0, x: 120, kind: 'wrong' },
    { id: 2, midi: 40, staff: 1, system: 0, x: 160, kind: 'hit' },
  ];
  const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
  expect(container.querySelectorAll('svg.piano-learn-ink')).toHaveLength(1);
  expect(container.querySelectorAll('.piano-learn-ink__note.is-wrong')).toHaveLength(1);
  expect(container.querySelectorAll('.piano-learn-ink__note.is-hit')).toHaveLength(1);
});

it('spells the wrong note in the sounding key (sharp head carries an accidental group)', () => {
  const inks = [{ id: 1, midi: 61, staff: 0, system: 0, x: 120, kind: 'wrong' }]; // C# in C major
  const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
  expect(container.querySelector('[data-acc="sharp"]')).not.toBeNull();
});

it('skips inks whose staff box is missing (mid re-engrave)', () => {
  const inks = [{ id: 1, midi: 60, staff: 5, system: 0, x: 120, kind: 'wrong' }];
  const { container } = render(<LearnInkLayer inks={inks} staffBoxes={BOXES} clefs={CLEFS} keyFifths={0} />);
  expect(container.querySelectorAll('.piano-learn-ink__note')).toHaveLength(0);
});

it('renders nothing when empty', () => {
  const { container } = render(<LearnInkLayer inks={[]} staffBoxes={BOXES} clefs={CLEFS} />);
  expect(container.querySelector('svg')).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the layer**

```jsx
// LearnInkLayer.jsx
import React from 'react';
import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';

/**
 * LearnInkLayer — user input rendered as wet ink at the cursor column (wave-3 D).
 * One <svg>, many glyph children (PendingLayer's jank discipline — never a
 * re-engrave). Wrong notes draw a red notehead AT THE PLAYED PITCH, spelled
 * from the SOUNDING key; hits flash; machine-driven states ink neutrally.
 * Pure: the parent owns ink lifecycle (append + timed removal).
 */
export default function LearnInkLayer({ inks = [], staffBoxes = [], clefs = {}, keyFifths = 0 }) {
  if (!inks.length || !staffBoxes.length) return null;
  const glyphs = [];
  for (const ink of inks) {
    const staff = staffBoxes.find((b) => b.system === ink.system && b.staff === ink.staff);
    if (!staff) continue; // geometry not reported (mid re-engrave) — skip
    glyphs.push(
      <g key={ink.id} className={`piano-learn-ink__note is-${ink.kind}`}>
        <WetNoteGlyph
          x={ink.x}
          staff={staff}
          clef={clefs[ink.staff] || { sign: ink.staff === 1 ? 'F' : 'G' }}
          pitch={spellMidi(ink.midi, keyFifths)}
          classPrefix="piano-learn-ink"
        />
      </g>,
    );
  }
  if (!glyphs.length) return null;
  return <svg className="piano-learn-ink" aria-hidden="true">{glyphs}</svg>;
}
```

SCSS (PianoApp.scss, after the cursor rules):

```scss
  // Learn wet ink (wave-3 D): z5 with the cursor, mounted AFTER it in the DOM
  // so ink paints above the band; the busy/progress veils (z6/z7) stay on top.
  .piano-learn-ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    z-index: 5;
    pointer-events: none;

    &__note {
      &.is-wrong { color: #ff5252; animation: piano-ink-fade 900ms ease-out forwards; }
      &.is-hit { color: var(--piano-accent, #2ec46f); animation: piano-ink-fade 350ms ease-out forwards; }
      &.is-neutral { color: var(--piano-muted, #8a8f98); animation: piano-ink-fade 500ms ease-out forwards; }
    }
  }
  @keyframes piano-ink-fade {
    0% { opacity: 0.95; }
    70% { opacity: 0.9; }
    100% { opacity: 0; }
  }
```

- [ ] **Step 4: ScorePlayer wiring (failing tests first).** Tests: (a) in gate state a plausible wrong note renders `.piano-learn-ink__note.is-wrong` and it disappears after timers advance; (b) reveal: two wrongs → `targetNotes` still null (keyboard shows no hint); third wrong on the same step → hint appears (assert via LiveKeyboard's target rendering, as existing revealKeys tests do); (c) machine-learn: a note_on renders `is-neutral`, no shake class on the cursor.

Implementation:

```js
  const [inks, setInks] = useState([]);
  const inkSeqRef = useRef(0);
  const inkTimersRef = useRef(new Map());
  const INK_TTL = { wrong: 900, hit: 350, neutral: 500 };
  const pushInk = useCallback((midi, kind) => {
    const cur = events[stepRef.current];       // read via a ref-safe copy: eventsRef
    const boxes = layoutRef.current?.staffBoxes || [];
    if (!cur || !boxes.length) return;
    // Staff: the selected hand's staff, or the staff of the nearest expected note.
    const active = activePartsRef.current || {};
    const activeStaves = Object.keys(active).filter((s) => active[s]).map(Number);
    let staff = activeStaves.length === 1 ? activeStaves[0] : 0;
    if (activeStaves.length > 1) {
      let best = Infinity;
      for (const n of stepsRef.current?.[stepRef.current]?.notes || []) {
        if (!active[n.staff]) continue;
        const d = Math.abs(n.midi - midi);
        if (d < best) { best = d; staff = n.staff; }
      }
    }
    const mid = (cur.top + cur.bottom) / 2;
    const sys = boxes.find((b) => mid >= b.top - b.lineSpacing * 3 && mid <= b.top + b.lineSpacing * 7)?.system
      ?? boxes.find((b) => b.staff === staff)?.system ?? 0;
    const id = ++inkSeqRef.current;
    setInks((prev) => [...prev, { id, midi, staff, system: sys, x: cur.x, kind }]);
    const t = setTimeout(() => {
      inkTimersRef.current.delete(id);
      setInks((prev) => prev.filter((i) => i.id !== id));
    }, INK_TTL[kind] ?? 600);
    inkTimersRef.current.set(id, t);
  }, [events]);
  useEffect(() => () => { inkTimersRef.current.forEach(clearTimeout); }, []);
```

(Introduce `eventsRef`/`layoutRef` mirrors beside the existing `stepsRef`/`activePartsRef` if not already present.) Hook-ups:
- `onFollowHit(note)`: `+ pushInk(note, 'hit'); wrongStreakRef.current = 0;`
- `onFollowWrong(midi)`: `flashWrong(); pushInk(midi, 'wrong'); cycleWrongsRef…; wrongStreakRef.current += 1; if (wrongStreakRef.current >= 3) setRevealKeys(true);` — DELETE the unconditional `setRevealKeys(true)`.
- `useEffect(() => { wrongStreakRef.current = 0; }, [step]);` (alongside the existing revealKeys reset).
- Machine-learn neutral ink: one subscription effect:

```js
  useEffect(() => {
    if (!machineLearn || !subscribe) return undefined;
    return subscribe((evt) => {
      if (!evt || evt.type !== 'note_on' || !evt.velocity) return;
      pushInk(evt.note, 'neutral');
    });
  }, [machineLearn, subscribe, pushInk]);
```

- Mount (Learn only, after the cursor div so ink paints above the band):

```jsx
          {mode === 'learn' && layoutFresh && (
            <LearnInkLayer
              inks={inks}
              staffBoxes={layout.staffBoxes}
              clefs={inkClefs}
              keyFifths={soundingFifths(parsed?.key?.fifths ?? 0, transpose)}
            />
          )}
```

with `const inkClefs = useMemo(() => { const c = parsed?.parts?.[0]?.clefs || {}; return Object.fromEntries(Object.entries(c).map(([n, v]) => [Number(n) - 1, v])); }, [parsed]);` (1-based MusicXML staff number → 0-based staff id). Clear inks on document/mode change (`setInks([])` in the `:1316` reset effect and in `onMode`).

- [ ] **Step 5: Run the SheetMusic suite — expect PASS**

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): LearnInkLayer wet ink + 3-wrong reveal budget (wave-3 D)"`

---

### Task 19: LoopGroup extraction + video re-consume

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/LoopGroup.jsx` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx:61-69` (consume)
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss` (rehome the group styling under `.piano-loop-group`)
- Modify: `frontend/src/Apps/PianoApp.scss:1718-1737` (video-specific overrides only)
- Check: `PianoVideoChrome.test.jsx` (:77-84 'marks A and B for the loop') stays green

**Interfaces:**
- Produces:
  ```jsx
  LoopGroup({
    inSet = false, outSet = false,          // endpoints exist
    inLabel, outLabel,                       // optional captions under in/out (Learn: 'm5'/'m8')
    armingIn = false, armingOut = false,     // arming highlight per button
    loopOn = false,                          // toggle lit
    canToggle = false, canClear = false,     // enable gates
    disabled = false,                        // whole-group lockout (video gateOpen)
    onMarkIn, onMarkOut, onToggle, onClear,
    className = '',
  })
  ```
  Renders `div.piano-loop-group[.has-marks when inSet||outSet]` with four `TransportButton`s in order: `loop-in` (aria `Mark loop start`, label `inLabel`) · `loop-out` (aria `Mark loop end`, label `outLabel`, class `is-section-end`) · `loop-toggle` (aria `Toggle loop`, `on={loopOn}`, disabled unless `canToggle`) · `clear-loop` (aria `Clear loop`, disabled unless `canClear`). Arming: `is-arming` class on the respective button.
- Consumes (video): `inSet={loop?.a != null}`, `outSet={loop?.b != null}`, `armingIn={loop?.a != null && loop?.b == null}` (preserves the shipped arming visual), `loopOn={!!loop?.active}`, `canToggle={bothMarks}`, `canClear={hasLoop}`, `disabled={gateOpen}`, handlers `onMarkA/B/toggle/clear`. No labels.
- **Icons:** `loop-in`/`loop-out`/`loop-toggle`/`clear-loop` — all four exist in `icons/svg/`; none of the design doc's `loop-a`/`loop-b`/`repeat` names are used (MANIFEST:50 forbids collapsing `repeat` with `loop-toggle`).

- [ ] **Step 1: Failing tests** (`LoopGroup.test.jsx`):

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import LoopGroup from './LoopGroup.jsx';

const noop = { onMarkIn: vi.fn(), onMarkOut: vi.fn(), onToggle: vi.fn(), onClear: vi.fn() };

describe('LoopGroup', () => {
  it('renders the four buttons and fires the mark handlers', () => {
    const onMarkIn = vi.fn(); const onMarkOut = vi.fn();
    render(<LoopGroup {...noop} onMarkIn={onMarkIn} onMarkOut={onMarkOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark loop start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark loop end' }));
    expect(onMarkIn).toHaveBeenCalled();
    expect(onMarkOut).toHaveBeenCalled();
  });

  it('toggle and clear gate on canToggle/canClear', () => {
    render(<LoopGroup {...noop} canToggle={false} canClear={false} />);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeDisabled();
  });

  it('shows measure labels and the arming highlight', () => {
    render(<LoopGroup {...noop} inSet outSet inLabel="m5" outLabel="m8" armingOut canToggle canClear loopOn />);
    expect(screen.getByText('m5')).toBeInTheDocument();
    expect(screen.getByText('m8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark loop end' }).className).toMatch(/is-arming/);
    expect(screen.getByRole('button', { name: 'Toggle loop' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disabled locks the whole group', () => {
    render(<LoopGroup {...noop} inSet outSet canToggle canClear disabled />);
    ['Mark loop start', 'Mark loop end', 'Toggle loop', 'Clear loop']
      .forEach((n) => expect(screen.getByRole('button', { name: n })).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```jsx
// LoopGroup.jsx
import React from 'react';
import TransportButton from './TransportButton.jsx';

/**
 * LoopGroup — the shared A–B loop cluster (wave-3 F), extracted from the video
 * chrome: in/out marks plant endpoints; toggle cycles the region; trash clears.
 * Two families separated by the section-end divider. Presentational — every
 * semantic (what "mark" means: playhead seconds in video, armed-tap measures in
 * Learn) lives in the parent.
 */
export default function LoopGroup({
  inSet = false, outSet = false, inLabel, outLabel,
  armingIn = false, armingOut = false,
  loopOn = false, canToggle = false, canClear = false, disabled = false,
  onMarkIn, onMarkOut, onToggle, onClear, className = '',
}) {
  return (
    <div className={`piano-loop-group${inSet || outSet ? ' has-marks' : ''}${className ? ` ${className}` : ''}`}>
      <TransportButton icon="loop-in" label={inLabel} ariaLabel="Mark loop start" className={`piano-loop-group__btn${armingIn ? ' is-arming' : ''}`} disabled={disabled} onPress={onMarkIn} />
      <TransportButton icon="loop-out" label={outLabel} ariaLabel="Mark loop end" className={`piano-loop-group__btn is-section-end${armingOut ? ' is-arming' : ''}`} disabled={disabled} onPress={onMarkOut} />
      <TransportButton icon="loop-toggle" ariaLabel="Toggle loop" on={loopOn} aria-pressed={loopOn} className="piano-loop-group__btn piano-loop-group__btn--loop-toggle" disabled={disabled || !canToggle} onPress={onToggle} />
      <TransportButton icon="clear-loop" ariaLabel="Clear loop" className="piano-loop-group__btn piano-loop-group__btn--clear-loop" disabled={disabled || !canClear} onPress={onClear} />
    </div>
  );
}
```

Transport.scss — move the video group rules to neutral names (copy PianoApp.scss:1718-1737, s/piano-video-chrome__loop-group/piano-loop-group/, s/piano-video-chrome__btn/piano-loop-group__btn/, including `has-marks`, `is-section-end`, `is-arming`, and the 1.25em stroked-icon sizing for toggle/clear).

- [ ] **Step 4: Re-consume in the video chrome.** Replace `PianoVideoChrome.jsx:61-69` with:

```jsx
        <LoopGroup
          className="piano-video-chrome__loop"
          inSet={loop?.a != null}
          outSet={loop?.b != null}
          armingIn={loop?.a != null && loop?.b == null}
          loopOn={loopActive}
          canToggle={bothMarks}
          canClear={hasLoop}
          disabled={gateOpen}
          onMarkIn={onMarkA}
          onMarkOut={onMarkB}
          onToggle={onToggleLoop}
          onClear={onClearLoop}
        />
```

Delete the now-dead `.piano-video-chrome__loop-group`/loop-button rules from PianoApp.scss (keep only sizing overrides that are genuinely video-specific, if any, under `.piano-video-chrome__loop`).

- [ ] **Step 5: Run** `LoopGroup.test.jsx` + `PianoVideoChrome.test.jsx` — expect PASS (the :77-84 mark test passes unchanged; note the toggle's aria label changed from `Toggle A-B loop` to `Toggle loop` — grep the video tests for the old label first; none pin it per recon, but verify).

- [ ] **Step 6: Commit** — `git commit -m "refactor(piano): extract LoopGroup from video chrome into transport/ (wave-3 F)"`

---

### Task 20: Armed endpoint flow in Learn — measureAtPoint, LoopGroup wiring, two-tap retirement

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/measureAtPoint.js` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (`arming` replaces `selecting`; commit semantics)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SelectBanner.jsx` (edge-based copy)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/SelectBanner.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (`ScorePracticeCluster` renders LoopGroup, Learn-only)
- Modify: `ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LoopControl.jsx` + `LoopControl.test.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.jsx` + `LoopSheet.test.jsx`

**Interfaces:**
- Produces (pure): `measureAtPoint({ events, measures, x, y, slack = 40 }) → number` — measure index, or `-1` for dead margins. Rule: candidate events are those whose vertical band `[top - slack, bottom + slack]` contains `y` (same system); the nearest by `|x - e.x|` wins; its step maps to a measure via `measures[].firstStep/lastStep`. No near-a-note radius — any x within a system resolves.
- Produces (ScorePlayer): `arming: 'in'|'out'|null` state; `onArm(edge)` (from LoopGroup mark buttons AND Task 21's handle taps); `commitEndpoint(edge, measureIdx)`:
  - no `focus` → `{ kind:'custom', inMeasure: m, outMeasure: m }`, `setLoopOn(false)` (§F: one-measure range, loop off — no half-mark state, `focus` stays atomic);
  - existing `focus` → replace that edge; auto-swap if crossed (`in > out` → swap);
  - **section snap on commit:** if a section boundary (any section's start index, or end index) is within 1 measure of `m`, snap to it;
  - always `stopForMatrixChange()` (range change stops playback, never auto-plays) + `voidCycle()`.
- Bar wiring: `ScorePracticeCluster` drops the `LoopControl` props (`sections/onPickSection/onStartSelect/scopeLabel/onNudge`) and renders, ONLY when `mode === 'learn'`:
  ```jsx
  <LoopGroup
    inSet={loopActive} outSet={loopActive}
    inLabel={inLabel} outLabel={outLabel}          // 'm5' / 'm8' (1-based display)
    armingIn={arming === 'in'} armingOut={arming === 'out'}
    loopOn={loopActive && loopEnabled}
    canToggle={loopActive} canClear={loopActive}
    onMarkIn={() => onArm('in')} onMarkOut={() => onArm('out')}
    onToggle={onToggleLoop} onClear={onClearFocus}
  />
  ```
  New shell props: `arming`, `inLabel`, `outLabel`, `onArm` (all step-independent — memo discipline holds). Listen/Polish render no loop chrome at all.
- SelectBanner: props become `{ edge, rejects, onCancel }` — copy: `'Tap the measure for the loop start'` / `'…loop end'`; reject copy `'Tap inside the music'` (there is no near-a-note rule anymore); shake-on-reject remount (`key={rejects}`) kept.
- Telemetry: DELETE `score.focus.select-start/-timeout`, `score.focus.arm`, `score.loop.toggle`. ADD `score.loop.arm {edge}`, `score.loop.set {edge, measure, via:'tap'|'drag', snapped}`, `score.loop.on {on}` (toggle), `score.loop.clear` (rename of `score.focus.clear` — keep the old name if you prefer one fewer dashboard change; decision: keep `score.focus.clear`). `score.focus.set` (the effect at :967) stays — origins now `'auto'|'handle-tap'|'drag'|'drill'|'restore'`.

**Behavior spec:**
1. Tap `Mark loop start` (no range) → banner shows; tap on measure 3's column → 1-measure range `{3,3}`, loop OFF, brackets/handles visible, cursor at measure 3's first step, no auto-play.
2. With range `{3,3}`: arm out, tap measure 6 → `{3,6}`; arm in, tap measure 7 → auto-swap `{6,7}`.
3. Armed tap in a dead margin (y outside any system band) → reject counter bumps, banner shakes, arming persists.
4. Arm expires after 15s idle (reuse `SELECT_IDLE_MS`), and cancels on mode change / Play / Restart (same disciplines `selecting` had).
5. Snap: sections at measures 8 and 16; armed tap resolving to measure 7 or 9 commits 8.
6. Two-tap machinery is GONE: an unarmed tap in Learn/gate always seeks (clamped); `score.seek.tap` unchanged.

- [ ] **Step 1: measureAtPoint failing tests**

```js
// measureAtPoint.test.js
import { measureAtPoint } from './measureAtPoint.js';

// Two systems: steps 0-3 at y 100-160, steps 4-7 at y 300-360. One measure per 2 steps.
const events = [
  { x: 100, top: 100, bottom: 160 }, { x: 200, top: 100, bottom: 160 },
  { x: 300, top: 100, bottom: 160 }, { x: 400, top: 100, bottom: 160 },
  { x: 100, top: 300, bottom: 360 }, { x: 200, top: 300, bottom: 360 },
  { x: 300, top: 300, bottom: 360 }, { x: 400, top: 300, bottom: 360 },
];
const measures = [
  { index: 0, firstStep: 0, lastStep: 1 }, { index: 1, firstStep: 2, lastStep: 3 },
  { index: 2, firstStep: 4, lastStep: 5 }, { index: 3, firstStep: 6, lastStep: 7 },
];

describe('measureAtPoint', () => {
  it('maps any x in a system to the nearest measure column', () => {
    expect(measureAtPoint({ events, measures, x: 120, y: 130 })).toBe(0);
    expect(measureAtPoint({ events, measures, x: 999, y: 130 })).toBe(1);  // far right still resolves
    expect(measureAtPoint({ events, measures, x: 250, y: 340 })).toBe(2);  // second system
  });
  it('rejects dead margins between systems', () => {
    expect(measureAtPoint({ events, measures, x: 200, y: 230 })).toBe(-1);
  });
  it('slack admits taps just above/below the staves', () => {
    expect(measureAtPoint({ events, measures, x: 200, y: 175, slack: 40 })).toBe(0);
  });
  it('empty geometry rejects', () => {
    expect(measureAtPoint({ events: [], measures, x: 1, y: 1 })).toBe(-1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**, then implement:

```js
// measureAtPoint.js
/**
 * measureAtPoint — armed-tap hit-testing (wave-3 F): any x within a system
 * resolves to the nearest measure's column; only dead margins (outside every
 * system's vertical band) reject. Unlike the retired two-tap flow there is no
 * near-a-note radius — endpoint picking is a coarse gesture.
 */
export function measureAtPoint({ events = [], measures = [], x, y, slack = 40 }) {
  let bestI = -1;
  let bestD = Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (y < e.top - slack || y > e.bottom + slack) continue; // other system / margin
    const d = Math.abs(x - e.x);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  if (bestI < 0) return -1;
  const m = measures.findIndex((mm) => bestI >= mm.firstStep && bestI <= mm.lastStep);
  return m < 0 ? -1 : m;
}
export default measureAtPoint;
```

Run → PASS.

- [ ] **Step 3: SelectBanner rework (failing tests first).** New contract:

```jsx
export default function SelectBanner({ edge, rejects = 0, onCancel })
// copy: rejects>0 → 'Tap inside the music'
//       edge==='in' → 'Tap the measure for the loop start'
//       edge==='out' → 'Tap the measure for the loop end'
```

Update `SelectBanner.test.jsx` accordingly (keep the `key={rejects}` remount assertion and role=status).

- [ ] **Step 4: ScorePlayer + bar surgery (failing ScorePlayer tests per the behavior spec above, then implement):**
  - Replace `selecting`/`selectRejects` with `arming`/`armRejects`. `onArm(edge)`: `setArming(edge); setArmRejects(0); logger.info('score.loop.arm', { edge });`. Idle-expiry effect mirrors :991-998.
  - `onScoreClick`: the `if (selecting)` block becomes:
    ```js
    if (arming) {
      const mi = measureAtPoint({ events, measures: layout.measures || [], x: e.clientX - r.left, y: e.clientY - r.top, slack: 40 * scale });
      if (mi < 0) { setArmRejects((n) => n + 1); return; }
      setArming(null);
      commitEndpoint(arming, mi, 'tap');
      return;
    }
    ```
  - `commitEndpoint(edge, mi, via)` implements the §F semantics + snap (`snapMeasure` local helper: boundaries = every section's `sectionToRange` in/out indices; `|mi - b| <= 1` → b) + `stopForMatrixChange()` + `voidCycle()` + `focusOriginRef.current = via === 'drag' ? 'drag' : 'handle-tap'` + `logger.info('score.loop.set', { edge, measure, via, snapped })`.
  - `scopeLabel` → `inLabel`/`outLabel` (`focus ? \`m${focus.inMeasure + 1}\` : undefined`, same for out).
  - `onStartSelect`/`onPickSection`/`onNudge` die (sections survive as snap targets + Task 21 markers; the LoopSheet section menu is gone). `onDrillWorst` keeps working (sets focus directly). Delete `SELECT_MAX_DIST` import if now unused; keep `nearestEvent` for seeks.
  - `onToggleLoop`: event rename to `score.loop.on`; Task 9's stop-and-jump semantics unchanged.
  - Bar: `ScorePracticeCluster` per the interface block above (Learn-only render of LoopGroup; drop LoopControl import/props). Rewrite the bar's loop tests (:158-189, :308-330): Learn shows the four-button group with measure labels; Listen and Polish show NO loop chrome; Perform unchanged (null).
  - Arming cancels where selecting did: `toggleRun`, `reset`, `onMode` (`setArming(null)`).
- [ ] **Step 5: Delete the retired files** (`LoopControl.jsx/.test.jsx`, `transport/LoopSheet.jsx/.test.jsx`) — neither is grandfathered in `noUnicodeGlyphs.test.js`, so no guard edits. Grep for any remaining imports (`grep -rn "LoopSheet\|LoopControl" frontend/src`) — must be zero.

- [ ] **Step 6: Full SheetMusic + transport suites green**

Run: `node_modules/.bin/vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ frontend/src/modules/Piano/PianoKiosk/transport/`

- [ ] **Step 7: Commit** — `git commit -m "feat(piano): armed endpoint picking replaces two-tap loop selection; LoopGroup in Learn (wave-3 F)"`

---

### Task 21: RangeHandleLayer — tap + drag handles, section markers

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RangeHandleLayer.jsx` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/FocusRangeLayer.jsx` (drop brackets + pending; keep tint; add section marks)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/FocusRangeLayer.test.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (mount; drag plumbing)
- Modify: `frontend/src/Apps/PianoApp.scss` (handles ≥48px, touch-action, marker ticks)

**Interfaces:**
- Produces: `RangeHandleLayer({ measures = [], stepBoxes = [], range = null, onArm, onCommit, onPreview, scrollRef })`:
  - `range` = `{ inMeasure, outMeasure }` (the committed focus) — renders two handle divs (`.piano-score-range-handle--in/--out`, `role="slider"`, `aria-label="Loop start handle"/"Loop end handle"`, `aria-valuenow={measure+1}`) at the in-measure's left / out-measure's right extents (via the same `measureExtent` scan FocusRangeLayer uses — export it from FocusRangeLayer).
  - **Tap** (pointerup with < 8px total movement) → `onArm(edge)` — arms the same flow as the LoopGroup buttons.
  - **Drag**: `onPointerDown` → `setPointerCapture(e.pointerId)` on the handle element (capture-on-handle-only; CSS `touch-action: none` on `.piano-score-range-handle`); move → `measureAtPoint`-style nearest measure under the pointer (cross-system: nearest by the same band rule, but with `slack = Infinity` fallback to nearest system so the handle never dead-zones mid-drag) → `onPreview(edge, mi)` + handle tracks the pointer x; near the scroll container's top/bottom edge (48px) auto-scrolls `scrollRef.current` by ±12px per move event; release → `onCommit(edge, mi, 'drag')` (parent snaps).
  - Sub-measure tracking is visual only (the handle follows the pointer); measure resolution is what's committed.
- FocusRangeLayer new shape: `{ measures, stepBoxes, range, marks = [] }` — tint bands unchanged; brackets and `pending` DELETED (handles are the boundary visuals; the two-tap pending state no longer exists); `marks` = measure indices rendered as thin `.piano-score-section-mark` ticks at each mark measure's left edge (shown while arming/dragging — parent passes `[]` otherwise).
- Consumes: `measureExtent` (exported from FocusRangeLayer), `stopForMatrixChange`/`commitEndpoint` (Task 20), sections → `marks` (ScorePlayer derives start indices via `sectionToRange`).

**jsdom test notes:** `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture` are not implemented — stub them: `beforeAll(() => { Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); });`. Fire `pointerdown`/`pointermove`/`pointerup` with `fireEvent` and explicit `clientX/clientY/pointerId`.

- [ ] **Step 1: Failing tests** (`RangeHandleLayer.test.jsx`) — reuse Task 20's two-system fixture:

```jsx
import { render, fireEvent } from '@testing-library/react';
import RangeHandleLayer from './RangeHandleLayer.jsx';

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const stepBoxes = [
  { x: 100, top: 100, bottom: 160 }, { x: 200, top: 100, bottom: 160 },
  { x: 300, top: 100, bottom: 160 }, { x: 400, top: 100, bottom: 160 },
];
const measures = [
  { index: 0, firstStep: 0, lastStep: 1 }, { index: 1, firstStep: 2, lastStep: 3 },
];

it('renders both handles at the range extents', () => {
  const { container } = render(<RangeHandleLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 0, outMeasure: 1 }} onArm={vi.fn()} onCommit={vi.fn()} />);
  expect(container.querySelector('.piano-score-range-handle--in')).not.toBeNull();
  expect(container.querySelector('.piano-score-range-handle--out')).not.toBeNull();
});

it('a still tap arms the edge', () => {
  const onArm = vi.fn();
  const { container } = render(<RangeHandleLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 0, outMeasure: 1 }} onArm={onArm} onCommit={vi.fn()} />);
  const h = container.querySelector('.piano-score-range-handle--in');
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 100, clientY: 130 });
  fireEvent.pointerUp(h, { pointerId: 1, clientX: 102, clientY: 131 });
  expect(onArm).toHaveBeenCalledWith('in');
});

it('a drag previews and commits the nearest measure', () => {
  const onCommit = vi.fn(); const onPreview = vi.fn();
  const { container } = render(<RangeHandleLayer measures={measures} stepBoxes={stepBoxes} range={{ inMeasure: 0, outMeasure: 1 }} onArm={vi.fn()} onCommit={onCommit} onPreview={onPreview} />);
  const h = container.querySelector('.piano-score-range-handle--out');
  fireEvent.pointerDown(h, { pointerId: 1, clientX: 400, clientY: 130 });
  fireEvent.pointerMove(h, { pointerId: 1, clientX: 110, clientY: 130 });
  fireEvent.pointerUp(h, { pointerId: 1, clientX: 110, clientY: 130 });
  expect(onPreview).toHaveBeenCalledWith('out', 0);
  expect(onCommit).toHaveBeenCalledWith('out', 0, 'drag');
});

it('no range renders nothing', () => {
  const { container } = render(<RangeHandleLayer measures={measures} stepBoxes={stepBoxes} range={null} onArm={vi.fn()} onCommit={vi.fn()} />);
  expect(container.firstChild).toBeNull();
});
```

**Coordinate note:** the layer positions handles in the renderer's offset space (like every layer), but pointer events arrive in client space. Inside the component, resolve pointer → local via the layer root's `getBoundingClientRect()` (in jsdom that's all zeros, so client coords ≡ local coords — the fixture exploits that; on device it's correct because the root spans the renderer).

- [ ] **Step 2: Run — expect FAIL**, then implement. Skeleton:

```jsx
// RangeHandleLayer.jsx
import React, { useRef, useCallback } from 'react';
import { measureExtent } from './FocusRangeLayer.jsx'; // exported in Step 3 of this task

const TAP_SLOP_PX = 8;
const EDGE_ZONE_PX = 48;
const EDGE_STEP_PX = 12;

export default function RangeHandleLayer({ measures = [], stepBoxes = [], range = null, onArm, onCommit, onPreview, scrollRef }) {
  const rootRef = useRef(null);
  const dragRef = useRef(null); // { edge, startX, startY, moved, lastMeasure }

  const localPoint = useCallback((e) => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }, []);

  const measureUnder = useCallback((pt) => {
    // Same-system nearest column; a pointer between systems falls to the
    // nearest system so a drag never dead-zones (design §F).
    let bestI = -1; let bestD = Infinity;
    for (let i = 0; i < stepBoxes.length; i++) {
      const b = stepBoxes[i];
      const inBand = pt.y >= b.top - 40 && pt.y <= b.bottom + 40;
      const d = Math.abs(pt.x - b.x) + (inBand ? 0 : Math.abs(pt.y - (b.top + b.bottom) / 2) * 2);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0) return -1;
    const m = measures.findIndex((mm) => bestI >= mm.firstStep && bestI <= mm.lastStep);
    return m;
  }, [stepBoxes, measures]);

  const onDown = (edge) => (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { edge, startX: e.clientX, startY: e.clientY, moved: false, lastMeasure: null };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > TAP_SLOP_PX) d.moved = true;
    if (!d.moved) return;
    const mi = measureUnder(localPoint(e));
    if (mi >= 0 && mi !== d.lastMeasure) { d.lastMeasure = mi; onPreview?.(d.edge, mi); }
    const el = scrollRef?.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + EDGE_ZONE_PX) el.scrollTop -= EDGE_STEP_PX;
      else if (e.clientY > r.bottom - EDGE_ZONE_PX) el.scrollTop += EDGE_STEP_PX;
    }
  };
  const onUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) { onArm?.(d.edge); return; }
    const mi = measureUnder(localPoint(e));
    if (mi >= 0) onCommit?.(d.edge, mi, 'drag');
  };

  if (!range) return null;
  const inExt = measures[range.inMeasure] && measureExtent(measures[range.inMeasure], stepBoxes);
  const outExt = measures[range.outMeasure] && measureExtent(measures[range.outMeasure], stepBoxes);
  if (!inExt || !outExt) return null;
  const handle = (edge, ext) => (
    <div
      className={`piano-score-range-handle piano-score-range-handle--${edge}`}
      role="slider"
      aria-label={edge === 'in' ? 'Loop start handle' : 'Loop end handle'}
      aria-valuenow={(edge === 'in' ? range.inMeasure : range.outMeasure) + 1}
      style={edge === 'in'
        ? { left: ext.left - 24, top: ext.top - 12, height: ext.bottom - ext.top + 24 }
        : { left: ext.right - 24, top: ext.top - 12, height: ext.bottom - ext.top + 24 }}
      onPointerDown={onDown(edge)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => { dragRef.current = null; }}
    />
  );
  return (
    <div ref={rootRef} className="piano-score-range-handles">
      {handle('in', inExt)}
      {handle('out', outExt)}
    </div>
  );
}
```

(Fix the import to `import { measureExtent } from './FocusRangeLayer.jsx';` — Step 3 exports it. The handle divs are the ONLY pointer-interactive overlay: `.piano-score-range-handles { position:absolute; inset:0; pointer-events:none; } .piano-score-range-handle { position:absolute; width:48px; min-height:48px; pointer-events:auto; touch-action:none; z-index:8; }` plus a visible grip bar via `::after`. A pointerdown on a handle must not fall through to `onScoreClick` — the layer sits INSIDE the scroll container but handles call `e.stopPropagation()` on pointerdown+click; add that.)

- [ ] **Step 3: FocusRangeLayer slim-down (failing tests first).** Export `measureExtent`; delete the bracket divs and the `pending` branch; add `marks` ticks:

```jsx
      {marks.map((m) => {
        const ext = measures[m] && measureExtent(measures[m], stepBoxes);
        return ext ? <div key={`mark-${m}`} className="piano-score-section-mark" style={{ left: ext.left - 2, top: ext.top, height: ext.bottom - ext.top }} /> : null;
      })}
```

Update `FocusRangeLayer.test.jsx`: bracket/pending assertions become their absence; add a marks test. SCSS: `.piano-score-section-mark { position:absolute; width:2px; z-index:4; background: #f0d270; opacity:.8; pointer-events:none; }`; delete `.piano-score-range-bracket` rules.

- [ ] **Step 4: Mount in ScorePlayer.** Inside the renderer, after FocusRangeLayer:

```jsx
          {mode === 'learn' && layoutFresh && focus && (
            <RangeHandleLayer
              measures={layout.measures}
              stepBoxes={stepBoxes}
              range={{ inMeasure: focus.inMeasure, outMeasure: focus.outMeasure }}
              onArm={onArm}
              onCommit={commitEndpoint}
              scrollRef={scrollRef}
            />
          )}
```

FocusRangeLayer gets `marks={arming || draggingRef.current ? sectionMarks : []}` where `sectionMarks = useMemo(() => sections.map((s) => sectionToRange(s, layout.measures || [])?.inMeasure).filter((m) => m != null), [sections, layout.measures])` (dragging flag: have `onPreview` set a `draggingEdge` state; clear on commit). `showFocusLayer` becomes Learn-only (`mode === 'learn'` — Polish lost the loop in Task 9; verify no Polish test still expects brackets). ScorePlayer tests: handles render only in Learn with a focus; commit via handle updates the focus (drive `onCommit` through pointer events on the rendered handle, fixture stepBoxes come from the layout fixture).

- [ ] **Step 5: Run the SheetMusic suite — expect PASS**

- [ ] **Step 6: Commit** — `git commit -m "feat(piano): range handles — tap-to-arm + drag with measure snap; section snap markers (wave-3 F)"`

---

### Task 22: polishTiers (pure) + gradeMeasure `rest` flag

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/polishTiers.js` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreEvaluator.js` (+`rest` on the grade result)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/scoreEvaluator.test.js`

**Interfaces:**
- Produces:
  - `gradeMeasure` result gains `rest: boolean` (`expected.length === 0`) — additive; distinguishes a genuinely-perfect measure from an empty one (both have `combined === 1`).
  - `TIERS = ['slow', 'medium', 'full', 'overclocked']`
  - `tierOf(tempoMult) → tier` — `full` when `|tempoMult - 1| <= 1e-6`; `slow` `< 0.8`; `medium` `< 1`; else `overclocked`.
  - `runScore(grades) → number|null` — `round(100 × mean(combined))` over grades where `!rest`; `null` when no non-rest measure was graded.
  - `displayScore(base, tier) → number` — `tier === 'overclocked' ? Math.round(base * 1.25) : base` (input `base` is the 0-100 run score; overclocked can exceed 100 — that's the point).
- Consumes: nothing (pure).

- [ ] **Step 1: Failing tests**

```js
// polishTiers.test.js
import { tierOf, runScore, displayScore } from './polishTiers.js';

describe('tierOf', () => {
  it('buckets by tempoMult at run start', () => {
    expect(tierOf(0.7)).toBe('slow');
    expect(tierOf(0.8)).toBe('medium');
    expect(tierOf(0.9)).toBe('medium');
    expect(tierOf(1)).toBe('full');
    expect(tierOf(1 + 5e-7)).toBe('full');   // ±1e-6 tolerance
    expect(tierOf(1.1)).toBe('overclocked');
  });
});

describe('runScore', () => {
  it('means combined over non-rest measures only', () => {
    const grades = {
      0: { combined: 1, rest: true },     // rest bar — excluded
      1: { combined: 0.8, rest: false },
      2: { combined: 0.6, rest: false },
    };
    expect(runScore(grades)).toBe(70);
  });
  it('null when nothing gradeable', () => {
    expect(runScore({})).toBe(null);
    expect(runScore({ 0: { combined: 1, rest: true } })).toBe(null);
  });
});

describe('displayScore', () => {
  it('overclocked earns the 1.25 multiplier and may exceed 100', () => {
    expect(displayScore(90, 'overclocked')).toBe(113);
    expect(displayScore(90, 'full')).toBe(90);
  });
});
```

And in `scoreEvaluator.test.js`: `gradeMeasure({ expected: [], hits: [] }, {}).rest === true`; `gradeMeasure({ expected: [60], hits: [] }, {}).rest === false`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** (`rest: expected.length === 0` added to gradeMeasure's return; polishTiers as specced):

```js
// polishTiers.js — Polish tempo-tier math (wave-3 H). Pure.
export const TIERS = ['slow', 'medium', 'full', 'overclocked'];

/** Tier bucket for a run, decided by tempoMult AT RUN START. */
export function tierOf(tempoMult) {
  const t = Number(tempoMult);
  if (!Number.isFinite(t)) return 'full';
  if (Math.abs(t - 1) <= 1e-6) return 'full';
  if (t < 0.8) return 'slow';
  if (t < 1) return 'medium';
  return 'overclocked';
}

/** round(100 × mean(combined)) over measures that expected notes; null if none. */
export function runScore(grades) {
  const vals = Object.values(grades || {}).filter((g) => g && !g.rest && Number.isFinite(g.combined));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, g) => a + g.combined, 0) / vals.length) * 100);
}

/** Overclocked extra credit: stored/displayed = round(base × 1.25); can exceed 100. */
export function displayScore(base, tier) {
  if (base == null) return null;
  return tier === 'overclocked' ? Math.round(base * 1.25) : base;
}

export default { TIERS, tierOf, runScore, displayScore };
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): polish tier math + rest flag on measure grades (wave-3 H)"`

---

### Task 23: Polish wiring — tiers, voiding, summary extension, bar readout

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/RunSummary.jsx` (+test)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (readout prefix)
- Modify: `ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx`

**Interfaces:**
- Produces (ScorePlayer):
  - `runTierRef` — `tierOf(tempoMult)` captured when a run STARTS (both start paths: `toggleRun` play branch AND `countIn.onGo`); `runMixedRef` — set true if `onTempo` fires while `runActive` (a mid-run tempo change voids tier persistence; live grades keep flowing).
  - Completion path only (`onDone`, mode polish): after `openRunSummary`, if `!runMixedRef.current` and `runScore != null` → `recordTierBest({ bucket: bucketOf(grandStaff, activeParts), tier: runTierRef.current, score: displayScore(runScore, tier) })`. Silent-stop and manual pause show the summary but never write bests (not a completed run).
  - Bar prop `scoreLabel` (string|null): in Polish with ≥1 non-rest grade, `\`${displayScore(runScore(grades), tierOf(tempoMult))}%\`` — the shell renders `{scoreLabel} · m 12/24` in the existing position span. **Perf note:** `scoreLabel` changes only when `grades` changes (per measure, not per step) and it feeds the SHELL's readout, not a memoized child — the memo discipline holds.
- Produces (RunSummary): new props `runScore` (number|null), `tier` (string|null), `tierBests` (`{slow,medium,full,overclocked}` for the CURRENT hands bucket, values number|null), `mixedTempo` (bool), `bucket` (string, for the caption). Renders a score headline (`87 · full speed` form), a "mixed tempo" caption instead of a tier when voided, and a four-cell tier-best strip (em-dash for null). Existing grades strip/counts/actions unchanged.
- Consumes: `polishTiers` (Task 22), `usePracticeRecord` (`record.polish`, `recordTierBest` — Task 12), `bucketOf`.

**Behavior spec:**
1. A completed whole-piece Polish run at `tempoMult 0.9` writes `polish.<bucket>.medium = score` (only if better) and the summary shows this run + all four bests.
2. An RH-only run writes `polish.rh.*`, never `polish.both.*`; the summary strip shows the `rh` bucket's bests.
3. Mid-run tempo change → summary shows "mixed tempo", NO best written.
4. Silent-stop / manual pause → summary shows, NO best written.
5. Bar center readout in Polish reads `82% · m 12/24` once a measure has been graded; before any grade it shows the plain position.
6. Overclocked completed run at 1.25× with mean 0.9 stores 113.

- [ ] **Step 1: RunSummary failing tests** (extend `RunSummary.test.jsx`):

```jsx
  it('shows the run score with tier and the four tier bests', () => {
    render(<RunSummary open grades={GRADES} measures={MEASURES} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={87} tier="medium" bucket="rh" mixedTempo={false}
      tierBests={{ slow: 78, medium: 84, full: null, overclocked: null }} />);
    expect(screen.getByText(/87/)).toBeInTheDocument();
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(2);   // full + overclocked unset
  });

  it('a voided run is labelled mixed tempo', () => {
    render(<RunSummary open grades={GRADES} measures={MEASURES} onClose={vi.fn()} onReplay={vi.fn()}
      runScore={64} tier="medium" mixedTempo tierBests={{}} bucket="both" />);
    expect(screen.getByText(/mixed tempo/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run — expect FAIL**, implement the RunSummary extension (a `.piano-score-run-score` headline row above the existing overall label + a `.piano-score-run-tiers` strip of four labelled cells; keep all existing DOM).

- [ ] **Step 3: ScorePlayer + bar (failing tests per the behavior spec, then implement).**
  - Run-start capture: in BOTH start paths — `runTierRef.current = tierOf(tempoMult); runMixedRef.current = false;`
  - `onTempo`: `if (runActiveRef.current) runMixedRef.current = true;` (add `runActiveRef` mirror).
  - onDone polish branch: after `openRunSummaryRef.current?.(...)`:
    ```js
    const base = runScore(gradesWithFinal);       // fold finalize()'s fresh grades like openRunSummary does
    if (!runMixedRef.current && base != null) {
      recordTierBest({ bucket: bucketOf(grandStaff, activeParts), tier: runTierRef.current, score: displayScore(base, runTierRef.current) });
    }
    ```
    (Compute `gradesWithFinal` once and share it with `openRunSummary` — refactor `openRunSummary(extra)` to return the folded map so the completion path reuses it, keeping the log and the best from drifting.)
  - Summary props: `runScore={displayScore(runScore(foldedGrades), runTierRef.current)}`, `tier={runTierRef.current}`, `mixedTempo={runMixedRef.current}`, `bucket`, `tierBests={practice?.polish?.[bucket] || {}}` — hold the folded map in state (`summaryGrades`) set when the summary opens, so the panel and the log agree.
  - Bar: `scoreLabel` prop + shell render `position = scoreLabel ? \`${scoreLabel} · ${positionCore}\` : positionCore`; test in `ScoreTransportBar.test.jsx`.
- [ ] **Step 4: Run the SheetMusic suite — expect PASS**

- [ ] **Step 5: Commit** — `git commit -m "feat(piano): polish tempo tiers — run score, voiding, tier bests in the summary and bar (wave-3 H)"`

---

### Task 24: Perform cleanup — zero chrome

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (Perform renders null)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (drop `perfPage`)
- Modify: `ScoreTransportBar.test.jsx`, `ScorePlayer.test.jsx`

**Interfaces:**
- Produces: in Perform the bar component returns `null` (zero chrome — no page indicator). Props `page`/`pages` deleted from the bar; `perfPage` state, `computePerfPage`, and its scroll/resize listeners deleted from ScorePlayer. **Pedal paging (`pageBy`, the CC subscription) and tap-to-scroll stay** — they are the interaction model; only the readout dies.
- Consumes: nothing new.

- [ ] **Step 1: Failing tests.** Bar: `render(<ScoreTransportBar {...base} mode="perform" />)` → `container.firstChild === null` (replace the existing page-indicator assertion). ScorePlayer: the Perform test asserting `1 / 2` page text now asserts NO `.piano-score-transportbar` content in Perform; the pedal-paging test (rising-edge CC → scroll) must still pass untouched.

- [ ] **Step 2: Run — expect FAIL**, implement: bar top-level `if (mode === 'perform') return null;`; delete `page`/`pages` props + the indicator span + `hasPosition` special-casing; ScorePlayer deletes `perfPage`/`computePerfPage` (:147, :728-737) and slims the Perform effect (:854-878) to the pedal subscription only.

- [ ] **Step 3: Run — expect PASS.** Commit — `git commit -m "feat(piano): Perform is zero-chrome — page indicator removed (wave-3 I)"`

**On-device follow-up (needs the physical piano — folded into Task 25's checklist):** verify left-pedal paging end-to-end (`sheetmusic.perform.backPedalCC`, default 66 = left/soft pedal, pages BACK by config — the design says the left pedal TURNS pages, so if the piano only has usable left-pedal CC, set `advancePedalCC: 66` in `piano.yml → sheetmusic.perform` instead of code changes; diagnose with the existing `pedalEdge` subscription by watching `score.perform.pageturn` in the session logs).

---

### Task 25: Integration — docs, config, merge main, deploy, on-device verify

**Files:**
- Modify: `docs/reference/piano/sheet-music-player.md` (endstate description of wave-3 behavior; module table)
- Modify: `data/household/config/piano.yml` (prod data volume — via `sudo docker exec`, ONLY if setting a non-default `sheetmusic.learn.defaultHands`; defaults need no config)
- No code files.

- [ ] **Step 1: Full test sweep in the worktree**

```bash
node_modules/.bin/vitest run frontend/src/modules/Piano frontend/src/modules/MusicNotation backend/src/4_api/v1/routers/piano.preset.test.mjs backend/src/4_api/v1/routers/piano.practice.test.mjs
```

Expect: all green. Then the harness view: `npm run test:isolated -- --only=frontend --pattern=Piano` (catches collocated files the explicit list missed).

- [ ] **Step 2: Update the reference doc.** `docs/reference/piano/sheet-music-player.md`: mode identities table (§0), hands model, Learn matrix + landing, practice record (YAML shape + endpoints), loop group/handles, Polish tiers, Perform zero-chrome. Present-tense endstate, no class names. Update the module table (line ~322) for created/deleted files. `git rev-parse HEAD > docs/docs-last-updated.txt`.

- [ ] **Step 3: Merge latest main FIRST (user instruction: pull from main before push and deploy).**

```bash
git -C /opt/Code/DaylightStation fetch origin main   # main checkout owns the remote
git merge origin/main                                 # in the worktree, onto worktree-sheetmusic-wave3
# resolve conflicts, re-run the Step 1 sweep after any merge
```

Then integrate per the branch policy (merge into main, delete the branch, record it in `docs/_archive/deleted-branches.md`) — follow `superpowers:finishing-a-development-branch` at execution time. Push only after the post-merge sweep is green.

- [ ] **Step 4: Deploy (kckern-server rules).** Check the deploy gates FIRST as their own step (they must HALT, never chain):

```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

Clear ⇒ `./scripts/build-daylight.sh`, then `sudo docker stop daylight-station && sudo docker rm daylight-station`, then `sudo deploy-daylight`. Verify `/build.txt` matches the pushed SHA.

- [ ] **Step 5: Reload the piano tablet** (FKB at `10.0.0.245:2323` — see memory `reference_fkb_piano_tablet_probe`; `loadStartURL` + `clearCache` via the Node/URLSearchParams pattern, never shell-interpolated curl).

- [ ] **Step 6: On-device verification checklist (piano tablet + physical piano):**
  - Learn landing: open a practiced score → auto-range at the frontier, loop ON, Play locked; play through → cursor advances, wrong note = shake + red ink at the played pitch, third wrong reveals keys dimly.
  - Handles: drag the out-handle across a system wrap on the JANK-PRONE tablet — no scroll hijack (pointer capture on handle only), snap on release, auto-scroll near the edge.
  - Armed taps: LoopGroup set-in → banner → tap a measure → 1-measure range, loop off.
  - Listen: hands toggles mute/dim staves live; keyboard hidden; metronome present (single-tempo score) off by default.
  - Polish: whole-piece run → summary with tier + bests; check `users/<id>/apps/piano/practice/<scoreKey>.yml` in the container.
  - Perform: zero chrome; left pedal pages (adjust `piano.yml` CCs if the piano's pedal emits a different controller — Task 24 note).
  - Watch session logs for `score.learn.auto-range`, `score.loop.set`, `score.learn.cycle`, `piano.practice.save` (verify via logs, never speculate).

- [ ] **Step 7: Final commit + docs marker; clean up the worktree branch per the branch policy.**

---

## Deliberate contract deletions (review guard)

Retired WITH their features — do not flag as regressions: `HandsControl` mypart tests; `LoopControl.test.jsx`; `transport/LoopSheet.test.jsx`; the bar's loop-prop tests (rewritten for LoopGroup); telemetry `score.listen.mypart`, `score.listen.part`, `score.loop.toggle` (→ `score.loop.on`), `score.focus.select-start/-timeout`, `score.focus.arm` (→ `score.loop.arm`/`score.loop.set`); scoreSettings `myStaves`; `playParts.cyclePart`; `deriveResumeSeconds`; the two-tap `selecting` machinery; FocusRangeLayer brackets + `pending`; the Perform page indicator; `ScoreTransportBar` props `handsVariant`/`roles`/`page`/`pages`/`scopeLabel`/`sections`/`onPickSection`/`onStartSelect`/`onNudge`.

## Execution order & dependencies

Tasks 1-4 are independent (§J batch — any order). 5 → 8, 18. 6 → 7 → 8, 9. 9 → 10, 13, 14, 20, 23. 11 → 12 → 13, 14, 23. 16, 17 → 18. 19 → 20 → 21. 22 → 23. 24, 25 last. Within that partial order, prefer the numbered sequence — it keeps ScorePlayer merges linear (Tasks 7, 9, 13, 14, 15, 18, 20, 21, 23, 24 all touch it; never run two of those concurrently).

## Open risks (from the design, sharpened by recon)

- OSMD per-staff geometry: `StaffLines[j]` is confirmed surface (typings), but only `MusicPages[0]` — multi-page scores keep today's single-page behavior (pre-existing limit, not a regression).
- Wet-ink spelling is the fiddliest new math — `spellMidi` is fully specced/tested, but budget an on-device fix round for glyph placement (Task 25 checklist).
- Handle drag on the jank-prone tablet: pointer-capture-on-handle-only is specced; the REAL test is Task 25's on-device pass.
- Pedal verification needs the physical instrument; config-first diagnosis path documented in Task 24.





