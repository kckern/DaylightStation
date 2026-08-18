import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chooseMove } from '@shared-gaming/chess/opponent.mjs';
import { LADDER_SIZE } from '@shared-gaming/chess/ladder.mjs';
import { legalDestinations } from '@shared-gaming/chess/engine.mjs';
import { fenToPosition } from '@shared-gaming/chess/position.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { pieceSource } from '../../Chess/pieceAssets.js';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import { GameRail, GameSlot, GameButton, WinTally } from '../game-platform/chrome/index.js';
import { resolveAddressing } from '../game-platform/addressing/resolveAddressing.js';
import { schemeFor } from '../game-platform/addressing/buildScheme.js';
import GearIcon from '../game-platform/chrome/GearIcon.jsx';
import { useAddressingLadder } from '../game-platform/addressing/useAddressingLadder.js';
import ChordNamePanel from '../components/ChordNamePanel.jsx';
import CurrentChordStaff from '../components/CurrentChordStaff.jsx';
import ChordReadout from './ChordReadout.jsx';
import ChessClock from './ChessClock.jsx';
import ChessResult from './ChessResult.jsx';
import { playCue } from './chessSounds.js';
import { onboardingCopy, onboardingStep, shouldOnboard } from './chessOnboarding.js';
import { elapsedBySide, resolveTiming } from './chessClock.js';
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';
import { usePianoMidiOptional, usePianoMidiNotesOptional } from '../PianoKiosk/PianoMidiContext.jsx';
import { useAnyKeyToContinue } from '../game-platform/input/useAnyKeyToContinue.js';
import { keyFallbackNeeded } from '../game-platform/input/touchCapability.js';
import { usePlayerLock } from '../PianoKiosk/PianoPlaybackContext.jsx';
import {
  archiveGame, beaconArchive, fetchChessConfig, fetchLadder, requestBestMove, requestOpponentMove,
  saveChessConfig, saveGameRecord,
} from './chessApi.js';
import OpponentPortrait, { opponentMood, opponentStatus } from './OpponentPortrait.jsx';
import GestureCards from './GestureCards.jsx';
import { OpponentRosterModal } from './OpponentRoster.jsx';
import { cuesFromConfig } from './chessCues.js';
import ChessSettingsPanel from './ChessSettingsPanel.jsx';
import { CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { DEFAULT_STAFF_SCHEME, isStaffScheme } from './staffAddress.js';
import StaffNoteLabel from './StaffNoteLabel.jsx';
import { candidateSquares } from './chordCandidates.js';
import { destinationBadges } from './chessBadges.js';
import { recognizeGesture } from './chordGestures.js';
import { buildGameRecord } from './chessGameRecord.js';
import { buildGameArchive } from './chessGameArchive.js';
import { advanceCursor, createCursorState } from './chordCursor.js';
import { applyEvent, createSelection, DOUBLE_WINDOW_MS } from './chordSelection.js';
import {
  REJECTION_MESSAGES, applySquare, capturedPieces, clearSelection, commitMove,
  createChessGameState, destinationsFor, fenBefore, isPlayerTurn, takeMoveBack,
} from './chessGameState.js';
import {
  checkTakeback, playerMoveCount, takebackNote, takebackRefusalMessage, willStillCount,
} from './takebackBudget.js';
import './PianoChessGame.scss';

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
/** For the opponent's status line — "Took your knight" reads, "Took your n" does not. */
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
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
export function schemeForAddressing(addressing, fallback = DEFAULT_CHORD_SCHEME) {
  // Two shapes reach here: the shipped `addressing: chords` string, and the
  // whole loaded config once a caller passes its block. Both are the game layer.
  const stated = (addressing && typeof addressing === 'object') ? addressing : { addressing };
  // The fallback carries what this game was already using, so a config that
  // says nothing about vocabulary keeps it rather than dropping to the house
  // default. Chess ships `chords`; the house floor is `staff`.
  const game = { vocabulary: isStaffScheme(fallback) ? 'staff' : 'chords', ...stated };

  const resolved = resolveAddressing({
    game,
    ladder: stated?.addressing?.ladder ?? null,
    axisSize: 8,
  });

  // Seed 0, deliberately: chess re-deals per turn through its OWN
  // `shuffleEachTurn` machinery inside `createChessGameState`, and letting the
  // cadence deal here as well would shuffle an already-shuffled board. The
  // resolver supplies the base material and its layout; chess supplies when it
  // moves.
  const built = schemeFor(resolved, { size: 8, seed: 0, fallback });
  if (!built.valid) {
    logger().warn('addressing.scheme-rejected', { errors: built.errors, source: built.source });
    return fallback;
  }
  return built.scheme;
}

/** A chord takes three notes to name a square; a staff address takes two. */
export const minNotesFor = (scheme) => (isStaffScheme(scheme) ? 2 : 3);

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'piano-chess' });
  return cachedLogger;
}

/** The prompt under the board: what the player should do next, in their terms. */
/**
 * The one sentence on screen that teaches the grammar. It has to name the
 * DOUBLE: a player who plays a piece's chord once gets a hover — the square
 * lights, the read-out agrees, and nothing happens — and if the prompt says
 * "play the chord of the piece you want to move" they have followed it exactly
 * and been answered with silence. When the cursor is already resting on a
 * square, the prompt names that square's own chord, so the instruction is the
 * literal next thing to play rather than a rule to apply.
 */
export function promptFor(state, rejection, hoveredChord = null, reading = false, takebackArmed = false) {
  if (state.status?.game_over) {
    if (state.status.outcome === 'checkmate') {
      return state.status.winner === state.playerColor ? 'Checkmate. You win.' : 'Checkmate. Your opponent wins.';
    }
    return `Draw — ${state.status.outcome.replace(/_/g, ' ')}.`;
  }
  if (rejection) return REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.';
  // Before the turn check on purpose: the moment a player wants this most is
  // while the opponent is still answering the move they regret.
  if (takebackArmed) return 'Play the octave again to take your move back.';
  if (!isPlayerTurn(state)) return 'Your opponent is thinking.';
  if (state.status?.check) return 'You are in check. Play a chord to answer it.';
  if (state.origin) {
    return reading
      ? 'Now play the two notes of the square to move to.'
      : 'Now play the chord of the square to move to.';
  }
  if (hoveredChord) return `Play ${hoveredChord} again to pick that piece up.`;
  return reading
    ? "Play a piece's two notes twice to pick it up."
    : "Play a piece's chord twice to pick it up.";
}

export function PianoChessGame({
  onDeactivate = null,
  gameConfig = null,
  // Supplied by the game platform (PianoVisualizer). Absent only for kiosk
  // callers that rely on PianoMidiProvider being above them.
  activeNotes: activeNotesProp = null,
  connected: connectedProp = null,
  currentUser = null,
  playerColor = gameConfig?.player_color ?? 'w',
  difficulty = gameConfig?.difficulty ?? 'learner',
  scheme = DEFAULT_CHORD_SCHEME,
  shuffleEachTurn: shuffleEachTurnProp = gameConfig?.shuffle_each_turn ?? true,
  seed = null,
  feedback = null,
  // Starting position override. A test seam like `seed`: the game-record test
  // needs a mate-in-one board, and production callers never pass it.
  fen = null,
}) {
  // currentUser may arrive as the resolved profile object or the bare id. Guests
  // (and the no-user case) must never hit the per-user chess endpoints.
  const userSlug = typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null;
  const userId = isPersistentUser(userSlug) ? userSlug : null;

  // The game holds this player's config and writes their record. Switching
  // the kiosk user mid-game would file one player's moves under another's
  // name, so the game keeps whoever started it until it ends. isPersistentUser
  // has already gated a guest to null above, so a locked guest still means "no
  // per-user writes" downstream — the lock preserves that, it doesn't bypass it.
  const lockedUserRef = useRef(userId);
  const lockedUser = lockedUserRef.current;
  // The archive is written from a mount-once cleanup, which sees whatever the
  // refs hold at that moment — so everything it needs lives in a ref, not in a
  // closed-over render value.
  const archivedRef = useRef(false);
  const archiveInputsRef = useRef(null);
  const addressingRef = useRef('chords');
  // The server is the authority on clamping a ladder request. Keep its reply so
  // both history formats state who actually played, rather than merely who the
  // rail happened to show while it was loading.
  const effectiveOpponentRef = useRef(null);
  // The exact position the pending opponent request was asked about — the
  // bundled-engine fallback has to reason about the SAME position, not
  // whatever gameRef happens to hold when the reply finally lands.
  const requestedFenRef = useRef(null);

  // Latching the player internally is not enough: the kiosk chip still offered
  // the switch, so a child could pick themselves mid-game, see the header change
  // to their name, and go on playing someone else's board on someone else's
  // settings. The chip is held shut for as long as the game is open.
  usePlayerLock(true, 'Finish the game to switch players');

  // The merged household+user chess config is the single source for the rung
  // ladder, the cue flags, the opponent delay, and the shuffle preference. The
  // old gameConfig.feedback path is gone on purpose: two config sources for one
  // preference is exactly the drift the chess.yml pair exists to prevent.
  const [chessConfig, setChessConfig] = useState(null);
  // Where this player stands on the opponent ladder. Null until it resolves (and
  // for a guest, whose progress is never persisted), in which case the screen
  // falls back to the named rungs and says nothing it cannot back up.
  const [ladder, setLadder] = useState(null);
  // The character being climbed. Falls back to the named rung's label when the
  // ladder has not resolved, so the rail is never blank and never invents one.
  // Declared here rather than with the other derived values: the opponent
  // effect depends on the level, and a const cannot be read before it exists.
  const opponent = ladder?.current ?? null;
  const ladderLevel = ladder?.unlocked_through ?? null;
  const ladderLevelRef = useRef(ladderLevel);
  ladderLevelRef.current = ladderLevel;
  // True once the ladder fetch has settled at least once — success, failure,
  // or "no ladder" for a guest all count. Firing the opponent's very first
  // request before this resolves would race the level the server is asked to
  // enforce: `ladderLevelRef` would still read its initial `null`, and the
  // request that is supposed to say "Caterpie, skill 0" would say nothing.
  // Every later turn is unaffected — this only guards the opening move.
  const [ladderReady, setLadderReady] = useState(false);
  const [rungId, setRungId] = useState('learner');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Apply immediately, persist to the player's own override layer. Guests get
  // the immediate effect only — userId is null, and the per-user endpoint
  // would (rightly) refuse them.
  const applySetting = useCallback((patch) => {
    setChessConfig((prev) => ({
      ...(prev || {}),
      ...patch,
      feedback: { ...(prev?.feedback || {}), ...(patch.feedback || {}) },
    }));
    if (patch.default_rung) setRungId(patch.default_rung);
    if (lockedUser) saveChessConfig(lockedUser, patch);
    logger().info('setting-applied', { patch, persisted: !!lockedUser });
  }, [lockedUser]);

  // The `feedback` prop survives ONLY as a test seam — production callers must
  // let the chess config speak for itself.
  const cues = { ...DEFAULT_FEEDBACK, ...cuesFromConfig(chessConfig), ...(feedback ?? {}) };
  const opponentDelayMs = chessConfig?.opponent_delay_ms ?? OPPONENT_DELAY_MS;
  // The clock's settings, resolved once here so the board and the archive can
  // never disagree about which control was in force.
  const timing = useMemo(() => resolveTiming(chessConfig), [chessConfig]);
  // Shuffle takes effect on the NEXT game: createChessGameState captures it at
  // construction, so a mid-game change never re-deals the board mid-read.
  const shuffleEachTurn = chessConfig?.shuffle_each_turn ?? shuffleEachTurnProp;
  const rung = chessConfig?.rungs?.find((entry) => entry.id === rungId);
  // Maps the active rung to a bundled difficulty the same way the server adapter
  // would, so a dropped request doesn't quietly change who the player is facing.
  const localFallbackDifficulty = Number.isFinite(rung?.elo) ? 'steady'
    : (rung?.skill ?? 3) <= 2 ? 'beginner'
      : (rung?.skill ?? 3) <= 10 ? 'learner' : 'steady';

  // A fixed seed would deal the same opening map in every game ever played, so
  // the one position a player sees most often would be the one they memorise —
  // precisely what re-dealing exists to prevent. Drawn once per mount.
  const [gameSeed] = useState(() => (
    Number.isFinite(seed) ? Number(seed) >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0)
  ));
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
  const [game, setGame] = useState(() => createChessGameState({
    fen: fen ?? undefined, playerColor, scheme, seed: gameSeed, shuffleEachTurn,
  }));
  // The server engine keeps per-game state keyed on this id, so it has to change
  // on restart — reusing it would let "Play again" find the finished game.
  const [gameId, setGameId] = useState(() => `chess-${Date.now()}`);
  // Mirrored in a ref so an async answer can ask "is this still the same game?"
  // without stale-closure risk — see the best-move validity check below.
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  // The map is re-dealt every turn, so everything that reads chords — the
  // cursor, the rim, the move log — has to follow state, not the prop.
  const liveScheme = game.scheme;
  // Read by the cursor clock, which must not re-subscribe when the map is
  // re-dealt mid-hold.
  const liveSchemeRef = useRef(liveScheme);
  liveSchemeRef.current = liveScheme;
  const [cursor, setCursor] = useState(null);
  const cursorRef = useRef(createCursorState());
  // Naming a square and committing to it are different acts: the selection
  // machine decides which. One chord hovers, the same square twice picks up.
  const selectionRef = useRef(createSelection());
  // The pick-up window, mirrored out of the ref so it can be DRAWN. The double
  // is the one interaction that fails invisibly — a player repeating a chord
  // and getting nothing cannot tell whether they were too slow or misheard —
  // so the deadline has to be visible while it is running, not inferred after
  // it has passed. Mirrored rather than derived because a ref cannot re-render.
  const [armed, setArmed] = useState(null);
  // True from the first tick where the held set reads as a help gesture until
  // the hands are fully off the keys. See the cursor tick for why: a staggered
  // release must not let the gesture's residue land as an unrecognised chord.
  const gestureLatchRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;
  // The takeback is the octave gesture played twice, so the first one has to be
  // remembered — and remembered ONCE. An earlier design held the window in a
  // ref and the prompt in a boolean, which is two clocks that drift: re-arming
  // called setTakebackArmed(true) on a value already true, React bailed out of
  // the render, the disarm effect never re-ran, and the FIRST octave's timer
  // then cleared the prompt while the ref had advanced to the second. Under
  // main-thread jank that lands a rewind with no armed prompt on screen —
  // exactly the accident the arming step exists to prevent.
  //
  // So the timestamp IS the state, and the ref only mirrors it for the tick
  // (which is mount-stable and cannot read render values), the same way gameRef
  // mirrors game below.
  const [armedAt, setArmedAt] = useState(0);
  const takebackArmed = armedAt > 0;
  const armedAtRef = useRef(0);
  armedAtRef.current = armedAt;
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
  // resolve — so it captured the prop fallback for shuffle_each_turn, and
  // commitMove re-deals from that CAPTURED value while the rail notice reads
  // the loaded one. If the player has not touched the game yet, re-deal it
  // under the loaded preference so the saved setting is real from the first
  // move; once a chord or move has landed the board must not rearrange under
  // them, and the captured value stands until the next game.
  useEffect(() => {
    let cancelled = false;
    fetchChessConfig(lockedUser).then((loaded) => {
      if (cancelled || !loaded) return;
      setChessConfig(loaded);
      setRungId(loaded.default_rung || 'learner');
      const loadedShuffle = loaded.shuffle_each_turn;
      // The addressing vocabulary is a per-player setting, so it can only be
      // known once that player's config layer has resolved — after the game was
      // built. Same rule as the shuffle: adopt it while the game is untouched,
      // never rearrange the board under a player mid-move.
      const loadedScheme = schemeForAddressing(loaded, scheme);
      setGame((current) => {
        const untouched = current.history.length === 0 && !current.origin;
        const nextShuffle = typeof loadedShuffle === 'boolean' ? loadedShuffle : current.shuffleEachTurn;
        if (!untouched) return current;
        if (current.shuffleEachTurn === nextShuffle && current.scheme?.id === loadedScheme.id) return current;
        return createChessGameState({
          fen: fen ?? undefined, playerColor, scheme: loadedScheme, seed: gameSeed, shuffleEachTurn: nextShuffle,
        });
      });
      logger().info('config-loaded', { default_rung: loaded.default_rung, rungs: loaded.rungs?.length });
    });
    return () => { cancelled = true; };
    // fen, playerColor, scheme, and gameSeed are mount-stable (props + one-shot state).
  }, [lockedUser, fen, playerColor, scheme, gameSeed]);

  // Leaving the PAGE, as opposed to leaving the component. A tab close, a kiosk
  // reload after a deploy, or the screen going to sleep never runs a React
  // cleanup, and those are the ordinary ways a game ends on this instrument —
  // so without this the archive quietly only ever holds in-app exits.
  useEffect(() => {
    const flush = () => {
      if (archivedRef.current || !archiveInputsRef.current) return;
      const archive = buildGameArchive({ ...archiveInputsRef.current, endedAt: Date.now(), endedBy: 'left' });
      if (!archive) return;
      archivedRef.current = true;
      if (!beaconArchive(archive)) archiveGame(archive);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLadder(lockedUser).then((loaded) => {
      if (cancelled) return;
      setLadderReady(true);
      if (!loaded) return;
      ladderLevelRef.current = loaded.unlocked_through ?? null;
      setLadder(loaded);
      logger().info('ladder-loaded', {
        level: loaded.unlocked_through,
        opponent: loaded.current?.name,
        wins: loaded.status?.wins,
        needed: loaded.status?.needed,
        persisted: loaded.persisted,
      });
    });
    return () => { cancelled = true; };
  }, [lockedUser]);

  /**
   * The opening beat.
   *
   * The screen used to mount straight into a live board — no moment that says a
   * game has begun or who is on the other side of it. One banner, dismissed by
   * a timer or by the first move, whichever comes first: it must never be
   * something a child has to wait out.
   */
  const [opening, setOpening] = useState(true);

  /**
   * The replay's two beats: rewind instantly, then play forward slowly.
   *
   * Two phases rather than one because the jump backwards is not the thing
   * worth watching — it is scaffolding. Only the forward pass is paced.
   */
  const [replay, setReplay] = useState(null);
  useEffect(() => {
    if (!replay) return undefined;
    if (replay.phase === 'rewind') {
      const timer = setTimeout(() => setReplay((prev) => (prev ? { ...prev, phase: 'play' } : null)), REPLAY_HOLD_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setReplay(null), REPLAY_MOVE_MS + 120);
    return () => clearTimeout(timer);
  }, [replay]);

  // A move landing mid-replay retires it: the board must never show a position
  // the game has already moved past.
  useEffect(() => { setReplay(null); }, [game.history.length]);

  useEffect(() => {
    if (!opening) return undefined;
    // Cleared by the first move too (below), so this is a ceiling and not a
    // wait: a child who starts playing immediately never sees it linger.
    const timer = setTimeout(() => setOpening(false), OPENING_MS);
    return () => clearTimeout(timer);
  }, [opening]);

  useEffect(() => {
    if (opening && game.history.length) setOpening(false);
  }, [opening, game.history.length]);

  // One completed move is the whole lesson. Written once, and only for a
  // signed-in player — a guest has nowhere to remember it.
  const introSavedRef = useRef(false);
  useEffect(() => {
    if (introSavedRef.current || !game.history.length) return;
    if (!lockedUser || chessConfig?.seen_intro === true) return;
    introSavedRef.current = true;
    saveChessConfig(lockedUser, { seen_intro: true });
  }, [game.history.length, lockedUser, chessConfig?.seen_intro]);

  const heldNotes = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const heldKey = heldNotes.join(',');
  // The cursor clock reads these rather than closing over them — see the effect
  // below for why. `anyNotesHeld` is its only reactive input: a boolean changes
  // twice per chord instead of once per note.
  const heldNotesRef = useRef(heldNotes);
  heldNotesRef.current = heldNotes;
  const anyNotesHeld = heldNotes.length > 0;

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
  /**
   * The same map, reachable from the cursor clock.
   *
   * That clock ticks every 25ms for as long as keys are held and asked
   * `destinationsFor` on each tick — a fresh `new Chess(fen)` and a full move
   * generation forty times a second, on the hottest path in the screen. The FEN
   * rides along because the tick can run between a state update and the render
   * that follows it; when they disagree the map is stale and the engine is the
   * only correct answer.
   */
  const legalMapRef = useRef({ fen: game.game.fen, map: legalMap });
  legalMapRef.current = { fen: game.game.fen, map: legalMap };
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

  // Help is per-move, not per-press: mashing the cluster cannot inflate the
  // tally, and the marks clear themselves when the move they helped with
  // completes. `best` goes to the analysis endpoint, which is never handicapped
  // — a hint only as strong as a beginner's opponent is not a hint, and the
  // lower ladder rungs are now a deliberately-weak teaching engine.
  const [help, setHelp] = useState({ legal: false, best: null });
  const [helpUsed, setHelpUsed] = useState({ hints: 0, bestMoves: 0, takebacks: 0 });
  // The takeback callback is mount-stable, so it cannot close over this render's
  // helpUsed directly — it reads the tally through this ref instead.
  const helpUsedRef = useRef(helpUsed);
  helpUsedRef.current = helpUsed;
  // One best-move request at a time: `help.best` is still null while the server
  // thinks, so without this gate a re-gesture mid-flight would queue a second
  // request (and, worse, a second charge).
  const bestPendingRef = useRef(false);
  // Help is only valid for the position it was asked about. A hint gestured on
  // the opponent's turn can show nothing (playableSources is empty) and would
  // be wiped by their reply before the turn returns, so charging it would put
  // an untruth in the record. A best-move ANSWER is checked the same way on
  // arrival rather than at gesture time: the request may leave whenever the
  // player asks, but the answer is drawn — and charged — only if the position
  // it was computed for is still on the board, in the same game, with the
  // player on move. Anything else is an answer about a board that no longer
  // exists, and drawing it would be a lie.
  useEffect(() => {
    if (gesture === 'hint' && !help.legal) {
      if (!isPlayerTurn(gameRef.current)) {
        logger().info('help-ignored', { kind: 'legal', reason: 'not_player_turn' });
        return;
      }
      setHelp((prev) => ({ ...prev, legal: true }));
      setHelpUsed((prev) => ({ ...prev, hints: prev.hints + 1 }));
      logger().info('help-requested', { kind: 'legal' });
    }
    /**
     * "Show me that again."
     *
     * Rewinds the board to before the last exchange and plays it forward at
     * half speed. The archive already keeps every move, so nothing new is
     * stored — the position is replayed from the start of the game, which is
     * the only source that cannot fall out of step with a takeback.
     *
     * Never charged as help: it shows what already happened in full view, and
     * tells the player nothing they were not entitled to see the first time.
     */
    if (gesture === 'replay' && !replay) {
      const live = gameRef.current;
      // The last exchange is their reply plus the move that provoked it; on the
      // very first ply there is only one.
      const plies = Math.min(2, live.history.length);
      const from = plies ? fenBefore(live, plies) : null;
      if (from) {
        setReplay({ fen: from, phase: 'rewind' });
        logger().info('replay-requested', { plies });
      }
    }
    if (gesture === 'best' && !help.best && !bestPendingRef.current) {
      bestPendingRef.current = true;
      const askedFen = gameRef.current.game.fen;
      const askedGameId = gameIdRef.current;
      logger().info('help-requested', { kind: 'best' });
      requestBestMove({ fen: askedFen, userId: lockedUser }).then((move) => {
        bestPendingRef.current = false;
        // Charged only when a move actually arrives: the record holds facts,
        // and "1 best move" the player never received is not one.
        if (!move) return;
        const live = gameRef.current;
        const stillValid = gameIdRef.current === askedGameId
          && live.game.fen === askedFen
          && isPlayerTurn(live);
        if (!stillValid) {
          logger().info('help-answer-stale', {
            kind: 'best',
            asked_fen: askedFen,
            live_fen: live.game.fen,
            same_game: gameIdRef.current === askedGameId,
            player_turn: isPlayerTurn(live),
          });
          return;
        }
        setHelp((prev) => ({ ...prev, best: { from: move.from, to: move.to } }));
        setHelpUsed((prev) => ({ ...prev, bestMoves: prev.bestMoves + 1 }));
      });
    }
    // The gesture alone triggers; everything else is read at the moment it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture]);
  // The marks clear when a move lands — not on mount, where this effect also
  // fires and would wipe a gesture armed on the very first render.
  const moveCount = game.history.length;
  useEffect(() => {
    // The board changed underneath the selection: a hover from before the
    // opponent moved must not combine with one after it into a pick-up.
    selectionRef.current = createSelection();
    if (moveCount === 0) return; // fresh board: restart() already reset help
    setHelp({ legal: false, best: null });
  }, [moveCount]);

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
      shuffle_each_turn: shuffleEachTurn, seed: gameSeed,
    });
    if (game.schemeRejected) logger().warn('scheme-rejected', game.schemeRejected);
  }, [difficulty, game.schemeRejected, gameSeed, playerColor, scheme.id, shuffleEachTurn]);

  /**
   * The archive, on the way out — and ONLY on the way out.
   *
   * This was originally the cleanup of the effect above, which has dependencies:
   * when the config resolved and flipped shuffle_each_turn, that effect tore
   * down and re-ran, so the game was archived MID-GAME and `archivedRef` was set
   * — meaning the real end-of-game archive was then skipped. In the logs it also
   * looked like the component was remounting on every entry, which it never was.
   * An unmount effect must have no dependencies; everything it needs is a ref.
   */
  useEffect(() => () => {
    logger().info('unmounted');
    if (archivedRef.current || !archiveInputsRef.current) return;
    const archive = buildGameArchive({ ...archiveInputsRef.current, endedAt: Date.now(), endedBy: 'left' });
    if (!archive) return; // no moves played — not a game
    archivedRef.current = true;
    archiveGame(archive);
  }, []);

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
    // The clock reads move timestamps rather than running its own counter, so
    // "now" is stamped at the moment the move lands and everything downstream —
    // the clock face, the archived think times, the post-game timing analysis —
    // derives from these.
    const { state, event } = applySquare(gameRef.current, square, Date.now());
    setGame(state);
    if (event.type === 'rejected') {
      announce(state, 'rejected');
      logger().debug('chord-rejected', { square, reason: event.reason });
    } else if (event.type === 'moved' || event.type === 'game_over') {
      announce(state);
      logger().info('move-played', { san: event.move.san, chords: state.history.at(-1)?.chords });
    } else logger().debug(`chord-${event.type}`, { square });
  }, []);

  const [rosterOpen, setRosterOpen] = useState(false);
  const [toast, setToast] = useState(null);

  /**
   * The READING ladder — how well this player addresses squares, which is a
   * different question from how well they play chess and moves on its own rung.
   * `saveChessConfig` is the same deep-merged config write every other setting
   * uses, so a rung earned here lands beside the opponent ladder.
   */
  const readingLadder = useAddressingLadder({
    client: { writeConfig: saveChessConfig },
    gameId: 'chess',
    userId: lockedUser,
    config: chessConfig,
    logger: logger(),
  });

  // Time-to-address runs from when it became this player's turn.
  const myTurn = !game.status?.game_over && game.status?.turn === playerColor;
  useEffect(() => { if (myTurn) readingLadder.startTurn(); }, [myTurn]);

  /**
   * A landed address, counted once per ply.
   *
   * History length is the honest signal: a chord that named a square and moved a
   * piece is an address that worked. Counting `preview` events instead would
   * count every hover on the way to a decision, which measures browsing rather
   * than addressing.
   */
  const addressedPliesRef = useRef(0);
  useEffect(() => {
    if (game.history.length <= addressedPliesRef.current) {
      addressedPliesRef.current = game.history.length;
      return;
    }
    addressedPliesRef.current = game.history.length;
    readingLadder.record({ ok: true });
    // Chess logged errors and nothing else — no record of a move ever landing.
    // A game that stops accepting input looked identical to one nobody touched.
    const last = game.history[game.history.length - 1];
    logger().info('chess.move', {
      from: last?.from ?? null, to: last?.to ?? null, san: last?.san ?? null,
      ply: game.history.length, turn: game.turn ?? null,
    });
  }, [game.history.length]);

  const rejection = game.rejection;

  // A refused chord is an address that did not land — exactly what accuracy is.
  useEffect(() => {
    if (rejection?.seq === undefined) return;
    readingLadder.record({ ok: false });
    // The reason is the whole point: "why won't it take my move" is otherwise
    // unanswerable from outside the room.
    logger().info('chess.rejected', {
      reason: rejection.reason ?? null, square: rejection.square ?? null, ply: game.history.length,
    });
  }, [rejection?.seq]);
  useEffect(() => {
    if (!rejection || !cues.toast) return undefined;
    setToast({ text: REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.', seq: rejection.seq });
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [cues.toast, rejection]);

  // One record per finished game; "Play again" starts the bookkeeping over.
  const recordedRef = useRef(false);
  const startedAtRef = useRef(Date.now());
  // The record that just got saved (or would have, for a guest), held so the
  // end screen can read the SAME numbers back. One source: the rail's tallies
  // and the stored record can never disagree, because they are one object.
  const [finishedRecord, setFinishedRecord] = useState(null);
  // The server's promotion verdict for the game just played, when there is one.
  const [ladderOutcome, setLadderOutcome] = useState(null);

  const restart = useCallback(() => {
    setGame(createChessGameState({
      fen: fen ?? undefined, playerColor, scheme, seed: gameSeed + 1, shuffleEachTurn,
    }));
    setGameId(`chess-${Date.now()}`);
    // A new game re-latches to whoever is at the kiosk NOW — the previous
    // lock belonged to the game that just ended, not to this one.
    lockedUserRef.current = userId;
    setToast(null);
    setHelp({ legal: false, best: null });
    setHelpUsed({ hints: 0, bestMoves: 0, takebacks: 0 });
    lastTakebackAtRef.current = null;
    setArmedAt(0);
    setFinishedRecord(null);
    setLadderOutcome(null);
    setOpening(true);
    selectionRef.current = createSelection();
    // A best-move ask still in flight belongs to the finished game. Its answer
    // is already doomed by the game-id check; clearing the gate here means the
    // new game may ask again immediately instead of waiting it out.
    bestPendingRef.current = false;
    recordedRef.current = false;
    startedAtRef.current = Date.now();
    logger().info('restarted');
  }, [fen, gameSeed, playerColor, scheme, shuffleEachTurn, userId]);

  // "Play again" is a button, and the office screen has no finger for it. Any
  // fresh key restarts; the keys still down from the mating move do not count,
  // so the result stays on screen long enough to read.
  useAnyKeyToContinue({
    enabled: keyFallbackNeeded(gameConfig) && !!game.status?.game_over,
    activeNotes, onContinue: restart,
  });


  /**
   * The rewind, budget first.
   *
   * The budget is checked before the rules are, so a player out of takebacks is
   * told that rather than being told there is nothing to take back — two very
   * different sentences, and only one of them is true.
   */
  const attemptTakeback = useCallback(() => {
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
    setGame(state);
    setHelpUsed((prev) => ({ ...prev, takebacks: prev.takebacks + 1 }));
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
  }, []);

  const cancelSelection = useCallback(() => {
    setGame((current) => (current.origin ? clearSelection(current) : current));
    logger().debug('selection-cancelled');
  }, []);

  // A keyboard Escape does the same thing, so the game is recoverable from a
  // desk as well as from the bench.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') cancelSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelSelection]);

  /**
   * The cursor has to be driven by a clock, not only by note events: the settle
   * window elapses in silence, after the last key is already down.
   *
   * Driven from refs, and keyed on WHETHER anything is held rather than on what.
   * Reading `heldNotes` directly put it in the dependency list, so a 40Hz
   * interval was torn down and rebuilt on every note on and off — three to five
   * times per chord, on the weakest device in the house, for a timer whose only
   * job is to notice silence.
   *
   * The interval also stops itself. Going idle cannot be expressed as a
   * dependency (the cursor's own memory outlives the keys by one tick), so the
   * tick that drains it clears its own timer.
   */
  useEffect(() => {
    if (!heldNotesRef.current.length && !cursorRef.current.held.length) return undefined;
    let timer = null;
    let stopped = false;
    const tick = () => {
      // Read before advancing: on the release tick the live set is already
      // empty, and the question is what WAS down. A recognised cluster is a
      // request for help, never chord input — its release must not land as an
      // unrecognised-chord refusal, nor be scolded for a quick tap.
      const wasGesture = !!recognizeGesture(cursorRef.current.held);
      // A human does not lift three fingers at once, so the LAST pre-release
      // set is often only the tail of the gesture — two notes, not a cluster.
      // The latch remembers that a gesture was held at ANY point since the
      // hands went down, and stands until they are fully off the keys. While
      // it stands, a null-square commit (the gesture's own residue) and a
      // refusal is swallowed; a commit that names a real square still plays, so
      // a gesture flowing straight into a chord without a full release behaves
      // as chord input.
      if (wasGesture) gestureLatchRef.current = true;
      const { state, event } = advanceCursor(
        cursorRef.current, heldNotesRef.current, Date.now(), { scheme: liveSchemeRef.current },
      );
      cursorRef.current = state;
      const latched = gestureLatchRef.current;
      if (!state.held.length) gestureLatchRef.current = false;
      if (!event) return;
      if (event.type === 'preview') setCursor(event.square);
      if (event.type === 'escape') {
        setCursor(null);
        const current = gameRef.current;
        const at = Date.now();
        if (current.status?.game_over) {
          restart();
        } else if (current.origin) {
          // A piece in hand is the first thing an octave means, and always has
          // been. Putting it back also restarts the double window, so the very
          // next octave arms the takeback rather than firing it.
          cancelSelection();
          setArmedAt(0);
        } else if (armedAtRef.current && at - armedAtRef.current <= DOUBLE_WINDOW_MS) {
          setArmedAt(0);
          attemptTakeback();
        } else {
          // With nothing in hand this used to do nothing at all, silently. Now
          // it says what a second one would do — which is both how the gesture
          // is discovered and why an idle octave can never rewind a game by
          // accident.
          // A fresh timestamp every time, so re-arming always re-renders and
          // always replaces the disarm timer. That is the whole fix for the
          // two-clock drift described at the state declaration.
          setArmedAt(at);
          logger().debug('takeback-armed', { moves_played: current.history.length });
        }
      }
      if (event.type === 'commit') setCursor(null);
      // Preview is visual feedback only. Every chess action waits for the full
      // release, so a major triad heard while a seventh is still arriving can
      // never pick up or drop on the triad's square. The gesture latch solves a
      // separate problem: staggered cluster release landing as a false refusal.
      if (event.type === 'preview' || event.type === 'commit') {
        if (wasGesture || (latched && !event.square)) return;
        const current = gameRef.current;
        const holdingPiece = Boolean(current.origin);
        // Read from the memoized map when it matches the position being
        // acted on; fall back to the engine only when this tick has outrun the
        // render that would have refreshed it.
        const cached = legalMapRef.current;
        const reach = holdingPiece
          ? (cached.fen === current.game.fen
            ? (cached.map[current.origin] ?? EMPTY_ARRAY)
            : destinationsFor(current, current.origin))
          : EMPTY_ARRAY;
        const isEligible = holdingPiece && reach.includes(event.square);
        const at = Date.now();
        const previous = selectionRef.current;
        const { selection, action } = applyEvent(previous, {
          type: event.type, square: event.square, at, holdingPiece, isEligible,
        });
        selectionRef.current = selection;
        // Armed is not a fourth thing to keep in sync — it is exactly the
        // machine's own memory of "a repeat of this square would be a double",
        // read straight back out. Identity is held stable so the countdown
        // animation restarts only on a genuine re-arm, never on a re-render.
        setArmed((prev) => {
          const next = selection.lastSquare
            ? { square: selection.lastSquare, at: selection.lastAt }
            : null;
          if (!prev && !next) return prev;
          if (prev && next && prev.square === next.square && prev.at === next.at) return prev;
          return next;
        });
        // The double-play is the one interaction that fails INVISIBLY: a player
        // repeating a chord and getting nothing cannot tell whether they were
        // too slow, too fast, or heard as a different square. Log the interval
        // so the next report is answerable from the logs instead of guessed at.
        if (event.type === 'commit' && !holdingPiece && event.square) {
          const sameSquare = previous.lastSquare === event.square;
          const elapsed = sameSquare ? at - previous.lastAt : null;
          if (action.type === 'pickup') {
            logger().info('pickup', { square: event.square, sinceFirstMs: elapsed });
          } else if (sameSquare) {
            logger().info('pickup-window-missed', {
              square: event.square, sinceFirstMs: elapsed, windowMs: DOUBLE_WINDOW_MS,
            });
          } else if (previous.lastSquare) {
            logger().debug('pickup-reset', { was: previous.lastSquare, now: event.square });
          }
        }
        if (action.type === 'hover') setCursor(action.square);
        if (action.type === 'pickup' || action.type === 'drop') {
          // What an octave means has just changed: with a piece in hand it puts
          // the piece back. An arm left standing would promise a rewind that the
          // next octave will not perform.
          setArmedAt(0);
          handleSquare(action.square);
        }
        if (action.type === 'refuse') handleSquare(null);
        // 'none' changes nothing, deliberately.
      }
      // Idle: the keys are up and the cursor's memory of them has drained.
      // Nothing further can happen until a note arrives, and a note arriving
      // re-runs this effect.
      if (!heldNotesRef.current.length && !cursorRef.current.held.length) {
        stopped = true;
        if (timer) { clearInterval(timer); timer = null; }
      }
    };
    // Run once immediately: on the release re-run this processes the lift on the
    // spot rather than up to a tick later.
    tick();
    if (!stopped) timer = setInterval(tick, CURSOR_TICK_MS);
    return () => { if (timer) clearInterval(timer); };
  }, [attemptTakeback, cancelSelection, handleSquare, anyNotesHeld, restart]);

  // The armed prompt has to expire with the window it describes, or it would
  // stand there offering a takeback that the next octave no longer performs.
  useEffect(() => {
    if (!armedAt) return undefined;
    const timer = setTimeout(() => setArmedAt(0), DOUBLE_WINDOW_MS);
    return () => clearTimeout(timer);
    // Keyed on the TIMESTAMP, not on a boolean: re-arming inside the window
    // changes armedAt, so this tears down the old timer and starts a new one.
  }, [armedAt]);

  // The opponent's reply is a floor on the wait, never an addend: the request
  // goes out the instant it becomes this character's turn, and the move
  // lands at max(elapsed, thinkMs) — see opponentPacing.js. The OLD version
  // of this effect waited `opponentDelayMs` and only THEN sent the request,
  // which added the round trip on top of the pause; on the kiosk tablet,
  // where WiFi is known to stall silently, that turned a deliberate brood
  // into a hang. `thinkTimeFor` also makes the pause SCALE with the rung —
  // fast at the bottom of the ladder, slow at the top — rather than one flat
  // number for all twenty-one characters.
  //
  // `resetKey: gameId` covers what `enabled` alone cannot: a fresh game can
  // start right back on the opponent's turn (the player as Black), so
  // restart() never toggles `enabled` across the reset — only the game's
  // identity does, and without this a stale reply for the FINISHED game
  // could land on the new one.
  const chessOpponentEnabled = ladderReady && !game.status?.game_over && game.status?.turn !== playerColor;
  const chessOpponentPace = chessConfig?.opponent?.pace ?? 1;
  const chessThinkMs = thinkTimeFor({
    level: ladderLevel, levels: LADDER_SIZE, config: chessConfig, seed: gameSeed,
    ply: game.history.length, pace: chessOpponentPace,
  }) ?? opponentDelayMs;
  // Null while it is not the opponent's turn, so OpponentPortrait's pulse
  // only ever runs while there is something to pulse for.
  const thinkMs = chessOpponentEnabled ? chessThinkMs : null;

  const { thinking: opponentThinking } = useOpponentReply({
    enabled: chessOpponentEnabled,
    thinkMs: chessThinkMs,
    resetKey: gameId,
    request: () => {
      requestedFenRef.current = gameRef.current.game.fen;
      // The ladder's level, when there is one, is the strength this
      // character plays at — the server clamps it to what the player has
      // actually unlocked, so this is a request, not an authority.
      return requestOpponentMove({
        fen: requestedFenRef.current, rung: rungId, level: ladderLevelRef.current, gameId, userId: lockedUser,
      });
    },
    onReply: (served) => {
      if (served?.opponent) effectiveOpponentRef.current = served.opponent;
      const fen = requestedFenRef.current;
      const reply = served
        || chooseMove(fen, { difficulty: localFallbackDifficulty, seed: gameRef.current.history.length });
      if (!reply) return;
      // The timestamp is what the clock and the archived think times are
      // derived from; `announce` is the board's voice. Both ride the pacing
      // hook's commit rather than replacing it.
      const { state } = commitMove(gameRef.current, reply.from, reply.to, reply.promotion, Date.now());
      setGame(state);
      announce(state);
      logger().info('opponent-replied', {
        san: reply.san,
        engine: served ? served.engine : 'local',
        opponent: served?.opponent || null,
      });
    },
  });

  // One record per finished game, posted only for a signed-in player — guests
  // never reach the per-user endpoints. Ref-guarded, not state-guarded: the
  // effect re-runs whenever unrelated state renders while game_over holds.
  useEffect(() => {
    if (!game.status?.game_over || recordedRef.current) return;
    recordedRef.current = true;
    const record = buildGameRecord({
      game, rungId, level: ladderLevel,
      hints: helpUsed.hints, bestMoves: helpUsed.bestMoves, takebacks: helpUsed.takebacks,
      opponent: effectiveOpponentRef.current,
      startedAt: startedAtRef.current, endedAt: Date.now(),
    });
    setFinishedRecord(record);
    if (record && lockedUser) {
      // The server decides promotion, and its answer is the only way to know a
      // rung was earned. It used to be thrown away, so the ladder advanced with
      // no acknowledgement anywhere on screen.
      saveGameRecord(lockedUser, record).then((saved) => {
        if (saved?.ladder) setLadderOutcome(saved.ladder);
      });
    }
    logger().info('game-recorded', { ...(record || {}), persisted: !!(record && lockedUser) });
    archivedRef.current = true;
    archiveGame(buildGameArchive({
      game, gameId, userId: lockedUser, rungId, addressing: addressingRef.current,
      opponent: effectiveOpponentRef.current,
      hints: helpUsed.hints, bestMoves: helpUsed.bestMoves, takebacks: helpUsed.takebacks,
      startedAt: startedAtRef.current, endedAt: Date.now(), endedBy: 'game_over',
      // Was missing: this path builds its own archive rather than reusing
      // `archiveInputsRef`, so a game played to a finish recorded no timing at
      // all while an abandoned one did.
      timing,
    }));
    // Everything but the game-over flag is read at the moment the game ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status?.game_over]);

  // The board takes plain strings; translating chords into them is this layer's
  // job, which is why ChessBoard never learns what a chord is.
  const reading = isStaffScheme(liveScheme);
  const minNotes = minNotesFor(liveScheme);
  // In the reading vocabulary the rim IS the lesson: a note drawn on the staff
  // the player reads it from. ChessBoard renders labels as children, so a node
  // costs it nothing to accept.
  // Memoized because these are props of a memoized board: rebuilt every render,
  // they defeated its bail-out on identity alone, and all 64 squares reconciled
  // on every note event as a result.
  const fileLabels = useMemo(() => (reading
    ? liveScheme.roots.map((midi) => <StaffNoteLabel key={midi} midi={midi} clef="treble" />)
    : liveScheme.roots), [reading, liveScheme]);
  const rankLabels = useMemo(() => (reading
    ? liveScheme.qualities.map((midi) => <StaffNoteLabel key={midi} midi={midi} clef="bass" />)
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
   * The character's colour, clamped so it can still be played on.
   *
   * The roster is data — a household can put any colour in YAML — and this one
   * value becomes the board's dark squares. Unclamped, a pale or washed-out
   * entry leaves the cream squares and the accent rings with almost nothing to
   * sit against, and every channel the board uses to talk stops reading. The
   * hue is the character's; the lightness is the board's to insist on.
   *
   * Passed through untouched when it is not an `hsl()` the roster generator
   * produced — a hand-written hex is the household's business, and silently
   * rewriting it would be worse than honouring it.
   */
  const boardTheme = useMemo(() => {
    const theme = opponent?.theme ?? null;
    const parsed = typeof theme === 'string'
      ? theme.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/)
      : null;
    if (!parsed) return theme;
    const [, hue, saturation, lightness] = parsed;
    const safeLightness = Math.min(52, Math.max(26, Number(lightness)));
    const safeSaturation = Math.min(46, Math.max(14, Number(saturation)));
    return `hsl(${hue} ${safeSaturation}% ${safeLightness}%)`;
  }, [opponent?.theme]);
  const opponentLastMove = useMemo(
    () => [...game.history].reverse().find((entry) => entry.color !== playerColor) ?? null,
    [game.history, playerColor],
  );
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

  /**
   * The character's reaction to the last thing that happened.
   *
   * Read off the move list rather than tracked, for the same reason the status
   * line is: a portrait that emotes on a schedule is theatre, and a child stops
   * reading it. `lostPiece` is a capture BY the player, which is the opponent
   * losing something — the two are the same event seen from opposite sides.
   */
  const mood = useMemo(() => {
    const last = game.history.at(-1);
    return opponentMood({
      thinking: opponentThinking,
      gameOver: !!game.status?.game_over,
      result: finishedRecord?.result ?? null,
      tookPiece: !!last?.captured && last.color !== playerColor,
      lostPiece: !!last?.captured && last.color === playerColor,
      givingCheck: !!game.status?.check && game.status.turn === playerColor,
    });
  }, [game.history, game.status, opponentThinking, playerColor, finishedRecord?.result]);

  // The player's own time, for the result card. Computed from the same move
  // timestamps the clock face reads, so the two can never disagree.
  const endTiming = useMemo(() => {
    if (!game.status?.game_over || timing.mode === 'off') return null;
    const spent = elapsedBySide(game.history, startedAtRef.current);
    return { timed: true, totalMs: spent[playerColor] };
  }, [game.status?.game_over, game.history, playerColor, timing.mode]);
  const lastCaptureName = opponentLastMove?.captured ? PIECE_NAMES[opponentLastMove.captured] : null;
  const opponentLine = opponentStatus({
    thinking: opponentThinking,
    lastMove: opponentLastMove?.san ?? null,
    lastCapture: lastCaptureName,
    gameOver: !!game.status?.game_over,
    result: finishedRecord?.result ?? null,
  });
  addressingRef.current = reading ? 'staff' : 'chords';
  archiveInputsRef.current = {
    game, gameId, userId: lockedUser, rungId, addressing: addressingRef.current,
    opponent: effectiveOpponentRef.current,
    hints: helpUsed.hints, bestMoves: helpUsed.bestMoves, takebacks: helpUsed.takebacks,
    startedAt: startedAtRef.current,
    timing,
  };
  // Only offered when the hovered square really does hold a piece this player
  // can move — naming the double on an empty square would be an instruction
  // that fails when followed.
  const pickupChord = !game.origin && cursor && sources.includes(cursor)
    ? cursorChord?.symbol ?? null
    : null;
  /**
   * The first-game walkthrough.
   *
   * Derived from the board rather than stepped through by hand, so a player who
   * does something out of order is never left on a step they have passed. The
   * "seen" flag rides the user config layer, which is the same place every
   * other per-player preference lives — a walkthrough that returns each session
   * is one a child learns to ignore.
   */
  const onboardStep = onboardingStep({
    history: game.history,
    origin: game.origin,
    hoveredChord: pickupChord,
    armed: Boolean(armed?.square),
  });
  const onboardVisible = shouldOnboard({
    seen: chessConfig?.seen_intro === true,
    gameOver: !!game.status?.game_over,
    playerTurn,
    step: onboardStep,
  });
  const onboardCopy = onboardVisible ? onboardingCopy(onboardStep, { reading }) : null;

  const prompt = promptFor(game, game.rejection, pickupChord, reading, takebackArmed);
  // The countdown is drawn only where the prompt is actually asking for a
  // repeat: same gate as pickupChord, plus the armed square agreeing with the
  // cursor. A bar running under "play a piece's chord twice" — an instruction
  // with no deadline attached yet — would be counting down nothing.
  const pickupDeadline = pickupChord && armed?.square === cursor ? armed.at : null;
  const turnColour = game.status?.turn === 'w' ? 'White' : 'Black';
  const turnLabel = game.status?.turn === playerColor ? `Yours (${turnColour})` : `Theirs (${turnColour})`;
  const displayName = (typeof currentUser === 'object' && currentUser?.id === lockedUser && currentUser.name)
    ? currentUser.name
    : (lockedUser || 'Guest');

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
          label="What the game is thinking"
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
            label="In hand"
            /* Measured above the tallest state this socket has, not guessed —
               see gameChrome.scss. The rail must not step when a piece is
               picked up. */
            reserve="8.5rem"
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
              {game.origin ? `from ${game.origin}` : 'Nothing picked up'}
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
            reserve={onboardCopy ? null : '9.75rem'}
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
            {/* One instruction at a time. While a step is being taught, the
                onboarding card IS the instruction — showing the standing prompt
                as well put two different things to do in one box, and cost the
                rail the 50px that pushed "Take it back" off its foot. */}
            {!onboardCopy && <p className="piano-chess__prompt" role="status">{prompt}</p>}
            {onboardCopy && (
              <aside className="chess-onboard" key={onboardStep}>
                <span className="chess-onboard__step">
                  {`Step ${ONBOARD_ORDER.indexOf(onboardStep) + 1} of ${ONBOARD_ORDER.length}`}
                </span>
                <strong className="chess-onboard__title">{onboardCopy.title}</strong>
                <span className="chess-onboard__body">{onboardCopy.body}</span>
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
                note: game.origin ? 'the piece in hand' : 'when holding a piece',
                active: !!game.origin,
                muted: !game.origin,
              },
              {
                id: 'legal',
                pressed: [0, 1, 2],
                title: 'Show moves',
                note: help.legal ? 'showing' : 'counts as a hint',
                active: help.legal,
              },
              {
                id: 'best',
                pressed: [0, 1, 2, 3],
                title: 'Best move',
                note: help.best ? 'showing' : 'counts as help',
                active: !!help.best,
              },
              {
                id: 'replay',
                pressed: [0, 1, 2, 3, 4],
                title: 'Show that again',
                // Never charged: it replays what already happened in full view
                // and tells the player nothing they were not entitled to see.
                note: replay ? 'replaying' : (game.history.length ? 'free' : 'after a move'),
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

          {shuffleEachTurn && (
            <p className={`piano-chess__redeal${justDealt ? ' piano-chess__redeal--fresh' : ''}`} role="status">
              {justDealt ? 'New chord map — read the edges' : 'Chords move every turn'}
            </p>
          )}
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
            startedAt={startedAtRef.current}
            turn={game.status?.turn}
            timing={timing}
            gameOver={!!game.status?.game_over}
            playerColor={playerColor}
          />
          <section className="piano-chess__identity">
            <span className="piano-chess__identity-player">{displayName}</span>
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
                  /* Keyed on the ply so the same reaction twice running still
                     plays twice — a remount is the only thing that restarts a
                     CSS animation, and "took another one" is exactly the case
                     a child should see acknowledged. */
                  key={`mood-${mood}-${game.history.length}`}
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
