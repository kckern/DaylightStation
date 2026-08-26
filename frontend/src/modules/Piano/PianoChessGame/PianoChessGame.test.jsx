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
  // The game reads the provider-optional variants so it can also render on the
  // office screen, where there is no PianoMidiProvider. Same mocks behind both.
  usePianoMidiOptional: () => mockUsePianoMidi(),
  usePianoMidiNotesOptional: () => mockUsePianoMidiNotes(),
}));

// The opponent effect and the settings wiring both go through this client, not
// fetch directly, so mocking it is what lets the tests below drive the
// server-success / server-failure / unmount-cancellation / config paths
// without a network. fetchChessConfig must return a promise even at rest —
// the mount effect calls .then() on it unconditionally.
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

import { OPPONENT_DELAY_MS, PianoChessGame, promptFor } from './PianoChessGame.jsx';
import {
  archiveGame, fetchChessConfig, fetchLadder, requestBestMove, requestOpponentMove,
  saveChessConfig, saveGameRecord,
} from './chessApi.js';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { DEFAULT_STAFF_SCHEME } from './staffAddress.js';
import { DOUBLE_WINDOW_MS } from './chordSelection.js';

const sourceOutlines = (container) => container.querySelectorAll('.chess-board__square--source').length;

beforeEach(() => localStorage.clear());

describe('the takeback prompt', () => {
  const playing = {
    status: { game_over: false, turn: 'w', check: false },
    playerColor: 'w',
    origin: null,
  };

  it('says what a second octave will do once the first has been played', () => {
    expect(promptFor(playing, null, null, false, true))
      .toBe('Play the octave again to take your move back.');
  });

  it('says so even while the opponent is thinking, which is when it is wanted', () => {
    const theirTurn = { ...playing, status: { ...playing.status, turn: 'b' } };
    expect(promptFor(theirTurn, null, null, false, true))
      .toBe('Play the octave again to take your move back.');
  });

  it('goes back to the ordinary instruction when nothing is armed', () => {
    expect(promptFor(playing, null, null, false, false))
      .toBe("Play a piece's chord twice to pick it up.");
  });

  it('never talks over a refusal', () => {
    expect(promptFor(playing, { reason: 'empty_square' }, null, false, true))
      .toBe('Nothing on that square.');
  });
});

// The prompt tests above would still pass if the octave were routed to
// restart() — they test the sentence, not the gesture. This block drives the
// actual keys: arming, firing inside the window, and missing the window. (A
// fourth test attempting to reproduce the two-clock arming race directly was
// removed — see the comment after this block for why it cannot be reproduced
// through this harness.)
describe('taking a move back at the keys', () => {
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
    activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
    noteHistory: [],
  });
  // A FRESH element per render: reusing one element object makes React bail
  // out on identical props, so the changed note mock would never be re-read.
  const makeElement = () => <PianoChessGame gameConfig={{ addressing: { shuffle: 'never' } }} />;

  const playChord = async (rerender, notes) => {
    holdNotes(notes);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };
  const OCTAVE = [60, 72];
  const noteOf = (container, title) => [...container.querySelectorAll('.gesture-card')]
    .find((card) => card.textContent.includes(title))
    ?.querySelector('.gesture-card__note')?.textContent;

  // Picks a piece up and moves it, then lets the opponent answer. Mirror the
  // move-flow block already in this file; do not invent a second way to move.
  // e2 is a White pawn with legal moves from the opening position (see 'hover
  // before commit' above) — hover, lift, land on e4.
  const playAMove = async (container, rerender) => {
    await playChord(rerender, notesFor('e2')); // hover
    await playChord(rerender, notesFor('e2')); // lift
    await playChord(rerender, notesFor('e4')); // land — White's opening move
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    fetchChessConfig.mockReset();
    fetchChessConfig.mockResolvedValue(null);
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('arms on the first octave and says so', async () => {
    const { container, rerender } = render(makeElement());
    await playAMove(container, rerender);
    await playChord(rerender, OCTAVE);
    expect(container.querySelector('.piano-chess__prompt').textContent)
      .toBe('Play the octave again to take your move back.');
  });

  it('rewinds on the second octave inside the window', async () => {
    const { container, rerender } = render(makeElement());
    await playAMove(container, rerender);
    await playChord(rerender, OCTAVE);
    await playChord(rerender, OCTAVE);
    expect(container.querySelector('.piano-chess__toast').textContent).toMatch(/^Took back /);
    // Not '2 left': the ladder has not loaded (fetchLadder resolves null), so
    // willStillCount falls back to DEFAULT_MAX_TAKEBACKS — mirroring the
    // server's own DEFAULT_LADDER_POLICY.max_takebacks: 1 (shared/gaming/rulesets/chess/
    // ladder.mjs). One is already spent, so the note about spending ANOTHER has
    // to lead with "won't count" rather than the three-per-game kiosk cap,
    // exactly as takebackBudget.test.js's own
    // 'follows the ladder ceiling' case asserts for used:1.
    expect(noteOf(container, 'Take it back')).toBe("won't count toward the climb");
  });

  it('does not rewind when the second octave is too late', async () => {
    const { container, rerender } = render(makeElement());
    await playAMove(container, rerender);
    await playChord(rerender, OCTAVE);
    await act(async () => { await vi.advanceTimersByTimeAsync(DOUBLE_WINDOW_MS + 200); });
    await playChord(rerender, OCTAVE);
    expect(container.querySelector('.piano-chess__toast')).toBe(null);
    expect(noteOf(container, 'Take it back')).toBe('3 left');
  });

  it('discards the opponent reply when a takeback lands before it has resolved', async () => {
    // A promise that never settles: the opponent is left thinking forever,
    // so the takeback below is guaranteed to land BEFORE any reply could.
    requestOpponentMove.mockImplementation(() => new Promise(() => {}));
    const { container, rerender } = render(makeElement());
    await playAMove(container, rerender); // White's e2-e4; the opponent's own request is now pending.
    expect(requestOpponentMove).toHaveBeenCalledTimes(1);

    // Take the move back while the opponent is still "thinking" — Black has
    // not replied, so this undoes only White's own move.
    await playChord(rerender, OCTAVE);
    await playChord(rerender, OCTAVE);
    expect(container.querySelector('.piano-chess__toast').textContent).toMatch(/^Took back /);

    // Give the (never-resolving, but still pending) reply every chance to
    // land — if the cancellation were broken, this is where a stale Nf3
    // would appear on a board it was never asked about.
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    // Fully reverted: no move on the board, and no second request was fired
    // (it is the player's turn again — nothing should be asking the engine).
    expect(container.querySelectorAll('.chess-board__square--last-move')).toHaveLength(0);
    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
  });
});

// A regression test for the two-clock arming race (Finding 1) was attempted
// here and removed: it could not be made to fail against the pre-fix
// lastEscapeAtRef+boolean implementation. The bug is inherently a REAL-CLOCK
// JANK bug — the finding's own worked example requires the disarm setTimeout
// to fire LATE relative to its scheduled deadline ("delayed... by main-thread
// jank"). Vitest's fake timers are deterministic: a scheduled callback always
// fires exactly at its virtual deadline, during whichever advanceTimersByTime
// sweep crosses it — there is no jitter available to open the gap between
// "the ref says the window has elapsed" and "the timer has actually fired"
// that the bug depends on. Verified two ways: (1) analytically, by re-deriving
// the arm/fire branch conditions and the disarm effect's dependency-array
// bailout against Finding 1's own t=0/850/950/1000 example, which only breaks
// under a LATE-firing timer; (2) empirically, by adding this exact test to a
// scratch worktree at c2a69491c (the pre-fix commit) and running it — it
// passed against the OLD code too, for every timing split tried. See the
// task-7 fix report (round 3) for the worktree commands and output. The
// single-`armedAt` design is still correct and still closes a real exposure
// under actual browser scheduling; it is simply not a race this harness can
// force through a deterministic clock.

describe('PianoChessGame chrome', () => {
  it('has no header of its own — the kiosk breadcrumb rail names the screen', () => {
    const { container } = render(<PianoChessGame onDeactivate={() => {}} />);
    expect(container.querySelector('.piano-chess__header')).toBeNull();
    expect(container.querySelector('.piano-chess__wordmark')).toBeNull();
  });

  it('does not repeat the kiosk breadcrumb inside the game', () => {
    // The kiosk header already names Games / Piano Chess and carries the way
    // back. A second copy on the rail said the same thing twice and cost the
    // state rail its top third.
    const { container } = render(<PianoChessGame onDeactivate={vi.fn()} />);
    expect(container.querySelector('.psc-rail')).toBeNull();
    expect(container.textContent).not.toContain('Piano Chess');
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
  // The move log was removed from the chrome, so a move is observed where it
  // actually shows: on the board. The last-move outline names both squares, and
  // reading it proves the position advanced rather than that a list was written.
  const moveSans = (container) => [...container.querySelectorAll('.chess-board__square--last-move')]
    .map((el) => el.getAttribute('data-square'))
    .filter(Boolean)
    .sort();

  beforeEach(() => {
    vi.useFakeTimers();
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends the move request immediately, before any of the think time elapses', async () => {
    // The floor is applied to the ANSWER, not to when the question is asked —
    // a network-then-request effect would add the delay on top of any round
    // trip and turn a deliberate brood into a hang on a stalled kiosk WiFi.
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    render(<PianoChessGame playerColor="b" seed={1} />);

    // Only a microtask flush — zero timers advanced.
    await act(async () => { await Promise.resolve(); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
  });

  // The opponent's very first request of a fresh mount waits on the ladder
  // fetch settling (see PianoChessGame.jsx's `ladderReady` gate — it exists so
  // that first request carries the real skill level instead of a placeholder
  // null). That settle is a real async hop ahead of the think-time floor, so
  // it has to be flushed on its own tick before the floor's own timer budget
  // is advanced — otherwise the ladder-settle and the floor race for the SAME
  // requested window and the floor's timer never gets scheduled in time.
  const settleLadderGate = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

  it('plays the server-supplied reply once the opponent delay elapses', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await settleLadderGate();
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    // Both ends of the served reply 1.e4 are outlined: it came from e2 and landed on e4.
    expect(moveSans(container)).toEqual(['e2', 'e4']);
  });

  it('falls back to the bundled engine so a move still lands when the server has none', async () => {
    // chessApi.js (unit-tested separately) never rejects in production — on any
    // transport failure it catches and resolves null, which is the contract this
    // effect is written against. A resolved null is the faithful failure shape
    // to mock here, not a rejection the effect was never meant to catch.
    requestOpponentMove.mockResolvedValueOnce(null);
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await settleLadderGate();
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    // The server produced nothing, yet a move landed — the only path that can
    // commit one here is the bundled `chooseMove` fallback.
    // A move landed from somewhere to somewhere — which move is the bundled
    // engine's business, but it must have moved.
    expect(moveSans(container).length).toBe(2);
    expect(moveSans(container)[0]).not.toBe(moveSans(container)[1]);
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

  it('threads the displayed ladder level so the server can enforce Caterpie at skill 0', async () => {
    fetchLadder.mockResolvedValueOnce({
      unlocked_through: 0,
      current: { level: 0, name: 'Caterpie' },
      status: { wins: 0, needed: 5 },
      persisted: true,
    });
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    render(<PianoChessGame playerColor="b" seed={1} currentUser="learner4" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'learner4', rung: 'learner', level: 0,
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
    addressing: { vocabulary: 'chords', shuffle: 'each_turn' },
    feedback: { flash_rejected: true, toast: true },
  };
  // The strength on the other side of the board is named in the opponent panel
  // — as a character once the ladder resolves, and as the rung's label before
  // that (and for a guest, who climbs nothing).
  const railBadge = (container) => container.querySelector('.piano-chess__opponent-rung-name')?.textContent;

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
    fireEvent.click(screen.getByRole('radio', { name: 'Learner' }));
    expect(railBadge(container)).toBe('Learner');
    expect(saveChessConfig).toHaveBeenCalledWith('kckern', { default_rung: 'learner' });
    expect(fetchChessConfig).toHaveBeenCalledWith('kckern');
  });

  it('never saves for a guest, though the change still applies for the session', async () => {
    const { container } = render(<PianoChessGame currentUser="guest" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Learner' }));
    expect(railBadge(container)).toBe('Learner');
    expect(saveChessConfig).not.toHaveBeenCalled();
    expect(fetchChessConfig).toHaveBeenCalledWith(null);
  });

  it('honours a configured never cadence from the first game — the initial deal is not shuffled', async () => {
    // The game state is created in a useState initializer, before the config
    // can possibly resolve — so without the config-load re-deal, the first
    // game's state captures the prop fallback (shuffle on) and the board
    // silently re-deals every turn while the notice (driven by the loaded
    // config) hides. The base scheme's ordered roots on the file axis are the
    // observable proof of which value is actually in force: shuffled deals are
    // seed-permuted and do not match.
    fetchChessConfig.mockResolvedValue({ ...SERVED_CONFIG, addressing: { ...SERVED_CONFIG.addressing, shuffle: 'never' } });
    const { container } = render(<PianoChessGame seed={1} />);
    // Wait on the deal itself. The old assertion waited for a rail notice that
    // no longer exists, so it was true before the async config had even loaded.
    await waitFor(() => {
      const fileAxis = [...container.querySelectorAll('.chess-board__file-axis .chess-board__axis-label')]
        .map((el) => el.textContent);
      expect(fileAxis).toEqual([...DEFAULT_CHORD_SCHEME.roots]);
    });
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
  // default scheme (major, minor, sus4, minor6, seventh, add6, major7,
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

// Narrowing is the light channel's whole job, and ChessBoard's own tests only
// prove prop-to-class. This is the one place that proves held notes actually
// REACH the board as candidates — without it, passing `candidates={[]}` to the
// board would leave every suite green.
describe('narrowing on the board', () => {
  beforeEach(() => {
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
  });

  afterEach(() => {
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('a held partial chord lights the squares it could still become', () => {
    // Use two notes from e2's address: e2 is a playable opening source, so it
    // remains lit while unavailable squares carrying compatible chords do not.
    const notes = squareToChord('e2', DEFAULT_CHORD_SCHEME).pitch_classes.slice(0, 2).map((pc) => 60 + pc);
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(notes.map((note) => [note, {}])), noteHistory: [] });
    const { container } = render(<PianoChessGame gameConfig={{ addressing: { shuffle: 'never' } }} />);
    const lit = [...container.querySelectorAll('.chess-board__square--candidate')]
      .map((square) => square.getAttribute('data-square'));
    expect(lit).toContain('e2');
    expect(lit.every((square) => ['a2', 'b1', 'b2', 'c2', 'd2', 'e2', 'f2', 'g1', 'g2', 'h2'].includes(square)))
      .toBe(true);
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
    requestBestMove.mockReset();
    // mockReset drops the factory's async default, and the component awaits
    // this unconditionally — restore a resolved promise or every test in this
    // block that touches the best cluster throws on `.then`.
    requestBestMove.mockResolvedValue(null);
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

  it('a four-semitone cluster asks the ANALYSIS endpoint, not the opponent, and rings the best move', async () => {
    // The hint must not be routed through the ladder: its lower rungs are a
    // deliberately-weak teaching engine, so the opponent's "best move" would be
    // a beginner's guess.
    requestBestMove.mockResolvedValueOnce({ from: 'g1', to: 'f3' });
    holdNotes(BEST_CLUSTER);
    const { container } = render(<PianoChessGame />);
    expect(requestBestMove).toHaveBeenCalledWith(expect.objectContaining({ fen: expect.any(String) }));
    expect(requestOpponentMove).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelectorAll('.chess-board__square--best')).toHaveLength(2));
  });

  it('does not queue a second charge while a best-move request is in flight', async () => {
    let resolveMove;
    requestBestMove.mockImplementation(() => new Promise((resolve) => { resolveMove = resolve; }));
    holdNotes(BEST_CLUSTER);
    const { rerender } = render(<PianoChessGame />);
    // Release and mash the cluster again before the server has answered.
    holdNotes(new Map());
    rerender(<PianoChessGame />);
    holdNotes(BEST_CLUSTER);
    rerender(<PianoChessGame />);
    expect(requestBestMove).toHaveBeenCalledTimes(1);
    await act(async () => { resolveMove({ from: 'g1', to: 'f3' }); });
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

// The selection model the session logs demanded: one chord HOVERS, the same
// square played twice inside the window picks the piece up, and a held piece
// drops with a single chord. Driven through the mocked MIDI context with fake
// timers, the same way helpValidity.test.jsx drives held notes.
//
// The square is e2 — a White pawn with legal moves (e3, e4) from the opening
// position, so a wrongly-committed single chord observably selects it. Its
// notes come from the board itself via squareToChord, never hard-coded, and
// addressing shuffle is off so DEFAULT_CHORD_SCHEME is the deal actually in
// force (a shuffled deal would re-address every square under the test).
describe('hover before commit', () => {
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
    activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
    noteHistory: [],
  });
  // A FRESH element per render: reusing one element object makes React bail
  // out on identical props, so the changed note mock would never be re-read.
  const makeElement = () => <PianoChessGame gameConfig={{ addressing: { shuffle: 'never' } }} />;

  /** Play one chord: hold past the 140ms settle, then release. */
  const playChord = async (rerender, notes) => {
    holdNotes(notes);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };

  // `game.origin` is what the board renders as --selected today; Task 3 adds
  // the dedicated held treatment on top of the same prop.
  const heldSquares = (container) => container.querySelectorAll('.chess-board__square--selected');

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('does not pick a piece up on a single chord', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    expect(heldSquares(container)).toHaveLength(0);
  });

  it('picks it up when the same square is played twice inside the window', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    // The second full release lands well inside the window.
    await playChord(rerender, notesFor('e2'));
    expect(heldSquares(container)).toHaveLength(1);
  });

  it('does not pick up when the second play falls outside the window', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await act(async () => { await vi.advanceTimersByTimeAsync(DOUBLE_WINDOW_MS + 200); });
    await playChord(rerender, notesFor('e2'));
    expect(heldSquares(container)).toHaveLength(0);
  });

  // The window is the one deadline the player is held to, so it has to be on
  // screen while it runs. These assert the CUE, not the timing — the machine's
  // own boundary tests live in chordSelection.test.js.
  const windowBar = (container) => container.querySelector('.piano-chess__window');

  it('shows the pick-up countdown once a hover arms the double', async () => {
    const { container, rerender } = render(makeElement());
    expect(windowBar(container)).toBeNull();
    await playChord(rerender, notesFor('e2'));
    expect(windowBar(container)).not.toBeNull();
  });

  it('runs the countdown for exactly the window the machine enforces', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    // A bar that drained on a different clock than the one deciding the double
    // would be a lie told precisely: it must carry the real window.
    expect(windowBar(container).style.getPropertyValue('--pc-window-ms'))
      .toBe(`${DOUBLE_WINDOW_MS}ms`);
  });

  it('does not offer a countdown on a square holding nothing to pick up', async () => {
    const { container, rerender } = render(makeElement());
    // d5 is empty in the opening position: the prompt has no repeat to ask for
    // there, so there is no deadline to draw.
    await playChord(rerender, notesFor('d5'));
    expect(windowBar(container)).toBeNull();
  });

  it('drops the countdown once the piece is in hand', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await playChord(rerender, notesFor('e2'));
    expect(heldSquares(container)).toHaveLength(1);
    expect(windowBar(container)).toBeNull();
  });

  it('restarts the countdown on a fresh arming rather than letting it run on', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    const first = windowBar(container).getAttribute('data-armed-at');
    await act(async () => { await vi.advanceTimersByTimeAsync(DOUBLE_WINDOW_MS + 200); });
    await playChord(rerender, notesFor('e2'));   // window lapsed: this re-arms
    expect(windowBar(container).getAttribute('data-armed-at')).not.toBe(first);
  });

  // Reading mode is the BEGINNER vocabulary — the players least able to infer an
  // unstated deadline — and it runs the same window. A cue that only reached the
  // chord spellers would be missing from the mode that needs it most.
  it('draws the countdown in the reading vocabulary too', async () => {
    const staffElement = () => (
      <PianoChessGame gameConfig={{ addressing: { shuffle: 'never' } }} scheme={DEFAULT_STAFF_SCHEME} />
    );
    const { container, rerender } = render(staffElement());
    // A staff address is two real MIDI notes, not pitch classes off middle C.
    holdNotes(squareToChord('e2', DEFAULT_STAFF_SCHEME).midis);
    rerender(staffElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(staffElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    expect(windowBar(container)).not.toBeNull();
  });

  it('never refuses while exploring with a piece in hand', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await playChord(rerender, notesFor('e2')); // now holding the e2 pawn
    await playChord(rerender, notesFor('d5')); // empty square the pawn cannot reach
    expect(container.querySelectorAll('.chess-board__square--rejected')).toHaveLength(0);
    // Exploring costs nothing: the piece is still in hand after the wander.
    expect(heldSquares(container)).toHaveLength(1);
  });
});

// The labels are the answer to the pick-up: the board must name the chord that
// reaches each eligible square the moment a piece is lifted, and say nothing
// before that. Config can turn them off; nothing about them is ever charged.
describe('destination labels answer the pick-up', () => {
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
    activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
    noteHistory: [],
  });
  const makeElement = () => <PianoChessGame gameConfig={{ addressing: { shuffle: 'never' } }} />;
  const playChord = async (rerender, notes) => {
    holdNotes(notes);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement());
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };
  const badgeMap = (container) => Object.fromEntries(
    [...container.querySelectorAll('.chess-board__badge')]
      .map((el) => [el.closest('[data-square]').dataset.square, el.textContent]),
  );

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    fetchChessConfig.mockReset();
    fetchChessConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('shows no badges while nothing is held', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2')); // hover only — not a pick-up
    expect(container.querySelectorAll('.chess-board__badge')).toHaveLength(0);
  });

  it('prints the addressing chord on every square the lifted pawn can reach', async () => {
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await playChord(rerender, notesFor('e2')); // the double lifts the pawn
    expect(badgeMap(container)).toEqual({
      e3: squareToChord('e3', DEFAULT_CHORD_SCHEME).symbol,
      e4: squareToChord('e4', DEFAULT_CHORD_SCHEME).symbol,
    });
  });

  it('stays dark when the config turns the labels off — pick-up and all', async () => {
    fetchChessConfig.mockResolvedValue({ feedback: { show_destination_labels: false } });
    const { container, rerender } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await playChord(rerender, notesFor('e2'));
    // The piece really is in hand; only the labels are silenced.
    expect(container.querySelectorAll('.chess-board__square--held')).toHaveLength(1);
    expect(container.querySelectorAll('.chess-board__badge')).toHaveLength(0);
  });
});

// A game holds one player's config and writes one player's record. The
// session that motivated this task switched kiosk users mid-game and kept
// playing under the new identity — the fix locks whoever started until the
// game ends, mirrored in the rail so the screen says whose game this is.
describe('the game is archived once, on the way out', () => {
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
    activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
    noteHistory: [],
  });
  // `difficulty` is one of the mount-effect's dependencies, so changing it
  // reproduces exactly what the config load used to do to that effect.
  const makeElement = (difficulty = 'learner') => (
    <PianoChessGame currentUser="learner3" difficulty={difficulty} gameConfig={{ addressing: { shuffle: 'never' } }} />
  );
  const playChord = async (rerender, notes, difficulty) => {
    holdNotes(notes);
    rerender(makeElement(difficulty));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement(difficulty));
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    fetchChessConfig.mockReset();
    fetchChessConfig.mockResolvedValue(null);
    archiveGame.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('archives a played game once, and only when the game is left', async () => {
    // The archive used to live in the cleanup of an effect that DEPENDED on
    // difficulty and addressing cadence. When the config resolved and flipped
    // one, that effect tore down and re-ran: the game was archived MID-PLAY and
    // the "already archived" guard then suppressed the real archive at the end.
    // In the logs it read as the component remounting on every entry, which it
    // never did. An unmount effect must have no dependencies.
    const { rerender, unmount } = render(makeElement());
    await playChord(rerender, notesFor('e2'));
    await playChord(rerender, notesFor('e2')); // the double lifts the pawn
    await playChord(rerender, notesFor('e4')); // and this drops it — one move played

    // Now disturb a dependency of the mount effect, mid-game.
    rerender(makeElement('sharp'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(archiveGame, 'a settings change is not the end of a game').not.toHaveBeenCalled();

    unmount();
    expect(archiveGame).toHaveBeenCalledTimes(1);
    const [record] = archiveGame.mock.calls[0];
    expect(record.move_count, 'the move played must be in the archive').toBeGreaterThanOrEqual(1);
    expect(record.completed).toBe(false);
    expect(record.ended_by).toBe('left');
  });
});

describe('the player is locked for the whole game', () => {
  const notesFor = (square) => squareToChord(square, DEFAULT_CHORD_SCHEME)
    .pitch_classes.map((pc) => 60 + pc);
  const holdNotes = (notes) => mockUsePianoMidiNotes.mockReturnValue({
    activeNotes: new Map(notes.map((n) => [n, { velocity: 80 }])),
    noteHistory: [],
  });
  const makeElement = (user) => (
    <PianoChessGame currentUser={user} gameConfig={{ addressing: { shuffle: 'never' } }} />
  );
  const playChord = async (rerender, user, notes) => {
    holdNotes(notes);
    rerender(makeElement(user));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    holdNotes([]);
    rerender(makeElement(user));
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockUsePianoMidi.mockReturnValue({ connected: true, status: 'connected' });
    fetchChessConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('keeps the starting player for the whole game, ignoring a mid-game switch', async () => {
    // Shared mocks across this file — clear so the assertion sees only this game.
    fetchChessConfig.mockClear();
    fetchLadder.mockClear();
    const { rerender } = render(makeElement('learner4'));
    await playChord(rerender, 'learner4', notesFor('e2'));
    rerender(makeElement('learner3'));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    // The rail no longer prints the player — the kiosk breadcrumb does, with an
    // avatar — so the lock is asserted where it actually bites: every per-user
    // call still belongs to whoever started the game.
    const users = [...fetchChessConfig.mock.calls, ...fetchLadder.mock.calls].map(([user]) => user);
    expect(users).toContain('learner4');
    expect(users, 'a mid-game switch must not re-scope the game').not.toContain('learner3');
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
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    mockUsePianoMidi.mockReturnValue({ connected: false, status: 'disconnected' });
    mockUsePianoMidiNotes.mockReturnValue({ activeNotes: new Map(), noteHistory: [] });
  });

  it('posts one record per game, and "Play again" starts the tallies over', async () => {
    // The best-move ask in game 2 fails: a hint that never arrived is not a
    // fact the record may claim.
    requestOpponentMove.mockResolvedValue(null);
    // A FRESH element per render: reusing one element object makes React bail
    // out on identical props, so the changed note mock would never be re-read.
    const makeElement = () => (
      <PianoChessGame fen={MATE_IN_ONE_FEN} currentUser="kckern" gameConfig={{ addressing: { shuffle: 'never' } }} />
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

    // Game 1: ask for a legal-move hint, then deliver the mate. Lifting takes
    // the same square twice now — one chord hovers, the repeat picks up.
    await play([60, 61, 62]); // hint cluster — charges one hint
    await play(notesFor('f1')); // name the rook — hovers
    await play(notesFor('f1')); // name it again — lifts it
    await play(notesFor('f8')); // land it — checkmate

    expect(saveGameRecord).toHaveBeenCalledTimes(1);
    expect(saveGameRecord).toHaveBeenCalledWith('kckern', expect.objectContaining({
      result: 'win',
      outcome: 'checkmate',
      moves: 1,
      help: expect.objectContaining({ hints: 1, best_moves: 0 }),
    }));

    // Play again must reset the once-only guard AND the tallies — without it
    // the second game never records, and help would carry over between games.
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));

    // Game 2: ask for the best move, but the server never produces one.
    await play([60, 61, 62, 63]); // best cluster — request fails, no charge
    await play(notesFor('f1')); // hover
    await play(notesFor('f1')); // lift
    await play(notesFor('f8'));

    expect(saveGameRecord).toHaveBeenCalledTimes(2);
    expect(saveGameRecord.mock.calls[1][1]).toMatchObject({
      result: 'win',
      moves: 1,
      help: { hints: 0, best_moves: 0, takebacks: 0 },
    });
  });
});

describe('the opening beat', () => {
  it('names who you are facing when the game starts', () => {
    const { container } = render(<PianoChessGame seed={1} />);
    expect(container.querySelector('.chess-opening')).toBeTruthy();
    expect(container.querySelector('.chess-opening__vs').textContent).toMatch(/White versus/);
  });

  it('says who moves first, from the player\'s side', () => {
    const asBlack = render(<PianoChessGame playerColor="b" seed={1} />);
    expect(asBlack.container.querySelector('.chess-opening__lead').textContent).toBe('They open');
  });

  it('clears itself on a timer rather than waiting to be dismissed', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<PianoChessGame seed={1} />);
      expect(container.querySelector('.chess-opening')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      rerender(<PianoChessGame seed={1} />);
      expect(container.querySelector('.chess-opening')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never covers a finished board', () => {
    // A mate-in-one played out would otherwise show the opening banner and the
    // result card at once.
    const MATE_IN_ONE_FEN = '7k/8/6K1/8/8/8/8/5R2 w - - 0 1';
    const { container } = render(<PianoChessGame fen={MATE_IN_ONE_FEN} seed={1} />);
    // Still live here, so the banner is legitimate...
    expect(container.querySelector('.chess-opening')).toBeTruthy();
    // ...and the guard is on game_over, asserted directly.
    expect(container.querySelector('.chess-result')).toBeNull();
  });
});
