import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * A WAY OUT OF EVERY GAME.
 *
 * chess-1794439407456, 2026-11-11: a child reached a king-bishop-knight
 * ending at ply 200 that he could neither win nor leave. The board froze for a
 * minute after every move, the game never ended, and nothing on the screen or
 * under his hands could start another one — walking away kept it resumable, so
 * it came back on the next launch too. These tests pin the exits: a draw ends
 * the game with a result card, and a game in progress can always be given up
 * from the touch screen AND from the keys, with a confirm step either way.
 */

const { mockUsePianoMidi, mockUsePianoMidiNotes } = vi.hoisted(() => ({
  mockUsePianoMidi: vi.fn(() => ({ connected: false, status: 'disconnected' })),
  mockUsePianoMidiNotes: vi.fn(() => ({ activeNotes: new Map(), noteHistory: [] })),
}));

vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => mockUsePianoMidi(),
  usePianoMidiNotes: () => mockUsePianoMidiNotes(),
  usePianoMidiOptional: () => mockUsePianoMidi(),
  usePianoMidiNotesOptional: () => mockUsePianoMidiNotes(),
}));

vi.mock('./chessApi.js', () => ({
  requestOpponentMove: vi.fn(async () => null),
  requestOpponentQuip: vi.fn(async () => null),
  requestBestMove: vi.fn(async () => null),
  fetchChessConfig: vi.fn(async () => null),
  saveChessConfig: vi.fn(async () => null),
  saveGameRecord: vi.fn(async () => null),
  archiveGame: vi.fn(async () => null),
  beaconArchive: vi.fn(() => true),
  fetchLadder: vi.fn(async () => null),
  saveGameProgress: vi.fn(async () => null),
  beaconProgress: vi.fn(() => true),
  fetchResumableGame: vi.fn(async () => ({ game: null, window_days: 3 })),
}));

import { PianoChessGame } from './PianoChessGame.jsx';
import { archiveGame, saveGameRecord } from './chessApi.js';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

beforeEach(() => localStorage.clear());

const boardReady = () => act(async () => {});
const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME).pitch_classes.map((pc) => 60 + pc);
const SIX_KEYS = [60, 61, 62, 63, 64, 65];
const OCTAVE = [60, 72];

// One capture from a bare-king draw: Bc5xb6 leaves king and bishop against king.
const ONE_CAPTURE_FROM_DRAW = '8/8/1p6/2B5/8/8/3K4/k7 w - - 0 60';

function harness(element) {
  const view = render(element());
  const play = async (notes) => {
    mockUsePianoMidiNotes.mockReturnValue({
      activeNotes: new Map(notes.map((note) => [note, { velocity: 80 }])),
      noteHistory: [],
    });
    view.rerender(element());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
    view.rerender(element());
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  };
  return { ...view, play };
}

const logged = (spy, event) => spy.mock.calls.some((args) => args.some((arg) => typeof arg === 'string' && arg.includes(event)));
const loggedWith = (spy, event, text) => spy.mock.calls.some((args) => {
  const line = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
  return line.includes(event) && line.includes(text);
});

describe('a draw ends the game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    saveGameRecord.mockClear();
    archiveGame.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('says "Draw — <reason>", files it like any finished game, and offers New game / Done', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const onDeactivate = vi.fn();
    const element = () => (
      <PianoChessGame
        fen={ONE_CAPTURE_FROM_DRAW}
        currentUser="kckern"
        gameConfig={{ addressing: { shuffle: 'never' } }}
        onDeactivate={onDeactivate}
      />
    );
    const { play, container } = harness(element);
    await boardReady();

    await play(notesFor('c5'));
    await play(notesFor('c5'));
    await play(notesFor('b6')); // Bxb6 — king and bishop against king

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    expect(saveGameRecord).toHaveBeenCalledWith('kckern', expect.objectContaining({
      result: 'draw', outcome: 'insufficient_material', completed: true,
    }));
    expect(container.querySelector('.chess-result__headline').textContent).toBe('Draw — not enough pieces');
    expect(loggedWith(logSpy, 'chess.game.draw', 'insufficient_material')).toBe(true);

    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });
});

describe('giving a game up', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    archiveGame.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  const element = () => <PianoChessGame currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />;
  const playAMove = async (play) => {
    await play(notesFor('e2'));
    await play(notesFor('e2'));
    await play(notesFor('e4'));
  };

  it('from the touch screen: New game asks first, Keep playing changes nothing', async () => {
    const { play, container } = harness(element);
    await boardReady();
    await playAMove(play);
    expect(container.querySelector('[data-square="e4"]').getAttribute('aria-label')).toBe('e4 — wP');

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(screen.getByRole('dialog', { name: 'Start a new game?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(archiveGame).not.toHaveBeenCalled();
  });

  it('from the touch screen: confirming files the game as resigned and deals a fresh board', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { play } = harness(element);
    await boardReady();
    await playAMove(play);

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, new game' }));
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(archiveGame).toHaveBeenCalledTimes(1);
    expect(archiveGame.mock.calls[0][0]).toMatchObject({ completed: false, ended_by: 'resigned' });
    expect(logged(logSpy, 'chess.game.resigned')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    // A fresh board: the pawn that moved is home again.
    expect(document.querySelector('[data-square="e2"]').getAttribute('aria-label')).toBe('e2 — wP');
    expect(document.querySelector('[data-square="e4"]').getAttribute('aria-label')).toBe('e4');
  });

  it('from the keys: six keys in a row asks, an octave keeps playing, six again confirms', async () => {
    const { play } = harness(element);
    await boardReady();
    await playAMove(play);

    await play(SIX_KEYS);
    expect(screen.getByRole('dialog', { name: 'Start a new game?' })).toBeTruthy();
    await play(OCTAVE);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(archiveGame).not.toHaveBeenCalled();

    await play(SIX_KEYS);
    expect(screen.getByRole('dialog', { name: 'Start a new game?' })).toBeTruthy();
    await play(SIX_KEYS);
    expect(archiveGame).toHaveBeenCalledTimes(1);
    expect(archiveGame.mock.calls[0][0]).toMatchObject({ ended_by: 'resigned' });
  });

  it('under an armed match gate, a resign hands the boundary to the gate', async () => {
    const gate = { armed: true, requestRematch: vi.fn() };
    const gated = () => (
      <MatchGateContext.Provider value={gate}>{element()}</MatchGateContext.Provider>
    );
    const { play } = harness(gated);
    await boardReady();
    await playAMove(play);

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, new game' }));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(archiveGame.mock.calls[0][0]).toMatchObject({ ended_by: 'resigned' });
    expect(gate.requestRematch).toHaveBeenCalledTimes(1);
  });
});
