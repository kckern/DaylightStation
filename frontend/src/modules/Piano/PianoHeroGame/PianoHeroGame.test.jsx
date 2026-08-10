import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const metronomeSpy = vi.fn();
let gamePhase = 'playing';

vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock('../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));
vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: vi.fn() }),
  usePianoMidiNotes: () => ({ activeNotes: new Set() }),
}));
vi.mock('../PianoKiosk/modes/SheetMusic/useMetronomeClick.js', () => ({
  default: (options) => metronomeSpy(options),
}));
vi.mock('./usePianoHeroGame.js', () => ({
  usePianoHeroGame: () => ({
    phase: gamePhase,
    elapsedMs: 0,
    run: { targets: [], score: { points: 0, combo: 0 } },
    timing: { fallDurationMs: 3000 },
    start: vi.fn(),
  }),
}));

import { HeroGame } from './PianoHeroGame.jsx';

const chart = {
  startNote: 60,
  endNote: 72,
  targets: [],
  tempo: 92,
  timeSig: { beats: 4, beatType: 4 },
  leadInMs: 3000,
  durationMs: 10000,
};

beforeEach(() => {
  metronomeSpy.mockClear();
  gamePhase = 'playing';
});

describe('HeroGame metronome', () => {
  it('starts on and can be switched off from the HUD', () => {
    render(<HeroGame song={{ title: 'Test Song' }} chart={chart} onChooseSong={vi.fn()} />);

    const toggle = screen.getByRole('button', { name: 'Metronome' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(metronomeSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: true,
      bpm: 92,
      beatsPerBar: 4,
    }));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(metronomeSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('opens the shared tempo sheet between runs and retimes the HUD', () => {
    gamePhase = 'ready';
    render(<HeroGame song={{ title: 'Test Song' }} chart={chart} onChooseSong={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }));
    expect(screen.getByRole('dialog', { name: 'tempo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '72' }));
    expect(screen.getByRole('button', { name: 'Tempo' })).toHaveTextContent('72 BPM');
  });
});
