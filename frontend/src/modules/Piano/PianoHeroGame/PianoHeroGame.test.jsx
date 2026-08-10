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

import { HeroGame, HeroHighway } from './PianoHeroGame.jsx';

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

  it('opens the practice-speed ladder between runs and retimes the HUD', () => {
    gamePhase = 'ready';
    render(<HeroGame song={{ title: 'Test Song' }} chart={chart} onChooseSong={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }));
    expect(screen.getByRole('dialog', { name: 'Tempo' })).toBeTruthy();
    // Steps are PERCENT of this song's own tempo, each labelled with the BPM it
    // produces here — an absolute preset list says nothing against a chart whose
    // written tempo it was not built for.
    fireEvent.click(screen.getByRole('button', { name: /^70%/ }));
    const chip = screen.getByRole('button', { name: 'Tempo' });
    expect(chip).toHaveTextContent('64 BPM'); // 70% of 92
    expect(chip).toHaveTextContent('70%');    // and the chip says you are off-tempo
  });

  it('keeps the tempo chip a reachable control on the ready screen, and out of reach mid-run', () => {
    gamePhase = 'ready';
    const { unmount } = render(<HeroGame song={{ title: 'Test Song' }} chart={chart} onChooseSong={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tempo' })).not.toBeDisabled();
    unmount();

    gamePhase = 'playing';
    render(<HeroGame song={{ title: 'Test Song' }} chart={chart} onChooseSong={vi.fn()} />);
    // Retiming a chart underway would move every note currently in the air.
    expect(screen.getByRole('button', { name: 'Tempo' })).toBeDisabled();
  });
});

describe('HeroHighway threshold feedback', () => {
  it('renders score-aligned beat, hit, and miss sparks on the hit line', () => {
    const targets = [
      { id: 1, pitches: [60], targetTimeMs: 900, durationMs: 300, state: 'hit', hitPitches: [60], resolvedAt: 900 },
      { id: 2, pitches: [67], targetTimeMs: 900, durationMs: 300, state: 'missed', hitPitches: [], resolvedAt: 950 },
    ];
    const { container } = render(
      <HeroHighway
        chart={{ ...chart, leadInMs: 0, tempo: 60 }}
        targets={targets}
        elapsedMs={1000}
        fallDurationMs={3000}
        metronomeOn
        playing
      />,
    );
    const line = screen.getByTestId('hero-hit-line');
    expect(line.querySelector('.piano-hero-highway__beat-flash')).toBeTruthy();
    expect(container.querySelector('.piano-hero-highway__threshold-spark.is-hit')).toBeTruthy();
    expect(container.querySelector('.piano-hero-highway__threshold-spark.is-miss')).toBeTruthy();
  });
});
