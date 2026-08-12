import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CHORD_SCHEME, squareToChord } from '@shared-gaming/chess/index.mjs';
import { DIFFICULTIES, chooseMove } from '@shared-gaming/chess/opponent.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ChessBoard from '../../Chess/ChessBoard.jsx';
import { PianoKeyboard } from '../components/PianoKeyboard.jsx';
import { usePianoMidiNotes } from '../PianoKiosk/PianoMidiContext.jsx';
import { advanceCursor, createCursorState } from './chordCursor.js';
import {
  REJECTION_MESSAGES, applySquare, capturedPieces, commitMove,
  createChessGameState, destinationsFor, isPlayerTurn,
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
  playerColor = 'w',
  difficulty = 'learner',
  scheme = DEFAULT_CHORD_SCHEME,
  shuffleEachTurn = true,
  seed = 1,
}) {
  const { activeNotes } = usePianoMidiNotes();
  const [game, setGame] = useState(() => createChessGameState({ playerColor, scheme, seed, shuffleEachTurn }));
  // The map is re-dealt every turn, so everything that reads chords — the
  // cursor, the rim, the move log — has to follow state, not the prop.
  const liveScheme = game.scheme;
  const [cursor, setCursor] = useState(null);
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
    logger().info('mounted', { player_color: playerColor, difficulty, scheme: scheme.id, shuffle_each_turn: shuffleEachTurn });
    return () => logger().info('unmounted');
  }, [difficulty, playerColor, scheme.id, shuffleEachTurn]);

  const handleSquare = useCallback((square) => {
    const { state, event } = applySquare(gameRef.current, square);
    setGame(state);
    if (event.type === 'rejected') logger().debug('chord-rejected', { square, reason: event.reason });
    else if (event.type === 'moved' || event.type === 'game_over') {
      logger().info('move-played', { san: event.move.san, chords: state.history.at(-1)?.chords });
    } else logger().debug(`chord-${event.type}`, { square });
  }, []);

  // The cursor has to be driven by a clock, not only by note events: the settle
  // window elapses in silence, after the last key is already down.
  useEffect(() => {
    if (!heldNotes.length && !cursorRef.current.held.length) return undefined;
    const tick = () => {
      const { state, event } = advanceCursor(cursorRef.current, heldNotes, Date.now(), { scheme: liveScheme });
      cursorRef.current = state;
      if (!event) return;
      if (event.type === 'preview') setCursor(event.square);
      if (event.type === 'commit') {
        setCursor(null);
        handleSquare(event.square);
      }
    };
    tick();
    const timer = setInterval(tick, CURSOR_TICK_MS);
    return () => clearInterval(timer);
  }, [handleSquare, heldKey, heldNotes, liveScheme]);

  // The opponent answers on a delay so its move reads as a reply, not a flicker.
  useEffect(() => {
    if (game.status?.game_over || game.status?.turn === playerColor) return undefined;
    const timer = setTimeout(() => {
      const reply = chooseMove(gameRef.current.game.fen, { difficulty, seed: gameRef.current.history.length });
      if (!reply) return;
      const { state } = commitMove(gameRef.current, reply.from, reply.to);
      setGame(state);
      logger().info('opponent-replied', { san: reply.san, difficulty });
    }, OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [difficulty, game.status, playerColor]);

  const destinations = game.origin ? destinationsFor(game, game.origin) : [];
  const originChord = game.origin ? squareToChord(game.origin, liveScheme) : null;
  const cursorChord = cursor ? squareToChord(cursor, liveScheme) : null;
  const captured = capturedPieces(game.history);
  const prompt = promptFor(game, game.rejection);
  const turnLabel = game.status?.turn === 'w' ? 'White' : 'Black';

  return (
    <div className="piano-chess">
      <header className="piano-chess__header">
        <h1 className="piano-chess__wordmark">Piano<span>Chess</span></h1>
        {shuffleEachTurn && (
          <p className={`piano-chess__redeal${justDealt ? ' piano-chess__redeal--fresh' : ''}`} role="status">
            {justDealt ? 'New chord map — read the edges' : 'Chords move every turn'}
          </p>
        )}
        <p className="piano-chess__turn">
          {game.status?.game_over ? 'Game over' : `${turnLabel} to move`}
          <span className="piano-chess__difficulty">{DIFFICULTIES[difficulty]?.label ?? difficulty}</span>
        </p>
        {onDeactivate && (
          <button type="button" className="piano-chess__exit" onClick={onDeactivate}>Leave</button>
        )}
      </header>

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
          {cursorChord && (
            <p className="piano-chess__hearing">
              Hearing <strong>{cursorChord.symbol}</strong>
            </p>
          )}
        </aside>

        <ChessBoard
          fen={game.game.fen}
          status={game.status}
          orientation={playerColor === 'b' ? 'black' : 'white'}
          notation="chord"
          scheme={liveScheme}
          selected={game.origin}
          destinations={destinations}
          lastMove={game.lastMove}
          cursorSquare={cursor}
        />

        <aside className="piano-chess__rail piano-chess__rail--log">
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

      <footer className="piano-chess__keys">
        <PianoKeyboard activeNotes={activeNotes} startNote={36} endNote={84} />
      </footer>
    </div>
  );
}

export default PianoChessGame;
