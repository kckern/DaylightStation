import { useEffect, useMemo, useRef, useState } from 'react';
import { chooseColumn, CONNECT_FOUR_OPPONENTS } from '@shared-gaming/rulesets/connect-four/opponent.mjs';
import { playColumn, replayGame } from '@shared-gaming/rulesets/connect-four/engine.mjs';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import { useAnyKeyToContinue } from '../game-platform/input/useAnyKeyToContinue.js';
import { useMatchRematch } from '../game-platform/host/useMatchRematch.js';
import InstrumentBoardStage from '../game-platform/families/addressed-board/InstrumentBoardStage.jsx';
import AddressRail from '../game-platform/families/addressed-board/AddressRail.jsx';
import { BOARD_LAYOUTS } from '../game-platform/families/addressed-board/contracts.js';
import { useAddressedBoardGame } from '../game-platform/families/addressed-board/useAddressedBoardGame.js';
import { useAddressing } from '../game-platform/addressing/useAddressing.js';
import { useAddressingLadder } from '../game-platform/addressing/useAddressingLadder.js';
import { managedAddressingAt } from '../game-platform/addressing/managedAddressing.js';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import {
  GameRail, GameSlot, GameButton, GameStatusBar, GameToggle, GameChoice, LadderBadge, DealNotice, GameSheet,
} from '../game-platform/chrome/index.js';
import AddressingSettings from '../game-platform/addressing/AddressingSettings.jsx';
import GearIcon from '../game-platform/chrome/GearIcon.jsx';
import Icon from '../ui/icons/Icon.jsx';
import { materialFor } from '../game-platform/addressing/resolveAddressing.js';
import connectFourClient from './connectFourApi.js';
import { useConnectFourAuthority } from './useConnectFourAuthority.js';
import {
  COLUMNS, DEFAULT_CONFIG, configuredAddressing, scaleRoots, shuffledColumns,
  addressedColumn, columnAddresses, lastDrop, dropDurationMs, winningKeys,
} from './pianoConnectFourModel.js';
import './PianoConnectFour.scss';

// Connect Four's ladder is 7 rungs — thinkTimeFor's `levels` generalises the
// old chess-only ladder size.
const LADDER_LEVELS = 7;
// Used only when thinkTimeFor has nothing to read yet (no ladder resolved).
const OPPONENT_THINK_FALLBACK_MS = 700;
const INPUT_MODES = [
  { value: 'notes', label: 'Notes' },
  { value: 'chords', label: 'Chords' },
];

/** The column legend must speak the same vocabulary as the input resolver. */
function railNotation(vocabulary) {
  if (vocabulary === 'chords') return 'chords';
  if (vocabulary === 'names') return 'names';
  return 'staff';
}
/** Search depth for a HINT — competent, and deliberately not the opponent's. */
const HINT_SEARCH_LEVEL = 5;

const HINT_CLUSTER = 7;

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
            /* Placed explicitly. The panel below spans the whole grid, and an
               explicitly-placed item makes auto-placement route around it —
               which pushed all 42 cells into implicit rows and left the holes
               registered horizontally but 408px out vertically. */
            style={{ gridRow: rowIndex + 1, gridColumn: column + 1 }}
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
          which is where it is in the physical game. See PianoConnectFour.scss.
          It is a GRID ITEM spanning every track, not an absolutely-positioned
          overlay, and each hole is a real grid cell rather than a tiled
          background: that is what makes a hole land on its cell by construction
          instead of by arithmetic that has to agree. */}
      <div className="connect-four-board__panel" aria-hidden="true">
        {Array.from({ length: 42 }, (_, i) => (
          <span key={i} className="connect-four-board__hole" />
        ))}
      </div>
    </div>
  );
}

export default function PianoConnectFour({ activeNotes = new Map(), currentUser = null, addressingPolicy = null, onNoteOn, onNoteOff }) {
  const [hint, setHint] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const latchedRef = useRef(false);

  // The checkpointed-local Gaming coordinator owns the transcript. Piano keeps
  // MIDI addressing, pedagogy, pacing, and presentation composition.
  const { moves, play: commitColumn, reset: resetAuthority } = useConnectFourAuthority({ userId: currentUser?.id || currentUser?.username || 'household' });
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
  const overrides = useMemo(() => configuredAddressing(config), [config]);
  const managed = useMemo(() => managedAddressingAt(addressingPolicy?.config, {
    learnerId: addressingPolicy?.learnerId,
    completedGames: addressingPolicy?.completedGames,
    completedPlayerMoves: Math.ceil(moves.length / 2),
  }), [addressingPolicy, moves.length]);
  const { x: columnNotes, addressing } = useAddressing({
    config, axisSize: COLUMNS, seed, ply: moves.length, overrides, managed,
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
  const { startTurn: startReadingTurn, record: recordReading } = useAddressingLadder({
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
      if (!next.error) commitColumn(column);
    },
  });

  // Time-to-address is measured from when it became the player's turn.
  useEffect(() => {
    if (!game.status.gameOver && game.turn === 1 && !thinking) startReadingTurn();
  }, [game.status.gameOver, game.turn, startReadingTurn, thinking]);

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
      // Searched at a competent depth, NOT the opponent's — see the same fix in
      // checkers. At level 1 the search is one ply and cannot see the reply, so
      // the "best column" it suggested was one that handed the game away.
      const suggested = chooseColumn(game.board, { player: 1, level: HINT_SEARCH_LEVEL });
      setHint(suggested);
      logger.info('connect-four.hint', { column: suggested, level, hintLevel: HINT_SEARCH_LEVEL });
      latchedRef.current = true;
      return;
    }
    const column = addressedColumn(activeNotes, columns, deal);
    if (column === null) return;
    const next = playColumn({ moves }, column);
    if (!next.error) {
      commitColumn(column);
      logger.info('connect-four.drop', { column, ply: next.moves.length });
    }
    // A full column is a refused address, not a landed one.
    recordReading({ ok: !next.error });
    latchedRef.current = true;
  }, [activeNotes, columns, commitColumn, deal, game, level, logger, moves, recordReading, thinking]);

  // The gate is consulted HERE, above `resetAuthority()`, and not only inside
  // `resetSession()`. `resetAuthority()` closes the finished session and mints
  // a fresh checkpointed one, writing its id into the active-session index —
  // so asking afterwards would leave an empty, unplayed board recorded as this
  // player's live game every time the challenge is failed or left. Nothing is
  // torn down until the host has said the next match may begin.
  const restart = useMatchRematch(() => {
    resetAuthority();
    setHint(null);
    // A key already down when the game restarts must not immediately address a
    // column — the latch opens on the next release, not on this render.
    latchedRef.current = activeNotes.size > 0;
    resetSession();
  });

  // No touchscreen on the office screen, so "Play again" is a dead end there:
  // the board is finished and the only way out is the launcher combo. Any fresh
  // key restarts. The keys still down from the winning move do not count — the
  // player has to see who won first.
  useAnyKeyToContinue({ enabled: game.status.gameOver, activeNotes, onContinue: restart });

  const opponent = ladder?.current
    ?? CONNECT_FOUR_OPPONENTS[Math.max(0, Math.min(CONNECT_FOUR_OPPONENTS.length - 1, level - 1))];
  const opponentName = opponent.name;
  // Who won, in the terms the player can check against the board: a colour and
  // the four lit discs. "You connected four!" and a bare "Pebble wins" left the
  // player hunting for the line that ended the game.
  const status = game.status.gameOver
    ? game.status.draw
      ? 'Draw — the board is full and nobody connected four'
      : game.status.winner === 1
        ? 'You win! Your four yellow discs are lit up'
        : `${opponentName} wins — the four red discs are lit up`
    : thinking ? `${opponentName} is thinking…`
      : hint !== null ? 'Suggested column is glowing.' : 'Your turn — play a key to drop a disc';

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
          <AddressRail
            addresses={railAddresses}
            notation={railNotation(addressing.vocabulary)}
            orientation="horizontal"
            active={hoveredColumn}
          />
        )}
        primary={<Board game={game} hint={hint} drop={drop} />}
        leftRail={(
          <GameRail label="Opponent">
            <GameSlot>
              <LadderBadge
                name={opponentName}
                level={level}
                levels={LADDER_LEVELS}
                wins={ladder?.wins ?? 0}
                needed={ladder?.needed ?? 3}
                portrait={opponent.art ? <img className="pg-ladder__portrait" src={opponent.art} alt="" /> : null}
              />
            </GameSlot>
          </GameRail>
        )}
        rightRail={(
          <GameRail
            label="Controls"
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
            <GameSlot label={<><Icon name="piano" /> Play with</>}>
              <GameChoice
                value={addressing.vocabulary === 'chords' ? 'chords' : 'notes'}
                options={INPUT_MODES}
                onChange={(value) => updateConfig({
                  addressing: { vocabulary: value === 'chords' ? 'chords' : 'staff' },
                })}
              />
              <GameToggle
                label="Shuffle columns"
                checked={addressing.shuffle !== 'never'}
                onChange={(value) => updateConfig({
                  addressing: { shuffle: value ? 'each_game' : 'never' },
                })}
              />
              <DealNotice cadence={addressing.shuffle} dealKey={`${seed}-${moves.length}`} />
            </GameSlot>
            {/* The text legend used to live here ("1: C  2: D  ..."), tucked in
                a settings panel the player has to open and read while their
                hands are off the keys. The rail above the board says the same
                thing where it actually helps — over each column, all the time,
                in the vocabulary the player is learning. */}
            <GameSlot label={<><Icon name="hand-right" /> Hint</>} variant="plain">
              <div className="pg-rail-cue" aria-label="Play seven keys together for a hint">
                <strong>7 keys</strong><span>Best column</span>
              </div>
            </GameSlot>
          </GameRail>
        )}
        status={(
          <GameStatusBar
            aside={game.status.gameOver ? 'Any key: play again' : localPractice ? 'Local practice' : null}
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
