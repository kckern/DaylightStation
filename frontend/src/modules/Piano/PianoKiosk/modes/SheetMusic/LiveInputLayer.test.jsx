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
    hold(67);
    const { container } = renderLayer();
    expect(noteheadCy(container)).toBeLessThan(100);
  });

  it('falls back to the top staff when the step writes nothing', () => {
    hold(67);
    const { container } = renderLayer({ step: { notes: [] } });
    expect(noteheadCy(container)).toBeLessThan(100);
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
