import { useEffect, useMemo, useRef, useState } from 'react';
import { chooseColumn } from '@shared-gaming/connect-four/opponent.mjs';
import { playColumn, replayGame } from '@shared-gaming/connect-four/engine.mjs';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import InstrumentBoardStage from '../game-platform/families/addressed-board/InstrumentBoardStage.jsx';
import AddressRail from '../game-platform/families/addressed-board/AddressRail.jsx';
import { BOARD_LAYOUTS } from '../game-platform/families/addressed-board/contracts.js';
import { useAddressedBoardGame } from '../game-platform/families/addressed-board/useAddressedBoardGame.js';
import { useAddressing } from '../game-platform/addressing/useAddressing.js';
import { useAddressingLadder } from '../game-platform/addressing/useAddressingLadder.js';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import {
  GameRail, GameSlot, GameButton, GameStatusBar, GameToggle, GameChoice, LadderBadge, DealNotice, GameSheet,
} from '../game-platform/chrome/index.js';
import AddressingSettings from '../game-platform/addressing/AddressingSettings.jsx';
import GearIcon from '../game-platform/chrome/GearIcon.jsx';
import { materialFor } from '../game-platform/addressing/resolveAddressing.js';
import { noteName } from '../PianoChessGame/staffAddress.js';
import connectFourClient from './connectFourApi.js';
import './PianoConnectFour.scss';

const DEFAULT_CONFIG = {
  input_mode: 'notes', shuffle_each_game: false,
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'], default_level: 1,
};
// Connect Four's ladder is 7 rungs — thinkTimeFor's `levels` generalises the
// old chess-only ladder size.
const LADDER_LEVELS = 7;
// Used only when thinkTimeFor has nothing to read yet (no ladder resolved).
const OPPONENT_THINK_FALLBACK_MS = 700;
const COLUMNS = 7;

/**
 * This game's own historical config keys, read forward onto the dimensions.
 *
 * `column_notes` is in real players' folders, so a saved axis still wins over a
 * tier — that is what the explicit-scheme escape hatch is for.
 *
 * One axis, not two: gravity picks the row, so Connect Four addresses a COLUMN
 * and nothing else. The scheme's `qualities` is filled with the same values as
 * `roots` because the shape is shared with the two-axis games and a scheme with
 * a missing axis fails validation — nothing ever reads it here.
 */
export function legacyAddressing(config) {
  const notes = config?.column_notes;
  const legacy = {};
  if (Array.isArray(notes) && notes.length === COLUMNS && notes.every(Number.isFinite)
    && notes.join() !== DEFAULT_CONFIG.column_notes.join()) {
    legacy.scheme = { id: 'connect-four-saved-columns', kind: 'staff', roots: notes, qualities: notes };
  }
  if (config?.shuffle_each_game !== undefined) legacy.shuffle_each_game = config.shuffle_each_game;
  return legacy;
}

/**
 * The chord roots this game addresses columns with, in SCALE order.
 *
 * The chord tier tables are alphabetical, because chess maps file `a` to A. A
 * row of columns read left to right is a scale, not an alphabet — so the same
 * tier material is re-sorted from C upward here. Same notes, the order a player
 * reading a keyboard expects.
 */
export function scaleRoots(roots, size = COLUMNS) {
  const order = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const rank = (root) => {
    const index = order.indexOf(root);
    return index < 0 ? order.length : index;
  };
  return [...roots].sort((a, b) => rank(a) - rank(b)).slice(0, size);
}

const ROOTS = [0, 2, 4, 5, 7, 9, 11];
const INPUT_MODES = [
  { value: 'notes', label: 'Single notes' },
  { value: 'chords', label: 'Major chords' },
];
const HINT_CLUSTER = 7;

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

/**
 * The rail's cards, in COLUMN order — not address order.
 *
 * `deal[address] = column`, so a shuffled game moves which note plays which
 * column while `config.column_notes` itself never changes. A rail drawn in
 * address order would show the SAME seven cards regardless of the deal, which
 * is exactly backwards: the rail sits over the board, so card N has to name
 * whatever note actually drops a disc into column N right now — inverting the
 * deal is what makes that true instead of coincidental.
 */
export function columnAddresses(config, deal) {
  const addressByColumn = [];
  deal.forEach((column, address) => { addressByColumn[column] = address; });
  return addressByColumn.map((address) => ({
    midi: config.column_notes[address],
    label: noteName(config.column_notes[address]),
    chord: config.column_chords?.[address] ?? null,
  }));
}

/**
 * Where the newest disc landed, and how far it had to fall to get there.
 *
 * Discs stack from the floor up, so the newest one in a column is the TOPMOST
 * occupied cell in it — no need to diff boards or thread the landing row out of
 * the engine. `rows` counts cells from above the board's rim down to the resting
 * place, which is what turns one animation into a fall of the right length: a
 * disc into a full column barely moves, a disc into an empty one falls six.
 */
export function lastDrop(board, moves) {
  if (!moves.length) return null;
  const column = moves.at(-1);
  const row = board.findIndex((cells) => cells[column]);
  if (row < 0) return null;
  return { row, column, rows: row + 1, ply: moves.length };
}

/** Longer falls take longer. Gravity, not a fixed transition. */
export function dropDurationMs(rows) {
  return 190 + Math.max(0, rows) * 52;
}

/**
 * The four cells that won, as `row-column` keys.
 *
 * The engine has always reported them (`describeBoard` → `winningCells`) and the
 * board has always thrown them away, so a finished game looked exactly like an
 * unfinished one plus a sentence. Keys rather than the raw pairs because the
 * board asks the question once per cell, forty-two times a render.
 */
export function winningKeys(status) {
  return new Set((status?.winningCells ?? []).map(({ row, column }) => `${row}-${column}`));
}

function Board({ game, hint, drop }) {
  const winners = winningKeys(game.status);
  return (
    <div
      className={`connect-four-board pg-board${winners.size ? ' is-decided' : ''}`}
      role="grid"
      aria-label="Connect Four board"
    >
      {game.board.map((row, rowIndex) => row.map((cell, column) => {
        const falling = drop && drop.row === rowIndex && drop.column === column;
        const won = winners.has(`${rowIndex}-${column}`);
        return (
          <div
            key={`${rowIndex}-${column}`}
            role="gridcell"
            className={`connect-four-board__cell${hint === column ? ' is-hint' : ''}${won ? ' is-winner' : ''}`}
          >
            <span
              /* Keyed on the ply so the same column twice running still animates
                 twice — a remount is the only thing that restarts a CSS
                 animation, and every disc landing deserves its own drop. */
              key={falling ? `drop-${drop.ply}` : 'seated'}
              className={`connect-four-board__disc connect-four-board__disc--${cell || 'empty'}${falling ? ' is-falling' : ''}${won ? ' is-winner' : ''}`}
              style={falling ? {
                '--c4-drop-rows': drop.rows,
                '--c4-drop-ms': `${dropDurationMs(drop.rows)}ms`,
              } : undefined}
            />
          </div>
        );
      }))}
      {/* The blue sheet with forty-two holes in it, drawn OVER the discs —
          which is where it is in the physical game. See PianoConnectFour.scss. */}
      <div className="connect-four-board__panel" aria-hidden="true" />
    </div>
  );
}

export default function PianoConnectFour({ activeNotes = new Map(), currentUser = null, onNoteOn, onNoteOff }) {
  const [hint, setHint] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const latchedRef = useRef(false);

  // The transcript IS the game — nothing else is persisted, and a replay from
  // moves is what the server validates against.
  const [moves, setMoves] = useState([]);
  const game = useMemo(() => replayGame({ moves }), [moves]);
  const result = !game.status.gameOver
    ? null
    : game.status.draw ? 'draw' : game.status.winner === 1 ? 'win' : 'loss';

  const {
    config, updateConfig, ladder, level, seed, gameSessionId, userId,
    localPractice, noteLocalPractice, restart: resetSession, logger,
  } = useAddressedBoardGame({
    gameId: 'connect-four',
    client: connectFourClient,
    currentUser,
    defaultConfig: DEFAULT_CONFIG,
    ladderLevels: LADDER_LEVELS,
    moves,
    result,
  });

  // Which key drops into which column, resolved from the layers rather than
  // from a constant in this file — see docs/reference/piano/grid-addressing.md.
  const legacy = useMemo(() => legacyAddressing(config), [config]);
  const { x: columnNotes, addressing } = useAddressing({
    config, axisSize: COLUMNS, seed, ply: moves.length, legacy,
  });

  // The deal stays this game's own: `deal[address] = column`, so the ADDRESS
  // order is what the resolver produces and the deal is what maps it onto the
  // board. Re-dealing the columns and re-ordering the axis are two different
  // things, and only the second belongs to the shared vocabulary.
  const deal = useMemo(
    () => (addressing.shuffle === 'never' ? [0, 1, 2, 3, 4, 5, 6] : shuffledColumns(seed)),
    [addressing.shuffle, seed],
  );

  // The material this game addresses with, whichever vocabulary is resolved.
  const columns = useMemo(() => ({
    ...config,
    // `addressedColumn` reads this; the resolved vocabulary is the source of
    // truth for it now, so a saved `input_mode` no longer disagrees with the
    // rail the player is reading.
    input_mode: addressing.vocabulary === 'chords' ? 'chords' : 'notes',
    column_notes: columnNotes,
    column_chords: scaleRoots(
      addressing.vocabulary === 'chords'
        ? materialFor('chords', 'x', addressing.x.tier)
        : config.column_chords ?? DEFAULT_CONFIG.column_chords,
    ),
  }), [config, columnNotes, addressing.vocabulary, addressing.x.tier]);

  // The reading ladder watches how the player ADDRESSES, not whether they win.
  const reading = useAddressingLadder({
    client: connectFourClient, gameId: 'connect-four', userId, config, logger,
  });

  // The disc that just landed, so it can fall in rather than appear.
  const drop = useMemo(() => lastDrop(game.board, moves), [game.board, moves]);

  // The opponent's reply is a floor on the wait, never an addend: the request
  // goes out the instant it is this character's turn, and the disc lands at
  // max(elapsed, thinkMs) — see opponentPacing.js.
  const opponentEnabled = !game.status.gameOver && game.turn === 2;
  const thinkMs = thinkTimeFor({
    level, levels: LADDER_LEVELS, config, seed, ply: moves.length, pace: config.opponent?.pace ?? 1,
  }) ?? OPPONENT_THINK_FALLBACK_MS;
  const { thinking } = useOpponentReply({
    enabled: opponentEnabled,
    thinkMs,
    resetKey: gameSessionId,
    request: () => connectFourClient.requestMove({
      transcript: { moves }, level, gameSessionId, userId,
    }),
    onReply: (answer) => {
      if (!answer?.move) noteLocalPractice();
      const column = answer?.move?.column ?? chooseColumn(game.board, { player: 2, level });
      const next = playColumn({ moves }, column);
      if (!next.error) setMoves(next.moves);
    },
  });

  // Time-to-address is measured from when it became the player's turn.
  useEffect(() => {
    if (!game.status.gameOver && game.turn === 1 && !thinking) reading.startTurn();
  }, [game.status.gameOver, game.turn, thinking]);

  useEffect(() => {
    // Same silent swallow as checkers had: a finished board re-entered from the
    // launcher eats every note and explains nothing. Sampled — evaluated per note.
    if (game.status.gameOver || game.turn !== 1 || thinking) {
      if (activeNotes.size > 0) {
        logger.sampled('connect-four.input-ignored', {
          reason: game.status.gameOver ? 'game-over' : thinking ? 'opponent-thinking' : 'not-your-turn',
          turn: game.turn, ply: moves?.length ?? null,
        }, { maxPerMinute: 6, aggregate: true });
      }
      return;
    }
    if (activeNotes.size === 0) { latchedRef.current = false; setHint(null); return; }
    if (latchedRef.current) return;
    // Seven-note cluster is the universal best-move gesture, independent of
    // addressing mode.
    if (activeNotes.size >= HINT_CLUSTER) {
      const suggested = chooseColumn(game.board, { player: 1, level });
      setHint(suggested);
      logger.info('connect-four.hint', { column: suggested, level });
      latchedRef.current = true;
      return;
    }
    const column = addressedColumn(activeNotes, columns, deal);
    if (column === null) return;
    const next = playColumn({ moves }, column);
    if (!next.error) {
      setMoves(next.moves);
      logger.info('connect-four.drop', { column, ply: next.moves.length });
    }
    // A full column is a refused address, not a landed one.
    reading.record({ ok: !next.error });
    latchedRef.current = true;
  }, [activeNotes, columns, deal, game, level, logger, moves, thinking]);

  const restart = () => {
    setMoves([]);
    setHint(null);
    // A key already down when the game restarts must not immediately address a
    // column — the latch opens on the next release, not on this render.
    latchedRef.current = activeNotes.size > 0;
    resetSession();
  };

  const opponentName = ladder?.current?.name ?? 'Pebble';
  // Who won, in the terms the player can check against the board: a colour and
  // the four lit discs. "You connected four!" and a bare "Pebble wins" left the
  // player hunting for the line that ended the game.
  const status = game.status.gameOver
    ? game.status.draw
      ? 'Draw — the board is full and nobody connected four'
      : game.status.winner === 1
        ? 'You win! Your four yellow discs are lit up'
        : `${opponentName} wins — the four red discs are lit up`
    : thinking ? `${opponentName} is thinking…` : 'Your turn — play a key to drop a disc';

  // The rail's own cards, one per column, already inverted through the deal —
  // see columnAddresses. The active card follows whatever the held keys
  // currently address, the SAME resolution the drop itself uses a moment later,
  // so the highlight never promises a column the drop would disagree with.
  const railAddresses = useMemo(() => columnAddresses(columns, deal), [columns, deal]);
  const hoveredColumn = addressedColumn(activeNotes, columns, deal);

  return (
    <PianoGameHost
      gameId="connect-four"
      phase={game.status.gameOver ? 'result' : thinking ? 'paused' : 'playing'}
      className="piano-connect-four"
      instrument={{ activeNotes, startNote: 48, endNote: 84, showLabels: true, onNoteOn, onNoteOff }}
    >
      <InstrumentBoardStage
        layout={BOARD_LAYOUTS.SINGLE}
        topRail={(
          <AddressRail addresses={railAddresses} orientation="horizontal" active={hoveredColumn} />
        )}
        primary={<Board game={game} hint={hint} drop={drop} />}
        leftRail={(
          <GameRail label="Opponent">
            <GameSlot label="Playing against">
              <LadderBadge
                name={opponentName}
                level={level}
                levels={LADDER_LEVELS}
                wins={ladder?.wins ?? 0}
                needed={ladder?.needed ?? 3}
              />
            </GameSlot>
          </GameRail>
        )}
        rightRail={(
          <GameRail
            label="Setup"
            foot={(
              <GameButton
                variant="icon"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-label="Settings"
                title="Settings"
              >
                <GearIcon />
              </GameButton>
            )}
          >
            <GameSlot label="How you play a column">
              <GameChoice
                value={addressing.vocabulary === 'chords' ? 'chords' : 'notes'}
                options={INPUT_MODES}
                onChange={(value) => updateConfig({
                  addressing: { vocabulary: value === 'chords' ? 'chords' : 'staff' },
                })}
              />
              <GameToggle
                label="Re-deal columns each game"
                checked={addressing.shuffle !== 'never'}
                onChange={(value) => updateConfig({
                  addressing: { shuffle: value ? 'each_game' : 'never' },
                })}
              />
            </GameSlot>
            {/* The text legend used to live here ("1: C  2: D  ..."), tucked in
                a settings panel the player has to open and read while their
                hands are off the keys. The rail above the board says the same
                thing where it actually helps — over each column, all the time,
                in the vocabulary the player is learning. */}
            <GameSlot label="Stuck?" variant="plain">
              Play seven notes together and the best column lights up.
              {/* Without this a re-deal is invisible: the player plays
                  yesterday's key and a disc lands in the wrong column. */}
              <DealNotice cadence={addressing.shuffle} dealKey={`${seed}-${moves.length}`} />
            </GameSlot>
          </GameRail>
        )}
        status={(
          <GameStatusBar
            aside={localPractice ? 'local practice' : null}
            action={game.status.gameOver && (
              <GameButton variant="primary" onClick={restart}>Play again</GameButton>
            )}
          >
            {status}
          </GameStatusBar>
        )}
      />

      {/* The same reading ladder chess offers, on the same control. */}
      {settingsOpen && (
        <GameSheet title="Settings" onClose={() => setSettingsOpen(false)}>
          <AddressingSettings config={config} axisSize={COLUMNS} onChange={updateConfig} />
        </GameSheet>
      )}
    </PianoGameHost>
  );
}
