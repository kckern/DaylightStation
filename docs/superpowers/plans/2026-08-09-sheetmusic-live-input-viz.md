# Sheet Music Live Input Viz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the notes the player is currently holding in the cursor column, at the pitch played — green when that pitch is written at the cursor, ghosted when it isn't — in Listen, Learn and Polish.

**Architecture:** A new `LiveInputLayer` subscribes to the MIDI note store itself and renders one glyph per held note, reusing the existing wet-ink glyph and pitch-spelling machinery. It deliberately does NOT render non-matching notes while Learn's gate is active, because the existing red wrong-note ink already covers that case — that division is what keeps a single glyph per keypress. `ScorePlayer` stops inking `hit` and `neutral` (the live layer supersedes both) and keeps inking `wrong` unchanged.

**Tech Stack:** React 18, OpenSheetMusicDisplay 2.0 (SVG), Web MIDI via an external note store, SCSS, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Run tests from the worktree root** with the main checkout's binary:
  `/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs <paths>`
  `npm run test:isolated` does NOT work from a worktree.
- **`usePianoMidiNotes()` re-renders its caller on every note event, by design.** Its own doc says only components that render live notes may use it; everything else uses `usePianoMidi()`, whose value was deliberately made identity-stable across note traffic (2026-07-06 decoupling audit R1). **`ScorePlayer` must NOT call it** — it is a ~2000-line component and re-rendering it per keypress would undo that audit. Only `LiveInputLayer` calls it.
- **Never commit with failing tests.** If you cannot get green, report BLOCKED with the output.
- **jsdom applies no SCSS and computes no layout.** Never assert colour, opacity or position by rendering — assert the SCSS **source text** (existing pattern: the `.piano-note-hit` check in `ScorePlayer.test.jsx`).
- **Never use raw `console.*`** for diagnostics; use `frontend/src/lib/logging/`.
- **0-based staff ids** in all app code (0 = top = RH).
- **One `<svg>` with N children**, never N positioned elements — the layer redraws on every key event, and one node with N shapes costs a single style/layout pass where N elements cost N.
- **Glyphs are hand-drawn SVG** (`WetNoteGlyph`), never Unicode music characters — those render as tofu in the kiosk browser.
- Modes are the strings `'listen' | 'learn' | 'polish' | 'perform'`. This feature is live in the first three and absent in `perform` (zero chrome by design).

---

### Task 1: `inputKind()` — what a held note should look like

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/inputKind.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/inputKind.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `inputKind(midi: number, writtenMidis: Set<number>, gateActive: boolean) => 'match' | 'ghost' | null`. Task 2 consumes it.

- [ ] **Step 1: Write the failing test**

Create `inputKind.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { inputKind, writtenMidisAtStep } from './inputKind.js';

describe('inputKind', () => {
  const written = new Set([67, 60]);

  it('is a match when the pitch is written at the cursor', () => {
    expect(inputKind(67, written, false)).toBe('match');
  });

  it('is a match regardless of which staff wrote it', () => {
    // 60 is the left hand's note; the player is holding it while practising RH.
    // The layer answers "is this on the page right now?", not "is it your job?".
    expect(inputKind(60, written, false)).toBe('match');
  });

  it('ghosts a pitch that is not written here, when nothing is grading it', () => {
    expect(inputKind(61, written, false)).toBe('ghost');
  });

  it('draws NOTHING for a non-match while the gate is grading', () => {
    // Learn's gate already inks this note red. Returning a kind would put a
    // second glyph in the same column on the same keypress.
    expect(inputKind(61, written, true)).toBe(null);
  });

  it('still matches while the gate is active', () => {
    expect(inputKind(67, written, true)).toBe('match');
  });

  it('ghosts everything when the step writes nothing', () => {
    expect(inputKind(67, new Set(), false)).toBe('ghost');
  });
});

describe('writtenMidisAtStep', () => {
  const step = { notes: [{ midi: 67, staff: 0 }, { midi: 60, staff: 1 }] };

  it('collects every pitch at the step, both staves', () => {
    expect([...writtenMidisAtStep(step)].sort((a, b) => a - b)).toEqual([60, 67]);
  });

  it('is empty for a missing step', () => {
    expect(writtenMidisAtStep(null).size).toBe(0);
    expect(writtenMidisAtStep({}).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/inputKind.test.js
```
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `inputKind.js`:

```javascript
/**
 * inputKind — how a HELD note should be drawn in the cursor column.
 *
 * Deliberately ignores the active hands. The layer answers "is this pitch on the
 * page right now?", not "is this your job right now?" — the only question that
 * still means something in Listen, where the hand toggles pick what the KIOSK
 * performs rather than what the player owes.
 */

/** Every pitch written at a cursor step, both staves. Empty for a missing step. */
export function writtenMidisAtStep(step) {
  const out = new Set();
  for (const n of step?.notes || []) out.add(n.midi);
  return out;
}

/**
 * @param {number} midi - the held pitch
 * @param {Set<number>} writtenMidis - pitches written at the cursor
 * @param {boolean} gateActive - Learn's gate is grading this note
 * @returns {'match'|'ghost'|null} `null` means DRAW NOTHING: while the gate is
 *   grading, a non-match is already inked red by the wrong-note path, and a
 *   second glyph in the same column on the same keypress is exactly the visual
 *   doubling this design exists to avoid.
 */
export function inputKind(midi, writtenMidis, gateActive) {
  if (writtenMidis?.has(midi)) return 'match';
  return gateActive ? null : 'ghost';
}

export default { inputKind, writtenMidisAtStep };
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/inputKind.js \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/inputKind.test.js
git commit -m "feat(piano): decide how a held note reads against the cursor

match when the pitch is written there, ghost when it is not, and nothing at
all while Learn's gate is grading — that case already has red ink, and a
second glyph in the same column is the doubling this design avoids."
```

---

### Task 2: `LiveInputLayer` — draw what is being held

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx`

**Interfaces:**
- Consumes: `inputKind`, `writtenMidisAtStep` (Task 1); `WetNoteGlyph` from `../Composer/wetGlyphs.jsx`; `spellMidi` from `../../../../MusicNotation/model/spellMidi.js`; `usePianoMidiNotes` from `../../PianoMidiContext.jsx`.
- Produces: `<LiveInputLayer step={object|null} cursorX={number} system={number} staffBoxes={Array} clefs={object} keyFifths={number} gateActive={boolean} />`. Task 3 wires it.

- [ ] **Step 1: Write the failing test**

Create `LiveInputLayer.test.jsx`:

```jsx
import { render, cleanup } from '@testing-library/react';
import { vi } from 'vitest';

// The layer subscribes to the live-note store itself, so the test drives that
// store rather than firing synthetic MIDI events.
const h = { active: new Map() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidiNotes: () => ({ activeNotes: h.active, sustainPedal: false, noteHistory: [], isPlaying: h.active.size > 0 }),
}));

const { default: LiveInputLayer } = await import('./LiveInputLayer.jsx');

const STAFF_BOXES = [
  { system: 0, staff: 0, top: 10, left: 40, right: 300, lineSpacing: 10 },
  { system: 0, staff: 1, top: 120, left: 40, right: 300, lineSpacing: 10 },
];
const STEP = { notes: [{ midi: 67, staff: 0 }, { midi: 60, staff: 1 }] };
const hold = (...midis) => { h.active = new Map(midis.map((m) => [m, { velocity: 80, timestamp: 0 }])); };

const renderLayer = (props = {}) => render(
  <LiveInputLayer
    step={STEP} cursorX={120} system={0} staffBoxes={STAFF_BOXES}
    clefs={{ 0: { sign: 'G' }, 1: { sign: 'F' } }} keyFifths={0} gateActive={false}
    {...props}
  />,
);

const marks = (c) => [...c.querySelectorAll('.piano-live-input__note')];
const kinds = (c) => marks(c).map((el) => el.getAttribute('class').replace('piano-live-input__note ', ''));

afterEach(() => { cleanup(); h.active = new Map(); });

describe('LiveInputLayer', () => {
  it('draws a held pitch that is written at the cursor as a match', () => {
    hold(67);
    const { container } = renderLayer();
    expect(kinds(container)).toEqual(['is-match']);
  });

  it('ghosts a held pitch that is not written at the cursor', () => {
    hold(61);
    const { container } = renderLayer();
    expect(kinds(container)).toEqual(['is-ghost']);
  });

  it('draws one mark per held note', () => {
    hold(67, 61);
    const { container } = renderLayer();
    expect(marks(container)).toHaveLength(2);
  });

  it('draws NOTHING for a non-match while the gate grades it', () => {
    // The wrong-note ink owns that case; a second glyph would double it.
    hold(61);
    const { container } = renderLayer({ gateActive: true });
    expect(marks(container)).toHaveLength(0);
  });

  it('still draws the match while the gate is active', () => {
    hold(67, 61);
    const { container } = renderLayer({ gateActive: true });
    expect(kinds(container)).toEqual(['is-match']);
  });

  it('releasing the key removes the mark', () => {
    hold(67);
    const { container, rerender } = renderLayer();
    expect(marks(container)).toHaveLength(1);
    h.active = new Map();
    rerender(
      <LiveInputLayer
        step={STEP} cursorX={120} system={0} staffBoxes={STAFF_BOXES}
        clefs={{ 0: { sign: 'G' }, 1: { sign: 'F' } }} keyFifths={0} gateActive={false}
      />,
    );
    expect(marks(container)).toHaveLength(0);
  });

  it('renders one <svg> holding every mark, not one element per mark', () => {
    hold(67, 61, 72);
    const { container } = renderLayer();
    expect(container.querySelectorAll('svg.piano-live-input')).toHaveLength(1);
    expect(marks(container)).toHaveLength(3);
  });

  it('renders nothing without geometry or without a cursor', () => {
    hold(67);
    expect(marks(renderLayer({ staffBoxes: [] }).container)).toHaveLength(0);
    cleanup();
    expect(marks(renderLayer({ step: null }).container)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx
```
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `LiveInputLayer.jsx`:

```jsx
import { usePianoMidiNotes } from '../../PianoMidiContext.jsx';
import { WetNoteGlyph } from '../Composer/wetGlyphs.jsx';
import { spellMidi } from '../../../../MusicNotation/model/spellMidi.js';
import { inputKind, writtenMidisAtStep } from './inputKind.js';

/**
 * LiveInputLayer — the notes being held RIGHT NOW, drawn in the cursor column at
 * the pitch played, spelled from the SOUNDING key so a transposed score reads
 * correctly. Green when that pitch is written at the cursor, ghosted when it is
 * not. Live in Listen, Learn and Polish; absent in Perform, which has no chrome.
 *
 * It subscribes to the live-note store ITSELF rather than taking held notes as a
 * prop. That is deliberate: `usePianoMidiNotes` re-renders its caller on every
 * note event by design, and the 2026-07-06 decoupling audit (R1) exists to keep
 * that traffic away from everything else. Holding the subscription here confines
 * the per-keypress re-render to this small component instead of ScorePlayer.
 *
 * Everything is ONE <svg> with many children — the same discipline as the wet-ink
 * layer: the layer redraws on every key event, and one node with N shapes costs a
 * single style/layout pass where N positioned elements cost N.
 *
 * Nothing is drawn for a non-match while Learn's gate is grading; that note is
 * already inked red by the wrong-note path (see inputKind).
 *
 * @param {object} p
 * @param {{notes: Array<{midi:number, staff:number}>}|null} p.step - cursor step
 * @param {number} p.cursorX - x of the cursor column, layout pixel space
 * @param {number} p.system - which system the cursor is on
 * @param {Array<{system:number, staff:number, top:number, left:number, right:number, lineSpacing:number}>} p.staffBoxes
 * @param {Object} p.clefs - 0-based staff id → { sign }
 * @param {number} p.keyFifths - SOUNDING key signature, so transposed scores spell right
 * @param {boolean} p.gateActive - Learn's gate is grading this note
 */
export default function LiveInputLayer({
  step = null, cursorX = 0, system = 0, staffBoxes = [], clefs = {}, keyFifths = 0, gateActive = false,
}) {
  const { activeNotes } = usePianoMidiNotes();
  if (!step || !staffBoxes.length || !activeNotes?.size) return null;

  const written = writtenMidisAtStep(step);
  const glyphs = [];
  for (const midi of activeNotes.keys()) {
    const kind = inputKind(midi, written, gateActive);
    if (!kind) continue;
    // Which staff does this pitch belong on? The staff of the nearest WRITTEN
    // pitch, so a left-hand note lands on the left-hand staff. With nothing
    // written here, fall back to the top staff.
    let staff = 0;
    let best = Infinity;
    for (const n of step.notes || []) {
      const d = Math.abs(n.midi - midi);
      if (d < best) { best = d; staff = n.staff; }
    }
    const box = staffBoxes.find((b) => b.system === system && b.staff === staff)
      ?? staffBoxes.find((b) => b.staff === staff);
    if (!box) continue; // geometry not reported (mid re-engrave) — skip, don't guess
    glyphs.push(
      <g key={midi} className={`piano-live-input__note is-${kind}`}>
        <WetNoteGlyph
          x={cursorX}
          staff={box}
          type="quarter"
          clef={clefs[staff] || { sign: staff >= 1 ? 'F' : 'G' }}
          pitch={spellMidi(midi, keyFifths)}
          classPrefix="piano-live-input"
        />
      </g>,
    );
  }
  if (!glyphs.length) return null;

  return <svg className="piano-live-input" aria-hidden="true">{glyphs}</svg>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command as Step 2. Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx
git commit -m "feat(piano): draw the notes being held, in the cursor column

Subscribes to the live-note store itself so the per-keypress re-render stays
in this small component instead of reaching ScorePlayer, which the 2026-07-06
decoupling audit deliberately isolated from note traffic."
```

---

### Task 3: Style the two kinds

**Files:**
- Modify: `frontend/src/Apps/PianoApp.scss` (add after the `.piano-learn-ink` block, which ends around line 2801)
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx`

**Interfaces:**
- Consumes: the `is-match` / `is-ghost` classes emitted in Task 2.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test**

Append to `LiveInputLayer.test.jsx` (add `import { readFileSync } from 'fs';` and `import { fileURLToPath } from 'url';` at the top of the file):

```jsx
describe('LiveInputLayer styling', () => {
  const scss = () => readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');

  it('positions the layer without covering the engraving', () => {
    const block = scss().match(/\.piano-live-input\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(block).toBeTruthy();
    expect(block).toMatch(/pointer-events:\s*none/); // never intercepts a tap on the score
  });

  it('fills a match green and a ghost at reduced strength', () => {
    const s = scss();
    const match = s.match(/\.piano-live-input__note\.is-match\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    const ghost = s.match(/\.piano-live-input__note\.is-ghost\s*\{(?:[^{}]|\{[^{}]*\})*\}/s)?.[0];
    expect(match).toBeTruthy();
    expect(ghost).toBeTruthy();
    expect(match).toContain('#2ec46f');          // the kiosk's affirming green
    expect(ghost).toMatch(/opacity:\s*0?\.3/);   // recessed, not absent
    // A ghost must never be drawn hollow — a hollow head means a half or whole note.
    expect(ghost).not.toMatch(/fill:\s*none/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx -t "styling"
```
Expected: FAIL — none of these rules exist.

- [ ] **Step 3: Write the implementation**

In `frontend/src/Apps/PianoApp.scss`, immediately AFTER the `@media (prefers-reduced-motion: reduce) { .piano-learn-ink__note { … } }` block (around line 2801) and BEFORE the `// Active-note light-up:` comment, insert:

```scss
// Live input (the notes being HELD right now), drawn in the cursor column at the
// pitch played. Sits at the same z as the wet ink so it reads as part of the same
// hand-written trace, and never intercepts a tap meant for the score.
//
// A match takes the kiosk's affirming green; anything else is recessed rather
// than absent, so the player can still see what they actually played. Neither is
// ever drawn hollow — a hollow notehead means a half or whole note.
.piano-live-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  z-index: 5;
  pointer-events: none;
}
.piano-live-input__note {
  &.is-match { color: var(--piano-accent, #2ec46f); }
  &.is-ghost { color: var(--piano-muted, #8a8f98); opacity: 0.3; }
}
```

`color` is the right property, not `fill`: `WetNoteGlyph` paints its shapes with
`currentColor`, which is exactly how the wet-ink layer's own `is-wrong`/`is-hit`
kinds are styled. Follow that pattern rather than reaching for `fill`.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```
Expected: PASS, whole directory.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Apps/PianoApp.scss \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LiveInputLayer.test.jsx
git commit -m "feat(piano): style live input — green match, recessed ghost

Neither kind is drawn hollow; a hollow head states a half or whole note."
```

---

### Task 4: Wire it into all three modes, and retire the ink it supersedes

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx`

**Interfaces:**
- Consumes: `<LiveInputLayer step cursorX system staffBoxes clefs keyFifths gateActive />` (Task 2).
- Produces: nothing for later tasks.

**Context you need before editing.** `ScorePlayer` already computes everything this layer wants:
- `steps[step]` — the cursor step; `events[step]` carries `x`, `top`, `bottom`.
- `layout.staffBoxes`, `inkClefs`, `inkFifths` — already passed to `LearnInkLayer`.
- `learnGate` — `mode === 'learn' && !!focus && loopOn`.
- The system the cursor is on is computed inside `pushInk` from the cursor box's vertical midpoint against `staffBoxes`. You will need the same value at render time.

- [ ] **Step 1: Write the failing test**

Add to `ScorePlayer.test.jsx`, as a new top-level `describe` after the staff-dim block:

```jsx
describe('ScorePlayer — live input viz', () => {
  afterEach(() => { cleanup(); });

  const liveMarks = () => document.querySelectorAll('.piano-live-input__note');

  it('draws held notes in Listen', async () => {
    renderPlayer(); // opens in Listen
    await act(async () => {});
    holdNotes(64); // the first step's written pitch in this fixture
    await act(async () => {});
    expect(liveMarks()).toHaveLength(1);
  });

  it('draws held notes in Polish', async () => {
    renderPlayer();
    await act(async () => {});
    enterPolish();
    await act(async () => {});
    holdNotes(64);
    await act(async () => {});
    expect(liveMarks()).toHaveLength(1);
  });

  it('draws nothing in Perform — that mode has no chrome at all', async () => {
    renderPlayer();
    await act(async () => {});
    enterPerform();
    await act(async () => {});
    holdNotes(64);
    await act(async () => {});
    expect(liveMarks()).toHaveLength(0);
  });
});
```

You must add three helpers for this to work. Put them beside the existing
`play`/`enterLearn` helpers near the top of the file:

- `holdNotes(...midis)` — sets the mocked live-note store's `activeNotes` to those midis and triggers a re-render. The renderer/MIDI mocks already live in this file; extend the MIDI mock so `usePianoMidiNotes` reads from a mutable handle on `h`, exactly as `LiveInputLayer.test.jsx` does. If `PianoMidiContext` is not currently mocked in this file, mock only `usePianoMidiNotes` and leave `usePianoMidi` as it is.
- `enterPolish()` / `enterPerform()` — `enterLearn` is `() => { pickMode('Learn'); clearAutoRange(); }` at `ScorePlayer.test.jsx:270`, so these are `() => pickMode('Polish')` and `() => pickMode('Perform')`. Neither needs `clearAutoRange`, which exists only because entering Learn lands an auto-range.

Read the existing helpers before writing these and follow their shape; do not
invent a different mechanism.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx -t "live input"
```
Expected: FAIL — the layer is not mounted anywhere.

- [ ] **Step 3: Mount the layer**

In `ScorePlayer.jsx`:

1. Import it beside the other layers:
```jsx
import LiveInputLayer from './LiveInputLayer.jsx';
```

2. Derive the cursor's system at render time, next to where `stepBoxes` is computed. Use the same rule `pushInk` uses so the two agree:
```jsx
  // Which system is the cursor on? The cursor box spans the whole grand staff, so
  // its vertical midpoint lands inside one system's band. Same rule pushInk uses —
  // the wet ink and the live input must not disagree about where the cursor is.
  const cursorSystem = useMemo(() => {
    const cur = events?.[step];
    const boxes = layout.staffBoxes || [];
    if (!cur || !boxes.length) return 0;
    const mid = (cur.top + cur.bottom) / 2;
    return boxes.find((b) => mid >= b.top - b.lineSpacing * 3 && mid <= b.top + b.lineSpacing * 7)?.system ?? 0;
  }, [events, step, layout.staffBoxes]);
```

3. Mount it immediately AFTER the `LearnInkLayer` block, so the live marks paint above the wet ink:
```jsx
          {mode !== 'perform' && layoutFresh && (
            <LiveInputLayer
              step={steps?.[step] || null}
              cursorX={events?.[step]?.x ?? 0}
              system={cursorSystem}
              staffBoxes={layout.staffBoxes}
              clefs={inkClefs}
              keyFifths={inkFifths}
              gateActive={learnGate}
            />
          )}
```

- [ ] **Step 4: Retire the ink the live layer supersedes**

The live layer now shows every held note, so the `hit` flash and the machine-rows
`neutral` trace would each be a SECOND glyph for the same keypress. Remove both;
keep `wrong` exactly as it is.

1. In `onFollowHit`, delete the line `pushInk(note, 'hit');` and drop `pushInk` from that callback's dependency array.
2. Delete the whole `machineLearn` neutral-ink `useEffect` (the one whose comment begins "Machine rows of the Learn matrix" and whose body calls `pushInk(evt.note, 'neutral')`), including its `subscribe` subscription.
3. In the `INK_TTL` constant, remove the now-unused `hit` and `neutral` entries, leaving `{ wrong: 900 }`, and update the comment above it so it describes only the wrong-note ink.
4. The `.piano-learn-ink__note` kind rules `&.is-hit` and `&.is-neutral` in `frontend/src/Apps/PianoApp.scss` (around lines 2788-2789) are now dead — nothing emits those classes. Delete both, leaving `&.is-wrong`. Leave the `piano-ink-fade` keyframes and the reduced-motion rule alone; `is-wrong` still uses them.
5. If `machineLearn` becomes unused after step 2, leave the variable in place — it is part of the documented Learn state matrix and other logic may read it. Only remove it if the linter proves it unused.

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
```
Expected: PASS, whole directory. Some existing wet-ink tests assert `hit`/`neutral`
ink behaviour that no longer exists — update those tests to assert the LIVE mark
instead, and say so in your report. Do NOT delete an assertion without replacing
the behaviour it covered.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx \
        frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.test.jsx
git commit -m "feat(piano): live input viz in Listen, Learn and Polish

Retires the hit flash and the machine-rows neutral trace, which the held-note
marks supersede; keeping them would put two glyphs in one column per keypress.
The red wrong-note ink is untouched."
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/reference/piano/sheet-music-player.md`

**Interfaces:** none.

- [ ] **Step 1: Update the mode table and the hands model**

In the Listen row of the modes table, the phrase "there is no 'play along and get
lit up' layer in Listen — that machinery retired with wave 3" is now false. In the
**One hands model** section, replace this sentence:

```markdown
- **Listen** — which hands the kiosk *performs*. An inactive staff is engraved
  but silent, not just dimmed; there is no "play along and get lit up" layer
  in Listen — that machinery retired with wave 3. Both hands on is the
```

with:

```markdown
- **Listen** — which hands the kiosk *performs*. An inactive staff is engraved
  but silent, not just dimmed. Playing along shows what you are holding (see
  "Live input" below), but nothing in Listen gates, advances or grades on it.
  Both hands on is the
```

- [ ] **Step 2: Add the Live input section**

Insert a new section immediately before `## Learn: landing and the state matrix`:

```markdown
## Live input

In Listen, Learn and Polish, the notes you are **currently holding** are drawn in
the cursor column at the pitch you played, spelled from the sounding key so a
transposed score still reads correctly. A pitch that is written at the cursor
takes an affirming green; anything else is recessed rather than hidden, so you
can always see what you actually played. Releasing the key removes the mark.

The rule is the same in all three modes and deliberately ignores which hands are
active: it answers "is this on the page right now?", not "is this your job right
now?" — the only question that still means something in Listen, where the hand
toggles pick what the kiosk performs rather than what you owe.

While Learn's gate is grading, a note that isn't written at the cursor draws
nothing here, because the gate already answers it with the red wrong-note ink.
That division is what keeps one glyph per keypress instead of two.

Perform has no live input, as it has no chrome of any kind.
```

- [ ] **Step 3: Add the Key files rows**

In the Key files table, after the `LearnInkLayer.jsx` row, add:

```markdown
| `LiveInputLayer.jsx` | the notes being held right now, drawn in the cursor column |
| `inputKind.js` | whether a held pitch reads as a match, a ghost, or nothing |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/piano/sheet-music-player.md
git commit -m "docs(piano): document live input across Listen, Learn and Polish"
```

---

### Task 6: Full suite, merge, gated deploy, visual check

**Files:** none modified.

- [ ] **Step 1: Run the whole Piano + MusicNotation suite**

```bash
/opt/Code/DaylightStation/frontend/node_modules/.bin/vitest run --config vitest.config.mjs \
  frontend/src/modules/Piano/ frontend/src/modules/MusicNotation/
```
Baseline before this plan: 281 files / 3204 tests green. Expect that plus the new
tests, zero failures. Do not proceed on red.

- [ ] **Step 2: Merge to main**

```bash
git -C /opt/Code/DaylightStation merge --ff-only sheetmusic-learn-hand-deadlock
git -C /opt/Code/DaylightStation log --oneline -1
```
Expected: a fast-forward. If it is not, STOP — main has moved and the branch needs rebasing.

- [ ] **Step 3: Check the deploy gate — HALT if either signal is active**

Its own step; never chain it to the deploy command.

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Clear means ALL of: render count `0`, no `"videoState":"playing"`, `"sessionActive":false`, `"rosterSize":0`. If a workout is live or a video is playing, WAIT.

- [ ] **Step 4: Build and deploy**

```bash
cd /opt/Code/DaylightStation && ./scripts/build-daylight.sh
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 5: Verify the served assets, not /build.txt**

`/build.txt` stamps the current commit even over cached-stale layers.

```bash
curl -s http://localhost:3111/build.txt
sudo docker exec daylight-station sh -c \
  'grep -o "piano-live-input__note.is-match{[^}]*}" frontend/dist/assets/*.css; \
   grep -c "piano-live-input" frontend/dist/assets/*.js | grep -v ":0$"'
```
Expected: the match rule with its green, and the class present in the JS bundle.

- [ ] **Step 6: Look at it, at the piano**

This needs a real MIDI keyboard; jsdom proves none of it. Open a score and check:
1. **Listen** — hold a written note: a green head appears in the cursor column at that pitch. Hold a wrong one: it appears recessed, not invisible.
2. **Release** — marks disappear cleanly, leaving nothing behind.
3. **Learn with the gate on** — a correct note is green; a wrong one shows the red wrong-note ink and NOT a second grey glyph beside it.
4. **A chord** — several marks at once, each at its own pitch, none overlapping illegibly.
5. **Polish** — marks appear and grading is unaffected.
6. **Perform** — nothing appears.
7. **Transpose** and re-check: marks must spell in the sounding key, sitting on the right lines.

- [ ] **Step 7: Reload the piano kiosk**

The tablet caches its bundle. Note: at the time this plan was written `10.0.0.245`
was unreachable (powered down or off-network) — if it still is, say so rather than
reporting a successful reload.

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.245:2323/?' + qs).then(r=>r.text()).then(console.log);
"
```

---

## Self-Review

**Spec coverage.** Every section of
`docs/superpowers/specs/2026-08-09-sheetmusic-live-input-viz-design.md` maps to a
task: one mark per key and the held lifecycle (Tasks 1-2), the three kinds
(Tasks 1-3), the match rule ignoring active hands (Task 1), the three modes and
Perform's exclusion (Task 4), the one-`<svg>` performance constraint (Task 2),
docs (Task 5).

**Deliberate deviation from the spec, and why.** The spec described `wrong` as a
third kind of this layer, persisting past release via a TTL. This plan instead
leaves the red wrong-note ink entirely alone in its existing layer and has the
live layer draw NOTHING for a non-match while the gate is active. The visible
result is identical — one red glyph, lingering after release — but it avoids
duplicating TTL bookkeeping that already exists and works, and it removes any
chance of a red held mark and a red lingering mark rendering together. The spec's
requirement that a slip stay readable after release is still met, by the existing
ink.

**Also removed, which the spec did not call out:** the `hit` flash and the
machine-rows `neutral` ink. Both would now be a second glyph for the same
keypress, which is precisely the doubling the spec's "one layer" decision exists
to prevent.

**Placeholder scan.** No TBD/TODO. The one step that cannot carry literal code is
Task 4 Step 1's test helpers, which must follow existing helpers in a file this
plan does not reproduce; it names them, says what they must do, and instructs the
implementer to read and mirror the existing shape rather than invent one.

**Type consistency.** `inputKind(midi, writtenMidis, gateActive) => 'match'|'ghost'|null`
and `writtenMidisAtStep(step) => Set<number>` are defined in Task 1 and consumed
under those names in Task 2. `LiveInputLayer`'s props are defined in Task 2 and
passed under those exact names in Task 4. The `is-match` / `is-ghost` classes
emitted in Task 2 are the ones styled in Task 3 and asserted in both.
