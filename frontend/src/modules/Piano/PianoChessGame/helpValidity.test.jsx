import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * Help validity — nothing on this screen may tell the player something untrue.
 *
 * These are whole-component seams the per-module tests could not see: help
 * state read instantaneously while the game moves underneath it. Each test
 * here reproduced a shipped lie (a false refusal, a stale best-move drawn for
 * a dead position, a hint charged that delivered nothing, an end screen that
 * withheld the tallies) before its fix landed. They stay as the regression
 * guard for the validity window.
 */

const { mockUsePianoMidi, mockUsePianoMidiNotes } = vi.hoisted(() => ({
  mockUsePianoMidi: vi.fn(() => ({ connected: true, status: 'connected' })),
  mockUsePianoMidiNotes: vi.fn(() => ({ activeNotes: new Map(), noteHistory: [] })),
}));

vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => mockUsePianoMidi(),
  usePianoMidiNotes: () => mockUsePianoMidiNotes(),
}));

vi.mock('./chessApi.js', () => ({
  requestOpponentMove: vi.fn(),
  fetchChessConfig: vi.fn(async () => null),
  saveChessConfig: vi.fn(async () => null),
  saveGameRecord: vi.fn(async () => null),
}));

import { PianoChessGame } from './PianoChessGame.jsx';
import { requestOpponentMove, saveGameRecord } from './chessApi.js';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';

const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
  activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
  noteHistory: [],
});

describe('help validity: seams the per-task tests could not see', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    requestOpponentMove.mockReset();
    requestOpponentMove.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('R1: a STAGGERED release of the hint cluster does not produce a false refusal', async () => {
    const { rerender } = render(<PianoChessGame />);
    // Hold the hint cluster past the settle window.
    holdNotes([60, 61, 62]);
    rerender(<PianoChessGame />);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    // Lift one finger first (human release), then the rest.
    holdNotes([60, 61]);
    rerender(<PianoChessGame />);
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
    holdNotes([]);
    rerender(<PianoChessGame />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    // A cluster is a request, never chord input — no refusal may appear.
    expect(screen.queryAllByText(/not on the board/i)).toHaveLength(0);
  });

  it('R2: a best-move answer that arrives after the position changed is not drawn', async () => {
    // Player is black; White (the opponent) moves first. Gesture "best" during
    // the opponent's think: the response resolves only AFTER the reply lands.
    let resolveBest;
    requestOpponentMove.mockImplementation(({ rung }) => {
      if (rung === 'ruthless') return new Promise((resolve) => { resolveBest = resolve; });
      return Promise.resolve({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    });
    const { container, rerender } = render(<PianoChessGame playerColor="b" seed={1} />);
    // Ask for the best move immediately (opponent is thinking).
    holdNotes([60, 61, 62, 63]);
    rerender(<PianoChessGame playerColor="b" seed={1} />);
    expect(requestOpponentMove).toHaveBeenCalledWith(expect.objectContaining({ rung: 'ruthless' }));
    holdNotes([]);
    rerender(<PianoChessGame playerColor="b" seed={1} />);
    // Opponent's reply lands (position advances; help is cleared).
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(container.querySelectorAll('.chess-board__square--last-move').length).toBe(2);
    // NOW the stale best-move answer arrives — computed for the pre-reply position.
    await act(async () => { resolveBest({ from: 'g1', to: 'f3', san: 'Nf3', engine: 'stockfish' }); });
    expect(container.querySelectorAll('.chess-board__square--best')).toHaveLength(0);
  });

  it('R3: a hint asked during the opponent\'s turn is not charged when it can show nothing', async () => {
    // Player is black; White is thinking. Hint cluster shows zero marks
    // (playableSources is empty off-turn) — so it must not be charged either.
    const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
    // Use white player on a mate-in-one board to finish quickly and read the record.
    saveGameRecord.mockClear();
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" playerColor="b" gameConfig={{ shuffle_each_turn: false }} />
    );
    // Black to... FEN says w to move; player is black, so it IS the opponent's turn.
    requestOpponentMove.mockImplementation(({ rung }) => {
      if (rung === 'ruthless') return Promise.resolve(null);
      return Promise.resolve({ from: 'f1', to: 'f8', san: 'Rf8#', engine: 'stockfish' });
    });
    const { container, rerender } = render(makeElement());
    // Hint during the opponent's turn: zero marks appear.
    holdNotes([60, 61, 62]);
    rerender(makeElement());
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    holdNotes([]);
    rerender(makeElement());
    // Opponent mates; game over; record posts.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    // The record must not claim a hint that never displayed anything.
    expect(saveGameRecord.mock.calls[0][1].hints).toBe(0);
  });

  it('R4: a finished game reads its tallies back on the end screen, from the record that was saved', async () => {
    // White: Kg6, Rf1. Black: Kh8. Rf1-f8 is mate — one player move ends the game.
    const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
    saveGameRecord.mockClear();
    const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
      .pitch_classes.map((pc) => 60 + pc);
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ shuffle_each_turn: false }} />
    );
    const { container, rerender } = render(makeElement());
    const play = async (notes) => {
      holdNotes(notes);
      rerender(makeElement());
      // Hold through the 140ms settle window, then release cleanly.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      holdNotes([]);
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    };

    await play([60, 61, 62]); // one hint, asked on the player's turn — a real charge
    await play(notesFor('f1')); // name the rook — hovers
    await play(notesFor('f1')); // name it again — lifts it (one chord only hovers now)
    await play(notesFor('f8')); // land it — checkmate

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    const record = saveGameRecord.mock.calls[0][1];
    expect(record).toMatchObject({ result: 'win', moves: 1, hints: 1, best_moves: 0 });

    // The end screen must state the same facts the record keeps — one source,
    // so the two can never disagree.
    const values = [...container.querySelectorAll('.piano-chess__summary-value')]
      .map((el) => el.textContent);
    expect(values).toEqual([String(record.moves), String(record.hints), String(record.best_moves)]);
    const labels = [...container.querySelectorAll('.piano-chess__summary .piano-chess__slot-label')]
      .map((el) => el.textContent.toLowerCase());
    expect(labels).toEqual(['moves', 'hints', 'best moves']);
  });
});
