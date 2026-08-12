import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chooseMove } from '@shared-gaming/chess/opponent.mjs';
import { fenToPosition } from '@shared-gaming/chess/position.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';
import ChordNamePanel from '../components/ChordNamePanel.jsx';
import ChordReadout from './ChordReadout.jsx';
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';
import PianoContextRail from '../PianoKiosk/modes/Videos/PianoContextRail.jsx';
import {
  fetchChessConfig, requestOpponentMove, saveChessConfig, saveGameRecord,
} from './chessApi.js';
import { cuesFromConfig } from './chessCues.js';
import ChessSettingsPanel from './ChessSettingsPanel.jsx';
import { CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { candidateSquares } from './chordCandidates.js';
import { destinationBadges } from './chessBadges.js';
import { recognizeGesture } from './chordGestures.js';
import { buildGameRecord } from './chessGameRecord.js';
import { advanceCursor, createCursorState } from './chordCursor.js';
import { applyEvent, createSelection } from './chordSelection.js';
import {
  REJECTION_MESSAGES, applySquare, capturedPieces, clearSelection, commitMove,
  createChessGameState, destinationsFor, isPlayerTurn, playableSources,
} from './chessGameState.js';
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
});
const OPPONENT_DELAY_MS = 700;
const PIECE_GLYPHS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

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
export function promptFor(state, rejection, hoveredChord = null) {
  if (state.status?.game_over) {
    if (state.status.outcome === 'checkmate') {
      return state.status.winner === state.playerColor ? 'Checkmate. You win.' : 'Checkmate. Your opponent wins.';
    }
    return `Draw — ${state.status.outcome.replace(/_/g, ' ')}.`;
  }
  if (rejection) return REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.';
  if (!isPlayerTurn(state)) return 'Your opponent is thinking.';
  if (state.status?.check) return 'You are in check. Play a chord to answer it.';
  if (state.origin) return 'Now play the chord of the square to move to.';
  return hoveredChord
    ? `Play ${hoveredChord} again to pick that piece up.`
    : "Play a piece's chord twice to pick it up.";
}

export function PianoChessGame({
  onDeactivate = null,
  gameConfig = null,
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

  // The merged household+user chess config is the single source for the rung
  // ladder, the cue flags, the opponent delay, and the shuffle preference. The
  // old gameConfig.feedback path is gone on purpose: two config sources for one
  // preference is exactly the drift the chess.yml pair exists to prevent.
  const [chessConfig, setChessConfig] = useState(null);
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
  const { activeNotes } = usePianoMidiNotes();
  const { connected } = usePianoMidi();
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
  const [cursor, setCursor] = useState(null);
  const cursorRef = useRef(createCursorState());
  // Naming a square and committing to it are different acts: the selection
  // machine decides which. One chord hovers, the same square twice picks up.
  const selectionRef = useRef(createSelection());
  // True from the first tick where the held set reads as a help gesture until
  // the hands are fully off the keys. See the cursor tick for why: a staggered
  // release must not let the gesture's residue land as an unrecognised chord.
  const gestureLatchRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;

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
      if (typeof loadedShuffle === 'boolean') {
        setGame((current) => {
          const untouched = current.history.length === 0 && !current.origin;
          if (!untouched || current.shuffleEachTurn === loadedShuffle) return current;
          return createChessGameState({
            fen: fen ?? undefined, playerColor, scheme, seed: gameSeed, shuffleEachTurn: loadedShuffle,
          });
        });
      }
      logger().info('config-loaded', { default_rung: loaded.default_rung, rungs: loaded.rungs?.length });
    });
    return () => { cancelled = true; };
    // fen, playerColor, scheme, and gameSeed are mount-stable (props + one-shot state).
  }, [lockedUser, fen, playerColor, scheme, gameSeed]);

  const heldNotes = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const heldKey = heldNotes.join(',');

  // Gesture recognition runs before square matching, and a recognised cluster
  // is never chord input: while it is physically down, narrowing is suppressed.
  const gesture = recognizeGesture(heldNotes);
  const candidates = useMemo(
    () => (gesture ? [] : candidateSquares(heldNotes, liveScheme)),
    [gesture, heldNotes, liveScheme],
  );

  // Help is per-move, not per-press: mashing the cluster cannot inflate the
  // tally, and the marks clear themselves when the move they helped with
  // completes. `best` asks the server at full strength regardless of the rung
  // being played — a hint only as strong as a beginner's opponent is not a hint.
  const [help, setHelp] = useState({ legal: false, best: null });
  const [helpUsed, setHelpUsed] = useState({ hints: 0, bestMoves: 0 });
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
    if (gesture === 'best' && !help.best && !bestPendingRef.current) {
      bestPendingRef.current = true;
      const askedFen = gameRef.current.game.fen;
      const askedGameId = gameIdRef.current;
      logger().info('help-requested', { kind: 'best' });
      requestOpponentMove({ fen: askedFen, rung: 'ruthless', gameId: askedGameId, userId: lockedUser }).then((move) => {
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
    return () => logger().info('unmounted');
  }, [difficulty, game.schemeRejected, gameSeed, playerColor, scheme.id, shuffleEachTurn]);

  const handleSquare = useCallback((square) => {
    const { state, event } = applySquare(gameRef.current, square);
    setGame(state);
    if (event.type === 'rejected') logger().debug('chord-rejected', { square, reason: event.reason });
    else if (event.type === 'moved' || event.type === 'game_over') {
      logger().info('move-played', { san: event.move.san, chords: state.history.at(-1)?.chords });
    } else logger().debug(`chord-${event.type}`, { square });
  }, []);

  const [toast, setToast] = useState(null);
  const rejection = game.rejection;
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
    setHelpUsed({ hints: 0, bestMoves: 0 });
    setFinishedRecord(null);
    selectionRef.current = createSelection();
    // A best-move ask still in flight belongs to the finished game. Its answer
    // is already doomed by the game-id check; clearing the gate here means the
    // new game may ask again immediately instead of waiting it out.
    bestPendingRef.current = false;
    recordedRef.current = false;
    startedAtRef.current = Date.now();
    logger().info('restarted');
  }, [fen, gameSeed, playerColor, scheme, shuffleEachTurn, userId]);

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

  // The cursor has to be driven by a clock, not only by note events: the settle
  // window elapses in silence, after the last key is already down.
  useEffect(() => {
    if (!heldNotes.length && !cursorRef.current.held.length) return undefined;
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
      // too-quick scold are swallowed; a commit that names a real square still
      // plays, so a gesture flowing straight into a chord without a full
      // release behaves as chord input.
      if (wasGesture) gestureLatchRef.current = true;
      const { state, event } = advanceCursor(cursorRef.current, heldNotes, Date.now(), { scheme: liveScheme });
      cursorRef.current = state;
      const latched = gestureLatchRef.current;
      if (!state.held.length) gestureLatchRef.current = false;
      if (!event) return;
      if (event.type === 'preview') setCursor(event.square);
      if (event.type === 'too_quick' && !wasGesture && !latched) {
        setToast({ text: 'Hold the chord a moment longer.', seq: `quick-${Date.now()}` });
      }
      if (event.type === 'escape') {
        setCursor(null);
        if (gameRef.current.status?.game_over) restart();
        else cancelSelection();
      }
      if (event.type === 'commit') setCursor(null);
      // Both cursor events feed the selection machine: the pick-up fires on
      // recognition — while the fingers are still down — and everything else
      // on release. The gesture latch stays exactly as it was: it solves a
      // different problem (a staggered cluster release landing as a false
      // refusal), and both guards are needed.
      if (event.type === 'preview' || event.type === 'commit') {
        if (wasGesture || (latched && !event.square)) return;
        const current = gameRef.current;
        const holdingPiece = Boolean(current.origin);
        const isEligible = holdingPiece && destinationsFor(current, current.origin).includes(event.square);
        const { selection, action } = applyEvent(selectionRef.current, {
          type: event.type, square: event.square, at: Date.now(), holdingPiece, isEligible,
        });
        selectionRef.current = selection;
        if (action.type === 'hover') setCursor(action.square);
        if (action.type === 'pickup' || action.type === 'drop') handleSquare(action.square);
        if (action.type === 'refuse') handleSquare(null);
        // 'none' and 'swallowed' change nothing, deliberately.
      }
    };
    tick();
    const timer = setInterval(tick, CURSOR_TICK_MS);
    return () => clearInterval(timer);
  }, [cancelSelection, handleSquare, heldKey, heldNotes, liveScheme, restart]);

  // The opponent answers on a delay so its move reads as a reply, not a flicker.
  // The server is the strong opponent; the bundled engine is what keeps the game
  // playable when it cannot be reached.
  useEffect(() => {
    if (game.status?.game_over || game.status?.turn === playerColor) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const fen = gameRef.current.game.fen;
      const served = await requestOpponentMove({ fen, rung: rungId, gameId, userId: lockedUser });
      const reply = served
        || chooseMove(fen, { difficulty: localFallbackDifficulty, seed: gameRef.current.history.length });
      if (cancelled || !reply) return;
      const { state } = commitMove(gameRef.current, reply.from, reply.to, reply.promotion);
      setGame(state);
      logger().info('opponent-replied', { san: reply.san, engine: served ? served.engine : 'local' });
    }, opponentDelayMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [game.status, playerColor, rungId, gameId, opponentDelayMs, lockedUser, localFallbackDifficulty]);

  // One record per finished game, posted only for a signed-in player — guests
  // never reach the per-user endpoints. Ref-guarded, not state-guarded: the
  // effect re-runs whenever unrelated state renders while game_over holds.
  useEffect(() => {
    if (!game.status?.game_over || recordedRef.current) return;
    recordedRef.current = true;
    const record = buildGameRecord({
      game, rungId, hints: helpUsed.hints, bestMoves: helpUsed.bestMoves,
      startedAt: startedAtRef.current, endedAt: Date.now(),
    });
    setFinishedRecord(record);
    if (record && lockedUser) saveGameRecord(lockedUser, record);
    logger().info('game-recorded', { ...(record || {}), persisted: !!(record && lockedUser) });
    // Everything but the game-over flag is read at the moment the game ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status?.game_over]);

  // The board takes plain strings; translating chords into them is this layer's
  // job, which is why ChessBoard never learns what a chord is.
  const fileLabels = liveScheme.roots;
  const rankLabels = liveScheme.qualities.map((quality) => CHORD_QUALITIES[quality]?.label || 'maj');

  // The marks channel is empty until a gesture asks. "Show legal moves" means
  // the destinations of the piece being held — or, when none is held yet,
  // which pieces can move at all. The marks stand until the move they helped
  // with completes (see the history-length effect above).
  const hintTargets = help.legal
    ? (game.origin ? destinationsFor(game, game.origin) : playableSources(game))
    : [];
  // The answer to the pick-up: each eligible square wears the chord that
  // reaches it. Not help and never charged — the double-play that lifted the
  // piece WAS the request. Config can silence it for players who want the
  // intersection drill back.
  const squareLabels = cues.showDestinationLabels ? destinationBadges(game, liveScheme) : {};
  const cursorChord = cursor ? squareToChord(cursor, liveScheme) : null;
  // Only while a piece is held and the cursor names a different square. Capture
  // targets get a ghost too — most previews the player cares about are captures.
  const heldPiece = game.origin ? fenToPosition(game.game.fen)?.[game.origin] : null;
  const ghost = heldPiece && cursor && cursor !== game.origin
    ? { square: cursor, piece: heldPiece }
    : null;
  const captured = capturedPieces(game.history);
  // Only offered when the hovered square really does hold a piece this player
  // can move — naming the double on an empty square would be an instruction
  // that fails when followed.
  const pickupChord = !game.origin && cursor && playableSources(game).includes(cursor)
    ? cursorChord?.symbol ?? null
    : null;
  const prompt = promptFor(game, game.rejection, pickupChord);
  const turnLabel = game.status?.turn === 'w' ? 'White' : 'Black';

  return (
    <div className="piano-chess">
      <div className="piano-chess__stage">
        <ChessBoard
          fen={game.game.fen}
          status={game.status}
          orientation={playerColor === 'b' ? 'black' : 'white'}
          fileLabels={fileLabels}
          rankLabels={rankLabels}
          selected={game.origin}
          heldSquare={game.origin}
          squareLabels={squareLabels}
          candidates={candidates}
          hintTargets={hintTargets}
          bestMove={help.best}
          rejectedSquare={cues.flashRejected ? game.rejection?.square ?? null : null}
          rejectedKey={game.rejection?.seq ?? null}
          lastMove={game.lastMove}
          cursorSquare={cursor}
          ghost={ghost}
        />

        <aside className="piano-chess__rail piano-chess__rail--log">
          {/* The kiosk's standard context rail, same as Videos. It carries the
              way back now that the header (and its Leave button) is gone — the
              breadcrumb rail above already says where we are. */}
          <PianoContextRail
            program="Piano Chess"
            ancestors={onDeactivate ? [{ label: 'Games', onClick: onDeactivate }] : []}
          />
          {/* Whoever started the game, latched at mount — a kiosk user switch
              mid-game must not change whose config plays or whose record
              gets written, and the screen has to say so. */}
          <p className="piano-chess__locked-user">Playing as {lockedUser || 'Guest'}</p>
          <p className="piano-chess__turn">
            {game.status?.game_over ? 'Game over' : `${turnLabel} to move`}
            {/* The active rung, straight from the config ladder — the bundled
                engine's old label table would go stale the moment rungs moved.
                Before the config resolves (or if a saved rung id has left the
                ladder) the id is capitalized rather than shown raw. */}
            <span className="piano-chess__difficulty">
              {rung?.label ?? (rungId.charAt(0).toUpperCase() + rungId.slice(1))}
            </span>
          </p>
          <p className="piano-chess__prompt" role="status">{prompt}</p>

          {/* The spec's promise: the end screen reads the game back as facts.
              These are fields of the SAME object the record effect saved —
              never a second formatting of the state — so the screen and the
              stored record cannot disagree. */}
          {game.status?.game_over && finishedRecord && (
            <dl className="piano-chess__summary">
              {[
                ['Moves', finishedRecord.moves],
                ['Hints', finishedRecord.hints],
                ['Best moves', finishedRecord.best_moves],
              ].map(([label, value]) => (
                <div key={label} className="piano-chess__summary-row">
                  <dt className="piano-chess__slot-label">{label}</dt>
                  <dd className="piano-chess__summary-value">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {game.status?.game_over ? (
            <button type="button" className="piano-chess__cancel" onClick={restart}>
              Play again
              <span className="piano-chess__cancel-hint">play an octave to start over</span>
            </button>
          ) : (
            <button
              type="button"
              className="piano-chess__cancel"
              onClick={cancelSelection}
              disabled={!game.origin}
            >
              Put it back
              <span className="piano-chess__cancel-hint">play an octave, or press Esc</span>
            </button>
          )}
          {chessConfig && (
            <button
              type="button"
              className="piano-chess__settings-btn"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              Settings
            </button>
          )}
          {shuffleEachTurn && (
            <p className={`piano-chess__redeal${justDealt ? ' piano-chess__redeal--fresh' : ''}`} role="status">
              {justDealt ? 'New chord map — read the edges' : 'Chords move every turn'}
            </p>
          )}
          <h2 className="piano-chess__rail-title">Moves</h2>
          <ol className="piano-chess__moves">
            {game.history.map((entry, index) => (
              <li key={`${entry.san}-${index}`} className="piano-chess__move">
                <span className="piano-chess__move-index">{Math.floor(index / 2) + 1}</span>
                <span className="piano-chess__move-chords">{entry.chords.join(' → ')}</span>
                <span className="piano-chess__move-san">{entry.san}</span>
              </li>
            ))}
            {!game.history.length && <li className="piano-chess__move piano-chess__move--empty">No moves yet.</li>}
          </ol>
          <div className="piano-chess__captured">
            {['w', 'b'].map((color) => (
              <div key={color} className="piano-chess__captured-row">
                <span className="piano-chess__slot-label">{color === 'w' ? 'White took' : 'Black took'}</span>
                <span className="piano-chess__captured-pieces">
                  {captured[color].map((piece) => PIECE_GLYPHS[piece]).join('') || '—'}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {toast && (
        <output className="piano-chess__toast" key={toast.seq}>{toast.text}</output>
      )}

      {settingsOpen && chessConfig && (
        <ChessSettingsPanel
          config={chessConfig}
          rungId={rungId}
          onChange={applySetting}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* The instrument zone: what is being played (plaque), what the game
          heard and where it points (read-out), and the keys themselves.
          `settling` needs no resolved-flag bookkeeping any more — narrowing
          answers instantly: zero candidates means no square can contain these
          notes, so only a still-narrowing chord reads as "settling". */}
      <footer className="piano-chess__instrument">
        <div className="piano-chess__instrument-readouts">
          <ChordNamePanel midiNotes={heldNotes} label="Playing" />
          <ChordReadout
            heldNotes={heldNotes}
            chord={cursorChord}
            square={cursor}
            connected={connected}
            settling={heldNotes.length >= 3 && candidates.length > 0 && !cursor}
          />
        </div>
        <PianoKeyboard activeNotes={activeNotes} startNote={36} endNote={84} showLabels />
      </footer>
    </div>
  );
}

export default PianoChessGame;
