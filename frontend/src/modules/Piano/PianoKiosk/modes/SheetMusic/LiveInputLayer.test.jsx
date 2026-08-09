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
