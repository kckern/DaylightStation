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
}));

import { PianoChessGame } from './PianoChessGame.jsx';
import { fetchChessConfig, requestOpponentMove, saveChessConfig } from './chessApi.js';
import { DEFAULT_CHORD_SCHEME } from './chordAddress.js';

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

describe('PianoChessGame legality cues', () => {
  it('does not outline the movable pieces before the player has got anything wrong', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelectorAll('.chess-board__square').length).toBe(64);
    expect(sourceOutlines(container)).toBe(0);
  });

  it('stays quiet even with the source cue explicitly enabled — the cue is gated on a refusal, not on config', () => {
    const { container } = render(<PianoChessGame feedback={{ highlightSources: true }} />);
    expect(sourceOutlines(container)).toBe(0);
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
    feedback: { hint_level: 'after-mistake', flash_rejected: true, toast: true },
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

  it('shows the legality cues without any refusal when the config says always', async () => {
    fetchChessConfig.mockResolvedValue({
      ...SERVED_CONFIG,
      feedback: { ...SERVED_CONFIG.feedback, hint_level: 'always' },
    });
    const { container } = render(<PianoChessGame />);
    await waitFor(() => expect(sourceOutlines(container)).toBeGreaterThan(0));
  });
});

// The read-out's own unit tests (ChordReadout.test.jsx) inject `settling` by
// hand, so they cannot catch a break in *this* component's wiring of it. Only
// an end-to-end render — a real held chord, ticking through the real 140ms
// settle window — can prove `cursorResolved` actually reaches the read-out.
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
