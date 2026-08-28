// Hero's SECOND door into a match: the song picker.
//
// Gating the "Play again" button was not enough. "Songs" (the HUD) and "Choose
// a song" (the result card) both drop back to the picker, and picking anything
// — the same song included — remounts `HeroGame` at `phase: 'ready'`, where the
// first run of a mount is deliberately free. Two taps, unlimited unpaid
// matches, and no route param changes so `GameHost`'s own re-arm never sees it.
//
// This test therefore goes through the PICKER, not the replay button. The
// button is already covered by useMatchRematch.test.jsx; if a future change
// closes the button and reopens the picker, that spec would still be green and
// this one would not.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

const h = vi.hoisted(() => ({ phase: 'ready', start: vi.fn() }));

vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../components/PianoKeyboard.jsx', () => ({ PianoKeyboard: () => <div data-testid="keyboard" /> }));
vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ subscribe: vi.fn() }),
  usePianoMidiNotes: () => ({ activeNotes: new Map() }),
  usePianoMidiOptional: () => ({ subscribe: vi.fn() }),
  usePianoMidiNotesOptional: () => ({ activeNotes: new Map() }),
}));
vi.mock('../PianoKiosk/modes/SheetMusic/useMetronomeClick.js', () => ({ default: vi.fn() }));
vi.mock('./usePianoHeroGame.js', () => ({
  usePianoHeroGame: () => ({
    phase: h.phase, start: h.start, elapsedMs: 0,
    timing: { fallDurationMs: 2000 },
    run: { targets: [], score: { points: 0, combo: 0, perfect: 0, good: 0, misses: 0, maxCombo: 0 } },
  }),
}));
// One song in the picker, and a chart for it — the score fetch and the MusicXML
// parse are not what is under test.
vi.mock('../PianoKiosk/usePianoList.js', () => ({
  default: () => ({ data: [{ id: 'scores/song-a.musicxml', title: 'Song A' }], error: null }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({})),
  DaylightAPIText: vi.fn(async () => '<score-partwise/>'),
}));
vi.mock('../../MusicNotation/parseMusicXml.js', () => ({ parseMusicXml: () => ({}) }));
vi.mock('./heroChart.js', async (importOriginal) => ({
  ...(await importOriginal()),
  buildHeroChart: () => ({
    startNote: 60, endNote: 72, tempo: 90, durationMs: 4000, leadInMs: 0,
    targets: [{ id: 't1', targetTimeMs: 0, pitches: [60], state: 'pending' }],
    source: { id: 'song-a' },
  }),
}));

const { PianoHeroGame } = await import('./PianoHeroGame.jsx');

const APP_CONFIG = { sheetmusic: { collection: 'scores' } };

function renderHero(matchGate) {
  const tree = (
    <PianoHeroGame appConfig={APP_CONFIG} gameConfig={{ noteSelect: false }} activeNotes={new Map()} />
  );
  return render(
    matchGate === undefined
      ? tree
      : <MatchGateContext.Provider value={matchGate}>{tree}</MatchGateContext.Provider>,
  );
}

/** Picker → song → the run screen. Awaits the chart load. */
async function pickSong() {
  fireEvent.click(await screen.findByTitle('Song A'));
  return screen.findByText('Play');
}

beforeEach(() => {
  h.phase = 'ready';
  h.start.mockClear();
});

describe('Piano Hero — a match reached through the song picker', () => {
  it('plays the first run of the visit for free — the gate at the door paid for it', async () => {
    const requestRematch = vi.fn();
    renderHero({ armed: true, requestRematch });

    fireEvent.click(await pickSong());
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(requestRematch).not.toHaveBeenCalled();
  });

  it('gates the NEXT run even though the picker remounts the game at "ready"', async () => {
    const requestRematch = vi.fn();
    renderHero({ armed: true, requestRematch });

    fireEvent.click(await pickSong());
    expect(h.start).toHaveBeenCalledTimes(1);

    // Back to the picker via the HUD, then straight back in on the same song.
    fireEvent.click(screen.getByText('Songs'));
    fireEvent.click(await pickSong());

    expect(requestRematch, 'the picker loop reached a match without the gate').toHaveBeenCalledTimes(1);
    expect(h.start, 'a second run started behind the gate').toHaveBeenCalledTimes(1);
  });

  it('gates the picker loop from a FINISHED run too — the result card route', async () => {
    const requestRematch = vi.fn();
    const view = renderHero({ armed: true, requestRematch });

    fireEvent.click(await pickSong());
    h.phase = 'complete';
    view.rerender(
      <MatchGateContext.Provider value={{ armed: true, requestRematch }}>
        <PianoHeroGame appConfig={APP_CONFIG} gameConfig={{ noteSelect: false }} activeNotes={new Map()} />
      </MatchGateContext.Provider>,
    );

    fireEvent.click(screen.getByText('Choose a song'));
    h.phase = 'ready';
    fireEvent.click(await pickSong());

    expect(requestRematch).toHaveBeenCalledTimes(1);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('keeps replaying through the picker outside the kiosk, where there is no gate', async () => {
    renderHero(undefined);

    fireEvent.click(await pickSong());
    fireEvent.click(screen.getByText('Songs'));
    fireEvent.click(await pickSong());

    expect(h.start).toHaveBeenCalledTimes(2);
  });
});
