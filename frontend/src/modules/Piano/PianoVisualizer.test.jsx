import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- mocks -----------------------------------------------------------------
// Ambient visualizer pulls its live surface + a stack of session/game hooks and
// heavy screen-framework deps. Stub them so we can assert the theory panel swap
// in isolation (no MIDI, no timers, no overlay context).
const activeNotes = new Map();
let midiSessionInfo = null;
vi.mock('./useMidiSubscription', () => ({
  useMidiSubscription: () => ({ activeNotes, sustainPedal: false, sessionInfo: midiSessionInfo, noteHistory: [] }),
}));

let gamesConfig = {};
vi.mock('./usePianoConfig.js', () => ({ usePianoConfig: () => ({ gamesConfig }) }));

// The launcher state machine has its own suite (useNoteLauncher.test.js). Here
// we drive it as a fixture so each wiring question can be asked on its own.
let launcherState = null;
let launcherArgs = null;
vi.mock('./game-platform/launcher/useNoteLauncher.js', () => ({
  useNoteLauncher: (args) => {
    launcherArgs = args;
    return launcherState;
  },
}));

let launcherUserState = null;
vi.mock('./game-platform/launcher/useLauncherUser.js', () => ({
  useLauncherUser: () => launcherUserState,
}));

let inactivityArgs = null;
vi.mock('./useInactivityTimer.js', () => ({
  useInactivityTimer: (...args) => {
    inactivityArgs = args;
    return { inactivityState: 'idle', countdownProgress: 0 };
  },
}));
vi.mock('./useSessionTracking.js', () => ({ useSessionTracking: () => ({ sessionDuration: 0 }) }));
vi.mock('./useSpamDetection.js', () => ({
  useSpamDetection: () => ({ spamState: 'normal', warningVisible: false, blackoutRemaining: 0, spamEventCount: 0 }),
}));

// Stable identities: the escape effect depends on these, and fresh vi.fn()s per
// render would re-register on every commit and hide a real dependency bug.
const registerEscapeInterceptor = vi.fn();
const unregisterEscapeInterceptor = vi.fn();
vi.mock('../../screen-framework/overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({ registerEscapeInterceptor, unregisterEscapeInterceptor }),
}));

const stubLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
  child: () => stubLogger,
};
vi.mock('../../lib/logging/Logger.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getLogger: () => stubLogger, default: () => stubLogger };
});

// Real registry shape (ids, labels, statuses, layout) with the lazy chunks
// swapped for a stub: the wiring questions are about which games are offered
// and how they are mounted, not about loading eight real games in jsdom.
let gameProps = null;
let gameShouldThrow = false;
let extraGames = [];
vi.mock('./gameRegistry.js', async (importOriginal) => {
  const actual = await importOriginal();
  const GameStub = (props) => {
    gameProps = props;
    if (gameShouldThrow) throw new Error('the board fell over');
    return <div data-testid="game-stub" />;
  };
  const patched = Object.fromEntries(
    Object.entries(actual.GAME_REGISTRY).map(([id, entry]) => [id, { ...entry, LazyComponent: GameStub }]),
  );
  const all = () => ({
    ...patched,
    ...Object.fromEntries(extraGames.map((id) => [
      id,
      { label: id, icon: 'game-tetris', status: 'released', layout: 'replace', LazyComponent: GameStub },
    ])),
  });
  return {
    ...actual,
    GAME_REGISTRY: patched,
    getGameEntry: (id) => all()[id] ?? null,
    getGameIds: () => Object.keys(all()),
  };
});

// Heavy presentational children are irrelevant here; stub waterfall + keyboard.
// The keyboard mock records the props it received so we can assert it stays
// display-only (no onNoteOn/onNoteOff wiring).
let keyboardProps = null;
vi.mock('./components/NoteWaterfall', () => ({ NoteWaterfall: () => <div data-testid="waterfall" /> }));
vi.mock('./components/PianoKeyboard', () => ({
  PianoKeyboard: (props) => {
    keyboardProps = props;
    return <div data-testid="keys" />;
  },
}));

import { PianoVisualizer } from './PianoVisualizer.jsx';

const freePlay = () => ({
  isOpen: false, activeGameId: null, isHolding: false,
  dismiss: vi.fn(), exitGame: vi.fn(), timeoutMs: 30000,
});

beforeEach(() => {
  launcherState = freePlay();
  launcherUserState = {
    users: [], currentUser: null, pickerOpen: false,
    openPicker: vi.fn(), closePicker: vi.fn(), pickUser: vi.fn(),
  };
  launcherArgs = null;
  inactivityArgs = null;
  gameProps = null;
  gameShouldThrow = false;
  extraGames = [];
  gamesConfig = {};
  midiSessionInfo = null;
  registerEscapeInterceptor.mockClear();
  unregisterEscapeInterceptor.mockClear();
  stubLogger.warn.mockClear();
});

describe('PianoVisualizer MIDI session end', () => {
  afterEach(() => vi.useRealTimers());

  it('dismisses ambient free play after showing its summary', () => {
    vi.useFakeTimers();
    midiSessionInfo = { event: 'session_end', noteCount: 24, duration: 30 };
    const onSessionEnd = vi.fn();
    const { container } = render(<PianoVisualizer onSessionEnd={onSessionEnd} />);

    expect(container.querySelector('.session-summary')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(onSessionEnd).toHaveBeenCalledWith(midiSessionInfo);
  });

  it('never lets an ambient session timeout unmount a live game', () => {
    vi.useFakeTimers();
    midiSessionInfo = { event: 'session_end', noteCount: 24, duration: 30 };
    launcherState = { ...launcherState, activeGameId: 'chess' };
    const onSessionEnd = vi.fn();
    const { container } = render(<PianoVisualizer onSessionEnd={onSessionEnd} />);

    expect(container.querySelector('[data-testid="game-stub"]')).toBeTruthy();
    expect(container.querySelector('.session-summary')).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onSessionEnd).not.toHaveBeenCalled();
  });
});

describe('PianoVisualizer ambient view', () => {
  it('renders the full theory panel (circle · staff · chord) in the header', () => {
    const { container } = render(<PianoVisualizer />);
    const header = container.querySelector('.piano-header');
    expect(header).toBeTruthy();
    // Theory panel present: circle of fifths + staff + chord speller.
    expect(header.querySelector('.theory-panel--row')).toBeTruthy();
    expect(header.querySelector('.piano-circle-of-fifths')).toBeTruthy();
    expect(header.querySelector('.chord-staff')).toBeTruthy();
    expect(header.querySelector('.piano-chord-name')).toBeTruthy();
  });

  it('keeps the keyboard display-only (no touch input wiring)', () => {
    const { getByTestId } = render(<PianoVisualizer />);
    expect(getByTestId('keys')).toBeTruthy();
    expect(keyboardProps).toBeTruthy();
    expect(keyboardProps.onNoteOn).toBeUndefined();
    expect(keyboardProps.onNoteOff).toBeUndefined();
    expect(keyboardProps.showLabels).toBe(true);
  });
});

describe('PianoVisualizer game launcher', () => {
  it('shows no launcher while the player is just playing', () => {
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.note-launcher')).toBeNull();
    expect(container.querySelector('.waterfall-container')).toBeTruthy();
  });

  it('renders the launcher over the free-play view when it opens', () => {
    launcherState = { ...launcherState, isOpen: true };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.note-launcher')).toBeTruthy();
    // Free play stays underneath: dismissing must not have cost you anything.
    expect(container.querySelector('.waterfall-container')).toBeTruthy();
  });

  it('builds one key per released registry game, and omits unreleased ones', () => {
    launcherState = { ...launcherState, isOpen: true };
    const { container } = render(<PianoVisualizer />);
    const keys = container.querySelectorAll('.nl-key');
    // Eight of the nine registered games are released; card-game is preview.
    expect(keys).toHaveLength(8);
    expect(container.textContent).not.toContain('Battle Stadium');
  });

  it('offers the board games config never listed, so they are reachable here', () => {
    launcherState = { ...launcherState, isOpen: true };
    const { container } = render(<PianoVisualizer />);
    // Config only ever carried the five games that had activation combos.
    expect(container.textContent).toContain('Piano Chess');
    expect(container.textContent).toContain('Connect Four');
    expect(container.textContent).toContain('Piano Checkers');
  });

  it('hides the waterfall and keyboard once a game is running', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.waterfall-container')).toBeNull();
    expect(container.querySelector('.keyboard-container')).toBeNull();
  });

  // A 'replace' game is meant to take the whole viewport. The waterfall and
  // keyboard were dropped for it but the theory band never was, so the staff,
  // circle of fifths and chord name stayed lit under the game — reported from
  // the office screen 2026-08-18 as the game "painting on top of whatever was
  // already there". They also keep re-rendering at MIDI rates while hidden.
  it('drops the theory band too — a replace game means the whole viewport', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.theory-panel--row')).toBeNull();
    expect(container.querySelector('.piano-circle-of-fifths')).toBeNull();
    expect(container.querySelector('.chord-staff')).toBeNull();
    expect(container.querySelector('.piano-chord-name')).toBeNull();
  });

  it('still shows the theory band in the ambient view', () => {
    launcherState = { ...launcherState, activeGameId: null };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.theory-panel--row')).toBeTruthy();
  });

  it('opens over a running game without ending it', () => {
    launcherState = { ...launcherState, isOpen: true, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    // An accidental combo mid-Tetris must not cost you the game: the launcher
    // draws on top (z-index 60 over the game's 50) and the game keeps running.
    expect(container.querySelector('.note-launcher')).toBeTruthy();
    expect(container.querySelector('.tetris-fullscreen')).toBeTruthy();
    expect(launcherState.exitGame).not.toHaveBeenCalled();
  });

  it('keeps the slot list stable across re-renders', () => {
    launcherState = { ...launcherState, isOpen: true };
    const { rerender } = render(<PianoVisualizer />);
    const first = launcherArgs.slots;
    rerender(<PianoVisualizer />);
    // Rebuilding inline would hand the selection effect a new array at MIDI
    // rates, re-running it on every note.
    expect(launcherArgs.slots).toBe(first);
  });

  it('warns when there are more released games than launcher keys', () => {
    extraGames = ['tenth-game', 'eleventh-game'];
    render(<PianoVisualizer />);
    expect(stubLogger.warn).toHaveBeenCalledWith('launcher.slots-overflow', { dropped: ['eleventh-game'] });
  });

  it('does not warn when every released game has a key', () => {
    render(<PianoVisualizer />);
    expect(stubLogger.warn).not.toHaveBeenCalled();
  });
});

describe('PianoVisualizer launcher chrome', () => {
  it('mounts the hold ring as a sibling of the launcher, not inside it', () => {
    launcherState = { ...launcherState, isOpen: true, isHolding: true };
    const { container } = render(<PianoVisualizer />);
    const root = container.querySelector('.piano-visualizer');
    const launcher = root.querySelector('.note-launcher');
    const ring = root.querySelector('.nl-hold');
    expect(launcher).toBeTruthy();
    expect(ring).toBeTruthy();
    // The ring must outlive the overlay closing — holding the combo with the
    // launcher open toggles it shut and only then quits at 2s.
    expect(launcher.contains(ring)).toBe(false);
    expect(ring.parentElement).toBe(root);
    expect(launcher.parentElement).toBe(root);
  });

  it('shows the hold ring with the launcher closed', () => {
    launcherState = { ...launcherState, isOpen: false, isHolding: true };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.nl-hold')).toBeTruthy();
    expect(container.querySelector('.note-launcher')).toBeNull();
  });

  it('shows no ring when nothing is being held', () => {
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.nl-hold')).toBeNull();
  });
});

describe('PianoVisualizer escape handling', () => {
  it('leaves escape alone during free play', () => {
    render(<PianoVisualizer />);
    expect(registerEscapeInterceptor).not.toHaveBeenCalled();
  });

  it('closes the launcher on escape and consumes the key', () => {
    launcherState = { ...launcherState, isOpen: true };
    render(<PianoVisualizer />);
    expect(registerEscapeInterceptor).toHaveBeenCalledTimes(1);
    const intercept = registerEscapeInterceptor.mock.calls[0][0];
    expect(intercept()).toBe(true);
    expect(launcherState.dismiss).toHaveBeenCalledWith('escape');
    // Dismiss only — escape must not cost you the game you were playing.
    expect(launcherState.exitGame).not.toHaveBeenCalled();
  });

  it('still swallows escape while a game is running', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    render(<PianoVisualizer />);
    const intercept = registerEscapeInterceptor.mock.calls[0][0];
    expect(intercept()).toBe(true);
    expect(launcherState.dismiss).not.toHaveBeenCalled();
    expect(launcherState.exitGame).not.toHaveBeenCalled();
  });
});

describe('PianoVisualizer inactivity suppression', () => {
  it('counts an open launcher as activity', () => {
    launcherState = { ...launcherState, isOpen: true };
    render(<PianoVisualizer />);
    expect(inactivityArgs[2]).toBe(true);
  });

  it('counts a running game as activity', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    render(<PianoVisualizer />);
    expect(inactivityArgs[2]).toBe(true);
  });

  it('lets the timer run during free play', () => {
    render(<PianoVisualizer />);
    expect(inactivityArgs[2]).toBe(false);
  });
});

describe('PianoVisualizer game mount', () => {
  it('hands a game its config section when one exists', () => {
    gamesConfig = { tetris: { speed: 3 } };
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    render(<PianoVisualizer />);
    expect(gameProps.gameConfig).toEqual({ speed: 3 });
  });

  it('hands a game null rather than undefined when config never listed it', () => {
    launcherState = { ...launcherState, activeGameId: 'chess' };
    render(<PianoVisualizer />);
    // Chess, connect-four and checkers were never in the games config.
    expect(gameProps.gameConfig).toBeNull();
  });

  it('quits the game on its own exit, rather than merely closing the launcher', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    render(<PianoVisualizer />);
    gameProps.onDeactivate();
    expect(launcherState.exitGame).toHaveBeenCalledWith('game-exit');
    expect(launcherState.dismiss).not.toHaveBeenCalled();
  });
});

describe('PianoVisualizer game crash containment', () => {
  let errorSpy;
  beforeEach(() => {
    // React logs the caught error to console.error by design.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('catches a throwing game instead of blanking the office screen', () => {
    gameShouldThrow = true;
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('Tetris stopped.');
    // The rest of the visualizer is still standing.
    expect(container.querySelector('.piano-header')).toBeTruthy();
  });

  it('quits the game from the crash screen, not just the launcher', () => {
    gameShouldThrow = true;
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    fireEvent.click(container.querySelector('.pg-btn'));
    // A crash exit is logged apart from a clean one — the two say very
    // different things about a game when they show up in the session log.
    expect(launcherState.exitGame).toHaveBeenCalledWith('crash');
    expect(launcherState.dismiss).not.toHaveBeenCalled();
  });
});

// The office screen has no breadcrumb rail and no user chip, so a game opened
// into a board that named neither itself nor whose it was.
describe('office game chrome', () => {
  it('passes the roster-resolved player name into the game, never just the id', () => {
    launcherUserState = {
      ...launcherUserState,
      users: [{ id: 'felix-kern', group_label: 'Felix', name: 'Felix Kern' }],
      currentUser: 'felix-kern',
    };
    launcherState = { ...launcherState, activeGameId: 'chess' };
    render(<PianoVisualizer />);

    expect(gameProps.currentUser).toBe('felix-kern');
    expect(gameProps.playerName).toBe('Felix');
  });

  it('names the game and the player while one is running', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    const chrome = container.querySelector('.office-game-chrome');
    expect(chrome).toBeTruthy();
    expect(chrome.textContent).toContain('Tetris');
  });

  it('says so when nobody is selected rather than leaving it blank', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    // A game filed under nobody is worth seeing, not hiding.
    expect(container.querySelector('.office-game-chrome__name--none')).toBeTruthy();
  });

  it('shows no chrome in the ambient view — there is no game to name', () => {
    launcherState = { ...launcherState, activeGameId: null };
    const { container } = render(<PianoVisualizer />);
    expect(container.querySelector('.office-game-chrome')).toBeNull();
  });

  // A `replace` game roots itself `position: absolute; inset: 0` (see
  // PianoChessGame.scss), so its containing block decides how much room it
  // thinks it has. With the game as a direct child of `.tetris-fullscreen`, that
  // block was the WHOLE 720px wrapper — the chrome's 52px strip included — and
  // the header printed straight over the eighth rank of the chessboard.
  //
  // The stage is the fix and it is structural, not cosmetic: it is the only
  // positioned box between the two, so `inset: 0` resolves to the space the
  // chrome has already given back. Nothing here can be asserted from geometry
  // (jsdom has no layout), so the nesting itself is the contract.
  it('puts the game in a stage BELOW the chrome, never in the chrome’s own box', () => {
    launcherState = { ...launcherState, activeGameId: 'tetris' };
    const { container } = render(<PianoVisualizer />);
    const wrapper = container.querySelector('.tetris-fullscreen');
    const chrome = wrapper.querySelector('.office-game-chrome');
    const stage = wrapper.querySelector('.tetris-fullscreen__stage');

    expect(stage).toBeTruthy();
    // Siblings in a flex column: the chrome takes its strip, the stage takes
    // the rest. If the chrome were inside the stage they would share a box
    // again and the overlap would be back.
    expect(stage.parentElement).toBe(wrapper);
    expect(stage.contains(chrome)).toBe(false);
    // Order matters — the chrome is the strip at the top.
    expect(chrome.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the game must actually be inside the stage, not beside it.
    expect(stage.childElementCount).toBeGreaterThan(0);
  });
});
