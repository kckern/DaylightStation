import { useEffect, useMemo, useRef, useState } from 'react';
import { chooseColumn } from '@shared-gaming/connect-four/opponent.mjs';
import { playColumn, replayGame } from '@shared-gaming/connect-four/engine.mjs';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import InstrumentBoardStage from '../game-platform/families/addressed-board/InstrumentBoardStage.jsx';
import { BOARD_LAYOUTS } from '../game-platform/families/addressed-board/contracts.js';
import {
  archiveConnectFourGame, fetchConnectFourConfig, fetchConnectFourLadder,
  requestConnectFourMove, saveConnectFourConfig, saveConnectFourGame,
} from './connectFourApi.js';
import './PianoConnectFour.scss';

const DEFAULT_CONFIG = {
  input_mode: 'notes', shuffle_each_game: false,
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'], default_level: 1,
};
const ROOTS = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function userIdOf(currentUser) {
  const value = typeof currentUser === 'string' ? currentUser : currentUser?.id;
  return value && value !== 'guest' ? value : null;
}

export function shuffledColumns(seed) {
  const values = [0, 1, 2, 3, 4, 5, 6];
  let state = seed >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const target = state % (index + 1);
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

export function addressedColumn(active, config, deal) {
  const notes = [...active.keys()].sort((a, b) => a - b);
  if (!notes.length) return null;
  if (config.input_mode === 'chords') {
    const pcs = [...new Set(notes.map((note) => note % 12))];
    const index = ROOTS.findIndex((root) => pcs.length === 3 && [root, (root + 4) % 12, (root + 7) % 12].every((pc) => pcs.includes(pc)));
    return index < 0 ? null : deal[index];
  }
  const index = config.column_notes.findIndex((note) => note === notes.at(-1) || note % 12 === notes.at(-1) % 12);
  return index < 0 ? null : deal[index];
}

function Board({ game, hint }) {
  return (
    <div className="connect-four-board" role="grid" aria-label="Connect Four board">
      {game.board.map((row, rowIndex) => row.map((cell, column) => (
        <div
          key={`${rowIndex}-${column}`}
          role="gridcell"
          className={`connect-four-board__cell${hint === column ? ' is-hint' : ''}`}
        >
          <span className={`connect-four-board__disc connect-four-board__disc--${cell || 'empty'}`} />
        </div>
      )))}
    </div>
  );
}

export default function PianoConnectFour({ activeNotes = new Map(), currentUser = null, onNoteOn, onNoteOff }) {
  const userId = userIdOf(currentUser);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [ladder, setLadder] = useState(null);
  const [moves, setMoves] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState(null);
  const [localPractice, setLocalPractice] = useState(false);
  const [seed, setSeed] = useState(() => Date.now() >>> 0);
  const [gameId, setGameId] = useState(() => `connect-four-${Date.now()}`);
  const latchedRef = useRef(false);
  const savedRef = useRef(false);
  const rankedRef = useRef(true);
  const movesRef = useRef(moves);
  movesRef.current = moves;
  const game = useMemo(() => replayGame({ moves }), [moves]);
  const deal = useMemo(() => config.shuffle_each_game ? shuffledColumns(seed) : [0, 1, 2, 3, 4, 5, 6], [config.shuffle_each_game, seed]);
  const level = ladder?.unlocked_through ?? config.default_level ?? 1;

  useEffect(() => {
    fetchConnectFourConfig(userId).then((value) => value && setConfig((old) => ({ ...old, ...value })));
    fetchConnectFourLadder(userId).then((value) => value && setLadder(value));
  }, [userId]);

  useEffect(() => {
    if (game.status.gameOver || game.turn !== 1 || thinking) return;
    if (activeNotes.size === 0) { latchedRef.current = false; setHint(null); return; }
    if (latchedRef.current) return;
    // Seven-note cluster is the universal best-move gesture, independent of addressing mode.
    if (activeNotes.size >= 7) {
      setHint(chooseColumn(game.board, { player: 1, level }));
      latchedRef.current = true;
      return;
    }
    const column = addressedColumn(activeNotes, config, deal);
    if (column === null) return;
    const next = playColumn({ moves }, column);
    if (!next.error) setMoves(next.moves);
    latchedRef.current = true;
  }, [activeNotes, config, deal, game, level, moves, thinking]);

  useEffect(() => {
    if (game.status.gameOver || game.turn !== 2) return;
    let cancelled = false;
    setThinking(true);
    requestConnectFourMove({ transcript: { moves }, level, gameId, userId }).then((answer) => {
      if (cancelled) return;
      if (!answer?.move) {
        rankedRef.current = false;
        setLocalPractice(true);
      }
      const column = answer?.move?.column ?? chooseColumn(game.board, { player: 2, level });
      const next = playColumn({ moves }, column);
      if (!next.error) setMoves(next.moves);
      setThinking(false);
    });
    return () => { cancelled = true; };
  }, [game.board, game.status.gameOver, game.turn, gameId, level, moves, userId]);

  useEffect(() => {
    if (!game.status.gameOver || savedRef.current) return;
    savedRef.current = true;
    const result = game.status.draw ? 'draw' : game.status.winner === 1 ? 'win' : 'loss';
    const record = { moves, result, level, ranked: rankedRef.current, completed: true, played_on: new Date().toISOString().slice(0, 10) };
    if (userId) saveConnectFourGame(userId, record).then((response) => response?.ladder && setLadder(response.ladder));
    archiveConnectFourGame({ ...record, user_id: userId });
  }, [game.status, level, moves, userId]);

  useEffect(() => () => {
    if (!savedRef.current && movesRef.current.length) {
      archiveConnectFourGame({ moves: movesRef.current, completed: false, user_id: userId, ended_by: 'exit' });
    }
  }, [userId]);

  const updateConfig = (patch) => {
    setConfig((value) => ({ ...value, ...patch }));
    if (userId) saveConnectFourConfig(userId, patch);
  };
  const restart = () => {
    setMoves([]);
    setHint(null);
    setThinking(false);
    setLocalPractice(false);
    savedRef.current = false;
    rankedRef.current = true;
    latchedRef.current = activeNotes.size > 0;
    setSeed((value) => (value + 1) >>> 0);
    setGameId(`connect-four-${Date.now()}`);
  };
  const status = game.status.gameOver
    ? game.status.draw ? 'Draw game' : game.status.winner === 1 ? 'You connected four!' : `${ladder?.current?.name ?? 'Opponent'} wins`
    : thinking ? `${ladder?.current?.name ?? 'Opponent'} is thinking…` : 'Play the key for a column';

  return (
    <PianoGameHost
      gameId="connect-four"
      phase={game.status.gameOver ? 'result' : thinking ? 'paused' : 'playing'}
      className="piano-connect-four"
      instrument={{ activeNotes, startNote: 48, endNote: 84, showLabels: true, onNoteOn, onNoteOff }}
    >
      <InstrumentBoardStage
        layout={BOARD_LAYOUTS.SINGLE}
        primary={<Board game={game} hint={hint} />}
        leftRail={(
          <div className="connect-four-opponent">
            <strong>{ladder?.current?.name ?? 'Pebble'}</strong>
            <span>Level {level} of 7</span>
            <span>{ladder?.wins ?? 0} / 3 wins</span>
          </div>
        )}
        rightRail={(
          <div className="connect-four-settings">
            <label>Input
              <select value={config.input_mode} onChange={(event) => updateConfig({ input_mode: event.target.value })}>
                <option value="notes">Single notes</option>
                <option value="chords">Major chords</option>
              </select>
            </label>
            <label><input type="checkbox" checked={config.shuffle_each_game} onChange={(event) => updateConfig({ shuffle_each_game: event.target.checked })} /> Re-deal columns</label>
            <div className="connect-four-key">
              {deal.map((column, address) => <span key={column}>{column + 1}: {config.input_mode === 'chords' ? config.column_chords[address] : NOTE_NAMES[config.column_notes[address] % 12]}</span>)}
            </div>
            <small>Play seven notes together for a hint.</small>
          </div>
        )}
        status={(
          <div className="connect-four-status">
            <span>{status}{localPractice ? ' · local practice' : ''}</span>
            {game.status.gameOver && <button type="button" onClick={restart}>Play again</button>}
          </div>
        )}
      />
    </PianoGameHost>
  );
}
