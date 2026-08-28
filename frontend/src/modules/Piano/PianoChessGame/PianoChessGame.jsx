import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_FEN, legalDestinations } from '@shared-gaming/rulesets/chess/engine.mjs';
import { fenToPosition } from '@shared-gaming/rulesets/chess/position.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { pieceSource } from '../../Chess/pieceAssets.js';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import { GameRail, GameSlot, GameButton, GameStatusBar, WinTally } from '../game-platform/chrome/index.js';
import { resolveAddressing } from '../game-platform/addressing/resolveAddressing.js';
import { schemeFor } from '../game-platform/addressing/buildScheme.js';
import GearIcon from '../game-platform/chrome/GearIcon.jsx';
import Icon from '../ui/icons/Icon.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import ChordNamePanel from '../components/ChordNamePanel.jsx';
import CurrentChordStaff from '../components/CurrentChordStaff.jsx';
import ChordReadout from './ChordReadout.jsx';
import ChessClock from './ChessClock.jsx';
import ChessResult from './ChessResult.jsx';
import { playCue } from './chessSounds.js';
import { resolveTiming } from './chessClock.js';
import { usePianoMidiOptional, usePianoMidiNotesOptional } from '../PianoKiosk/PianoMidiContext.jsx';
import { useAnyKeyToContinue } from '../game-platform/input/useAnyKeyToContinue.js';
import { keyFallbackNeeded } from '../game-platform/input/touchCapability.js';
import { usePlayerLock } from '../PianoKiosk/PianoPlaybackContext.jsx';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';
import {
  archiveGame, beaconArchive, fetchChessConfig, fetchLadder, requestBestMove,
  requestOpponentMove, requestOpponentQuip, saveChessConfig, saveGameRecord,
} from './chessApi.js';
import OpponentPortrait from './OpponentPortrait.jsx';
import GestureCards from './GestureCards.jsx';
import { OpponentRosterModal } from './OpponentRoster.jsx';
import { cuesFromConfig } from './chessCues.js';
import ChessSettingsPanel from './ChessSettingsPanel.jsx';
import { CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { isStaffScheme } from './staffAddress.js';
import StaffNoteLabel from './StaffNoteLabel.jsx';
import { candidateSquares } from './chordCandidates.js';
import { destinationBadges } from './chessBadges.js';
import { recognizeGesture } from './chordGestures.js';
import { DOUBLE_WINDOW_MS } from './chordSelection.js';
import {
  REJECTION_MESSAGES, applySquare, capturedPieces,
  createChessGameState, isPlayerTurn, projectChessAuthorityState, takeMoveBack,
} from './chessGameState.js';
import { useChessAuthority } from './useChessAuthority.js';
import {
  checkTakeback, playerMoveCount, takebackNote, takebackRefusalMessage, willStillCount,
} from './takebackBudget.js';
import { buildChessRailViewModel } from './chessRailViewModel.js';
import { useChessAddressingProgress } from './useChessAddressingProgress.js';
import { useChessOpponentTurn } from './useChessOpponentTurn.js';
import { useChessPersistenceLifecycle } from './useChessPersistenceLifecycle.js';
import { useChessSessionIdentity } from './useChessSessionIdentity.js';
import { useChessSessionResources } from './useChessSessionResources.js';
import { useChessHelpController } from './useChessHelpController.js';
import { useChessInputController } from './useChessInputController.js';
import './PianoChessGame.scss';

export { promptFor } from './chessRailViewModel.js';

/**
 * Piano Chess — chess played by chords.
 *
 * Every square is a chord: the file is the root, the rank is the quality. A move
 * is the two chords that perform it, played in order — lift, then land. Nothing
 * here is pointer-driven, because the instrument is the controller.
 */

const CURSOR_TICK_MS = 25;
const TOAST_MS = 2600;

/**
 * How loudly the board answers a mistake. Refusal loudness ONLY: legality
 * marks are not feedback but a gesture channel — they appear when the player
 * asks at the keys, never because a config said so.
 */
export const DEFAULT_FEEDBACK = Object.freeze({
  flashRejected: true,   // the refused square shakes and flares red
  toast: true,           // a sentence saying what was wrong
  sound: true,           // the board is audible: move, capture, refusal, check
});
/**
 * The fallback think time, used only when the rung-scaled curve cannot resolve
 * one — a guest, or a game with no ladder. The real pacing lives in
 * `opponentPacing.js`, which scales the brood with the rung and treats it as a
 * floor on the total wait rather than a pause before the request.
 */
export const OPPONENT_DELAY_MS = 1200;
/** How long the opening banner stands before it clears itself. */
const OPENING_MS = 1600;
/** How long a piece takes to cross the board, per actor. See `moveDurationMs`. */
const PLAYER_MOVE_MS = 180;
const OPPONENT_MOVE_MS = 420;
/** The order a captured rail reads in: cheapest first, so a queen ends the row. */
const PIECE_ORDER = ['p', 'n', 'b', 'r', 'q'];

/**
 * Frozen empties for the idle paths.
 *
 * The board is memoized, so a fresh `[]` or `{}` per render defeats its bail-out
 * exactly as thoroughly as changed data would — and that costs 64 square
 * subtrees and ~32 images on every MIDI note event.
 */
/** The teachable steps, in order, for the "step N of M" counter. */
const ONBOARD_ORDER = Object.freeze(['find', 'arm', 'lift', 'land']);

/** How long the rewind holds before the exchange plays forward again. */
const REPLAY_HOLD_MS = 260;
/** Half speed, so the move that was missed can actually be followed. */
const REPLAY_MOVE_MS = 840;

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});


/**
 * The addressing vocabulary, chosen by config rather than by code.
 *
 * `staff` is the reading level: a rank is a note on the bass staff, a file a
 * note on the treble staff, and a square is the two played together. It exists
 * for players who read both clefs long before they can spell a chord — which is
 * most beginners, for years — and it is the same 64 squares, so nothing else in
 * the game changes.
 */
export function chessAddressingFor(addressing, fallback = DEFAULT_CHORD_SCHEME, gameSeed = 0) {
  const stated = (addressing && typeof addressing === 'object') ? addressing : {};
  // The fallback carries what this game was already using, so a config that
  // says nothing about vocabulary keeps it rather than dropping to the house
  // default. Chess ships `chords`; the house floor is `staff`.
  const game = { vocabulary: isStaffScheme(fallback) ? 'staff' : 'chords', ...stated };

  const resolved = resolveAddressing({
    game,
    ladder: stated?.addressing?.ladder ?? null,
    axisSize: 8,
  });

  // The cadence is the RESOLVED one — config and ladder rung, through the same
  // layering as everything else — never read raw off the config, where a sparse
  // user file used to leave it undefined and the prop default (shuffle ON) won.
  //
  // `each_turn` re-deals per turn through chess's OWN machinery inside
  // `createChessGameState`, so the builder seeds at 0 — dealing here as well
  // would shuffle an already-shuffled board. `each_game` has no chess-side
  // machinery, so it IS dealt here, from the game's seed, which changes on
  // restart.
  const seed = resolved.shuffle === 'each_game' ? (Number(gameSeed) >>> 0) : 0;
  const shuffleEachTurn = resolved.shuffle === 'each_turn';
  const built = schemeFor(resolved, { size: 8, seed, fallback });
  if (!built.valid) {
    logger().warn('addressing.scheme-rejected', { errors: built.errors, source: built.source });
    return { scheme: fallback, shuffleEachTurn };
  }
  return { scheme: built.scheme, shuffleEachTurn };
}

/** The scheme alone, for callers with no stake in the cadence. */
export function schemeForAddressing(addressing, fallback = DEFAULT_CHORD_SCHEME) {
  return chessAddressingFor(addressing, fallback).scheme;
}

/** A chord takes three notes to name a square; a staff address takes two. */
export const minNotesFor = (scheme) => (isStaffScheme(scheme) ? 2 : 3);

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'piano-chess' });
  return cachedLogger;
}
const CHESS_ADDRESSING_CLIENT = Object.freeze({ writeConfig: saveChessConfig });
const CHESS_PERSISTENCE_GATEWAY = Object.freeze({ archiveGame, beaconArchive, saveGameRecord });

export function PianoChessGame({
  gameConfig = null,
  // Supplied by the game platform (PianoVisualizer). Absent only for kiosk
  // callers that rely on PianoMidiProvider being above them.
  activeNotes: activeNotesProp = null,
  connected: connectedProp = null,
  currentUser = null,
  playerName = null,
  playerColor = gameConfig?.player_color ?? 'w',
  difficulty = gameConfig?.difficulty ?? 'learner',
  scheme = DEFAULT_CHORD_SCHEME,
  shuffleEachTurn: shuffleEachTurnProp = gameConfig?.addressing?.shuffle !== 'never',
  seed = null,
  feedback = null,
  // Starting position override. A test seam like `seed`: the game-record test
  // needs a mate-in-one board, and production callers never pass it.
  fen = null,
}) {
  const {
    lockedUser,
    displayName,
    playerAvatarId,
    gameId,
    gameSeed,
    beginNextGame,
  } = useChessSessionIdentity({ currentUser, playerName, initialSeed: seed });

  const authorityUserId = lockedUser || 'household';
  const {
    session: chessSession,
    ready: chessAuthorityReady,
    move: commitChessMove,
    takeback: commitChessTakeback,
    reset: resetChessAuthority,
  } = useChessAuthority({ userId: authorityUserId, initialFen: fen ?? INITIAL_FEN, seed: gameSeed });

  const [game, setGame] = useState(() => createChessGameState({
    fen: fen ?? undefined,
    playerColor,
    scheme,
    seed: gameSeed,
    shuffleEachTurn: shuffleEachTurnProp,
  }));

  const {
    chessConfig,
    ladder,
    ladderReady,
    rungId,
    opponent,
    ladderLevel,
    updateSetting: applySetting,
  } = useChessSessionResources({
    sessionId: gameId,
    userId: lockedUser,
    historyLength: game.history.length,
    readConfig: fetchChessConfig,
    readLadder: fetchLadder,
    writeConfig: saveChessConfig,
    logger: logger(),
  });

  usePlayerLock(!game.status?.game_over, 'Finish the game to switch players');

  // The merged household+user chess config is the single source for the rung
  // ladder, the cue flags, the opponent delay, and the shuffle preference. The
  // old gameConfig.feedback path is gone on purpose: two config sources for one
  // preference is exactly the drift the chess.yml pair exists to prevent.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The `feedback` prop survives ONLY as a test seam — production callers must
  // let the chess config speak for itself.
  const cues = { ...DEFAULT_FEEDBACK, ...cuesFromConfig(chessConfig), ...(feedback ?? {}) };
  const opponentDelayMs = chessConfig?.opponent_delay_ms ?? OPPONENT_DELAY_MS;
  // The clock's settings, resolved once here so the board and the archive can
  // never disagree about which control was in force.
  const timing = useMemo(() => resolveTiming(chessConfig), [chessConfig]);
  // Shuffle takes effect on the NEXT game: createChessGameState captures it at
  // construction, so a mid-game change never re-deals the board mid-read.
  // Scheme and cadence resolve together, through the addressing layers, so the
  // board and its shuffle can never come from two different opinions of the
  // config.
  const loadedAddressing = useMemo(
    () => (chessConfig ? chessAddressingFor(chessConfig, scheme, gameSeed) : null),
    [chessConfig, scheme, gameSeed],
  );
  const shuffleEachTurn = loadedAddressing ? loadedAddressing.shuffleEachTurn : shuffleEachTurnProp;
  const rung = chessConfig?.rungs?.find((entry) => entry.id === rungId);
  // Maps the active rung to a bundled difficulty the same way the server adapter
  // would, so a dropped request doesn't quietly change who the player is facing.
  const localFallbackDifficulty = Number.isFinite(rung?.elo) ? 'steady'
    : (rung?.skill ?? 3) <= 2 ? 'beginner'
      : (rung?.skill ?? 3) <= 10 ? 'learner' : 'steady';

  // Notes come from whoever mounts this game. The platform hands every game its
  // `activeNotes` (PianoVisualizer does), and on the office screen that WS feed
  // is the ONLY source — there is no PianoMidiProvider there, so reaching into
  // the kiosk context threw and the game died on open the first time the note
  // launcher made it reachable. Context is the fallback, for kiosk callers that
  // mount it without passing notes.
  const ctxNotes = usePianoMidiNotesOptional();
  const midiCtx = usePianoMidiOptional();
  const activeNotes = activeNotesProp ?? ctxNotes.activeNotes;
  // No provider means no connection state to read. The visualizer only appears
  // once notes are already flowing, so assume attached rather than nagging the
  // player to connect a piano they are demonstrably playing.
  const connected = connectedProp ?? midiCtx?.connected ?? true;
  // The map is re-dealt every turn, so everything that reads chords — the
  // cursor, the rim, the move log — has to follow state, not the prop.
  const liveScheme = game.scheme;
  const reading = isStaffScheme(liveScheme);
  const gameRef = useRef(game);
  gameRef.current = game;
  const terminalSpeechRef = useRef(() => {});
  // `performance.now()` is monotonic for this browser session. We record each
  // completed ply here rather than trying to infer it from archive wall times.
  // A remount cannot continue this clock, so its incomplete ledger is honestly
  // marked discontinuous when archived.
  const timingLedgerRef = useRef(null);
  if (!timingLedgerRef.current || timingLedgerRef.current.gameId !== gameId) {
    timingLedgerRef.current = {
      gameId,
      quality: game.history.length ? 'discontinuous' : (timing.mode === 'off' ? 'off' : 'complete'),
      lastAt: typeof performance === 'undefined' ? null : performance.now(),
      byPly: {},
    };
  }
  const recordMoveTiming = useCallback((ply) => {
    const ledger = timingLedgerRef.current;
    if (!ledger || ledger.quality === 'off') return;
    const now = typeof performance === 'undefined' ? null : performance.now();
    if (now == null || ledger.lastAt == null || !Number.isInteger(ply) || ply < 1) {
      ledger.quality = 'discontinuous';
      return;
    }
    ledger.byPly[ply] = Math.max(0, Math.round(now - ledger.lastAt));
    ledger.lastAt = now;
  }, []);
  const projectAuthority = useCallback((authoritativeSession, nativeState = gameRef.current) => (
    projectChessAuthorityState(authoritativeSession.state, {
      playerColor,
      scheme: nativeState?.baseScheme || scheme,
      seed: authoritativeSession.header.seed,
      shuffleEachTurn: nativeState?.shuffleEachTurn ?? shuffleEachTurnProp,
    })
  ), [playerColor, scheme, shuffleEachTurnProp]);

  useEffect(() => {
    if (!chessSession) return;
    setGame((current) => projectAuthority(chessSession, current));
  }, [chessSession, projectAuthority]);
  // Where the cooldown counts from — the player's own move count at the last
  // takeback, or null when there has not been one this game.
  const lastTakebackAtRef = useRef(null);
  // The tick effect and the takeback callback are both mount-stable, so
  // everything they read of the render's values has to arrive by ref.
  const chessConfigRef = useRef(null);
  chessConfigRef.current = chessConfig;
  const ladderPolicyRef = useRef(null);
  ladderPolicyRef.current = ladder?.policy ?? null;

  // Below the game state on purpose: this effect may recreate it. The initial
  // game is built in the useState initializer — always before this fetch can
  // resolve — so it captured the prop fallback for the shuffle cadence, and
  // commitMove re-deals from that CAPTURED value while the rail notice reads
  // the loaded one. If the player has not touched the game yet, re-deal it
  // under the loaded preference so the saved setting is real from the first
  // move; once a chord or move has landed the board must not rearrange under
  // them, and the captured value stands until the next game.
  useEffect(() => {
      if (!loadedAddressing) return;
      // The addressing vocabulary is a per-player setting, so it can only be
      // known once that player's config layer has resolved — after the game was
      // built. Same rule as the shuffle: adopt it while the game is untouched,
      // never rearrange the board under a player mid-move.
      const { scheme: loadedScheme, shuffleEachTurn: nextShuffle } = loadedAddressing;
      setGame((current) => {
        const untouched = current.history.length === 0 && !current.origin;
        if (!untouched) return current;
        if (current.shuffleEachTurn === nextShuffle && current.scheme?.id === loadedScheme.id) return current;
        return createChessGameState({
          fen: fen ?? undefined, playerColor, scheme: loadedScheme, seed: gameSeed, shuffleEachTurn: nextShuffle,
        });
      });
  }, [loadedAddressing, fen, gameSeed, playerColor]);

  const heldNotes = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);

  /**
   * Every legal move in this position, generated ONCE.
   *
   * This is the hot path of the whole screen. `playableSources` and
   * `destinationsFor` each build a fresh `new Chess(fen)` and run a full verbose
   * move generation, and four separate places below wanted one or the other —
   * three of them unmemoized, so they ran on every render. Renders happen on
   * every MIDI note on AND off, and a held chord is three to five of those
   * inside about 100ms. That was the reported jank, and the throwaway engines
   * were also the largest source of GC garbage on a device this old.
   *
   * Keyed on the FEN alone: the position is the only thing a move list depends
   * on. Everything below derives from this map and never touches the engine.
   */
  const legalMap = useMemo(() => legalDestinations(game.game.fen), [game.game.fen]);
  const playerTurn = isPlayerTurn(game);
  // Stable identities on the idle paths: these feed a memoized board, and a
  // fresh [] every render defeats the memo just as surely as new data would.
  const sources = useMemo(
    () => (playerTurn ? Object.keys(legalMap).sort() : EMPTY_ARRAY),
    [legalMap, playerTurn],
  );
  const originDestinations = useMemo(
    () => (game.origin ? (legalMap[game.origin] ?? EMPTY_ARRAY) : EMPTY_ARRAY),
    [legalMap, game.origin],
  );

  // Gesture recognition runs before square matching, and a recognised cluster
  // is never chord input: while it is physically down, narrowing is suppressed.
  const gesture = recognizeGesture(heldNotes);
  const candidates = useMemo(() => {
    // Nothing held is the common case — the board sits here between moves — and
    // it used to build the whole available-set anyway before filtering against
    // an empty chord.
    if (gesture || !heldNotes.length) return EMPTY_ARRAY;
    // Narrow only among squares the player can act on in the current half of
    // the move. Lighting empty, enemy, or unreachable squares made the board
    // look random even though the pitch-class subset calculation was correct.
    const available = new Set(game.origin ? originDestinations : sources);
    return candidateSquares(heldNotes, liveScheme).filter((square) => available.has(square));
  }, [game.origin, gesture, heldNotes, liveScheme, originDestinations, sources]);

  const {
    opening,
    replay,
    help,
    helpUsed,
    helpUsedRef,
    addTakeback,
    resetHelp,
  } = useChessHelpController({
    game,
    gameRef,
    gameId,
    userId: lockedUser,
    gesture,
    requestBestMove,
    logger: logger(),
    openingMs: OPENING_MS,
    replayHoldMs: REPLAY_HOLD_MS,
    replayMoveMs: REPLAY_MOVE_MS,
  });

  // A board that silently rearranges itself is a board the player will misread.
  // The re-deal announces itself, then gets out of the way.
  const [justDealt, setJustDealt] = useState(false);
  useEffect(() => {
    if (!shuffleEachTurn) return undefined;
    setJustDealt(true);
    const timer = setTimeout(() => setJustDealt(false), 1600);
    return () => clearTimeout(timer);
  }, [liveScheme.id, shuffleEachTurn]);

  useEffect(() => {
    logger().info('mounted', {
      player_color: playerColor, difficulty, scheme: scheme.id,
      shuffle: shuffleEachTurn ? 'each_turn' : 'never', seed: gameSeed,
    });
    if (game.schemeRejected) logger().warn('scheme-rejected', game.schemeRejected);
  }, [difficulty, game.schemeRejected, gameSeed, playerColor, scheme.id, shuffleEachTurn]);

  /**
   * The board, said out loud.
   *
   * Read through a ref because the callers are mount-stable, and gated on a
   * config flag rather than on whether audio happens to work — `playCue` is
   * already a no-op on a WebView that refuses an AudioContext.
   *
   * Ordered by importance, not by chronology: a capture that also gives check
   * announces the check, because that is the thing the player has to answer.
   */
  const soundRef = useRef(true);
  soundRef.current = cues.sound;

  const announce = useCallback((state, kind) => {
    if (!soundRef.current) return;
    if (kind === 'rejected') { playCue('refuse'); return; }
    if (state.status?.game_over) {
      if (state.status.outcome !== 'checkmate') { playCue('move'); return; }
      playCue(state.status.winner === state.playerColor ? 'win' : 'lose');
      return;
    }
    if (state.status?.check) { playCue('check'); return; }
    const last = state.history.at(-1);
    if (last?.san?.includes('=')) { playCue('promote'); return; }
    playCue(last?.captured ? 'capture' : 'move');
  }, []);

  const handleSquare = useCallback((square) => {
    if (!chessAuthorityReady) return;
    // The clock reads move timestamps rather than running its own counter, so
    // "now" is stamped at the moment the move lands and everything downstream —
    // the clock face, the archived think times, the post-game timing analysis —
    // derives from these.
    const { state, event } = applySquare(gameRef.current, square, Date.now());
    if (event.type === 'rejected') {
      setGame(state);
      announce(state, 'rejected');
      logger().debug('chord-rejected', { square, reason: event.reason });
    } else if (event.type === 'moved' || event.type === 'game_over') {
      commitChessMove(event.move).then((authoritativeSession) => {
        const projected = projectAuthority(authoritativeSession, gameRef.current);
        // Only a move that actually reaches the authoritative board is part of
        // the archive. Recording before this promise resolves would leave a
        // failed network commit masquerading as a completed think.
        recordMoveTiming(projected.history.length);
        if (projected.status?.game_over) terminalSpeechRef.current(projected);
        setGame(projected);
        announce(projected);
        logger().info('move-played', { san: event.move.san, chords: projected.history.at(-1)?.chords });
      }).catch((error) => {
        setGame((current) => ({ ...current, origin: null }));
        setToast({ text: 'That move could not be committed. Try again.', seq: `authority-${Date.now()}` });
        logger().error('authority-move-failed', { error: error.message, from: event.move.from, to: event.move.to });
      });
    } else {
      setGame(state);
      logger().debug(`chord-${event.type}`, { square });
    }
  }, [announce, chessAuthorityReady, commitChessMove, projectAuthority, recordMoveTiming]);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const rejection = game.rejection;
  useChessAddressingProgress({
    game,
    gameId,
    playerColor,
    userId: lockedUser,
    config: chessConfig,
    client: CHESS_ADDRESSING_CLIENT,
    logger: logger(),
  });

  useEffect(() => {
    if (!rejection || !cues.toast) return undefined;
    setToast({ text: REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.', seq: rejection.seq });
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [cues.toast, rejection]);

  const {
    thinking: opponentThinking,
    thinkMs,
    effectiveOpponentRef,
    opponentError,
    retryOpponent,
    resetOpponent,
    speech: opponentSpeech,
    dialogueRef,
    showTerminalSpeech,
  } = useChessOpponentTurn({
    game,
    gameRef,
    gameId,
    playerColor,
    ladderReady,
    ladderLevel,
    chessConfig,
    gameSeed,
    fallbackThinkMs: opponentDelayMs,
    rungId,
    userId: lockedUser,
    localFallbackDifficulty,
    setGame,
    announce,
    logger: logger(),
    requestMove: requestOpponentMove,
    requestQuip: requestOpponentQuip,
    commitAuthorityMove: async (candidate) => {
      const authoritativeSession = await commitChessMove(candidate);
      return projectAuthority(authoritativeSession, gameRef.current);
    },
    recordMoveTiming,
  });
  terminalSpeechRef.current = showTerminalSpeech;

  const {
    startedAt,
    finishedRecord,
    ladderOutcome,
    endTiming,
  } = useChessPersistenceLifecycle({
    game,
    gameId,
    userId: lockedUser,
    rungId,
    ladderLevel,
    addressing: reading ? 'staff' : 'chords',
    opponentRef: effectiveOpponentRef,
    helpUsed,
    timing,
    playerColor,
    commentary: dialogueRef,
    timingLedgerRef,
    logger: logger(),
    gateway: CHESS_PERSISTENCE_GATEWAY,
  });

  // Who, if anyone, owns the boundary between one game and the next. Read
  // through a ref so `restart` keeps a stable identity — it is handed to
  // `useAnyKeyToContinue` and to the input controller, both of which arm
  // listeners on it.
  const matchGate = useContext(MatchGateContext);
  const matchGateRef = useRef(matchGate);
  matchGateRef.current = matchGate;

  const restart = useCallback(async () => {
    // Every route into a new board comes through here: the result card's Play
    // again, the rail's mid-game Play again, the any-key continue, and the
    // input controller's restart gesture. All four are the SAME boundary, and
    // all four are gated — a mid-game abandon that skipped the challenge would
    // be a one-tap bypass of it (start, abandon, play on), which is exactly
    // what D12 forbids. Board state is discarded on every one of these paths
    // anyway, so there is nothing to lose by unmounting instead.
    const gate = matchGateRef.current;
    if (gate?.armed) {
      gate.requestRematch();
      return;
    }
    const nextSession = beginNextGame();
    // The next game keeps the player's resolved addressing. Rebuilding from the
    // raw props here used to silently reset a configured player to the shipped
    // defaults on "play again" — resolved from the ref so a restart never
    // recomputes the callback, and with the NEW seed so an each_game cadence
    // actually re-deals.
    const loaded = chessConfigRef.current
      ? chessAddressingFor(chessConfigRef.current, scheme, nextSession.seed)
      : null;
    const nativeInitial = createChessGameState({
      fen: fen ?? undefined,
      playerColor,
      scheme: loaded?.scheme ?? scheme,
      seed: nextSession.seed,
      shuffleEachTurn: loaded?.shuffleEachTurn ?? shuffleEachTurnProp,
    });
    // Clear terminal UI in the same render as the identity changes so the
    // persistence effect cannot record the finished board under the new id.
    setGame(nativeInitial);
    try {
      const authoritativeSession = await resetChessAuthority(nextSession.seed);
      setGame(projectAuthority(authoritativeSession, nativeInitial));
    } catch (error) {
      logger().error('authority-reset-failed', { error: error.message });
      setToast({ text: 'A new game could not be started.', seq: `authority-${Date.now()}` });
      return;
    }
    setToast(null);
    resetHelp();
    lastTakebackAtRef.current = null;
    resetOpponent();
    logger().info('restarted');
  }, [beginNextGame, fen, playerColor, projectAuthority, resetChessAuthority, resetHelp, resetOpponent, scheme, shuffleEachTurnProp]);

  // "Play again" is a button, and the office screen has no finger for it. Any
  // fresh key restarts; the keys still down from the mating move do not count,
  // so the result stays on screen long enough to read.
  useAnyKeyToContinue({
    enabled: keyFallbackNeeded(gameConfig) && !!game.status?.game_over,
    // Preserve the result long enough to read and let queued chord-recognition
    // work from the mating gesture drain before the keyboard can re-arm.
    activeNotes, onContinue: restart, minimumDelayMs: 1800,
  });


  /**
   * The rewind, budget first.
   *
   * The budget is checked before the rules are, so a player out of takebacks is
   * told that rather than being told there is nothing to take back — two very
   * different sentences, and only one of them is true.
   */
  const attemptTakeback = useCallback(async () => {
    const current = gameRef.current;
    const used = helpUsedRef.current.takebacks;
    const since = lastTakebackAtRef.current === null
      ? null
      : playerMoveCount(current.history, current.playerColor) - lastTakebackAtRef.current;
    const check = checkTakeback({ config: chessConfigRef.current, used, movesSinceLast: since });
    if (!check.allowed) {
      setToast({ text: takebackRefusalMessage(check), seq: `takeback-${Date.now()}` });
      logger().info('takeback-refused', { reason: check.reason, remaining: check.remaining });
      return;
    }

    const { state, event } = takeMoveBack(current);
    if (event.type === 'rejected') {
      setToast({
        text: REJECTION_MESSAGES[event.reason] ?? 'You cannot take a move back right now.',
        seq: `takeback-${Date.now()}`,
      });
      logger().info('takeback-refused', { reason: event.reason, remaining: check.remaining });
      return;
    }

    const willCount = willStillCount({ policy: ladderPolicyRef.current, used });
    try {
      const authoritativeSession = await commitChessTakeback(event.plies);
      setGame(projectAuthority(authoritativeSession, state));
    } catch (error) {
      setToast({ text: 'That takeback could not be committed.', seq: `authority-${Date.now()}` });
      logger().error('authority-takeback-failed', { error: error.message, plies: event.plies });
      return;
    }
    addTakeback();
    lastTakebackAtRef.current = playerMoveCount(state.history, state.playerColor);
    setToast({
      text: `Took back ${event.undone.map((entry) => entry.san).join(' and ')}.`,
      seq: `takeback-${Date.now()}`,
    });
    logger().info('takeback', {
      plies: event.plies,
      undone_san: event.undone.map((entry) => entry.san),
      remaining: check.remaining === null ? null : check.remaining - 1,
      will_count: willCount,
    });
  }, [addTakeback, commitChessTakeback, projectAuthority]);

  const { cursor, armed, takebackArmed } = useChessInputController({
    gameId,
    game,
    gameRef,
    heldNotes,
    liveScheme,
    legalMap,
    setGame,
    onSquare: handleSquare,
    onTakeback: attemptTakeback,
    onRestart: restart,
    logger: logger(),
    doubleWindowMs: DOUBLE_WINDOW_MS,
    cursorTickMs: CURSOR_TICK_MS,
  });

  // The board takes plain strings; translating chords into them is this layer's
  // job, which is why ChessBoard never learns what a chord is.
  const minNotes = minNotesFor(liveScheme);
  // In the reading vocabulary the rim IS the lesson: a note drawn on the staff
  // the player reads it from. ChessBoard renders labels as children, so a node
  // costs it nothing to accept.
  // Memoized because these are props of a memoized board: rebuilt every render,
  // they defeated its bail-out on identity alone, and all 64 squares reconciled
  // on every note event as a result.
  const fileLabels = useMemo(() => (reading
    ? liveScheme.roots.map((midi) => <StaffNoteLabel key={midi} midi={midi} />)
    : liveScheme.roots), [reading, liveScheme]);
  const rankLabels = useMemo(() => (reading
    ? liveScheme.qualities.map((midi) => <StaffNoteLabel key={midi} midi={midi} />)
    : liveScheme.qualities.map((quality) => CHORD_QUALITIES[quality]?.label || 'maj')),
  [reading, liveScheme]);

  // The marks channel is empty until a gesture asks. "Show legal moves" means
  // the destinations of the piece being held — or, when none is held yet,
  // which pieces can move at all. The marks stand until the move they helped
  // with completes (see the history-length effect above).
  const hintTargets = useMemo(
    () => (help.legal ? (game.origin ? originDestinations : sources) : EMPTY_ARRAY),
    [help.legal, game.origin, originDestinations, sources],
  );
  // Recomputed every render off the same inputs the callback reads by ref: the
  // card and the toast the callback would produce must never disagree about
  // whether a takeback is currently affordable.
  const takebackCheck = checkTakeback({
    config: chessConfig,
    used: helpUsed.takebacks,
    movesSinceLast: lastTakebackAtRef.current === null
      ? null
      : playerMoveCount(game.history, game.playerColor) - lastTakebackAtRef.current,
  });
  const takebackWillCount = willStillCount({ policy: ladder?.policy ?? null, used: helpUsed.takebacks });
  // The answer to the pick-up: each eligible square wears the chord that
  // reaches it. Not help and never charged — the double-play that lifted the
  // piece WAS the request. Config can silence it for players who want the
  // intersection drill back.
  const squareLabels = useMemo(
    () => (cues.showDestinationLabels ? destinationBadges(game, liveScheme, originDestinations) : EMPTY_OBJECT),
    [cues.showDestinationLabels, game, liveScheme, originDestinations],
  );
  const cursorChord = cursor ? squareToChord(cursor, liveScheme) : null;
  // Only while a piece is held and the cursor names a different square. Capture
  // targets get a ghost too — most previews the player cares about are captures.
  const heldPiece = game.origin ? fenToPosition(game.game.fen)?.[game.origin] : null;
  const ghost = useMemo(
    () => (heldPiece && cursor && cursor !== game.origin ? { square: cursor, piece: heldPiece } : null),
    [heldPiece, cursor, game.origin],
  );
  const captured = useMemo(() => capturedPieces(game.history), [game.history]);
  /**
   * Whose move the board is about to animate.
   *
   * The two actors get different tempos. Your own move should feel immediate —
   * you caused it and already know what it was. Theirs has to be followable by
   * someone who was reading the rail when it happened, which is the case that
   * made opponent replies missable in the first place.
   */
  const moveDurationMs = game.history.at(-1)?.color === playerColor
    ? PLAYER_MOVE_MS
    : OPPONENT_MOVE_MS;
  /**
   * The square a pawn just promoted on, for one beat.
   *
   * Read off the SAN rather than tracked as state: `=Q` is how chess.js records
   * it, and a derived value cannot drift out of step with the move list the way
   * a separately-managed flag would. Only the most recent move counts, so the
   * reveal plays once and the piece then sits there like any other.
   */
  const promotedSquare = useMemo(() => {
    const last = game.history.at(-1);
    return last?.san?.includes('=') ? last.to : null;
  }, [game.history]);

  const {
    boardTheme,
    mood,
    opponentLine,
    onboardStep,
    onboardCopy,
    prompt,
    pickupDeadline,
    turnColour,
    turnLabel,
  } = buildChessRailViewModel({
    game,
    playerColor,
    opponent,
    opponentThinking,
    finishedResult: finishedRecord?.result ?? null,
    cursor,
    cursorChord,
    movableSources: sources,
    armed,
    introSeen: chessConfig?.seen_intro === true,
    reading,
    takebackArmed,
  });
  return (
    <PianoGameHost
      gameId="chess"
      phase={game.status?.game_over ? 'result' : (opening ? 'opening' : 'playing')}
      className={`piano-chess${reading ? ' piano-chess--reading' : ''}`}
      /* Arriving at a new character LOOKS like arriving somewhere new. Purely
         cosmetic: it retints the dark squares and touches nothing else. */
      style={boardTheme ? { '--pc-dark': boardTheme } : undefined}
      instrumentClassName="piano-chess__instrument"
      instrument={{ activeNotes, startNote: 36, endNote: 84, showLabels: true }}
    >
      <div className="piano-chess__stage">
        {/* THE STATE RAIL — what the game is currently thinking. Every row here
            holds its place whether or not it has something to say: a read-out
            that resizes as fingers land drags the eye and, worse, moves the
            board. Fixed rows, fixed rail width, board centred regardless. */}
        <GameRail
          label="Move controls"
          className="piano-chess__rail piano-chess__rail--state"
          foot={(
            <>
              {/* The result overlay carries "Play again" whenever it is up, and
                  it is where the eye already is. This is the fallback for a
                  finished game that produced no record to show a card for — two
                  identical buttons on screen at once is an ambiguity, not a
                  convenience. */}
              {game.status?.game_over && !finishedRecord && (
                <GameButton variant="ghost" className="piano-chess__cancel" onClick={restart}>
                  Play again
                </GameButton>
              )}
              {chessConfig && (
                <GameButton
                  variant="icon"
                  className="piano-chess__settings-btn"
                  onClick={() => setSettingsOpen((open) => !open)}
                  aria-expanded={settingsOpen}
                  aria-label="Settings"
                  title="Settings"
                >
                  <GearIcon />
                </GameButton>
              )}
            </>
          )}
        >
          {/* IN HAND. Not a fact table row — a socket, with the piece sitting in
              it or visibly waiting for one. The way to put it back lives in the
              same tile, because "Put it back" floating on its own asks "put
              WHAT back?" every time the socket is empty. */}
          <GameSlot
            label={<><Icon name="hand-right" /> Piece</>}
            /* Measured above the tallest state this socket has, not guessed —
               see gameChrome.scss. The rail must not step when a piece is
               picked up. */
            reserve="6rem"
            variant={game.origin ? 'active' : null}
            className={`piano-chess__hand${game.origin ? ' piano-chess__hand--holding' : ''}`}
          >
            <div className="piano-chess__hand-slot">
              {game.origin && heldPiece ? (
                /* The SAME artwork the board draws, not a character from a font.
                   fenToPosition yields "wP" — colour plus an UPPERCASE type — so
                   every glyph-table lookup missed and drew a literal "?"; and a
                   unicode chess glyph renders as tofu in the kiosk WebView
                   anyway. A player who picks up their pawn should see their
                   pawn. */
                <img className="piano-chess__hand-piece" src={pieceSource(heldPiece)} alt="" draggable="false" />
              ) : null}
            </div>
            <span className="piano-chess__hand-from">
              {game.origin ? `from ${game.origin}` : <span aria-label="No piece selected">—</span>}
            </span>
          </GameSlot>

          {/* WHAT THE GAME HEARD, in its own voice. It is the game answering
              you, so it is shaped like speech rather than like a field. */}
          <GameSlot
            as="div"
            variant="lift"
            /* Above the TALLEST state, measured (two-line prompt + the
               read-out's square line = 150px). A floor BELOW the tallest state
               reserves nothing — the box still shrinks for shorter messages,
               which is the whole defect.
               Dropped while the onboarding card is up: that card is already
               taller than the reservation, so holding BOTH heights at once just
               pushes the last gesture cards off the foot of the rail. The
               reservation exists to stop the rail stepping, and a slot that is
               taller than its reservation for four consecutive steps is not
               stepping. */
            reserve={onboardCopy ? null : '5.5rem'}
            className="piano-chess__says"
          >
            <ChordReadout
              heldNotes={heldNotes}
              chord={reading ? null : cursorChord}
              square={cursor}
              connected={connected}
              settling={heldNotes.length >= minNotes && candidates.length > 0 && !cursor}
              minNotes={minNotes}
              isReading={reading}
            />
            {onboardCopy && (
              <aside className="chess-onboard" key={onboardStep}>
                <span className="chess-onboard__step">
                  {`Step ${ONBOARD_ORDER.indexOf(onboardStep) + 1} of ${ONBOARD_ORDER.length}`}
                </span>
                <strong className="chess-onboard__title">{onboardCopy.title}</strong>
              </aside>
            )}
            {/* The deadline on that sentence, made visible. Keyed on the arming
                instant so each fresh hover restarts the run; aria-hidden because
                the prompt beside it already speaks the instruction, and a bar
                that announced itself would talk over every hover. */}
            {pickupDeadline !== null && (
              <div
                key={pickupDeadline}
                /* The key restarts the CSS run; the attribute is that same
                   instant made observable, so "it re-armed" is a fact a test
                   can read rather than an animation it has to infer. */
                data-armed-at={pickupDeadline}
                className="piano-chess__window"
                style={{ '--pc-window-ms': `${DOUBLE_WINDOW_MS}ms` }}
                aria-hidden="true"
              >
                <span className="piano-chess__window-bar" />
              </div>
            )}
          </GameSlot>

          {/* WHAT ELSE YOU CAN PLAY. Drawn as keys, because no child can act on
              "a run of three adjacent semitones". */}
          <GestureCards
            /* The rail is carrying the onboarding card too; tighten so the last
               two gestures stay on screen rather than clipping off the foot. */
            compact={!!onboardCopy}
            gestures={[
              {
                id: 'octave',
                pressed: [0, 12],
                title: 'Put it back',
                active: !!game.origin,
                muted: !game.origin,
              },
              {
                id: 'legal',
                pressed: [0, 1, 2],
                title: 'Show moves',
                active: help.legal,
              },
              {
                id: 'best',
                pressed: [0, 1, 2, 3],
                title: 'Best move',
                active: !!help.best,
              },
              {
                id: 'replay',
                pressed: [0, 1, 2, 3, 4],
                title: 'Show that again',
                active: !!replay,
                muted: !game.history.length,
              },
              {
                id: 'takeback',
                pressed: [0, 12],
                repeat: 2,
                title: 'Take it back',
                note: takebackNote({
                  check: takebackCheck,
                  willCount: takebackWillCount,
                  opponentName: opponent?.name ?? null,
                }),
                active: takebackArmed,
                muted: !takebackCheck.allowed,
              },
            ]}
          />
        </GameRail>

        <ChessBoard
          fen={replay?.phase === 'rewind' ? replay.fen : game.game.fen}
          status={game.status}
          orientation={playerColor === 'b' ? 'black' : 'white'}
          fileLabels={fileLabels}
          rankLabels={rankLabels}
          selected={game.origin}
          heldSquare={game.origin}
          /* Shape as well as text. The board has always had a dot-and-ring
             channel for "you can go here" and this host never passed it, so
             where a piece could move was answerable only by reading a chord
             name off each square — and not at all when the labels are
             configured off. A dot reads across a room; the badge confirms it
             up close. */
          destinations={originDestinations}
          /* Only while the notice is fresh, so the rim announces a re-deal
             exactly when the caption does and then stops. */
          dealKey={justDealt ? liveScheme.id : null}
          promotedSquare={promotedSquare}
          squareLabels={squareLabels}
          candidates={candidates}
          hintTargets={hintTargets}
          bestMove={help.best}
          rejectedSquare={cues.flashRejected ? game.rejection?.square ?? null : null}
          rejectedKey={game.rejection?.seq ?? null}
          lastMove={game.lastMove}
          cursorSquare={cursor}
          ghost={ghost}
          /* The rewind is scaffolding and snaps; only the forward pass is
             paced, at half the normal tempo so a missed move can be followed. */
          moveDurationMs={replay ? (replay.phase === 'rewind' ? 1 : REPLAY_MOVE_MS) : moveDurationMs}
        />

        {/* THE CHORD RAIL — a mirror of the hands, in both vocabularies at once:
            the name for the speller, the notation for the reader. It reports;
            it does not teach theory, which is why there is no circle here. */}
        <GameRail label="Your hands" className="piano-chess__rail piano-chess__rail--chords">
          {/* Whose game this is, whose turn it is, and which colour you have.
              All three were already computed and none of them was ever drawn —
              the first questions anyone asks on sitting down, answered nowhere
              on the screen. The turn chip carries a state class as well as its
              words, so "am I up?" is answerable without reading. */}
          <ChessClock
            history={game.history}
            startedAt={startedAt}
            turn={game.status?.turn}
            timing={timing}
            gameOver={!!game.status?.game_over}
            playerColor={playerColor}
          />
          <section className="piano-chess__identity">
            <span className="piano-chess__identity-player">
              <ProfileAvatar id={playerAvatarId} name={displayName} size={64} />
              <span>{displayName}</span>
            </span>
            <span
              className={`piano-chess__turn${game.status?.turn === playerColor ? ' piano-chess__turn--mine' : ''}`}
            >
              {game.status?.game_over ? `Game over (${turnColour} to move)` : turnLabel}
            </span>
          </section>
          {/* Who you are playing, and what they are doing. Above the chord
              read-outs because it is about the game, not about your hands. */}
          {/* Who you are playing. The ladder names a character; without one
              (a guest, or before it resolves) the rail still has to say what
              strength is on the other side of the board, so it falls back to
              the rung the settings panel sets. */}
          <GameSlot label="Opponent" className="piano-chess__opponent">
            {opponent ? (
              <button
                type="button"
                className="piano-chess__opponent-btn"
                onClick={() => setRosterOpen(true)}
                aria-label={`${opponent.name} — see all opponents`}
              >
                <OpponentPortrait
                  opponent={opponent}
                  level={ladderLevel}
                  status={opponentLine}
                  size="lg"
                  /* The pulse is driven by the REAL think time for this rung,
                     not a boolean — a strong character visibly broods longer.
                     The mood is layered on top of it. */
                  thinkMs={thinkMs}
                  mood={mood}
                  speech={opponentSpeech}
                  reactionKey={`mood-${mood}-${game.history.length}`}
                />
              </button>
            ) : (
              <p className="piano-chess__opponent-rung">
                <span className="piano-chess__opponent-rung-name">
                  {rung?.label ?? (rungId.charAt(0).toUpperCase() + rungId.slice(1))}
                </span>
                <span className="chess-opponent__status">{opponentLine}</span>
              </p>
            )}
            {ladder?.status && !ladder.status.at_top && ladder.persisted && (
              /* Was an unstyled <p> in a class with no rules anywhere — the
                 one place on this screen that still spelled a tally out. */
              <WinTally
                label={`to beat ${opponent?.name ?? 'them'}`}
                wins={ladder.status.wins}
                needed={ladder.status.needed}
              />
            )}
          </GameSlot>

          <h2 className="pg-slot__label">Playing</h2>
          <ChordNamePanel midiNotes={heldNotes} />
          {/* Notation is ink, so it needs paper. Same card the other games put
              their staves on, rather than staff lines floating on charcoal. */}
          <div className="piano-chess__staff-card action-staff">
            <CurrentChordStaff activeNotes={activeNotes} />
          </div>
          <div className="piano-chess__captured">
            {/* A dash for every row is a non-answer taking up the foot of the
                rail. Nothing taken yet is one quiet line; once there is
                something to report, only the side that has taken anything
                speaks. */}
            {!captured.w.length && !captured.b.length ? (
              <p className="piano-chess__captured-none">No pieces taken yet</p>
            ) : ['w', 'b'].filter((color) => captured[color].length).map((color) => (
              <div key={color} className="piano-chess__captured-row">
                <span className="pg-slot__label">{color === 'w' ? 'White took' : 'Black took'}</span>
                <span className="piano-chess__captured-pieces">
                  {/* Artwork, not unicode chess glyphs — those render as tofu in
                      the kiosk WebView, which this file already says twelve
                      lines above GearIcon and then did anyway here.
                      Sorted cheapest-first so the row reads as a tally and the
                      biggest thing taken lands at the end. A capture by White
                      removes a BLACK piece, hence the flip. */}
                  {[...captured[color]]
                    .sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b))
                    .map((piece, index) => (
                      <img
                        key={`${piece}-${index}`}
                        className="piano-chess__captured-piece"
                        src={pieceSource(`${color === 'w' ? 'b' : 'w'}${piece.toUpperCase()}`)}
                        alt=""
                        aria-hidden="true"
                        draggable="false"
                      />
                    ))}
                </span>
              </div>
            ))}
          </div>
        </GameRail>
      </div>

      <GameStatusBar
        className="piano-chess__status"
        aside={shuffleEachTurn
          ? (justDealt ? 'New chord map — read the edges' : 'Map changes every turn')
          : null}
      >
        <span className="piano-chess__prompt">
          {opponentError ?? onboardCopy?.body ?? prompt}
        </span>
        {opponentError && (
          <GameButton variant="ghost" onClick={retryOpponent}>Retry</GameButton>
        )}
      </GameStatusBar>

      {/* The start of the game, given a moment. Same placement as the result
          card — over the board, so the position is never hidden from view. */}
      {opening && !game.status?.game_over && (
        <div className="chess-opening" role="status">
          <p className="chess-opening__vs">
            {playerColor === 'w' ? 'White' : 'Black'} versus {opponent?.name || rung?.label || 'the engine'}
          </p>
          <p className="chess-opening__lead">
            {playerColor === 'w' ? 'Your move' : 'They open'}
          </p>
        </div>
      )}

      {/* The end of the game, given a moment. Over the board rather than
          instead of it — the position that produced the result is the first
          thing anyone wants to look at. */}
      {game.status?.game_over && finishedRecord && (
        <ChessResult
          result={finishedRecord.result}
          outcome={game.status.outcome}
          opponent={opponent}
          level={ladderLevel}
          record={finishedRecord}
          timing={endTiming}
          ladder={ladderOutcome}
          onPlayAgain={restart}
        />
      )}

      {toast && (
        <output className="piano-chess__toast" key={toast.seq}>{toast.text}</output>
      )}

      {rosterOpen && ladder?.roster?.length > 0 && (
        <OpponentRosterModal
          roster={ladder.roster}
          unlockedThrough={ladder.unlocked_through}
          onClose={() => setRosterOpen(false)}
        />
      )}

      {settingsOpen && chessConfig && (
        <ChessSettingsPanel
          config={chessConfig}
          rungId={rungId}
          onChange={applySetting}
          onClose={() => setSettingsOpen(false)}
        />
      )}

    </PianoGameHost>
  );
}

export default PianoChessGame;
