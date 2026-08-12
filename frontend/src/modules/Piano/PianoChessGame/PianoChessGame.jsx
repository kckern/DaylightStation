import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIFFICULTIES, chooseMove } from '@shared-gaming/chess/opponent.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';
import ChordReadout from './ChordReadout.jsx';
import { isPersistentUser } from '../PianoKiosk/pianoUser.js';
import { usePianoMidi, usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';
import PianoContextRail from '../PianoKiosk/modes/Videos/PianoContextRail.jsx';
import { requestOpponentMove } from './chessApi.js';
import { CHORD_QUALITIES, DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { advanceCursor, createCursorState } from './chordCursor.js';
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
 * How loudly the board answers a mistake.
 *
 * Parameterised because the right amount of ceremony depends on who is playing:
 * a beginner wants the legal pieces outlined before they choose, while someone
 * who knows the board finds that noisy and only wants to be told when they are
 * wrong. All four can be turned off independently.
 */
export const DEFAULT_FEEDBACK = Object.freeze({
  flashRejected: true,   // the refused square shakes and flares red
  toast: true,           // a sentence saying what was wrong
  highlightSources: true,// outline the pieces that can move, before choosing
  highlightTargets: true,// dot the squares the held piece can reach
});
const OPPONENT_DELAY_MS = 700;
const PIECE_GLYPHS = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };

let cachedLogger;
function logger() {
  if (!cachedLogger) cachedLogger = getLogger().child({ component: 'piano-chess' });
  return cachedLogger;
}

/** The prompt under the board: what the player should do next, in their terms. */
export function promptFor(state, rejection) {
  if (state.status?.game_over) {
    if (state.status.outcome === 'checkmate') {
      return state.status.winner === state.playerColor ? 'Checkmate. You win.' : 'Checkmate. Your opponent wins.';
    }
    return `Draw — ${state.status.outcome.replace(/_/g, ' ')}.`;
  }
  if (rejection) return REJECTION_MESSAGES[rejection.reason] ?? 'Try another chord.';
  if (!isPlayerTurn(state)) return 'Your opponent is thinking.';
  if (state.status?.check) return 'You are in check. Play a chord to answer it.';
  return state.origin ? 'Now play the square to move to.' : 'Play the chord of the piece you want to move.';
}

export function PianoChessGame({
  onDeactivate = null,
  gameConfig = null,
  currentUser = null,
  playerColor = gameConfig?.player_color ?? 'w',
  difficulty = gameConfig?.difficulty ?? 'learner',
  scheme = DEFAULT_CHORD_SCHEME,
  shuffleEachTurn = gameConfig?.shuffle_each_turn ?? true,
  seed = null,
  feedback = null,
}) {
  const cues = { ...DEFAULT_FEEDBACK, ...(gameConfig?.feedback ?? {}), ...(feedback ?? {}) };

  // currentUser may arrive as the resolved profile object or the bare id. Guests
  // (and the no-user case) must never hit the per-user chess endpoints.
  const userSlug = typeof currentUser === 'string' ? currentUser : currentUser?.id ?? null;
  const userId = isPersistentUser(userSlug) ? userSlug : null;

  // Config-driven rung/delay land in Task 7; until then these are the defaults
  // the server and local engine both understand.
  const chessConfig = null;
  const rungId = 'learner';
  const opponentDelayMs = OPPONENT_DELAY_MS;
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
    playerColor, scheme, seed: gameSeed, shuffleEachTurn,
  }));
  // The server engine keeps per-game state keyed on this id, so it has to change
  // on restart — reusing it would let "Play again" find the finished game.
  const [gameId, setGameId] = useState(() => `chess-${Date.now()}`);
  // The map is re-dealt every turn, so everything that reads chords — the
  // cursor, the rim, the move log — has to follow state, not the prop.
  const liveScheme = game.scheme;
  const [cursor, setCursor] = useState(null);
  // Whether the cursor has reported for the chord currently held. A `preview`
  // event fires with `square: null` when a settled chord doesn't map to a
  // square, so `cursor` alone can't tell "still settling" from "settled and
  // unmapped" — both read as null. This flag carries that distinction.
  const [cursorResolved, setCursorResolved] = useState(false);
  const cursorRef = useRef(createCursorState());
  const gameRef = useRef(game);
  gameRef.current = game;

  const heldNotes = useMemo(() => [...activeNotes.keys()].sort((a, b) => a - b), [activeNotes]);
  const heldKey = heldNotes.join(',');

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

  const restart = useCallback(() => {
    setGame(createChessGameState({ playerColor, scheme, seed: gameSeed + 1, shuffleEachTurn }));
    setGameId(`chess-${Date.now()}`);
    setToast(null);
    logger().info('restarted');
  }, [gameSeed, playerColor, scheme, shuffleEachTurn]);

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
      const { state, event } = advanceCursor(cursorRef.current, heldNotes, Date.now(), { scheme: liveScheme });
      cursorRef.current = state;
      if (!event) return;
      if (event.type === 'preview') { setCursor(event.square); setCursorResolved(true); }
      if (event.type === 'too_quick') setToast({ text: 'Hold the chord a moment longer.', seq: `quick-${Date.now()}` });
      if (event.type === 'escape') {
        setCursor(null);
        if (gameRef.current.status?.game_over) restart();
        else cancelSelection();
      }
      if (event.type === 'commit') {
        setCursor(null);
        handleSquare(event.square);
      }
    };
    tick();
    const timer = setInterval(tick, CURSOR_TICK_MS);
    return () => clearInterval(timer);
  }, [cancelSelection, handleSquare, heldKey, heldNotes, liveScheme, restart]);

  // Hands off the keys means the next chord starts unresolved again, so the
  // read-out doesn't carry a stale "settled" verdict into a fresh chord.
  useEffect(() => {
    if (heldNotes.length === 0) setCursorResolved(false);
  }, [heldNotes.length]);

  // The opponent answers on a delay so its move reads as a reply, not a flicker.
  // The server is the strong opponent; the bundled engine is what keeps the game
  // playable when it cannot be reached.
  useEffect(() => {
    if (game.status?.game_over || game.status?.turn === playerColor) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const fen = gameRef.current.game.fen;
      const served = await requestOpponentMove({ fen, rung: rungId, gameId, userId });
      const reply = served
        || chooseMove(fen, { difficulty: localFallbackDifficulty, seed: gameRef.current.history.length });
      if (cancelled || !reply) return;
      const { state } = commitMove(gameRef.current, reply.from, reply.to, reply.promotion);
      setGame(state);
      logger().info('opponent-replied', { san: reply.san, engine: served ? served.engine : 'local' });
    }, opponentDelayMs);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [game.status, playerColor, rungId, gameId, opponentDelayMs, userId, localFallbackDifficulty]);

  // A refusal turns the legality cues on; the next completed move turns them off.
  const [showLegality, setShowLegality] = useState(false);
  const rejectionSeq = game.rejection?.seq ?? null;
  const moveCount = game.history.length;
  useEffect(() => {
    if (rejectionSeq != null) setShowLegality(true);
  }, [rejectionSeq]);
  useEffect(() => {
    setShowLegality(false);
  }, [moveCount]);

  // The board takes plain strings; translating chords into them is this layer's
  // job, which is why ChessBoard never learns what a chord is.
  const fileLabels = liveScheme.roots;
  const rankLabels = liveScheme.qualities.map((quality) => CHORD_QUALITIES[quality]?.label || 'maj');

  // Legality is shown only once the player has actually got it wrong. Outlining
  // every movable piece up front answers the question before it is asked, which
  // is the whole exercise; after a refusal it is help, not a spoiler. The hints
  // stand until the next move lands, then the board goes quiet again.
  const destinations = showLegality && cues.highlightTargets && game.origin
    ? destinationsFor(game, game.origin)
    : [];
  const sources = showLegality && cues.highlightSources && !game.origin
    ? playableSources(game)
    : [];
  const originChord = game.origin ? squareToChord(game.origin, liveScheme) : null;
  const cursorChord = cursor ? squareToChord(cursor, liveScheme) : null;
  const captured = capturedPieces(game.history);
  const prompt = promptFor(game, game.rejection);
  const turnLabel = game.status?.turn === 'w' ? 'White' : 'Black';

  return (
    <div className="piano-chess">
      <div className="piano-chess__stage">
        <aside className="piano-chess__rail piano-chess__rail--move">
          <h2 className="piano-chess__rail-title">This move</h2>
          <div className="piano-chess__slot">
            <span className="piano-chess__slot-label">From</span>
            <span className={`piano-chess__chord${originChord ? ' piano-chess__chord--set' : ''}`}>
              {originChord?.symbol ?? '—'}
            </span>
          </div>
          <div className="piano-chess__slot">
            <span className="piano-chess__slot-label">To</span>
            <span className={`piano-chess__chord${cursorChord && game.origin ? ' piano-chess__chord--live' : ''}`}>
              {game.origin ? (cursorChord?.symbol ?? '—') : '—'}
            </span>
          </div>
          <p className="piano-chess__prompt" role="status">{prompt}</p>

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
        </aside>

        <ChessBoard
          fen={game.game.fen}
          status={game.status}
          orientation={playerColor === 'b' ? 'black' : 'white'}
          fileLabels={fileLabels}
          rankLabels={rankLabels}
          selected={game.origin}
          destinations={destinations}
          sourceSquares={sources}
          rejectedSquare={cues.flashRejected ? game.rejection?.square ?? null : null}
          rejectedKey={game.rejection?.seq ?? null}
          lastMove={game.lastMove}
          cursorSquare={cursor}
        />

        <aside className="piano-chess__rail piano-chess__rail--log">
          {/* The kiosk's standard context rail, same as Videos. It carries the
              way back now that the header (and its Leave button) is gone — the
              breadcrumb rail above already says where we are. */}
          <PianoContextRail
            program="Piano Chess"
            ancestors={onDeactivate ? [{ label: 'Games', onClick: onDeactivate }] : []}
          />
          <p className="piano-chess__turn">
            {game.status?.game_over ? 'Game over' : `${turnLabel} to move`}
            <span className="piano-chess__difficulty">{DIFFICULTIES[difficulty]?.label ?? difficulty}</span>
          </p>
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

      <footer className="piano-chess__keys">
        <ChordReadout
          heldNotes={heldNotes}
          chord={cursorChord}
          square={cursor}
          connected={connected}
          settling={heldNotes.length >= 3 && !cursorResolved}
        />
        <PianoKeyboard activeNotes={activeNotes} startNote={36} endNote={84} />
      </footer>
    </div>
  );
}

export default PianoChessGame;
