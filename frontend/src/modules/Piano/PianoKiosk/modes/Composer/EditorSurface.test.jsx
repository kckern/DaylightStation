import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';

// Capture the MIDI callback so tests can play real notes into the editor, and
// spy on the OUTBOUND send API the transport drives (playback goes out through
// these three; nothing else in the editor sends MIDI).
let midiHandler = null;
// Task 6: the RAW MIDI subscriber (full-fidelity bytes incl. note-off/sustain),
// captured so a test can push a wrapped { data } event straight at the recorder tap.
let rawHandler = null;
const midiOut = { sendNoteAt: vi.fn(), sendNoteOffAt: vi.fn(), sendPanic: vi.fn() };
vi.mock('../../PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({
    subscribe: (fn) => { midiHandler = fn; return () => { midiHandler = null; }; },
    subscribeRaw: (fn) => { rawHandler = fn; return () => { rawHandler = null; }; },
    ...midiOut,
  }),
}));
// Records every DISTINCT musicXml the renderer is handed — i.e. one entry per
// OSMD engrave. The whole point of the two-plane split is that this list does
// NOT grow per keypress.
const engraves = [];
// Fed back through onLayout so tests can place the overlays against a known
// staff geometry, the way a real OSMD extract would.
let layoutToPublish = null;
vi.mock('../../../../MusicNotation/renderers/MusicXmlRenderer.jsx', () => ({
  MusicXmlRenderer: ({ musicXml, onLayout, scale, manuscript, children }) => {
    if (engraves[engraves.length - 1] !== musicXml) engraves.push(musicXml);
    useEffect(() => { if (layoutToPublish) onLayout?.(layoutToPublish); }, [musicXml, onLayout]);
    // `data-scale` is the OSMD zoom the editor asked for. Surfaced because the
    // caret's scale-dependent terms MUST be driven by the same number.
    return (
      <div data-testid="renderer" data-xml-len={String(musicXml || '').length} data-scale={String(scale)} data-manuscript={String(!!manuscript)}>
        {children}
      </div>
    );
  },
}));
import {
  EditorSurface, caretStepIndex, wetInkAnchor, serializeForDisplay,
  padDisplayMeasures, withDisplayRests, DISPLAY_MIN_BARS, DEFAULT_ZOOM,
} from './EditorSurface.jsx';
import { CARET_GAP, CARET_WIDTH, MEASURE_START_UNITS } from './CaretLayer.jsx';
import { WET_ADVANCE_UNITS, WET_RX_UNITS } from './PendingLayer.jsx';
import { makeEmptyScore, makeNote } from './model/index.js';
import { __resetRecorder, __snapshotForTest, KIND } from '../../../../../lib/logging/inputRecorder.js';

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

// ---------------------------------------------------------------------------
// Task 6 — raw MIDI capture. Independent of the editor's PARSED `subscribe`
// (which only carries note-ons for score entry), a subscribeRaw tap mirrors the
// full-fidelity byte stream — note-off, sustain, CC — into the recorder ring,
// reusing SheetMusic's pure midiToRecord classifier. Always on; shipping is
// gated elsewhere.
// ---------------------------------------------------------------------------
describe('EditorSurface — raw MIDI recorder capture', () => {
  it('records a MIDI_ON from the wrapped subscribeRaw event ({ data })', () => {
    rawHandler = null;
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(rawHandler).toBeTypeOf('function'); // the effect subscribed to raw MIDI
    __resetRecorder();
    // emitRaw wraps bytes as { data, time }; the tap reads evt.data, not the bytes.
    act(() => { rawHandler({ data: [0x90, 72, 88], time: 0 }); });
    const hit = __snapshotForTest().records.some((r) => r.kind === KIND.MIDI_ON && r.a === 72 && r.b === 88);
    expect(hit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 7 — toolbar tap capture. Every toolbar handler records a UI_INTENT into
// the recorder ring (and, on the next frame, an input→paint TAP), so touch
// latency on the kiosk is measurable the way MIDI/gesture input already is.
// ---------------------------------------------------------------------------
describe('EditorSurface — toolbar tap telemetry', () => {
  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = null; });

  it('records a UI_INTENT when a toolbar control is tapped (Undo)', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    // Play a note so Undo is enabled, then clear the ring so only the tap shows.
    playNotes(1);
    __resetRecorder();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /undo/i })); });
    expect(__snapshotForTest().records.some((r) => r.kind === KIND.UI_INTENT)).toBe(true);
  });

  it('records a UI_INTENT when the help toggle is tapped', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    __resetRecorder();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /how to write music/i })); });
    expect(__snapshotForTest().records.some((r) => r.kind === KIND.UI_INTENT)).toBe(true);
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

  it('gives an untouched draft full-measure rests so it engraves as a real staff', () => {
    const xml = serializeForDisplay({ score: makeEmptyScore() });
    // Every displayed bar is padded AND rested — a blank draft engraves as ruled
    // manuscript paper, not one lonely bar (see the DISPLAY_MIN_BARS block below).
    expect(measuresIn(xml)).toBe(DISPLAY_MIN_BARS);
    expect(restsIn(xml)).toBe(DISPLAY_MIN_BARS);
  });

  it('fills the empty trailing bar that a bar-filling note opens, rather than emitting it bare', () => {
    const score = makeEmptyScore();
    score.parts[0].measures = [
      { number: 1, notes: [makeNote({ step: 'C', octave: 4 })] },
      { number: 2, notes: [] }, // what ensureMeasure leaves behind
    ];
    const xml = serializeForDisplay({ score });
    // The new bar IS drawn (wet ink needs the room) and it is not empty, so OSMD
    // can engrave it. Padding then takes the sheet out to the 4-bar minimum.
    expect(measuresIn(xml)).toBe(DISPLAY_MIN_BARS);
    expect(restsIn(xml)).toBe(DISPLAY_MIN_BARS - 1); // bar 1 has the note
  });

  it('emits no rest in a bar that has notes', () => {
    const score = makeEmptyScore();
    score.parts[0].measures = [{ number: 1, notes: [makeNote({ step: 'C', octave: 4 })] }];
    const xml = serializeForDisplay({ score });
    // Only the PADDED bars carry rests; the written bar is untouched.
    expect(restsIn(xml)).toBe(DISPLAY_MIN_BARS - 1);
  });
});

// ---------------------------------------------------------------------------
// MANUSCRIPT PAPER (Task 10). A fresh draft used to show a single bar fragment
// floating on a big empty card: maximum dead space, minimum invitation. Real
// manuscript paper shows ruled systems waiting to be filled, so the DISPLAY copy
// is padded out with bars the model does not have. Padding is render-only — the
// autosave path serializes editorState directly and must never see it.
// ---------------------------------------------------------------------------
describe('serializeForDisplay — manuscript-paper padding', () => {
  const measuresIn = (xml) => xml.split('<measure').length - 1;
  const filled = (n) => {
    const score = makeEmptyScore();
    score.parts[0].measures = Array.from({ length: n }, (_, i) => ({ number: i + 1, notes: [makeNote({ step: 'C', octave: 4 })] }));
    return score;
  };

  it('pads a blank score out to the 4-bar minimum', () => {
    expect(measuresIn(serializeForDisplay({ score: makeEmptyScore() }))).toBe(4);
  });

  it('keeps one empty runway bar past the last filled bar once the score is long', () => {
    expect(measuresIn(serializeForDisplay({ score: filled(6) }))).toBe(7);
  });

  it('holds the minimum when the score is still short', () => {
    expect(measuresIn(serializeForDisplay({ score: filled(2) }))).toBe(4);
  });

  it('takes the minimum from config so a bigger sheet is a config change, not a code change', () => {
    expect(measuresIn(serializeForDisplay({ score: makeEmptyScore() }, 8))).toBe(8);
    // The runway rule still wins when it asks for more than the minimum.
    expect(measuresIn(serializeForDisplay({ score: filled(9) }, 8))).toBe(10);
  });

  // Padding the XML is only half of it: OSMD's reading defaults collapse a run
  // of rest bars into ONE bar with a count over it, and stop the system where
  // the content stops — so the padded sheet engraves as a fragment plus a
  // mystery numeral unless the editor opts into the writing-surface rules.
  // Observed in headless Chromium 2026-07-18 before the prop existed.
  it('asks the renderer for manuscript-paper engraving, not reading engraving', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.getByTestId('renderer').getAttribute('data-manuscript')).toBe('true');
  });

  it('never mutates the model score it was handed', () => {
    const score = makeEmptyScore();
    serializeForDisplay({ score });
    expect(score.parts[0].measures).toHaveLength(1);
  });

  // The caret indexes the MODEL, and the renderer's buildSteps excludes rests
  // (osmdRender.js, `n.isRest()`), so padded bars contribute no engraved steps
  // and cannot shift the caret. Proven rather than assumed: caretStepIndex is
  // the function that would drift, and it reads the same on both scores.
  it('leaves caret step math identical — padded bars hold only rests, which are not steps', () => {
    const score = filled(2);
    const caret = { measureIdx: 1, noteIdx: 1 };
    const before = caretStepIndex(score, caret);
    // Pad THEN rest — the order the display pipeline uses, so the bars padding
    // adds are themselves rested rather than emitted bare.
    const padded = withDisplayRests(padDisplayMeasures(score, 4));
    expect(padded.parts[0].measures).toHaveLength(4);
    // Every bar the padding added carries a rest and nothing else.
    for (const m of padded.parts[0].measures.slice(2)) {
      expect(m.notes.every((n) => n.rest)).toBe(true);
    }
    expect(caretStepIndex(padded, caret)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Padding is a RENDER concern and must never be persisted: a kid who writes two
// bars must get two bars back, not four bars with two of them full of rests that
// the next session's runway rule then pads AGAIN. Proven through the real
// autosave path rather than by reading serializeForDisplay's call sites.
// ---------------------------------------------------------------------------
describe('EditorSurface — display padding never reaches the saved MusicXML', () => {
  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = null; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  const measuresIn = (xml) => xml.split('<measure').length - 1;

  it('saves only the bars the model actually holds', async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, revision: 2 });
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={save} config={{}} />);

    // One note → one filled bar in the MODEL. The DISPLAY copy is 4 bars.
    playNotes(1);
    const displayed = engraves[engraves.length - 1];
    expect(measuresIn(displayed)).toBe(DISPLAY_MIN_BARS);

    await act(async () => { vi.advanceTimersByTime(4000); }); // past the autosave idle
    expect(save).toHaveBeenCalled();
    const savedXml = save.mock.calls[0][1].musicxml;
    expect(measuresIn(savedXml)).toBe(1);   // the model's single bar, nothing else
    expect(savedXml).not.toContain('<rest'); // and no display rest rode along
  });
});

// ---------------------------------------------------------------------------
// ZOOM (Task 11). The staff used to render at OSMD zoom 1 inside a 60rem slab —
// on the 8" kiosk tablet, a tiny staff in the corner of a big blank card. The
// correctness risk in zooming is the CARET: OSMD's layout output (staves[].
// lineSpacing, steps[].x/width) is already in ZOOMED screen pixels, but
// CaretLayer's CARET_GAP / CARET_WIDTH are unscaled constants it multiplies by
// its own `scale` prop. So `scale` MUST be the OSMD zoom — one value feeding
// both, or the caret drifts from the notes by (zoom - 1) * CARET_GAP.
// ---------------------------------------------------------------------------
describe('EditorSurface — engrave zoom', () => {
  const LS = 14; // what lineSpacing measures at zoom 1.4 (10px/unit x zoom)
  const staff = { system: 0, top: 100, left: 20, right: 900, lineSpacing: LS };
  const caretLeft = (c) => Number(/translate3d\(([-\d.]+)px/.exec(c.querySelector('.composer-caret').style.transform)[1]);
  const headCentres = (c) => [...c.querySelectorAll('.composer-wet-note__head')].map((e) => Number(e.getAttribute('cx')));

  beforeEach(() => { engraves.length = 0; midiHandler = null; layoutToPublish = { steps: [], staves: [staff] }; vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('engraves at the 1.4 default rather than 1', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.getByTestId('renderer').getAttribute('data-scale')).toBe(String(DEFAULT_ZOOM));
    expect(DEFAULT_ZOOM).toBe(1.4);
  });

  it('takes the zoom from config when set', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 0.9 }} />);
    expect(screen.getByTestId('renderer').getAttribute('data-scale')).toBe('0.9');
  });

  it('scales the caret by the SAME zoom it engraves at', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(2);
    const heads = headCentres(container);
    const lastRightEdge = heads[1] + LS * WET_RX_UNITS;
    // The gap is a fixed-pixel constant, so at zoom 1.4 it must measure 1.4x. A
    // caret still running on a hardcoded scale of 1 would sit CARET_GAP away.
    expect(caretLeft(container) - lastRightEdge).toBeCloseTo(CARET_GAP * DEFAULT_ZOOM);
  });

  it('sizes the caret band by the same zoom', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ wetink_idle_ms: 600 }} />);
    playNotes(1);
    // staveCaretMetrics: max(40 * zoom, lineSpacing * 4) — both are 56 at 1.4,
    // which is the point: the floor tracks the zoom instead of stranding at 40.
    expect(container.querySelector('.composer-caret').style.height).toBe('56px');
  });
});

// ---------------------------------------------------------------------------
// The caretOverride seam. wetInkAnchor is tested standalone and CaretLayer only
// proves it honours SOME override — the coordinate conversion between them
// lives here, and getting it wrong makes the caret jump sideways on every
// settle rather than being wrong once.
//
// These pin `zoom: 1` deliberately: what they assert is the coordinate
// CONVERSION between the wet anchor (a notehead CENTRE) and the caret (a LEFT
// edge), in unscaled pixels. Zoom is proven separately, above.
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
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1, wetink_idle_ms: 600 }} />);
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
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1, wetink_idle_ms: 600 }} />);
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
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1, wetink_idle_ms: 600 }} />);
    playNotes(3);
    expect(caretLeft(container) + CARET_WIDTH).toBeLessThanOrEqual(150);
  });

  // The landing screen. Before this, `steps` was empty on a fresh draft and the
  // caret simply did not render — no insertion point on the one screen every
  // session opens with.
  it('shows a caret at the measure entry point on an untouched draft', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1 }} />);
    expect(container.querySelector('.composer-caret')).toBeTruthy();
    expect(caretLeft(container)).toBe(staff.left + LS * MEASURE_START_UNITS);
  });

  it('hands the caret back to the engraved layout once the ink dries', () => {
    layoutToPublish = { steps: [{ measure: 0, notes: [{ x: 300, top: 100, bottom: 140, width: 12 }] }], staves: [staff] };
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1, wetink_idle_ms: 600 }} />);
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
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{ zoom: 1, wetink_idle_ms: 600 }} />);
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

// ---------------------------------------------------------------------------
// TRANSPORT. Before this, the Composer had no way to HEAR what you wrote — the
// only transport-looking control was the arm toggle, which is now "Write". The
// button below is the mode's actual playback control.
// ---------------------------------------------------------------------------
describe('EditorSurface — playback transport', () => {
  const playBtn = () => screen.getByRole('button', { name: /^(play|pause) your song$/i });
  beforeEach(() => {
    engraves.length = 0; midiHandler = null; layoutToPublish = null;
    midiOut.sendNoteAt.mockClear(); midiOut.sendNoteOffAt.mockClear(); midiOut.sendPanic.mockClear();
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  /** A one-bar score of four quarters at 100bpm: C4 D4 E4 F4, 600ms apart. */
  function fourQuarters() {
    const s = makeEmptyScore({ tempo: 100 });
    s.parts[0].measures[0].notes = [
      makeNote({ step: 'C', octave: 4 }), makeNote({ step: 'D', octave: 4 }),
      makeNote({ step: 'E', octave: 4 }), makeNote({ step: 'F', octave: 4 }),
    ];
    return s;
  }

  it('starts disabled on an empty score — there is nothing to play yet', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(playBtn()).toBeDisabled();
    expect(playBtn()).toHaveTextContent('Play');
  });

  it('plays: the button flips to Pause and the notes go out as timestamped sends', () => {
    render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.click(playBtn()); });
    expect(playBtn()).toHaveTextContent('Pause');

    act(() => { vi.advanceTimersByTime(2500); });
    // Sensible pitches, in order, at sensible wall times (100bpm → 600ms apart).
    expect(midiOut.sendNoteAt.mock.calls.map((c) => c[0])).toEqual([60, 62, 64, 65]);
    expect(midiOut.sendNoteAt.mock.calls.map((c) => c[2])).toEqual([0, 600, 1200, 1800]);
    // Every note is released, gated early (540ms into a 600ms quarter).
    expect(midiOut.sendNoteOffAt.mock.calls.map((c) => c[1])).toEqual([540, 1140, 1740, 2340]);
  });

  it('pause stops the sends and panics, so nothing can be left droning', () => {
    render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(700); });
    const sentSoFar = midiOut.sendNoteAt.mock.calls.length;

    act(() => { fireEvent.click(playBtn()); });
    expect(playBtn()).toHaveTextContent('Play');
    // Already-dispatched sends can't be recalled, so the panic is the ONLY thing
    // that stops a note whose note_off was scheduled past the pause.
    expect(midiOut.sendPanic).toHaveBeenCalled();
    // …and a second panic clears the lookahead tail once that window elapses.
    midiOut.sendPanic.mockClear();
    act(() => { vi.advanceTimersByTime(600); });
    expect(midiOut.sendPanic).toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(midiOut.sendNoteAt.mock.calls.length).toBe(sentSoFar); // paused means paused
  });

  it('NumpadEnter toggles playback (the spec\'s transport key)', () => {
    render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.keyDown(window, { code: 'NumpadEnter' }); });
    expect(playBtn()).toHaveTextContent('Pause');
    act(() => { fireEvent.keyDown(window, { code: 'NumpadEnter' }); });
    expect(playBtn()).toHaveTextContent('Play');
  });

  it('plays from the CARET measure, not always from the top', () => {
    const s = fourQuarters();
    s.parts[0].measures.push({ number: 2, notes: [makeNote({ step: 'G', octave: 4 })] });
    render(<EditorSurface initialScore={s} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.keyDown(window, { code: 'PageDown' }); }); // caret → bar 2
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(1000); });
    // Only bar 2's note, and re-zeroed to t=0 — not offset by bar 1's 2400ms.
    expect(midiOut.sendNoteAt.mock.calls.map((c) => c[0])).toEqual([67]);
    expect(midiOut.sendNoteAt.mock.calls[0][2]).toBe(0);
  });

  it('DOES NOT record playback back into the score when Write is armed (MIDI echo guard)', () => {
    render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.keyDown(window, { code: 'Numpad4' }); }); // arm Write
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(300); });

    // Simulate the Jamcorder echoing our own output straight back to the input.
    act(() => { midiHandler({ type: 'note_on', note: 60, velocity: 80 }); });
    act(() => { midiHandler({ type: 'note_on', note: 62, velocity: 80 }); });

    // The engraved XML is the observable proxy for the model: if the echo had
    // been recorded, the score would have grown by two notes.
    const xmlDuringPlayback = screen.getByTestId('renderer').getAttribute('data-xml-len');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('renderer').getAttribute('data-xml-len')).toBe(xmlDuringPlayback);

    // Write is still armed — stop playback and a real key writes again.
    act(() => { fireEvent.click(playBtn()); });
    act(() => { midiHandler({ type: 'note_on', note: 71, velocity: 80 }); });
    act(() => { vi.advanceTimersByTime(1200); }); // let the wet ink settle + re-engrave
    expect(Number(screen.getByTestId('renderer').getAttribute('data-xml-len')))
      .toBeGreaterThan(Number(xmlDuringPlayback));
  });

  it('unmounting mid-playback silences — a kid leaving the mode must not leave a drone', () => {
    const { unmount } = render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(700); });
    midiOut.sendPanic.mockClear();
    const sentAtUnmount = midiOut.sendNoteAt.mock.calls.length;

    act(() => { unmount(); });
    expect(midiOut.sendPanic).toHaveBeenCalled();
    // The delayed panic is DESIRED after unmount: it clears note-ons already
    // handed to the MIDI service for a time in the lookahead window.
    midiOut.sendPanic.mockClear();
    act(() => { vi.advanceTimersByTime(600); });
    expect(midiOut.sendPanic).toHaveBeenCalled();
    expect(midiOut.sendNoteAt.mock.calls.length).toBe(sentAtUnmount); // the timer is dead
  });

  it('reaching the end resets to Play so the button can start it again', () => {
    render(<EditorSurface initialScore={fourQuarters()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(playBtn()).toHaveTextContent('Play');
    expect(midiOut.sendPanic).toHaveBeenCalled(); // the gated tail is flushed

    midiOut.sendNoteAt.mockClear();
    act(() => { fireEvent.click(playBtn()); });
    act(() => { vi.advanceTimersByTime(2500); });
    expect(midiOut.sendNoteAt.mock.calls.map((c) => c[0])).toEqual([60, 62, 64, 65]); // from the top again
  });
});

// ---------------------------------------------------------------------------
// Toolbar chrome (Task 11B). The mode used to stack FOUR chrome strips on an 8"
// tablet — browser bar, kiosk breadcrumb, editor toolbar, and a full-width
// bottom bar holding exactly two buttons. The bottom bar is gone; its two
// controls live here, where the rest of the editor's chrome already is.
// TEXT labels, not glyphs — Unicode renders as tofu on the kiosk browser.
// ---------------------------------------------------------------------------
describe('EditorSurface — toolbar nav + help', () => {
  it('offers "Songs" in the toolbar and calls back when tapped', () => {
    const onSongs = vi.fn();
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} onSongs={onSongs} config={{}} />);
    const btn = screen.getByRole('button', { name: /your songs/i });
    expect(container.querySelector('.composer-toolbar')).toContainElement(btn);
    fireEvent.click(btn);
    expect(onSongs).toHaveBeenCalled();
  });

  it('omits "Songs" entirely when the host gives it nowhere to go', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    expect(screen.queryByRole('button', { name: /your songs/i })).not.toBeInTheDocument();
  });

  it('toggles the help panel from the toolbar', () => {
    render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    const help = screen.getByRole('button', { name: /how to write music/i });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.composer-help')).toBeNull();
    fireEvent.click(help);
    expect(document.querySelector('.composer-help')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /how to write music/i }));
    expect(document.querySelector('.composer-help')).toBeNull();
  });

  it('labels its nav buttons with words, not Unicode glyphs (tofu on the kiosk)', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} onSongs={vi.fn()} config={{}} />);
    const text = container.querySelector('.composer-toolbar').textContent;
    for (const glyph of ['☰', 'ⓘ', '＋']) expect(text).not.toContain(glyph);
    expect(text).toContain('Songs');
  });
});

// ---------------------------------------------------------------------------
// Task 12 — one SVG icon language across the toolbar. Every glyph the toolbar
// used to typeset (`↶` `↷` for history, and the bare-word transport/nav) is now
// a drawing, because Unicode symbols paint as tofu boxes in the kiosk WebView.
// ---------------------------------------------------------------------------
describe('EditorSurface — toolbar icons', () => {
  const mount = (props = {}) => render(
    <EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} onSongs={vi.fn()} config={{}} {...props} />
  );

  it('draws undo and redo instead of typesetting arrow characters', () => {
    const { container } = mount();
    const hist = container.querySelector('.composer-toolbar__history');
    expect(hist.querySelectorAll('svg').length).toBe(2);
    // The characters themselves are the regression: they rendered as empty
    // rectangles on the device, so undo/redo were two blank buttons.
    expect(hist.textContent).not.toMatch(/[↶↷]/);
    expect(hist.textContent.trim()).toBe('');
  });

  it('gives every toolbar button an accessible name even though its icon is hidden', () => {
    const { container } = mount();
    for (const btn of container.querySelectorAll('.composer-toolbar button')) {
      const name = btn.getAttribute('aria-label') || btn.textContent.trim();
      expect(name, `a toolbar button rendered with no name: ${btn.className}`).not.toBe('');
    }
    // The icons must stay out of the accessibility tree; the button names them.
    for (const svg of container.querySelectorAll('.composer-toolbar svg')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('pairs the transport icon with its word, and swaps the icon on state', () => {
    // Needs a score with notes, or the transport is disabled and never flips.
    const score = makeEmptyScore({ tempo: 100 });
    score.parts[0].measures[0].notes = [makeNote({ step: 'C', octave: 4 })];
    const { container } = render(<EditorSurface initialScore={score} songId="x" initialRevision={1} save={vi.fn()} config={{}} />);
    const btn = container.querySelector('.composer-toolbar__play');
    // The WORD stays: an icon-only transport is a guess for a kid who has not
    // met the convention yet, and this is the mode's primary action.
    expect(btn.textContent).toContain('Play');
    const paused = btn.querySelector('svg').innerHTML;
    act(() => { fireEvent.click(btn); });
    expect(container.querySelector('.composer-toolbar__play').textContent).toContain('Pause');
    expect(container.querySelector('.composer-toolbar__play svg').innerHTML).not.toBe(paused);
  });
});

// ---------------------------------------------------------------------------
// Task 14 — naming your song from the editor. An untitled draft showed no name
// anywhere and offered no way to give one, so a kid's song stayed "Untitled" in
// the gallery forever. The title control is the first step of the work having a
// life outside this screen.
// ---------------------------------------------------------------------------
describe('EditorSurface — rename', () => {
  const mount = (props = {}) => render(
    <EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} {...props} />
  );
  const titleBtn = () => screen.getByRole('button', { name: /name your song|rename/i });

  it('invites a name when the song has none', () => {
    mount({ title: '' });
    expect(titleBtn()).toHaveTextContent('Name your song');
  });

  it('shows the song\'s own title once it has one', () => {
    mount({ title: 'Ode to Waffles' });
    expect(screen.getByRole('button', { name: /rename/i })).toHaveTextContent('Ode to Waffles');
  });

  it('sits on the LEFT of the toolbar, where a document title belongs', () => {
    const { container } = mount({ title: 'Waffles' });
    const kids = [...container.querySelector('.composer-toolbar').children];
    const doc = kids.findIndex((n) => n.classList.contains('composer-toolbar__doc'));
    const nav = kids.findIndex((n) => n.classList.contains('composer-toolbar__nav'));
    expect(doc).toBe(0);
    expect(doc).toBeLessThan(nav);
    expect(kids[doc].querySelector('.composer-toolbar__title')).toBeTruthy();
  });

  it('stacks the save status under the title rather than beside the controls', () => {
    // Layout constraint, not decoration: as its own flex item on a full 1280px
    // toolbar, "Saved" appearing was enough to wrap a control onto a second row.
    // Inside the title's column it costs no horizontal space at all.
    const { container } = mount({ title: 'Waffles' });
    const doc = container.querySelector('.composer-toolbar__doc');
    expect(doc.querySelector('.composer-toolbar__status')).toBeTruthy();
    expect(container.querySelector('.composer-toolbar > .composer-toolbar__status')).toBeNull();
  });

  it('swaps to a focused text field on tap, and commits on Enter', () => {
    const onRename = vi.fn();
    mount({ title: '', onRename });
    fireEvent.click(titleBtn());
    const input = screen.getByRole('textbox', { name: /song name/i });
    expect(input).toHaveFocus(); // autoFocus: one tap to tapping, not two
    fireEvent.change(input, { target: { value: 'Waffle Song' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Waffle Song');
    expect(screen.queryByRole('textbox', { name: /song name/i })).not.toBeInTheDocument();
  });

  it('commits on blur too — a kid taps the staff to get back to work, not Enter', () => {
    const onRename = vi.fn();
    mount({ title: '', onRename });
    fireEvent.click(titleBtn());
    const input = screen.getByRole('textbox', { name: /song name/i });
    fireEvent.change(input, { target: { value: 'Blur Song' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith('Blur Song');
  });

  it('abandons the edit on Escape, keeping the previous name', () => {
    const onRename = vi.fn();
    mount({ title: 'Keep Me', onRename });
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    const input = screen.getByRole('textbox', { name: /song name/i });
    fireEvent.change(input, { target: { value: 'Discard Me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /rename/i })).toHaveTextContent('Keep Me');
  });

  it('trims the name, and treats a whitespace-only one as no name at all', () => {
    const onRename = vi.fn();
    mount({ title: '', onRename });
    fireEvent.click(titleBtn());
    fireEvent.change(screen.getByRole('textbox', { name: /song name/i }), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: /song name/i }), { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('');
  });

  // THE TRAP. useComposerInput's window keydown listener preventDefault()s every
  // mapped code, and Backspace is bound to "delete the note before the caret".
  // Without its INPUT/TEXTAREA guard, typing a name would erase the SCORE while
  // the characters refused to erase. Both halves are asserted because they fail
  // independently: the guard could stop the edit but still swallow the key.
  it('typing Backspace in the name field edits TEXT, not the score', () => {
    const { container } = render(<EditorSurface initialScore={makeEmptyScore()} songId="x" initialRevision={1} save={vi.fn()} config={{}} title="" onRename={vi.fn()} />);
    playNotes(3);
    const before = container.querySelector('[data-testid="renderer"]').getAttribute('data-xml-len');

    fireEvent.click(screen.getByRole('button', { name: /name your song|rename/i }));
    const input = screen.getByRole('textbox', { name: /song name/i });
    const ev = new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace', bubbles: true, cancelable: true });
    act(() => { input.dispatchEvent(ev); });

    // The score is untouched...
    expect(container.querySelector('[data-testid="renderer"]').getAttribute('data-xml-len')).toBe(before);
    // ...AND the browser's own text editing was left alone to do its job.
    expect(ev.defaultPrevented).toBe(false);
  });
});
