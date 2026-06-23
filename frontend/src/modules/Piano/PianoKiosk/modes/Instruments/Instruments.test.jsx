import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  loadPreset: vi.fn(),
  stop: vi.fn(),
  setParam: vi.fn(),
  panic: vi.fn(),
  status: { link: 'connected', engine: 'stopped', preset: null },
}));

const midi = vi.hoisted(() => ({
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

vi.mock('./Instruments.scss', () => ({}));
vi.mock('../../PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('../../usePianoVoiceBridge.js', () => ({ usePianoVoiceBridge: () => bridge }));
vi.mock('../../PianoConfig.jsx', () => ({ usePianoKioskConfig: () => config }));

import { Instruments } from './Instruments.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  midi.activeNotes = new Map();
});

// Voice cards live in the rack <ul>; scope queries there so the controls label
// (which repeats the active instrument's name) doesn't create ambiguous matches.
const rack = () => screen.getByRole('list');
const card = (name) => within(rack()).getByText(name).closest('button');

describe('Instruments voice rack', () => {
  it('renders Onboard plus the two configured voices', () => {
    render(<Instruments />);
    expect(card('Onboard')).toBeTruthy();
    expect(card('Concert Grand')).toBeTruthy();
    expect(card('DX7 EP')).toBeTruthy();
  });

  it('Onboard is the active voice by default', () => {
    render(<Instruments />);
    expect(card('Onboard').className).toContain('is-active');
    expect(card('Concert Grand').className).not.toContain('is-active');
  });

  it('tapping a voice loads it, mutes onboard, and marks it active', () => {
    render(<Instruments />);
    fireEvent.click(card('Concert Grand'));
    expect(bridge.loadPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grand', engine: 'sfizz' }),
    );
    expect(midi.sendLocalControl).toHaveBeenCalledWith(false);
    expect(card('Concert Grand').className).toContain('is-active');
  });

  it('tapping Onboard after a voice stops the engine and restores onboard sound', () => {
    render(<Instruments />);
    fireEvent.click(card('Concert Grand'));
    fireEvent.click(card('Onboard'));
    expect(bridge.stop).toHaveBeenCalled();
    expect(midi.sendLocalControl).toHaveBeenLastCalledWith(true);
  });

  it('gain slider on the active voice calls setParam with a number', () => {
    render(<Instruments />);
    fireEvent.click(card('Concert Grand'));
    fireEvent.change(screen.getByDisplayValue('-3'), { target: { value: '0' } });
    expect(bridge.setParam).toHaveBeenCalledWith('gain_db', 0);
  });

  it('reverb slider appears only for a voice with reverb and calls setParam', () => {
    render(<Instruments />);
    fireEvent.click(card('Concert Grand'));
    fireEvent.change(screen.getByDisplayValue('0.4'), { target: { value: '0.6' } });
    expect(bridge.setParam).toHaveBeenCalledWith('reverb.mix', 0.6);
  });

  it('no controls/params for the Onboard voice', () => {
    render(<Instruments />);
    // Onboard active by default → no sliders.
    expect(screen.queryByDisplayValue('-3')).toBeNull();
  });
});

describe('Instruments voice rack with no rendered instruments', () => {
  beforeEach(() => { config.config.instruments = []; });
  afterEach(() => {
    config.config.instruments = [
      { id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz', gain_db: -3, reverb: { mix: 0.4 } },
      { id: 'dx7', name: 'DX7 EP', engine: 'dexed', asset: 'd.syx' },
    ];
  });

  it('shows only Onboard plus an inviting empty message', () => {
    render(<Instruments />);
    expect(card('Onboard')).toBeTruthy();
    expect(screen.queryByText('Concert Grand')).toBeNull();
    expect(screen.getByText(/Only the onboard voice is here for now/)).toBeTruthy();
  });
});
