import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  loadPreset: vi.fn(),
  stop: vi.fn(),
  setParam: vi.fn(),
  panic: vi.fn(),
  status: { link: 'connected', engine: 'stopped', preset: null },
}));

const midiState = vi.hoisted(() => ({ captured: null }));
const midi = vi.hoisted(() => ({
  subscribe: vi.fn(),
  sendLocalControl: vi.fn(),
  activeNotes: new Map(),
}));

const config = vi.hoisted(() => ({
  pianoId: 'default',
  config: {
    instruments: [
      { id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz', gain_db: -3, reverb: { mix: 0.4 } },
      { id: 'dx7', name: 'DX7 EP', engine: 'dexed', asset: 'd.syx' },
    ],
  },
}));

// Stub the scss import: vitest has no sass-embedded, and the styles are irrelevant
// to behaviour. (The shipped component imports the real .scss for the kiosk build.)
vi.mock('./Instruments.scss', () => ({}));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('../../usePianoVoiceBridge.js', () => ({ usePianoVoiceBridge: () => bridge }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => config }));

import { Instruments } from './Instruments.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  midiState.captured = null;
  // Capture the MIDI subscription listener so tests can drive physical-key nav.
  midi.subscribe.mockImplementation((fn) => { midiState.captured = fn; return () => {}; });
});

// The entry list is a <ul>; scope queries there so the transport "active name"
// label (which can also read "Onboard") doesn't create ambiguous matches.
const list = () => screen.getByRole('list');
const entryBtn = (name) => within(list()).getByText(name).closest('button');

describe('Instruments mode', () => {
  it('renders Onboard plus the two configured instruments', () => {
    render(<Instruments />);
    expect(entryBtn('Onboard')).toBeTruthy();
    expect(entryBtn('Concert Grand')).toBeTruthy();
    expect(entryBtn('DX7 EP')).toBeTruthy();
  });

  it('clicking an instrument entry loads it and disables local control', () => {
    render(<Instruments />);
    fireEvent.click(entryBtn('Concert Grand'));
    expect(bridge.loadPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grand', engine: 'sfizz' }),
    );
    expect(midi.sendLocalControl).toHaveBeenCalledWith(false);
  });

  it('clicking Onboard after an instrument stops the engine and restores local control', () => {
    render(<Instruments />);
    fireEvent.click(entryBtn('Concert Grand'));
    fireEvent.click(entryBtn('Onboard'));
    expect(bridge.stop).toHaveBeenCalled();
    expect(midi.sendLocalControl).toHaveBeenLastCalledWith(true);
  });

  it('on-screen Next advances selection, Select activates, Panic fires panic', () => {
    render(<Instruments />);
    // Onboard is selected by default (index 0). Next → index 1 (Concert Grand).
    fireEvent.click(screen.getByText('Next'));
    expect(entryBtn('Concert Grand').className).toContain('is-selected');

    fireEvent.click(screen.getByText('Select'));
    expect(bridge.loadPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grand' }),
    );

    fireEvent.click(screen.getByText('Panic'));
    expect(bridge.panic).toHaveBeenCalled();
  });

  it('physical key nav (note_on 38 then 40) moves selection and activates', () => {
    render(<Instruments />);
    expect(midiState.captured).toBeTypeOf('function');
    // 38 = Next → index 1 (Concert Grand). Raw listener calls aren't auto-wrapped
    // in act(), so wrap them to flush state updates.
    act(() => midiState.captured({ type: 'note_on', note: 38, velocity: 100, time: 0 }));
    expect(entryBtn('Concert Grand').className).toContain('is-selected');
    // 40 = Select → activate
    act(() => midiState.captured({ type: 'note_on', note: 40, velocity: 100, time: 0 }));
    expect(bridge.loadPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grand' }),
    );
  });

  it('a non-nav note (note_on 60) does not navigate or activate', () => {
    render(<Instruments />);
    act(() => midiState.captured({ type: 'note_on', note: 60, velocity: 100, time: 0 }));
    expect(bridge.loadPreset).not.toHaveBeenCalled();
    expect(entryBtn('Onboard').className).toContain('is-selected');
  });

  it('gain_db slider change calls bridge.setParam with a number', () => {
    render(<Instruments />);
    fireEvent.click(entryBtn('Concert Grand')); // active → params panel appears
    const gainInput = screen.getByDisplayValue('-3');
    fireEvent.change(gainInput, { target: { value: '0' } });
    expect(bridge.setParam).toHaveBeenCalledWith('gain_db', 0);
  });

  it('reverb slider appears for an instrument with reverb and calls setParam', () => {
    render(<Instruments />);
    fireEvent.click(entryBtn('Concert Grand'));
    const reverbInput = screen.getByDisplayValue('0.4');
    fireEvent.change(reverbInput, { target: { value: '0.6' } });
    expect(bridge.setParam).toHaveBeenCalledWith('reverb.mix', 0.6);
  });
});

describe('Instruments mode with no configured instruments', () => {
  it('shows only Onboard plus the configuration hint', () => {
    config.config.instruments = [];
    render(<Instruments />);
    expect(entryBtn('Onboard')).toBeTruthy();
    expect(screen.getByText(/No rendered instruments configured/)).toBeTruthy();
    expect(screen.queryByText('Concert Grand')).toBeNull();
    // restore for any later runs
    config.config.instruments = [
      { id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz', gain_db: -3, reverb: { mix: 0.4 } },
      { id: 'dx7', name: 'DX7 EP', engine: 'dexed', asset: 'd.syx' },
    ];
  });
});
