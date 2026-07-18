import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';

// Capture the MIDI callback so tests can play real notes into the editor.
let midiHandler = null;
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: (fn) => { midiHandler = fn; return () => { midiHandler = null; }; } }),
}));
// Records every DISTINCT musicXml the renderer is handed — i.e. one entry per
// OSMD engrave. The whole point of the two-plane split is that this list does
// NOT grow per keypress.
const engraves = [];
// Fed back through onLayout so tests can place the overlays against a known
// staff geometry, the way a real OSMD extract would.
let layoutToPublish = null;
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ musicXml, onLayout, children }) => {
    if (engraves[engraves.length - 1] !== musicXml) engraves.push(musicXml);
    useEffect(() => { if (layoutToPublish) onLayout?.(layoutToPublish); }, [musicXml, onLayout]);
    return (<div data-testid="renderer" data-xml-len={String(musicXml || '').length}>{children}</div>);
  },
}));
import { EditorSurface, caretStepIndex, wetInkAnchor, serializeForDisplay } from './EditorSurface.jsx';
import { CARET_GAP, CARET_WIDTH, MEASURE_START_UNITS } from './CaretLayer.jsx';
import { WET_ADVANCE_UNITS, WET_RX_UNITS } from './PendingLayer.jsx';
import { makeEmptyScore, makeNote } from './model/index.js';

/** Arm note entry (numpad 4) and play `n` middle-C note-ons. */
function playNotes(n) {
  act(() => { fireEvent.keyDown(window, { code: 'Numpad4' }); });
  for (let i = 0; i < n; i++) {
    act(() => { midiHandler({ type: 'note_on', note: 60, velocity: 80 }); });
  }
}

describe('EditorSurface', () => {
  it('mounts, renders the score xml, and shows the duration palette', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.getByTestId('renderer')).toBeInTheDocument();
    expect(Number(screen.getByTestId('renderer').getAttribute('data-xml-len'))).toBeGreaterThan(0);
    // Self-documenting palette: the quarter-note button (numpad 5) is present,
    // and it starts active (quarter is the default sticky duration).
    const quarter = screen.getByRole('button', { name: /quarter note \(numpad 5\)/i });
    expect(quarter).toBeInTheDocument();
    expect(quarter).toHaveAttribute('aria-pressed', 'true');
  });

  it('tapping a duration button selects it (touch path mirrors the numpad)', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    const half = screen.getByRole('button', { name: /half note \(numpad 7\)/i });
    fireEvent.click(half);
    expect(half).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /quarter note \(numpad 5\)/i })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('caretStepIndex', () => {
  it('counts a chord (multiple notes, one onset) as a SINGLE engraved step, not one step per note', () => {
    // Measure 0: a 2-note chord (C4 onset + E4 chord-continuation) followed by
    // a melody note (D4). Engraved steps: [chord@onset, melody] = 2 steps.
    // Raw note-array length is 3 — that's the bug this test guards against.
    const chordRoot = makeNote({ step: 'C', octave: 4 });
    const chordTone = makeNote({ step: 'E', octave: 4 }, { chord: true });
    const melody = makeNote({ step: 'D', octave: 4 });
    const score = {
      parts: [{ measures: [{ number: 1, notes: [chordRoot, chordTone, melody] }] }],
    };
    // Caret positioned AFTER all three model entries (noteIdx: 3).
    const caret = { measureIdx: 0, noteIdx: 3 };

    // 2 onset steps precede the caret (the chord counts once, then the melody
    // note) — NOT 3 (raw note count).
    expect(caretStepIndex(score, caret)).toBe(2);
  });

  it('sums onset-only counts across measures before the caret', () => {
    const chordRoot = makeNote({ step: 'C', octave: 4 });
    const chordTone = makeNote({ step: 'G', octave: 4 }, { chord: true });
    const melody = makeNote({ step: 'D', octave: 4 });
    const score = {
      parts: [{
        measures: [
          { number: 1, notes: [chordRoot, chordTone] }, // 1 onset step
          { number: 2, notes: [melody] },
        ],
      }],
    };
    const caret = { measureIdx: 1, noteIdx: 1 };
    expect(caretStepIndex(score, caret)).toBe(2); // 1 (measure 0 chord) + 1 (melody)
  });

  it('excludes rests from the onset count — the renderer never engraves a step for a rest', () => {
    // Measure: [note, REST, note]. The renderer's buildSteps skips rests
    // (n.isRest()), so only the two real notes get engraved steps. Caret
    // positioned after the 2nd (real) note — i.e. past all three model
    // entries — must count 2 onset steps (note + note), NOT 3 (which would
    // happen if the rest were counted as an onset).
    const first = makeNote({ step: 'C', octave: 4 });
    const rest = { rest: true, type: 'quarter' };
    const second = makeNote({ step: 'D', octave: 4 });
    const score = {
      parts: [{ measures: [{ number: 1, notes: [first, rest, second] }] }],
    };
    const caret = { measureIdx: 0, noteIdx: 3 };
    expect(caretStepIndex(score, caret)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Two-plane render (spec §2.1): the settled engrave must NOT rebuild per keypress.
// ---------------------------------------------------------------------------
describe('EditorSurface — settled engrave vs wet ink', () => {
  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = null; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('does not re-engrave while notes are being entered, then engraves once on idle', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    expect(engraves).toHaveLength(1); // the initial blank staff

    playNotes(3); // three notes into bar 0 — none of them fills it
    expect(engraves).toHaveLength(1); // ← the defect this task fixes: still ONE engrave

    act(() => { vi.advanceTimersByTime(600); });
    expect(engraves).toHaveLength(2); // one engrave for the whole burst
  });

  it('engraves at the bar boundary during unbroken entry, with no idle gap at all', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(4); // the 4th quarter fills 4/4 → new measure → structural settle
    expect(engraves).toHaveLength(2); // settled without any timer advancing
  });
});

describe('wetInkAnchor', () => {
  const staves = [
    { system: 0, top: 100, left: 20, right: 520, lineSpacing: 10 },
    { system: 1, top: 300, left: 20, right: 520, lineSpacing: 10 },
  ];
  const step = (measure, x, top) => ({ measure, notes: [{ x, top, width: 12, bottom: top + 40 }] });

  it('anchors one wet advance past the last engraved note of the caret bar', () => {
    const steps = [step(0, 100, 100), step(0, 160, 100)];
    // centre (160 + 6) + 2.4 spaces (24px)
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 0 })).toEqual({ x: 190, system: 0 });
  });

  it('picks the system the anchor note actually sits on', () => {
    const steps = [step(0, 100, 100), step(1, 160, 305)];
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1 }).system).toBe(1);
  });

  it('resolves a ledger-line note above the staff to that staff, not the one above it', () => {
    // y=285 is above system 1's top (300) but far below system 0's band.
    const steps = [step(0, 100, 100), step(1, 160, 285)];
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1 }).system).toBe(1);
  });

  it('falls back to the head of the first system when nothing is engraved (blank draft)', () => {
    expect(wetInkAnchor({ steps: [], staves, caretMeasureIdx: 0 })).toEqual({ x: 100, system: 0 });
  });

  it('returns null when there is no staff geometry yet', () => {
    expect(wetInkAnchor({ steps: [], staves: [], caretMeasureIdx: 0 })).toBeNull();
  });

  // A bar the previous settle just opened has no engraving of its own, so the
  // anchor comes off the PREVIOUS bar's last note plus a barline's room.
  it('anchors off the previous bar when the caret bar is empty', () => {
    const steps = [step(0, 160, 100)];
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1 })).toEqual({ x: 200, system: 0 });
  });

  // CROWDING GUARD: the previous bar ran to the end of its system, so OSMD put
  // the new bar on the next one. Following it is what stops several wet notes
  // being clamped into the right margin as an unreadable pile.
  it('follows the wrap to the next system when the previous bar ended flush right', () => {
    const steps = [step(0, 500, 100)];
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1 })).toEqual({ x: 100, system: 1 });
  });

  // Tier 1 clamp: the bar is already engraved on THIS system, so wrapping is
  // not an option and the anchor simply stays in bounds.
  it('never anchors past the end of the system (tier 1)', () => {
    const tight = [staves[0]];
    const steps = [step(0, 510, 100)];
    const a = wetInkAnchor({ steps, staves: tight, caretMeasureIdx: 0 });
    expect(a.x).toBeLessThanOrEqual(520);
    expect(a.system).toBe(0);
  });

  // Tier 2 clamp: out of room AND no next system to wrap onto. Distinct code
  // path from the tier 1 clamp above, and the one the browser run never reached.
  it('clamps inside the last system when tier 2 has nowhere to wrap to', () => {
    const tight = [staves[0]];
    const a = wetInkAnchor({ steps: [step(0, 500, 100)], staves: tight, caretMeasureIdx: 1 });
    expect(a.system).toBe(0);
    expect(a.x).toBeLessThanOrEqual(520 - 10 * 0.62); // notehead right edge at the system end
  });

  // The wrap decision must consider the WHOLE pending run. A bar of sixteenths
  // leaves 8+ notes wet; judging by note 0 alone lets the tail clamp onto the
  // margin in a pile — the exact defect this anchor exists to avoid.
  it('wraps on where the LAST pending note lands, not the first', () => {
    const steps = [step(0, 300, 100)];
    // One note fits comfortably on system 0 …
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1, pendingCount: 1 }).system).toBe(0);
    // … but a run of nine would run off the end, so the whole run moves.
    expect(wetInkAnchor({ steps, staves, caretMeasureIdx: 1, pendingCount: 9 })).toEqual({ x: 100, system: 1 });
  });
});

// ---------------------------------------------------------------------------
// Empty measures in the DISPLAY copy. OSMD throws on a note-less measure, and
// MusicXmlRenderer responds by refusing to render its children — staff AND
// overlays blank out. insertNote's exact-fill branch opens exactly such a bar,
// and it is the state a 'structural' settle engraves, so this is on the hot path.
// ---------------------------------------------------------------------------
describe('serializeForDisplay — no note-less measure ever reaches OSMD', () => {
  const measuresIn = (xml) => xml.split('<measure').length - 1;
  const restsIn = (xml) => xml.split('<rest').length - 1;

  it('gives an untouched draft a full-measure rest so it engraves as a real staff', () => {
    const xml = serializeForDisplay({ score: makeEmptyScore() });
    expect(measuresIn(xml)).toBe(1);
    expect(restsIn(xml)).toBe(1);
  });

  it('fills the empty trailing bar that a bar-filling note opens, rather than emitting it bare', () => {
    const score = makeEmptyScore();
    score.parts[0].measures = [
      { number: 1, notes: [makeNote({ step: 'C', octave: 4 })] },
      { number: 2, notes: [] }, // what ensureMeasure leaves behind
    ];
    const xml = serializeForDisplay({ score });
    expect(measuresIn(xml)).toBe(2); // the new bar IS drawn — wet ink needs the room
    expect(restsIn(xml)).toBe(1);    // and it is not empty, so OSMD can engrave it
  });

  it('leaves a fully-populated score untouched', () => {
    const score = makeEmptyScore();
    score.parts[0].measures = [{ number: 1, notes: [makeNote({ step: 'C', octave: 4 })] }];
    expect(restsIn(serializeForDisplay({ score }))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The caretOverride seam. wetInkAnchor is tested standalone and CaretLayer only
// proves it honours SOME override — the coordinate conversion between them
// lives here, and getting it wrong makes the caret jump sideways on every
// settle rather than being wrong once.
// ---------------------------------------------------------------------------
describe('EditorSurface — wet caret position', () => {
  const LS = 10;
  const staff = { system: 0, top: 100, left: 20, right: 900, lineSpacing: LS };
  const caretLeft = (c) => Number(/translate3d\(([-\d.]+)px/.exec(c.querySelector('.composer-caret').style.transform)[1]);
  const caretBand = (c) => {
    const el = c.querySelector('.composer-caret');
    return { top: Number(/translate3d\([-\d.]+px,\s*([-\d.]+)px/.exec(el.style.transform)[1]), height: el.style.height };
  };
  const headCentres = (c) => [...c.querySelectorAll('.composer-wet-note__head')].map((e) => Number(e.getAttribute('cx')));

  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = { steps: [], staves: [staff] }; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('clears the LAST wet notehead by exactly the gap the engraved caret uses', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(2);
    const heads = headCentres(container);
    expect(heads).toHaveLength(2);

    // anchor.x is a notehead CENTRE; the caret is positioned by its LEFT EDGE.
    // The invariant that keeps settle from jolting: caret-left minus the last
    // notehead's RIGHT edge is the same CARET_GAP the engraved path applies.
    const lastRightEdge = heads[1] + LS * WET_RX_UNITS;
    expect(caretLeft(container) - lastRightEdge).toBeCloseTo(CARET_GAP);
  });

  it('does not sit a whole advance past the last note (the pre-fix off-by-one)', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(2);
    const heads = headCentres(container);
    // The bug put the caret at anchor.x + n*advance — a full advance past the
    // last notehead's CENTRE — so it snapped ~12px left when ink dried.
    expect(caretLeft(container)).toBeLessThan(heads[1] + LS * WET_ADVANCE_UNITS);
  });

  it('keeps the caret WHOLLY inside the system when it has to clamp', () => {
    // A staff with almost no room: the caret's right edge, not its left, is what
    // must stay in bounds.
    layoutToPublish = { steps: [], staves: [{ ...staff, right: 150 }] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(3);
    expect(caretLeft(container) + CARET_WIDTH).toBeLessThanOrEqual(150);
  });

  // The landing screen. Before this, `steps` was empty on a fresh draft and the
  // caret simply did not render — no insertion point on the one screen every
  // session opens with.
  it('shows a caret at the measure entry point on an untouched draft', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(container.querySelector('.composer-caret')).toBeTruthy();
    expect(caretLeft(container)).toBe(staff.left + LS * MEASURE_START_UNITS);
  });

  it('hands the caret back to the engraved layout once the ink dries', () => {
    layoutToPublish = { steps: [{ measure: 0, notes: [{ x: 300, top: 100, bottom: 140, width: 12 }] }], staves: [staff] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(1);
    act(() => { vi.advanceTimersByTime(600); });
    expect(container.querySelectorAll('.composer-wet-note__head')).toHaveLength(0);
    // Engraved past-the-end position: note right edge (300 + 12) + CARET_GAP.
    expect(caretLeft(container)).toBe(300 + 12 + CARET_GAP);
  });

  // THE regression this unification is about. The caret is the most-watched
  // element on the screen, and when ink dried it used to jump DIAGONALLY: the
  // horizontal shift (expected, documented on caretOverride) was compounded by a
  // vertical one, because the engraved tier read the NOTE's box while the wet
  // tier read the STAVE. A middle C engraves BELOW a treble staff, so the two
  // disagreed by a ledger line's worth on every settle.
  it('keeps the caret in the SAME vertical band across a settle', () => {
    layoutToPublish = { steps: [{ measure: 0, notes: [{ x: 300, top: 116, bottom: 156, width: 12 }] }], staves: [staff] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(1);
    const wet = caretBand(container);
    act(() => { vi.advanceTimersByTime(600); });
    expect(container.querySelectorAll('.composer-wet-note__head')).toHaveLength(0); // genuinely engraved now
    expect(caretBand(container)).toEqual(wet);
    expect(wet).toEqual({ top: staff.top, height: '40px' }); // the stave's band, not the note's 116
  });
});

// ---------------------------------------------------------------------------
// The empty-state invitation. The blank staff is the design, but landing on one
// with no copy and an arm toggle that defaults OFF means a kid who sits down and
// plays sees nothing happen at all.
// ---------------------------------------------------------------------------
describe('EditorSurface — empty-state hint', () => {
  const hint = (c) => c.querySelector('.composer-page__hint');
  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = null; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('invites the kid to play on an untouched draft', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(hint(container)).toBeTruthy();
    // Names both things the kid controls: the duration palette and the arm toggle.
    expect(hint(container).textContent).toMatch(/note length/i);
    expect(hint(container).textContent).toMatch(/play/i);
  });

  it('names the arm toggle by the label that button ACTUALLY carries today', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    // Guards the copy/label coupling: if DurationPalette's unarmed label is
    // renamed (a later task renames it to "Write"), this fails and the hint
    // string must be updated with it.
    const armLabel = container.querySelector('.composer-palette__arm').textContent.trim();
    expect(armLabel).toBe('Write');
    expect(hint(container).textContent).toContain(armLabel);
  });

  it('disappears the instant the first note lands, while that note is still WET', () => {
    layoutToPublish = { steps: [], staves: [{ system: 0, top: 100, left: 20, right: 900, lineSpacing: 10 }] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    expect(hint(container)).toBeTruthy();
    playNotes(1);
    // No timers advanced: the note has NOT settled or been engraved yet.
    expect(container.querySelectorAll('.composer-wet-note__head')).toHaveLength(1);
    expect(hint(container)).toBeNull();
  });

  it('stays gone once the ink dries', () => {
    layoutToPublish = { steps: [], staves: [{ system: 0, top: 100, left: 20, right: 900, lineSpacing: 10 }] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(1);
    act(() => { vi.advanceTimersByTime(600); });
    expect(hint(container)).toBeNull();
  });

  it('is absent when opening a song that already has notes', () => {
    const score = makeEmptyScore();
    score.parts[0].measures = [{ number: 1, notes: [makeNote({ step: 'C', octave: 4 })] }];
    const { container } = render(<EditorSurface initialScore={score} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(hint(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Palette WIRING. DurationPalette.test.jsx proves the button calls its prop;
// this proves EditorSurface hands it the hook's real deleteBack — the seam that
// was simply missing (the hook returned it, nothing consumed it), so a touch
// user could write notes and never remove one.
// ---------------------------------------------------------------------------
describe('EditorSurface — delete button wiring', () => {
  const hint = (c) => c.querySelector('.composer-page__hint');
  const del = () => screen.getByRole('button', { name: /delete the last note/i });
  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = null; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('removes the note just played (the wet note goes, the invitation comes back)', () => {
    layoutToPublish = { steps: [], staves: [{ system: 0, top: 100, left: 20, right: 900, lineSpacing: 10 }] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(1);
    expect(container.querySelectorAll('.composer-wet-note__head')).toHaveLength(1);
    act(() => { fireEvent.click(del()); });
    expect(container.querySelectorAll('.composer-wet-note__head')).toHaveLength(0);
    expect(hint(container)).toBeTruthy();
  });

  it('is a harmless no-op on an empty score — a kid will tap it first, before writing anything', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.click(del()); });
    act(() => { fireEvent.click(del()); });
    expect(hint(container)).toBeTruthy();
    expect(screen.getByTestId('renderer')).toBeInTheDocument();
  });
});
