import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, indexToCoord, legalMoves, replayGame } from '@shared-gaming/checkers/engine.mjs';
import { chooseMove } from '@shared-gaming/checkers/opponent.mjs';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import InstrumentBoardStage from '../game-platform/families/addressed-board/InstrumentBoardStage.jsx';
import { BOARD_LAYOUTS } from '../game-platform/families/addressed-board/contracts.js';
import { resolveAddressedSelection } from '../game-platform/families/addressed-board/interactionGrammars.js';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import checkersClient from './checkersApi.js';
import './PianoCheckers.scss';

const DEFAULT_CONFIG = Object.freeze({
  shuffle_each_game: false,
  square_notes: Array.from({ length: 32 }, (_, index) => 48 + index),
  default_level: 1,
});
// Checkers' ladder is 7 rungs (1-7, see the "Level {level} of 7" rail below) —
// thinkTimeFor's `levels` generalises the old chess-only ladder size.
const LADDER_LEVELS = 7;
// Used only when thinkTimeFor has nothing to read yet (no ladder resolved) —
// mirrors chess's own OPPONENT_DELAY_MS fallback constant.
const OPPONENT_THINK_FALLBACK_MS = 700;
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function userIdOf(currentUser) {
  const value = typeof currentUser === 'string' ? currentUser : currentUser?.id;
  return value && value !== 'guest' ? value : null;
}

export function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function shuffledSquares(seed) {
  const values = Array.from({ length: 32 }, (_, index) => index);
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

export function squareForNotes(activeNotes, config, deal) {
  const held = [...activeNotes.keys()].sort((a, b) => a - b);
  if (!held.length) return null;
  const address = config.square_notes.indexOf(held.at(-1));
  return address < 0 ? null : deal[address];
}

function CheckersBoard({ game, deal, config, selected, hint }) {
  const moves = legalMoves(game.board, game.turn, game.forcedFrom);
  const sources = new Set(moves.map((move) => move.from));
  const destinations = new Set(moves.filter((move) => move.from === selected).map((move) => move.to));
  const addressBySquare = useMemo(() => {
    const inverse = [];
    deal.forEach((square, address) => { inverse[square] = address; });
    return inverse;
  }, [deal]);
  return (
    <div className="checkers-board" role="grid" aria-label="Checkers board">
      {Array.from({ length: 64 }, (_, cell) => {
        const row = Math.floor(cell / 8);
        const column = cell % 8;
        const playable = (row + column) % 2 === 1;
        const square = playable ? row * 4 + Math.floor(column / 2) : null;
        const piece = playable ? game.board[square] : null;
        const address = playable ? addressBySquare[square] : null;
        const classes = [
          'checkers-board__cell', playable ? 'is-playable' : 'is-light',
          playable && selected !== null && square === selected ? 'is-selected' : '',
          destinations.has(square) ? 'is-destination' : '',
          selected === null && game.turn === 1 && sources.has(square) ? 'is-source' : '',
          hint && (hint.from === square || hint.to === square) ? 'is-hint' : '',
        ].filter(Boolean).join(' ');
        return (
          <div key={cell} className={classes} role="gridcell">
            {playable && <span className="checkers-board__address">{noteName(config.square_notes[address])}</span>}
            {piece && (
              <span className={`checkers-board__piece checkers-board__piece--${piece.toLowerCase() === 'r' ? 'player' : 'opponent'}`}>
                {piece === piece.toUpperCase() && <span className="checkers-board__crown">♛</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PianoCheckers({ activeNotes = new Map(), currentUser = null, onNoteOn, onNoteOff }) {
  const userId = userIdOf(currentUser);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [ladder, setLadder] = useState(null);
  const [moves, setMoves] = useState([]);
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);
  const [hint, setHint] = useState(null);
  const [localPractice, setLocalPractice] = useState(false);
  const [seed, setSeed] = useState(() => Date.now() >>> 0);
  const [gameSessionId, setGameSessionId] = useState(() => `checkers-${Date.now()}`);
  const latchedRef = useRef(false);
  const rankedRef = useRef(true);
  const savedRef = useRef(false);
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const game = useMemo(() => replayGame({ moves }), [moves]);
  const deal = useMemo(() => config.shuffle_each_game ? shuffledSquares(seed) : Array.from({ length: 32 }, (_, index) => index), [config.shuffle_each_game, seed]);
  const level = ladder?.unlocked_through ?? config.default_level ?? 1;

  // The opponent's reply is a floor on the wait, never an addend — see
  // opponentPacing.js. `resetKey: gameSessionId` covers the reset case
  // `enabled` alone can't see: after restart() the fresh board always opens
  // on the player's turn (turn 1) here, so `enabled` already flips false on
  // its own, but the reset key costs nothing and matches the other two games.
  const opponentEnabled = !game.status.gameOver && game.turn === 2;
  const opponentPace = config.opponent?.pace ?? 1;
  const thinkMs = thinkTimeFor({
    level, levels: LADDER_LEVELS, config, seed, ply: moves.length, pace: opponentPace,
  }) ?? OPPONENT_THINK_FALLBACK_MS;
  const { thinking } = useOpponentReply({
    enabled: opponentEnabled,
    thinkMs,
    resetKey: gameSessionId,
    request: () => checkersClient.requestMove({ transcript: { moves }, level, gameSessionId, userId }),
    onReply: (answer) => {
      if (!answer?.move) {
        rankedRef.current = false;
        setLocalPractice(true);
      }
      // Keep offline practice responsive on the kiosk's older WebView CPU.
      const move = answer?.move ?? chooseMove(game, { level: Math.min(2, level) });
      const next = move ? applyMove(game, move) : game;
      if (!next.error && move) setMoves(next.moves);
    },
  });

  useEffect(() => {
    checkersClient.readConfig(userId).then((value) => value && setConfig((old) => ({ ...old, ...value })));
    checkersClient.readLadder(userId).then((value) => value && setLadder(value));
  }, [userId]);

  useEffect(() => {
    if (game.status.gameOver || game.turn !== 1 || thinking) return;
    if (activeNotes.size === 0) { latchedRef.current = false; return; }
    if (latchedRef.current) return;
    if (activeNotes.size >= 7) {
      setHint(chooseMove(game, { level }));
      setMessage('Suggested move is glowing.');
      latchedRef.current = true;
      return;
    }
    const square = squareForNotes(activeNotes, config, deal);
    if (square === null) return;
    const available = legalMoves(game.board, 1, game.forcedFrom);
    const currentSelection = game.forcedFrom ?? selected;
    const resolution = resolveAddressedSelection({
      selected: currentSelection,
      address: square,
      sources: available.map((move) => move.from),
      destinations: available.filter((move) => move.from === currentSelection).map((move) => move.to),
    });
    if (resolution.committed) {
      const next = applyMove(game, resolution.committed);
      if (!next.error) {
        setMoves(next.moves);
        setSelected(next.turn === 1 ? next.forcedFrom : null);
        setMessage(next.forcedFrom !== null ? 'Keep jumping with the same piece.' : null);
        setHint(null);
      }
    } else {
      setSelected(resolution.selected);
      setMessage(resolution.rejection === 'select_source' ? 'Play the note on a glowing red piece.'
        : resolution.rejection === 'select_destination' ? 'Play a glowing destination note.' : null);
    }
    latchedRef.current = true;
  }, [activeNotes, config, deal, game, level, selected, thinking]);

  useEffect(() => {
    if (!game.status.gameOver || savedRef.current) return;
    savedRef.current = true;
    const result = game.status.draw ? 'draw' : game.status.winner === 1 ? 'win' : 'loss';
    const record = {
      moves, result, level, ranked: rankedRef.current, completed: true,
      played_on: new Date().toISOString().slice(0, 10),
    };
    if (userId) checkersClient.saveGame(userId, record).then((response) => response?.ladder && setLadder(response.ladder));
    checkersClient.archiveGame({ ...record, user_id: userId });
  }, [game.status, level, moves, userId]);

  useEffect(() => () => {
    if (!savedRef.current && movesRef.current.length) {
      checkersClient.archiveGame({ moves: movesRef.current, completed: false, user_id: userId, ended_by: 'exit' });
    }
  }, [userId]);

  const updateConfig = (patch) => {
    setConfig((value) => ({ ...value, ...patch }));
    if (userId) checkersClient.writeConfig(userId, patch);
  };
  const restart = () => {
    setMoves([]);
    setSelected(null);
    setMessage(null);
    setHint(null);
    setLocalPractice(false);
    rankedRef.current = true;
    savedRef.current = false;
    latchedRef.current = activeNotes.size > 0;
    setSeed((value) => (value + 1) >>> 0);
    setGameSessionId(`checkers-${Date.now()}`);
  };
  const status = game.status.gameOver
    ? game.status.draw ? 'Draw game' : game.status.winner === 1 ? 'You won the board!' : `${ladder?.current?.name ?? 'Opponent'} wins`
    : thinking ? `${ladder?.current?.name ?? 'Opponent'} is thinking…`
      : message ?? (selected !== null ? 'Now play a glowing destination note.' : 'Play the note shown on a movable red piece.');

  return (
    <PianoGameHost
      gameId="checkers"
      phase={game.status.gameOver ? 'result' : thinking ? 'paused' : 'playing'}
      className="piano-checkers"
      instrument={{ activeNotes, startNote: 48, endNote: 79, showLabels: true, onNoteOn, onNoteOff }}
    >
      <InstrumentBoardStage
        layout={BOARD_LAYOUTS.SINGLE}
        primary={<CheckersBoard game={game} deal={deal} config={config} selected={game.forcedFrom ?? selected} hint={hint} />}
        leftRail={(
          <div className="checkers-opponent">
            <strong>{ladder?.current?.name ?? 'Button'}</strong>
            <span>Level {level} of 7</span>
            <span>{ladder?.wins ?? 0} / 3 wins</span>
            <span>{game.board.filter((piece) => piece?.toLowerCase() === 'r').length} red · {game.board.filter((piece) => piece?.toLowerCase() === 'b').length} blue</span>
          </div>
        )}
        rightRail={(
          <div className="checkers-settings">
            <label className="checkers-settings__check"><input type="checkbox" checked={config.shuffle_each_game} onChange={(event) => updateConfig({ shuffle_each_game: event.target.checked })} /> Re-deal square notes</label>
            <p>Each dark square shows its piano note. Play a piece, then its destination.</p>
            <p>Captures glow and are required. Multiple jumps keep the piece selected.</p>
            <small>Play seven notes together for a suggested move.</small>
          </div>
        )}
        status={(
          <div className="checkers-status">
            <span>{status}{localPractice ? ' · local practice' : ''}</span>
            {game.status.gameOver && <button type="button" onClick={restart}>Play again</button>}
          </div>
        )}
      />
    </PianoGameHost>
  );
}
