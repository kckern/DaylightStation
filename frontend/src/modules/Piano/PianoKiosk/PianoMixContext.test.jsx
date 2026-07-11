import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const midi = vi.hoisted(() => ({ outputConnected: false, sendControlChange: vi.fn() }));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));

import { PianoMixProvider, usePianoMix } from './PianoMixContext.jsx';

function Harness() {
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  return (
    <div>
      <span data-testid="piano">{pianoLevel}</span>
      <span data-testid="media">{mediaLevel}</span>
      <button type="button" onClick={() => setPianoLevel(0.5)}>piano-half</button>
      <button type="button" onClick={() => setMediaLevel(0.3)}>media-30</button>
    </div>
  );
}
const renderMix = () => render(<PianoMixProvider><Harness /></PianoMixProvider>);

beforeEach(() => {
  localStorage.clear();
  midi.sendControlChange.mockReset();
  midi.outputConnected = false;
});

describe('PianoMixContext', () => {
  it('defaults both levels to 1', () => {
    renderMix();
    expect(screen.getByTestId('piano').textContent).toBe('1');
    expect(screen.getByTestId('media').textContent).toBe('1');
  });

  it('setPianoLevel sends CC7 (linear→0..127) and persists', () => {
    renderMix();
    fireEvent.click(screen.getByText('piano-half'));
    expect(midi.sendControlChange).toHaveBeenCalledWith(7, 64); // round(0.5*127)=64
    expect(screen.getByTestId('piano').textContent).toBe('0.5');
    expect(localStorage.getItem('piano.mix.pianoLevel')).toBe('0.5');
  });

  it('setMediaLevel persists without touching MIDI', () => {
    renderMix();
    fireEvent.click(screen.getByText('media-30'));
    expect(screen.getByTestId('media').textContent).toBe('0.3');
    expect(localStorage.getItem('piano.mix.mediaLevel')).toBe('0.3');
    expect(midi.sendControlChange).not.toHaveBeenCalled();
  });

  it('re-reads persisted levels on mount', () => {
    localStorage.setItem('piano.mix.pianoLevel', '0.4');
    localStorage.setItem('piano.mix.mediaLevel', '0.2');
    renderMix();
    expect(screen.getByTestId('piano').textContent).toBe('0.4');
    expect(screen.getByTestId('media').textContent).toBe('0.2');
  });

  it('re-asserts CC7 when the MIDI OUT link is connected on mount', () => {
    midi.outputConnected = true; // keyed on the OUT link (the port that flaps), not input status
    localStorage.setItem('piano.mix.pianoLevel', '0.6');
    renderMix();
    expect(midi.sendControlChange).toHaveBeenCalledWith(7, 76); // round(0.6*127)=76
  });
});
