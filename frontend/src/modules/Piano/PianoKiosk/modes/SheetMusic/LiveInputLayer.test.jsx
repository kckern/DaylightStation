import { render, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

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
// x/top/bottom/width are the engraved notehead's own box (osmdRender.js's
// buildSteps) — Fix 1 registers a match mark on THIS geometry, not cursorX.
// A match now RECOLOURS the engraved notehead, so each written note needs the
// element the engraver produced. x/top/bottom/width remain for the ghost path.
const mkEl = () => document.createElement('div');
let RH_EL; let LH_EL; let STEP;
const buildStep = () => {
  RH_EL = mkEl(); LH_EL = mkEl();
  STEP = {
    notes: [
      { midi: 67, staff: 0, x: 210, top: 30, bottom: 42, width: 12, el: RH_EL },
      { midi: 60, staff: 1, x: 180, top: 140, bottom: 152, width: 12, el: LH_EL },
    ],
  };
};
buildStep();
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

afterEach(() => { cleanup(); h.active = new Map(); buildStep(); });

describe('LiveInputLayer', () => {
  it('turns the PRINTED note green when you hold a pitch written at the cursor', () => {
    // No mark is drawn for a match — the engraved notehead itself is recoloured,
    // so the affirmation can never sit beside the note it is affirming.
    hold(67);
    const { container } = renderLayer();
    expect(RH_EL.classList.contains('piano-note-match')).toBe(true);
    expect(LH_EL.classList.contains('piano-note-match')).toBe(false);
    expect(marks(container)).toHaveLength(0);
  });

  it('ghosts a held pitch that is not written at the cursor', () => {
    hold(61);
    const { container } = renderLayer();
    expect(kinds(container)).toEqual(['is-ghost']);
  });

  it('recolours the match and draws the ghost, one of each', () => {
    hold(67, 61);
    const { container } = renderLayer();
    expect(RH_EL.classList.contains('piano-note-match')).toBe(true);
    expect(kinds(container)).toEqual(['is-ghost']);
  });

  it('draws NOTHING for a non-match while the gate grades it', () => {
    // The wrong-note ink owns that case; a second glyph would double it.
    hold(61);
    const { container } = renderLayer({ gateActive: true });
    expect(marks(container)).toHaveLength(0);
  });

  it('still marks the match while the gate is active', () => {
    // Both hands active, matching the un-gated default — 67 is written for RH
    // and RH is active, so it still reads as a match; 61 is written nowhere and
    // draws nothing at all under the gate.
    hold(67, 61);
    const { container } = renderLayer({ gateActive: true, activeParts: { 0: true, 1: true } });
    expect(RH_EL.classList.contains('piano-note-match')).toBe(true);
    expect(marks(container)).toHaveLength(0);
  });

  it('releasing the key puts the printed note back', () => {
    hold(67);
    renderLayer();
    expect(RH_EL.classList.contains('piano-note-match')).toBe(true);
    h.active = new Map();
    cleanup();
    // The class must never be stranded: OSMD's SVG outlives this component.
    expect(RH_EL.classList.contains('piano-note-match')).toBe(false);
  });

  it('renders one <svg> holding every ghost, not one element per ghost', () => {
    hold(61, 72, 74); // none written here — all ghosts
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

  // The staff a mark lands on is the staff of the NEAREST written pitch, so a
  // fumbled left-hand note inks on the left-hand staff. Fixture: staff 0 top=10,
  // staff 1 top=120 — a mark's notehead cy tells us unambiguously which it chose.
  const noteheadCy = (c) => {
    const el = c.querySelector('.piano-live-input__note ellipse');
    return el ? Number(el.getAttribute('cy')) : null;
  };

  it('places a held pitch on the staff of the nearest written pitch', () => {
    // 61 is 1 semitone from the LH's written 60 and 6 from the RH's 67, so it
    // belongs on the LOWER staff even though it matches neither.
    hold(61);
    const { container } = renderLayer();
    expect(noteheadCy(container)).toBeGreaterThan(100);
  });

  it('places a pitch nearest the upper staff on the upper staff', () => {
    // 68 is unwritten (a ghost, exercising nearest-staff fallback), 1 semitone
    // from the RH's written 67 and 7 from the LH's written 60.
    hold(68);
    const { container } = renderLayer();
    expect(noteheadCy(container)).toBeLessThan(100);
  });

  it('falls back to the top staff when the step writes nothing', () => {
    hold(67);
    const { container } = renderLayer({ step: { notes: [] } });
    expect(noteheadCy(container)).toBeLessThan(100);
  });

  // Fix 1 — a match registers on the WRITTEN note's own engraved geometry
  // (step.notes[].x/top/bottom/width), never on cursorX. cursorX is the OSMD
  // cursor element's centre, a different point than the notehead's true centre;
  // drawing there produced a smeared second note beside the real one.
  it('cannot land a match away from its note — nothing is positioned at all', () => {
    // The predecessor drew a mark at measured coordinates and got it wrong twice:
    // beside the note (the cursor's x is not the notehead's centre), and adrift
    // mid-system when a notehead's own measurement was unavailable and the
    // geometry fell back to the cursor's full-height box. Recolouring the
    // engraved element removes coordinates from the problem, so a cursorX
    // nowhere near the note cannot displace anything.
    hold(67);
    const { container } = renderLayer({ cursorX: 999 }); // far from the written 67
    expect(RH_EL.classList.contains('piano-note-match')).toBe(true);
    expect(container.querySelectorAll('.piano-live-input__note')).toHaveLength(0);
    expect(container.querySelector('svg.piano-live-input')).toBeNull();
  });

  it('still draws a ghost as a full glyph at the cursor column', () => {
    hold(61);
    const { container } = renderLayer({ cursorX: 333 });
    const g = container.querySelector('.piano-live-input__note.is-ghost');
    // WetNoteGlyph draws a stem for a quarter note — the ghost path, unlike the
    // match path, is unchanged by Fix 1.
    expect(g.querySelector('line')).not.toBeNull();
    const head = g.querySelector('ellipse');
    expect(Number(head.getAttribute('cx'))).toBe(333);
  });

  it('renders nothing for a match with no corresponding entry in step.notes, rather than throwing', () => {
    // Shouldn't happen — `written` is built FROM step.notes, so a midi it yields
    // is normally guaranteed to have an entry. Prove the defensive `if (!n)
    // continue` holds anyway, by giving `step.notes` a getter that answers
    // differently on the two reads the component makes (once to build the
    // written set, once to look up the matched note's geometry).
    hold(67);
    let call = 0;
    const trickyStep = {
      get notes() {
        call += 1;
        return call === 1 ? [{ midi: 67, staff: 0, x: 210, top: 30, bottom: 42, width: 12 }] : [];
      },
    };
    const { container } = renderLayer({ step: trickyStep });
    expect(marks(container)).toHaveLength(0);
  });

  // Fix 2 — while the gate grades, "match" must mean what the GATE means: scoped
  // to the active hands, via expectedMidisAtStep. Otherwise a pitch the gate
  // calls wrong (the other hand's note during one-handed practice) would draw
  // green here at the same time the gate inks it red elsewhere.
  it('draws nothing for the inactive hand\'s written pitch while the gate grades RH only', () => {
    hold(60); // LH's written pitch
    const { container } = renderLayer({ gateActive: true, activeParts: { 0: true } });
    expect(marks(container)).toHaveLength(0);
  });

  it('marks that same pitch as a match once the gate is off', () => {
    hold(60);
    renderLayer({ gateActive: false, activeParts: { 0: true } });
    expect(LH_EL.classList.contains('piano-note-match')).toBe(true);
  });
});

describe('LiveInputLayer styling', () => {
  // Scope to the live-input section, then assert nesting-agnostically: these
  // rules are about which PROPERTIES carry the styling, not how the source
  // happens to be nested. Re-nesting them must not break this test.
  const liveBlock = () => {
    const s = readFileSync(fileURLToPath(new URL('../../../../../Apps/PianoApp.scss', import.meta.url)), 'utf8');
    const start = s.indexOf('.piano-live-input {');
    const end = s.indexOf('// Active-note light-up');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return s.slice(start, end);
  };

  it('never intercepts a tap meant for the score', () => {
    expect(liveBlock()).toMatch(/pointer-events:\s*none/);
  });

  it('colours a match with the kiosk accent green', () => {
    expect(liveBlock()).toMatch(/is-match\s*\{[^}]*color:\s*var\(--piano-accent[^}]*#2ec46f/);
  });

  it('recesses a ghost rather than hiding it', () => {
    expect(liveBlock()).toMatch(/is-ghost\s*\{[^}]*opacity:\s*0?\.3/);
  });

  it('carries colour with `color`, never `fill`', () => {
    // WetNoteGlyph paints with currentColor, so a `fill` declaration here would
    // silently do nothing. A ghost must also never be hollow — `fill: none`
    // would state a half or whole note.
    expect(liveBlock()).not.toMatch(/fill:/);
  });
});
