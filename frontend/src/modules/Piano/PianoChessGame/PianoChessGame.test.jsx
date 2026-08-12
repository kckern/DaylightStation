import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// vi.hoisted so the mock functions exist before the vi.mock factory below runs
// (vi.mock calls are hoisted above imports). Most describes never touch these —
// they get the defaults below — but the cursor-resolution wiring test needs a
// connected piano holding a real chord, so the mocks have to be overridable.
const { mockUsePianoMidi, mockUsePianoMidiNotes } = vi.hoisted(() => ({
  mockUsePianoMidi: vi.fn(() => ({ connected: false, status: 'disconnected' })),
  mockUsePianoMidiNotes: vi.fn(() => ({ activeNotes: new Map(), noteHistory: [] })),
}));

vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => mockUsePianoMidi(),
  usePianoMidiNotes: () => mockUsePianoMidiNotes(),
}));

// The opponent effect and the settings wiring both go through this client, not
// fetch directly, so mocking it is what lets the tests below drive the
// server-success / server-failure / unmount-cancellation / config paths
// without a network. fetchChessConfig must return a promise even at rest —
// the mount effect calls .then() on it unconditionally.
vi.mock('./chessApi.js', () => ({
  requestOpponentMove: vi.fn(),
  fetchChessConfig: vi.fn(async () => null),
  saveChessConfig: vi.fn(async () => null),
  saveGameRecord: vi.fn(async () => null),
}));

import { PianoChessGame } from './PianoChessGame.jsx';
import {
  fetchChessConfig, requestOpponentMove, saveChessConfig, saveGameRecord,
} from './chessApi.js';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';

const sourceOutlines = (container) => container.querySelectorAll('.chess-board__square--source').length;

describe('PianoChessGame chrome', () => {
  it('has no header of its own — the kiosk breadcrumb rail names the screen', () => {
    const { container } = render(<PianoChessGame onDeactivate={() => {}} />);
    expect(container.querySelector('.piano-chess__header')).toBeNull();
    expect(container.querySelector('.piano-chess__wordmark')).toBeNull();
  });

  it('carries the way back in the shared context rail instead of a Leave button', () => {
    const onDeactivate = vi.fn();
    const { container } = render(<PianoChessGame onDeactivate={onDeactivate} />);
    const rail = container.querySelector('.psc-rail');
    expect(rail).not.toBeNull();
    expect(rail.textContent).toContain('Games');
    expect(rail.textContent).toContain('Piano Chess');
    screen.getByText('▸ Games').click();
    expect(onDeactivate).toHaveBeenCalled();
  });
});

describe('help is asked for, never volunteered', () => {
  it('shows no hint marks on a fresh board', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelectorAll('.chess-board__square').length).toBe(64);
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    expect(sourceOutlines(container)).toBe(0);
  });

  it('stays quiet even when the old force-on seam is used — the auto-reveal is gone, not reconfigured', () => {
    // `feedback` was the test seam that forced legality cues on. After this task
    // it can no longer produce a mark, because marks are a gesture channel.
    const { container } = render(<PianoChessGame feedback={{ highlightSources: true, highlightTargets: true }} />);
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
    expect(sourceOutlines(container)).toBe(0);
  });
});

describe('the instrument zone', () => {
  it('names what was played even when it is not a square', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelector('.piano-chord-name')).not.toBeNull();
  });

  it('keeps no left rail', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelector('.piano-chess__rail--move')).toBeNull();
  });
});

// The opponent effect is the actual deliverable of the server-engine wiring:
// server-first, local-engine fallback, unmount cancellation, and correct
// request threading. All of it lives inside one effect, so it has to be
// exercised at the component level — unit tests on chessApi.js or commitMove
// in isolation can't catch a regression in the wiring itself.
//
// playerColor="b" is used throughout so the opponent (White) replies on mount
// without needing a simulated player move first — White is on move from the
// initial position, and the human is Black.
describe('PianoChessGame opponent effect', () => {
  const OPPONENT_DELAY_MS = 700;
  const moveSans = (container) => [...container.querySelectorAll('.piano-chess__move-san')].map((el) => el.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays the server-supplied reply once the opponent delay elapses', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    expect(moveSans(container)).toEqual(['e4']);
  });

  it('falls back to the bundled engine so a move still lands when the server has none', async () => {
    // chessApi.js (unit-tested separately) never rejects in production — on any
    // transport failure it catches and resolves null, which is the contract this
    // effect is written against. A resolved null is the faithful failure shape
    // to mock here, not a rejection the effect was never meant to catch.
    requestOpponentMove.mockResolvedValueOnce(null);
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    // The server produced nothing, yet a move landed — the only path that can
    // commit one here is the bundled `chooseMove` fallback.
    expect(moveSans(container).length).toBe(1);
    expect(moveSans(container)[0]).not.toBe('');
  });

  it('does not run the reply after unmount once a stale request resolves', async () => {
    // React 18 dropped the "state update on an unmounted component" console
    // warning, so a console.error spy can't tell a working `cancelled` guard
    // from a broken one — both look silent. `setGame` and the `opponent-replied`
    // log sit on consecutive lines in the effect, both gated by the same
    // `if (cancelled || !reply) return;`, and the logger's console transport
    // for 'info' goes through console.log (see Logger.js `devOutput`), so
    // spying there is a proxy for "did the post-unmount branch actually run."
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let resolveMove;
    requestOpponentMove.mockImplementationOnce(() => new Promise((resolve) => { resolveMove = resolve; }));

    const { unmount } = render(<PianoChessGame playerColor="b" seed={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });
    expect(requestOpponentMove).toHaveBeenCalledTimes(1);

    unmount();

    // Resolve the in-flight request only after the component is gone.
    await act(async () => {
      resolveMove({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
      await Promise.resolve();
    });

    const repliedAfterUnmount = logSpy.mock.calls.some(
      ([message]) => typeof message === 'string' && message.includes('opponent-replied'),
    );
    expect(repliedAfterUnmount).toBe(false);
  });

  it('threads the active rung, a per-game id, and no userId for a guest', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    render(<PianoChessGame playerColor="b" seed={1} currentUser="guest" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledWith(expect.objectContaining({
      rung: 'learner',
      gameId: expect.stringMatching(/^chess-\d+$/),
      userId: null,
    }));
  });
});

// The settings wiring is where Task 7's promises are kept: the config loads on
// mount, the active rung drives the rail badge, a tapped setting applies
// immediately, and only a persistent user's tap reaches the save endpoint.
// Component-level because the seam under test IS the wiring between the panel,
// the config state, and the API client.
describe('PianoChessGame settings wiring', () => {
  const SERVED_CONFIG = {
    default_rung: 'steady',
    rungs: [
      { id: 'first-moves', label: 'First moves', skill: 0, movetime_ms: 100 },
      { id: 'learner', label: 'Learner', skill: 3, movetime_ms: 200 },
      { id: 'steady', label: 'Steady', skill: 8, movetime_ms: 300 },
    ],
    opponent_delay_ms: 700,
    shuffle_each_turn: true,
    feedback: { flash_rejected: true, toast: true },
  };
  const railBadge = (container) => container.querySelector('.piano-chess__difficulty').textContent;

  beforeEach(() => {
    fetchChessConfig.mockResolvedValue(SERVED_CONFIG);
    saveChessConfig.mockClear();
  });

  afterEach(() => {
    fetchChessConfig.mockImplementation(async () => null);
  });

  it('loads the config on mount and shows the active rung in the rail badge', async () => {
    const { container } = render(<PianoChessGame />);
    await waitFor(() => expect(railBadge(container)).toBe('Steady'));
    expect(fetchChessConfig).toHaveBeenCalledWith(null);
  });

  it('applies a tapped rung immediately and saves it to the player\'s own layer', async () => {
    const { container } = render(<PianoChessGame currentUser="kckern" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Learner' }));
    expect(railBadge(container)).toBe('Learner');
    expect(saveChessConfig).toHaveBeenCalledWith('kckern', { default_rung: 'learner' });
    expect(fetchChessConfig).toHaveBeenCalledWith('kckern');
  });

  it('never saves for a guest, though the change still applies for the session', async () => {
    const { container } = render(<PianoChessGame currentUser="guest" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Learner' }));
    expect(railBadge(container)).toBe('Learner');
    expect(saveChessConfig).not.toHaveBeenCalled();
    expect(fetchChessConfig).toHaveBeenCalledWith(null);
  });

  it('honours a saved shuffle_each_turn:false from the first game — the initial deal is not shuffled', async () => {
    // The game state is created in a useState initializer, before the config
    // can possibly resolve — so without the config-load re-deal, the first
    // game's state captures the prop fallback (shuffle on) and the board
    // silently re-deals every turn while the notice (driven by the loaded
    // config) hides. The base scheme's ordered roots on the file axis are the
    // observable proof of which value is actually in force: shuffled deals are
    // seed-permuted and do not match.
    fetchChessConfig.mockResolvedValue({ ...SERVED_CONFIG, shuffle_each_turn: false });
    const { container } = render(<PianoChessGame seed={1} />);
    // The re-deal notice disappearing proves the config has been applied...
    await waitFor(() => expect(container.querySelector('.piano-chess__redeal')).toBeNull());
    // ...and the file axis must then be the unshuffled base scheme — the deal
    // in force, not just the label.
    const fileAxis = [...container.querySelectorAll('.chess-board__file-axis .chess-board__axis-label')]
      .map((el) => el.textContent);
    expect(fileAxis).toEqual([...DEFAULT_CHORD_SCHEME.roots]);
  });

  it('shows a human label, never the raw rung id, before the config resolves', () => {
    fetchChessConfig.mockImplementation(async () => null);
    const { container } = render(<PianoChessGame />);
    expect(railBadge(container)).toBe('Learner');
  });

  it('ignores a stale hint_level in a saved override — it selects behaviour that no longer exists', async () => {
    fetchChessConfig.mockResolvedValue({
      ...SERVED_CONFIG,
      feedback: { ...SERVED_CONFIG.feedback, hint_level: 'always' },
    });
    const { container } = render(<PianoChessGame />);
    await waitFor(() => expect(railBadge(container)).toBe('Steady'));
    expect(sourceOutlines(container)).toBe(0);
    expect(container.querySelectorAll('.chess-board__square--hint')).toHaveLength(0);
  });
});

// The read-out's own unit tests (ChordReadout.test.jsx) inject `settling` by
// hand, so they cannot catch a break in *this* component's wiring of it. Only
// an end-to-end render — a real held set reaching the real narrowing — can
// prove the candidate count actually drives the read-out's verdict.
describe('PianoChessGame chord read-out wiring', () => {
  // [60, 61, 62] is three adjacent semitones — no root/quality pair in the
  // default scheme (major, minor, sus4, add2, seventh, add6, major7,
  // diminished) produces a pitch-class cluster that tight, so it settles to a
  // definite "no square" rather than a lucky match.
  const UNMAPPABLE_CHORD = new Map([[60, {}], [61, {}], [62, {}]]);

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: UNMAPPABLE_CHORD, noteHistory: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('reaches "not a square" once a held chord settles and fails to map to any square', async () => {
    render(<PianoChessGame />);
    // 140ms settle window plus headroom for a couple of 25ms ticks either side.
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByText(/not a square/i)).toBeTruthy();
  });
});

// The hint gestures are the ONLY way marks reach the board, so the wiring from
// a held cluster to the marks channel is what these exercise. The recogniser
// itself is unit-tested in chordGestures.test.js; here the question is whether
// the component arms the help state, asks the server at full strength, and
// never mistakes a gesture for chord input.
describe('hint gestures', () => {
  const HINT_CLUSTER = new Map([[60, {}], [61, {}], [62, {}]]);
  const BEST_CLUSTER = new Map([[60, {}], [61, {}], [62, {}], [63, {}]]);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({ activeNotes: notes, noteHistory: [] });

  beforeEach(() => {
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('a held three-semitone cluster marks the movable pieces', () => {
    holdNotes(HINT_CLUSTER);
    const { container } = render(<PianoChessGame />);
    // No piece is held yet, so "show legal moves" means "which pieces can move".
    expect(container.querySelectorAll('.chess-board__square--hint').length).toBeGreaterThan(0);
  });

  it('a four-semitone cluster asks the server at full strength and rings the best move', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'g1', to: 'f3', san: 'Nf3', engine: 'stockfish' });
    holdNotes(BEST_CLUSTER);
    const { container } = render(<PianoChessGame />);
    expect(requestOpponentMove).toHaveBeenCalledWith(expect.objectContaining({ rung: 'ruthless' }));
    await waitFor(() => expect(container.querySelectorAll('.chess-board__square--best')).toHaveLength(2));
  });

  it('a released gesture is never chord input — no refusal appears, and the marks persist', async () => {
    vi.useFakeTimers();
    try {
      holdNotes(HINT_CLUSTER);
      const { container, rerender } = render(<PianoChessGame />);
      // Past the settle window, so the cursor has read the cluster...
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      // ...and now the hands come off. A cluster is a request, not a chord, so
      // its release must not reach the game as an unrecognised-chord refusal.
      holdNotes(new Map());
      rerender(<PianoChessGame />);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      // The refusal would surface twice (toast + prompt line), so query them all.
      expect(screen.queryAllByText(/not on the board/i)).toHaveLength(0);
      expect(container.querySelectorAll('.chess-board__square--hint').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// The record effect is wiring, not arithmetic — buildGameRecord is unit-tested
// in chessGameRecord.test.js. What only a component render can prove is that a
// finished game posts exactly once, to the signed-in player, with the tallies.
describe('the game record', () => {
  // White: Kg6, Rf1. Black: Kh8. Rf1-f8 is mate — one player move ends the game.
  const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    saveGameRecord.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('posts one record for the signed-in player when the game ends', async () => {
    // A FRESH element per render: reusing one element object makes React bail
    // out on identical props, so the changed note mock would never be re-read.
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ shuffle_each_turn: false }} />
    );
    const { rerender } = render(makeElement());

    const play = async (notes) => {
      mockUsePianoMidiNotes.mockReturnValue({
        activeNotes: new Map(notes.map((note) => [note, { velocity: 80 }])),
        noteHistory: [],
      });
      rerender(makeElement());
      // Hold through the 140ms settle window, then release cleanly.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
      rerender(makeElement());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    };

    await play(notesFor('f1')); // lift the rook
    await play(notesFor('f8')); // land it — checkmate

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    expect(saveGameRecord).toHaveBeenCalledWith('kckern', expect.objectContaining({
      result: 'win',
      outcome: 'checkmate',
      moves: 1,
      hints: 0,
      best_moves: 0,
    }));
  });
});
