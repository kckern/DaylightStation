import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  loadPreset: vi.fn(),
  stop: vi.fn(),
  setParam: vi.fn(),
  panic: vi.fn(),
  status: { link: 'connected', engine: 'stopped', preset: null },
}));
const midi = vi.hoisted(() => ({
  sendProgramChange: vi.fn(),
  sendLocalControl: vi.fn(),
}));

vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('./usePianoVoiceBridge.js', () => ({ usePianoVoiceBridge: () => bridge }));
vi.mock('./PianoConfig.jsx', () => ({
  usePianoKioskConfig: () => ({
    pianoId: 'default',
    config: {
      voices: [{ label: 'Grand Piano', program: 0 }, { label: 'Electric Piano', program: 4 }],
      instruments: [{ id: 'grand', name: 'Concert Grand', engine: 'sfizz', asset: 'g.sfz' }],
    },
  }),
}));

import { PianoSoundProvider, usePianoSound } from './PianoSoundContext.jsx';

function Harness() {
  const { sources, active, activeName, select } = usePianoSound();
  return (
    <div>
      <span data-testid="active">{activeName}</span>
      <span data-testid="kind">{active?.kind}</span>
      {sources.map((s) => (
        <button key={s.id} onClick={() => select(s.id)}>{s.name}</button>
      ))}
    </div>
  );
}

const renderSound = () => render(<PianoSoundProvider><Harness /></PianoSoundProvider>);

describe('PianoSoundContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to the first onboard voice', () => {
    renderSound();
    expect(screen.getByTestId('active').textContent).toBe('Grand Piano');
    expect(screen.getByTestId('kind').textContent).toBe('onboard');
  });

  it('selecting an instrument loads its preset and mutes local control', () => {
    renderSound();
    fireEvent.click(screen.getByText('Concert Grand'));
    expect(bridge.loadPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'grand', engine: 'sfizz' }));
    expect(midi.sendLocalControl).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('active').textContent).toBe('Concert Grand');
  });

  it('selecting an onboard voice stops the bridge, restores local control, sends its program', () => {
    renderSound();
    fireEvent.click(screen.getByText('Concert Grand')); // go to an instrument first
    vi.clearAllMocks();
    fireEvent.click(screen.getByText('Electric Piano'));
    expect(bridge.stop).toHaveBeenCalled();
    expect(midi.sendLocalControl).toHaveBeenCalledWith(true);
    expect(midi.sendProgramChange).toHaveBeenCalledWith(4);
  });
});
