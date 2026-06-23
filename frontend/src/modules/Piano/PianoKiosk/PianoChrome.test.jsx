import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const bridge = vi.hoisted(() => ({
  loadPreset: vi.fn(),
  stop: vi.fn(),
  setParam: vi.fn(),
  panic: vi.fn(),
  status: { link: 'connected', engine: 'stopped', preset: null },
}));
const midi = vi.hoisted(() => ({
  connected: true,
  status: 'connected',
  inputName: 'Piano',
  sendProgramChange: vi.fn(),
  sendLocalControl: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./usePianoVoiceBridge.js', () => ({ usePianoVoiceBridge: () => bridge }));

import { PianoChrome } from './PianoChrome.jsx';

const voices = [
  { label: 'Grand Piano', program: 0 },
  { label: 'Electric Piano', program: 4 },
];
const instruments = [
  { id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz' },
];

const renderChrome = (props = {}) =>
  render(
    <MemoryRouter>
      <PianoChrome pianoId="default" instruments={instruments} voices={voices} {...props} />
    </MemoryRouter>,
  );

describe('PianoChrome source selector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selecting an instrument loads it and disables local control', () => {
    renderChrome();
    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'grand' } });
    expect(bridge.loadPreset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'grand', engine: 'sfizz' }),
    );
    expect(midi.sendLocalControl).toHaveBeenCalledWith(false);
  });

  it('selecting Onboard stops the engine and restores local control', () => {
    renderChrome();
    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'grand' } });
    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: '__onboard__' } });
    expect(bridge.stop).toHaveBeenCalled();
    expect(midi.sendLocalControl).toHaveBeenCalledWith(true);
  });

  it('selecting an unknown instrument id does nothing', () => {
    renderChrome();
    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'nope' } });
    expect(bridge.loadPreset).not.toHaveBeenCalled();
    expect(midi.sendLocalControl).not.toHaveBeenCalled();
  });

  it('hides the onboard voices picker when an instrument is active, shows it for Onboard', () => {
    renderChrome();
    // Onboard is the default source → voices picker is visible.
    expect(screen.getByLabelText('Instrument voice')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: 'grand' } });
    expect(screen.queryByLabelText('Instrument voice')).toBeNull();

    fireEvent.change(screen.getByLabelText('Sound source'), { target: { value: '__onboard__' } });
    expect(screen.getByLabelText('Instrument voice')).toBeTruthy();
  });

  it('does not render the source selector when instruments is empty', () => {
    render(
      <MemoryRouter>
        <PianoChrome pianoId="default" instruments={[]} voices={voices} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText('Sound source')).toBeNull();
    // The onboard voices picker still renders independently.
    expect(screen.getByLabelText('Instrument voice')).toBeTruthy();
  });
});
