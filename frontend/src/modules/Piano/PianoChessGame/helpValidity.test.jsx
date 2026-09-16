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
  // The game reads the provider-optional variants so it can also render on the
  // office screen, where there is no PianoMidiProvider. Same mocks behind both.
  usePianoMidiOptional: () => mockUsePianoMidi(),
  usePianoMidiNotesOptional: () => mockUsePianoMidiNotes(),
}));

vi.mock('./chessApi.js', () => ({
  requestOpponentMove: vi.fn(),
  requestOpponentQuip: vi.fn(async () => null),
  requestBestMove: vi.fn(async () => null),
  fetchChessConfig: vi.fn(async () => null),
  saveChessConfig: vi.fn(async () => null),
  saveGameRecord: vi.fn(async () => null),
  archiveGame: vi.fn(async () => null),
  beaconArchive: vi.fn(() => true),
  fetchLadder: vi.fn(async () => null),
}));

import { PianoChessGame } from './PianoChessGame.jsx';
import { requestBestMove, requestOpponentMove, saveGameRecord } from './chessApi.js';
import { OPPONENT_DELAY_MS } from './PianoChessGame.jsx';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { GESTURE_SETTLE_MS } from './useSettledGesture.js';
import { fetchLadder } from './chessApi.js';
import { DEFAULT_LADDER_POLICY } from '@shared-gaming/rulesets/chess/ladder.mjs';

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
    requestBestMove.mockReset();
    requestBestMove.mockResolvedValue(null);
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
    requestBestMove.mockImplementation(() => new Promise((resolve) => { resolveBest = resolve; }));
    requestOpponentMove.mockResolvedValue({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    const { container, rerender } = render(<PianoChessGame playerColor="b" seed={1} />);
    // Ask for the best move while the opponent is thinking. The cluster must
    // hold still for GESTURE_SETTLE_MS before it counts as a request (see
    // useSettledGesture.js); 140ms sits far inside the 1200ms opponent delay,
    // so the reply cannot land while we wait for it.
    holdNotes([60, 61, 62, 63]);
    rerender(<PianoChessGame playerColor="b" seed={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(GESTURE_SETTLE_MS + 10); });
    expect(requestBestMove).toHaveBeenCalledWith(expect.objectContaining({ fen: expect.any(String) }));
    holdNotes([]);
    rerender(<PianoChessGame playerColor="b" seed={1} />);
    // The opponent's own move request waits on the ladder fetch settling
    // (PianoChessGame.jsx's `ladderReady` gate) before it fires — flush that
    // async hop on its own tick first, or it races the think-time floor for
    // the same advanced window below and the floor's timer never gets
    // scheduled in time.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Opponent's reply lands (position advances; help is cleared).
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS + 200); });
    expect(container.querySelectorAll('.chess-board__square--last-move').length).toBe(2);
    // NOW the stale best-move answer arrives — computed for the pre-reply position.
    await act(async () => { resolveBest({ from: 'g1', to: 'f3' }); });
    expect(container.querySelectorAll('.chess-board__square--best')).toHaveLength(0);
  });

  it('R3: a hint asked during the opponent\'s turn is not charged when it can show nothing', async () => {
    // Player is black; White is thinking. Hint cluster shows zero marks
    // (playableSources is empty off-turn) — so it must not be charged either.
    const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
    // Use white player on a mate-in-one board to finish quickly and read the record.
    saveGameRecord.mockClear();
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" playerColor="b" gameConfig={{ addressing: { shuffle: 'never' } }} />
    );
    // Black to... FEN says w to move; player is black, so it IS the opponent's turn.
    requestBestMove.mockResolvedValue(null);
    requestOpponentMove.mockResolvedValue({ from: 'f1', to: 'f8', san: 'Rf8#', engine: 'stockfish' });
    const { container, rerender } = render(makeElement());
    // Hint during the opponent's turn: zero marks appear.
    holdNotes([60, 61, 62]);
    rerender(makeElement());
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    holdNotes([]);
    rerender(makeElement());
    // Flush the ladder-fetch gate before advancing the think-time floor — see
    // the identical comment in R2 above.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Opponent mates; game over; record posts.
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS + 400); });
    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    // The record must not claim a hint that never displayed anything.
    expect(saveGameRecord.mock.calls[0][1].help.hints).toBe(0);
  });

  it('R4: a finished game reads its tallies back on the end screen, from the record that was saved', async () => {
    // White: Kg6, Rf1. Black: Kh8. Rf1-f8 is mate — one player move ends the game.
    const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
    saveGameRecord.mockClear();
    const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
      .pitch_classes.map((pc) => 60 + pc);
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />
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
    expect(record).toMatchObject({ result: 'win', moves: 1, help: { hints: 1, best_moves: 0, takebacks: 0 } });

    // The end screen must state the same facts the record keeps — one source,
    // so the two can never disagree. The tallies live on the result card now,
    // not in a rail list.
    const values = [...container.querySelectorAll('.chess-result__tally-value')]
      .map((el) => el.textContent);
    expect(values.slice(0, 4)).toEqual([
      String(record.moves), String(record.help.hints), String(record.help.best_moves), String(record.help.takebacks),
    ]);
    const labels = [...container.querySelectorAll('.chess-result__tally-label')]
      .map((el) => el.textContent.toLowerCase());
    // The clock is on by default, so the card carries a time as well. It is not
    // part of the saved record — the record holds the game, the clock holds the
    // pace — so it is asserted as present rather than compared against one.
    expect(labels.slice(0, 4)).toEqual(['moves', 'hints', 'best moves', 'takebacks']);
    expect(labels).toContain('your time');
    // Win, loss and draw used to differ only in wording.
    expect(container.querySelector('.chess-result--win')).toBeTruthy();
  });

  /**
   * A cluster is one request, however unevenly the fingers land.
   *
   * `recognizeGesture` reads 3 adjacent semitones as `hint`, 4 as `best` and 5
   * as `replay`, and nothing debounced the held set — so a four-key best press
   * that did not land perfectly flat passed through the three-key hint shape
   * on the way up and was charged a hint the child never asked for. The
   * five-key replay press was worse: it crossed BOTH the hint and the best
   * shapes, so "show me that again" fired an analysis request and voided the
   * game for promotion.
   */
  const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';

  const pressStaggered = async (notes, makeElement, rerender) => {
    // Land the keys one at a time, the way hands actually do.
    for (let i = 1; i <= notes.length; i += 1) {
      holdNotes(notes.slice(0, i));
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(15); });
    }
    // Then hold the complete cluster, well past any settle window.
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  };

  it('R5: a staggered four-key BEST press is not also charged a hint on the way up', async () => {
    saveGameRecord.mockClear();
    requestBestMove.mockResolvedValue(null); // the answer never arrives: no best charge either
    const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
      .pitch_classes.map((pc) => 60 + pc);
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />
    );
    const { rerender } = render(makeElement());
    const play = async (notes) => {
      holdNotes(notes);
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      holdNotes([]);
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    };

    await pressStaggered([60, 61, 62, 63], makeElement, rerender);
    await play(notesFor('f1'));
    await play(notesFor('f1'));
    await play(notesFor('f8')); // checkmate

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    // One request was made. Exactly one may be charged, and it is not a hint.
    expect(saveGameRecord.mock.calls[0][1].help.hints).toBe(0);
  });

  it('R6: a staggered five-key REPLAY press asks for no hint and no analysis', async () => {
    saveGameRecord.mockClear();
    requestBestMove.mockClear();
    requestBestMove.mockResolvedValue({ from: 'f1', to: 'f8' });
    const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
      .pitch_classes.map((pc) => 60 + pc);
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />
    );
    const { rerender } = render(makeElement());
    const play = async (notes) => {
      holdNotes(notes);
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      holdNotes([]);
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    };

    await pressStaggered([60, 61, 62, 63, 64], makeElement, rerender);
    // "Show me that again" must never reach the analysis engine.
    expect(requestBestMove).not.toHaveBeenCalled();

    await play(notesFor('f1'));
    await play(notesFor('f1'));
    await play(notesFor('f8')); // checkmate

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    const { help } = saveGameRecord.mock.calls[0][1];
    expect(help).toMatchObject({ hints: 0, best_moves: 0 });
  });
});

describe('arming: nothing may cost a child a round without telling them first', () => {
  /**
   * The retrospective half of this already shipped — the result card names the
   * rule that voided a win. But it names it AFTERWARDS, once the round is
   * already gone. These cover the half that speaks up in time.
   */
  const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    requestOpponentMove.mockReset();
    requestOpponentMove.mockResolvedValue(null);
    requestBestMove.mockReset();
    requestBestMove.mockResolvedValue({ from: 'f1', to: 'f8' });
    // A real policy: one free hint, no best moves, one takeback.
    fetchLadder.mockResolvedValue({
      roster: [{ level: 0, name: 'Caterpie' }, { level: 1, name: 'Weedle' }],
      available: [{ level: 0, name: 'Caterpie' }],
      current: { level: 0, name: 'Caterpie' },
      unlocked_through: 0,
      status: { level: 0, wins: 0, needed: 5, window: 7, promotes: false, at_top: false },
      standing: { round: 1, level: 0, counted: 0, practice: 0, gateWins: 0, gateNeeded: 5, gateWindow: 7, remaining: 5, promotes: false, atTop: false },
      policy: DEFAULT_LADDER_POLICY,
      persisted: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    fetchLadder.mockResolvedValue(null);
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  const makeGame = () => (
    <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />
  );

  const pressAndHold = async (notes, rerender) => {
    holdNotes(notes);
    rerender(makeGame());
    await act(async () => { await vi.advanceTimersByTimeAsync(GESTURE_SETTLE_MS + 60); });
    holdNotes([]);
    rerender(makeGame());
    await act(async () => { await vi.advanceTimersByTimeAsync(60); });
  };

  it('A1: the first BEST press warns instead of spending; the second goes through', async () => {
    const { rerender } = render(makeGame());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // ladder read lands

    await pressAndHold([60, 61, 62, 63], rerender);
    // max_best_moves is 0, so this press would demote. It must ask first.
    expect(requestBestMove).not.toHaveBeenCalled();

    await pressAndHold([60, 61, 62, 63], rerender);
    // Asked and answered: the second press is the confirmation.
    expect(requestBestMove).toHaveBeenCalledTimes(1);
  });

  it('A2: the FIRST hint is free and must not be made to feel expensive', async () => {
    const { container, rerender } = render(makeGame());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await pressAndHold([60, 61, 62], rerender);
    // max_hints is 1 — this one is inside the ceiling, so it happens at once.
    expect(container.querySelectorAll('.chess-board__square--hint').length).toBeGreaterThan(0);
  });

  it('A3: playing on is how you decline — a move disarms the warning', async () => {
    const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
      .pitch_classes.map((pc) => 60 + pc);
    const { rerender } = render(makeGame());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    await pressAndHold([60, 61, 62, 63], rerender);
    expect(requestBestMove).not.toHaveBeenCalled();

    // Change your mind and play chess instead: pick the rook up and mate.
    await pressAndHold(notesFor('f1'), rerender);
    await pressAndHold(notesFor('f1'), rerender);
    await pressAndHold(notesFor('f8'), rerender);

    // The arm did not survive the move, so nothing was ever spent.
    expect(requestBestMove).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(saveGameRecord).toHaveBeenCalled();
    const last = saveGameRecord.mock.calls[saveGameRecord.mock.calls.length - 1][1];
    expect(last.help).toMatchObject({ hints: 0, best_moves: 0 });
  });
});
