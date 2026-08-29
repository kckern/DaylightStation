import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMove, legalMoves, replayGame } from '@shared-gaming/rulesets/checkers/engine.mjs';
import { chooseMove, CHECKERS_OPPONENTS } from '@shared-gaming/rulesets/checkers/opponent.mjs';
import { checkersCommentary } from '@shared-gaming/rulesets/checkers/commentary.mjs';
import BoardGameFrame from '../game-platform/host/BoardGameFrame.jsx';
import BoardGameResult from '../game-platform/host/BoardGameResult.jsx';
import BoardGameOpening from '../game-platform/host/BoardGameOpening.jsx';
import { useAnyKeyToContinue } from '../game-platform/input/useAnyKeyToContinue.js';
import { useMatchRematch } from '../game-platform/host/useMatchRematch.js';
import { slideOffsetCells, slideDurationMs } from './moveSlide.js';
import AddressRail from '../game-platform/families/addressed-board/AddressRail.jsx';
import { BOARD_LAYOUTS } from '../game-platform/families/addressed-board/contracts.js';
import { resolveAddressedSelection } from '../game-platform/families/addressed-board/interactionGrammars.js';
import { useAddressedBoardGame } from '../game-platform/families/addressed-board/useAddressedBoardGame.js';
import { useAddressing } from '../game-platform/addressing/useAddressing.js';
import { useAddressingLadder } from '../game-platform/addressing/useAddressingLadder.js';
import { managedAddressingAt } from '../game-platform/addressing/managedAddressing.js';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import {
  GameRail, GameSlot, GameButton, GameStatusBar, GameToggle, DealNotice, GameSheet,
} from '../game-platform/chrome/index.js';
import OpponentPanel from '../game-platform/opponent/OpponentPanel.jsx';
import OpponentRosterSheet from '../game-platform/opponent/OpponentRosterSheet.jsx';
import { useOpponentDialogue } from '../game-platform/opponent/useOpponentDialogue.js';
import AddressingSettings from '../game-platform/addressing/AddressingSettings.jsx';
import Icon from '../ui/icons/Icon.jsx';
import {
  DEFAULT_FILE_NOTES, DEFAULT_RANK_NOTES, activeFileIndex, activeRankDisplayIndex,
  fileRailAddresses, rankRailAddresses, squareForAddress,
} from './checkersAddress.js';
import checkersClient from './checkersApi.js';
import { useCheckersAuthority } from './useCheckersAuthority.js';
import { selectionMessage, configuredAddressing } from './checkersAddressingModel.js';
import './PianoCheckers.scss';

const DEFAULT_CONFIG = Object.freeze({
  addressing: { vocabulary: 'staff', shuffle: 'never' },
  file_notes: DEFAULT_FILE_NOTES,
  rank_notes: DEFAULT_RANK_NOTES,
  default_level: 1,
});
// Checkers' ladder is 7 rungs — thinkTimeFor's `levels` generalises the old
// chess-only ladder size.
const LADDER_LEVELS = 7;
// Used only when thinkTimeFor has nothing to read yet (no ladder resolved).
const OPPONENT_THINK_FALLBACK_MS = 700;
/** Search depth for a HINT — competent, and deliberately not the opponent's. */
const HINT_SEARCH_LEVEL = 5;

const HINT_CLUSTER = 7;
const AXIS = 8;

function CheckersBoard({ game, selected, hint }) {
  const moves = legalMoves(game.board, game.turn, game.forcedFrom);
  // The move that just landed, so the piece now sitting on `to` can be shown
  // arriving from `from` rather than simply being there. Matters most for the
  // OPPONENT's move: the player did not make it and has to read it off the board.
  const slide = slideOffsetCells(game.lastMove);
  const slideMs = slideDurationMs(slide);
  const sources = new Set(moves.map((move) => move.from));
  const destinations = new Set(moves.filter((move) => move.from === selected).map((move) => move.to));
  return (
    <div className="checkers-board" role="grid" aria-label="Checkers board">
      {Array.from({ length: 64 }, (_, cell) => {
        const row = Math.floor(cell / 8);
        const column = cell % 8;
        const playable = (row + column) % 2 === 1;
        const square = playable ? row * 4 + Math.floor(column / 2) : null;
        const piece = playable ? game.board[square] : null;
        const classes = [
          'checkers-board__cell', playable ? 'is-playable' : 'is-light',
          playable && selected !== null && square === selected ? 'is-selected' : '',
          destinations.has(square) ? 'is-destination' : '',
          selected === null && game.turn === 1 && sources.has(square) ? 'is-source' : '',
          hint && (hint.from === square || hint.to === square) ? 'is-hint' : '',
        ].filter(Boolean).join(' ');
        // No address label here — see checkersAddress.js. The square is still
        // addressed by playing its file note and rank note together; the rim
        // rails around the board (below) are where that answer lives now.
        return (
          <div key={cell} className={classes} role="gridcell">
            {piece && (
              <span
                /* Keyed on the ply so the same piece moving twice running
                   animates twice — a remount is the only thing that restarts a
                   CSS animation. */
                key={slide && square === game.lastMove?.to ? `slide-${game.moves.length}` : 'seated'}
                className={`checkers-board__piece checkers-board__piece--${piece.toLowerCase() === 'r' ? 'player' : 'opponent'}${slide && square === game.lastMove?.to ? ' is-sliding' : ''}`}
                style={slide && square === game.lastMove?.to ? {
                  '--ck-slide-x': slide.dx,
                  '--ck-slide-y': slide.dy,
                  '--ck-slide-ms': `${slideMs}ms`,
                } : undefined}
              >
                {piece === piece.toUpperCase() && <Icon name="crown" className="checkers-board__crown" label="King" />}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PianoCheckers({ activeNotes = new Map(), currentUser = null, addressingPolicy = null, onNoteOn, onNoteOff }) {
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState(null);
  const [hint, setHint] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [opening, setOpening] = useState(true);
  const latchedRef = useRef(false);
  const terminalSpokenRef = useRef(null);

  const authorityUserId = currentUser?.id || currentUser?.username || currentUser?.user_id || 'household';
  const { state: authorityState, moves, play: commitMove, reset: resetAuthority } = useCheckersAuthority({ userId: authorityUserId });
  const game = authorityState || replayGame({ moves: [] });
  const result = !game.status.gameOver
    ? null
    : game.status.draw ? 'draw' : game.status.winner === 1 ? 'win' : 'loss';

  const {
    config, updateConfig, ladder, level, seed, gameSessionId, userId,
    localPractice, noteLocalPractice, restart: resetSession, logger, archiveContextRef,
  } = useAddressedBoardGame({
    gameId: 'checkers',
    client: checkersClient,
    currentUser,
    defaultConfig: DEFAULT_CONFIG,
    ladderLevels: LADDER_LEVELS,
    moves,
    result,
  });

  // Which key means which square, resolved from the layers rather than from a
  // constant in this file: house default → this game's YAML → the addressing
  // rung → this player. The tier decides the material, the order decides the
  // layout, and the cadence decides when it moves — see
  // docs/reference/piano/grid-addressing.md.
  const overrides = useMemo(() => configuredAddressing(config), [config]);
  const completedPlayerMoves = useMemo(() => moves.reduce((total, _move, index) => {
    const replayed = replayGame({ moves: moves.slice(0, index + 1) });
    return total + (replayed.lastMove?.player === 1 ? 1 : 0);
  }, 0), [moves]);
  const managed = useMemo(() => managedAddressingAt(addressingPolicy?.config, {
    learnerId: addressingPolicy?.learnerId,
    completedGames: addressingPolicy?.completedGames,
    completedPlayerMoves,
  }), [addressingPolicy, completedPlayerMoves]);
  const { x: fileNotes, y: rankNotes, addressing } = useAddressing({
    config, axisSize: AXIS, seed, ply: moves.length, overrides, managed,
  });
  const notes = useMemo(
    () => ({ file_notes: fileNotes, rank_notes: rankNotes }),
    [fileNotes, rankNotes],
  );

  // The reading ladder watches how the player ADDRESSES, not whether they win —
  // see game-platform/addressing/addressingProgress.js.
  const { startTurn: startReadingTurn, record: recordReading } = useAddressingLadder({
    client: checkersClient, gameId: 'checkers', userId, config, logger,
  });

  // The opponent's reply is a floor on the wait, never an addend — see
  // opponentPacing.js.
  const opponentEnabled = !game.status.gameOver && game.turn === 2;
  const thinkMs = thinkTimeFor({
    level, levels: LADDER_LEVELS, config, seed, ply: moves.length, pace: config.opponent?.pace ?? 1,
  }) ?? OPPONENT_THINK_FALLBACK_MS;
  const dialogue = useOpponentDialogue({ logger });
  const { thinking } = useOpponentReply({
    enabled: opponentEnabled,
    thinkMs,
    // The ply and the forced-jump square are part of the key, not just the
    // game id. `enabled` is `turn === 2`, and after an opponent CAPTURE with
    // another jump available the engine leaves `forcedFrom` set and `turn` AT
    // 2 (engine.mjs: `turn = forcedFrom === null ? swap : game.turn`). So
    // `enabled` never toggled, the effect never re-ran, and the opponent
    // stopped halfway through a double jump — the board stayed on its turn
    // forever and every key the player pressed was discarded as
    // `not-your-turn`. Any opponent multi-jump hung the game.
    resetKey: `${gameSessionId}:${moves.length}:${game.forcedFrom ?? '-'}`,
    request: async () => {
      const answer = await checkersClient.requestMove({ transcript: { moves }, level, gameSessionId, userId });
      const move = answer?.move ?? chooseMove(game, { level: Math.min(2, level) });
      const projected = move ? applyMove(game, move) : game;
      const completedTurn = projected.status.gameOver || projected.turn === 1;
      const facts = completedTurn ? checkersCommentary({ moves: projected.moves }, {
        sessionId: gameSessionId, ply: projected.moves.length, playerSide: 1,
      }) : null;
      const reaction = facts ? dialogue.prepareReaction({
        request: () => checkersClient.requestDialogue?.({
          sessionId: gameSessionId, ply: projected.moves.length, level, playerSide: 1,
          transcript: { moves: projected.moves }, dialogue: dialogue.dialogueRef.current, userId,
        }),
        fallback: { eventId: facts.eventId, quip: facts.fallback, source: 'fallback' },
        event: { gameId: 'checkers', sessionId: gameSessionId, ply: projected.moves.length, opponentId: answer?.opponent?.opponent?.id || null },
      }) : null;
      return { answer, move, reaction };
    },
    onReply: async (plan) => {
      const { answer, move, reaction } = plan || {};
      if (!answer?.move) noteLocalPractice();
      // Keep offline practice responsive on the kiosk's older WebView CPU.
      const next = move ? await commitMove(move) : game;
      if (reaction && (next.status.gameOver || next.turn === 1)) dialogue.commitReaction(reaction);
      // Only the PLAYER's moves were ever logged, so a transcript could never
      // be replayed from the log store — exactly half the game was missing,
      // and it is the opponent's reply that sets up the forced jump a player
      // then gets stuck in.
      logger.info('checkers.opponent-move', {
        from: move?.from ?? null,
        to: move?.to ?? null,
        local: !answer?.move,
        forcedFrom: next.forcedFrom ?? null,
        ply: next.moves?.length ?? null,
        error: null,
      });
    },
  });

  useEffect(() => {
    setOpening(true);
    const timer = setTimeout(() => setOpening(false), 1200);
    return () => clearTimeout(timer);
  }, [gameSessionId]);

  useEffect(() => {
    if (!game.status.gameOver || game.lastMove?.player !== 1) return;
    const key = `${gameSessionId}:${game.moves.length}`;
    if (terminalSpokenRef.current === key) return;
    terminalSpokenRef.current = key;
    const facts = checkersCommentary({ moves: game.moves }, { sessionId: gameSessionId, ply: game.moves.length, playerSide: 1 });
    if (facts) dialogue.showTerminalReaction({
      reaction: { eventId: facts.eventId, quip: facts.fallback },
      event: { gameId: 'checkers', sessionId: gameSessionId, ply: game.moves.length, opponentId: opponent.id },
    });
  }, [dialogue, game, gameSessionId]);

  // Time-to-address is measured from when it became the player's turn.
  useEffect(() => {
    if (!game.status.gameOver && game.turn === 1 && !thinking) startReadingTurn();
  }, [game.status.gameOver, game.turn, startReadingTurn, thinking]);

  useEffect(() => {
    // Every one of these swallows the player's input. Silently, until now: a
    // finished board re-entered from the launcher looks identical to a working
    // one, and "I can't move" produced not a single log line to explain it.
    // Sampled because it is evaluated on every note event.
    if (game.status.gameOver || game.turn !== 1 || thinking) {
      if (activeNotes.size > 0) {
        logger.sampled('checkers.input-ignored', {
          reason: game.status.gameOver ? 'game-over' : thinking ? 'opponent-thinking' : 'not-your-turn',
          turn: game.turn, ply: game.moves?.length ?? null,
        }, { maxPerMinute: 6, aggregate: true });
      }
      return;
    }
    if (activeNotes.size === 0) { latchedRef.current = false; return; }
    if (latchedRef.current) return;
    if (activeNotes.size >= HINT_CLUSTER) {
      // A HINT is not an opponent move. It used to be searched at the
      // OPPONENT's level, and level 1 is depth 1 — `search(..., depth - 1)`
      // with depth 1 never looks at the reply at all, so the "suggested" move
      // walked pieces onto squares that were immediately jumped. Help that is
      // deliberately weak is worse than none: the player trusts the glow and
      // loses a piece for it. Chess already treats help this way — it asks for a
      // genuine best move regardless of who it is playing against.
      const suggestion = chooseMove(game, { level: HINT_SEARCH_LEVEL });
      setHint(suggestion);
      setMessage('Suggested move is glowing.');
      logger.info('checkers.hint', { from: suggestion?.from ?? null, to: suggestion?.to ?? null, level });
      latchedRef.current = true;
      return;
    }
    // Two notes together, exactly like chess's staff scheme — squareForAddress
    // returns null (a no-op, not a rejection) while only one of the pair is
    // down, so this effect naturally waits for the second note rather than
    // needing its own "how many notes so far" bookkeeping.
    const square = squareForAddress([...activeNotes.keys()], notes);
    if (square === null) return;
    recordReading({ ok: true });
    const available = legalMoves(game.board, 1, game.forcedFrom);
    const currentSelection = game.forcedFrom ?? selected;
    const destinations = available
      .filter((move) => move.from === currentSelection).map((move) => move.to);
    const resolution = resolveAddressedSelection({
      selected: currentSelection,
      address: square,
      sources: available.map((move) => move.from),
      destinations,
      // The engine, not the player, owns the source during a multi-jump.
      locked: game.forcedFrom !== null,
    });
    if (resolution.committed) {
      commitMove(resolution.committed).then((next) => {
        if (!next) return;
        setSelected(next.turn === 1 ? next.forcedFrom : null);
        setMessage(next.forcedFrom !== null ? 'Keep jumping with the same piece.' : null);
        setHint(null);
        logger.info('checkers.move', {
          from: resolution.committed.from, to: resolution.committed.to, ply: next.moves.length,
        });
      }).catch((error) => logger.error('checkers.commit-failed', {
        from: resolution.committed.from, to: resolution.committed.to, error: error.message,
      }));
    } else {
      setSelected(resolution.selected);
      setMessage(selectionMessage(resolution.rejection));
      if (resolution.rejection) {
        // The address and the reason alone cannot explain a stuck board after
        // the fact — they say what was refused, never what the board was
        // holding. Log the selection and the moves that WOULD have been taken.
        logger.info('checkers.rejected', {
          square,
          reason: resolution.rejection,
          selected: currentSelection,
          forcedFrom: game.forcedFrom,
          destinations,
          ply: game.moves?.length ?? null,
        });
        // A refused address is still an address that did not land: the ladder
        // counts it, because accuracy is what it is judging.
        recordReading({ ok: false });
      }
    }
    latchedRef.current = true;
  }, [activeNotes, commitMove, game, level, logger, notes, recordReading, selected, thinking]);

  // The gate is consulted HERE, above `resetAuthority()`, and not only inside
  // `resetSession()`. `resetAuthority()` closes the finished session and mints
  // a fresh checkpointed one, writing its id into the
  // `gaming:piano-checkers:active:{user}` index — so asking afterwards would
  // leave an empty, unplayed board recorded as this player's live game every
  // time the challenge is failed or left. Nothing is torn down until the host
  // has said the next match may begin.
  const restart = useMatchRematch(() => {
    setSelected(null);
    setMessage(null);
    setHint(null);
    dialogue.reset();
    // A key already down when the game restarts must not immediately address a
    // square — the latch opens on the next release, not on this render.
    latchedRef.current = activeNotes.size > 0;
    resetAuthority();
    resetSession();
  });

  // No touchscreen on the office screen, so "Play again" is a dead end there:
  // the board is finished and the only way out is the launcher combo. Any fresh
  // key restarts. The keys still down from the winning move do not count — the
  // player has to see who won first.
  useAnyKeyToContinue({ enabled: game.status.gameOver, activeNotes, onContinue: restart });

  const opponent = ladder?.current
    ?? { id: `checkers:level-${level}`, name: `Level ${level}`, art: null };
  const opponentName = opponent.name;
  archiveContextRef.current = {
    opponent: { id: opponent.id || `checkers:level-${level}`, name: opponentName, level },
    dialogue: dialogue.dialogueRef.current,
    prepareTerminal: () => {
      if (game.lastMove?.player === 1) {
        const key = `${gameSessionId}:${game.moves.length}`;
        if (terminalSpokenRef.current !== key) {
          terminalSpokenRef.current = key;
          const facts = checkersCommentary({ moves: game.moves }, { sessionId: gameSessionId, ply: game.moves.length, playerSide: 1 });
          if (facts) dialogue.showTerminalReaction({ reaction: { eventId: facts.eventId, quip: facts.fallback }, event: { gameId: 'checkers', sessionId: gameSessionId, ply: game.moves.length, opponentId: opponent.id } });
        }
      }
      return { dialogue: dialogue.dialogueRef.current };
    },
  };
  const status = game.status.gameOver
    ? game.status.draw ? 'Draw game' : game.status.winner === 1 ? 'You won the board!' : `${opponentName} wins`
    : thinking ? `${opponentName} is thinking…`
      : message ?? (selected !== null ? "Now play the destination's file and rank notes together." : "Play a movable red piece's file and rank notes together.");

  // The rail's own cards, from the SAME (possibly re-dealt) notes the addressing
  // effect above just used — the rim can never show a note that does not
  // actually work. Active highlighting follows whichever half of the pair is
  // currently held, same idea as chess's cursor: a lone file note lights its
  // file card, a lone rank note lights its rank card, and both light together in
  // the instant just before the square commits.
  const heldNotesList = useMemo(() => [...activeNotes.keys()], [activeNotes]);
  const fileAddresses = useMemo(() => fileRailAddresses(notes), [notes]);
  const rankAddresses = useMemo(() => rankRailAddresses(notes), [notes]);
  const activeFile = activeFileIndex(heldNotesList, notes);
  const activeRank = activeRankDisplayIndex(heldNotesList, notes);

  const red = game.board.filter((piece) => piece?.toLowerCase() === 'r').length;
  const blue = game.board.filter((piece) => piece?.toLowerCase() === 'b').length;

  return (
    <BoardGameFrame
      gameId="checkers"
      phase={game.status.gameOver ? 'result' : thinking ? 'paused' : 'playing'}
      className="piano-checkers"
      // Same scheme as chess (DEFAULT_STAFF_SCHEME, 47-72), so the same keyboard
      // window shows every note either game addresses with.
      instrument={{ activeNotes, startNote: 36, endNote: 84, showLabels: true, onNoteOn, onNoteOff }}
        layout={BOARD_LAYOUTS.SINGLE}
        /* Both rim rails live INSIDE the board's own grid rather than in the
           stage's `topRail` slot. The file rail has to sit over the files it
           names, and the stage centres its top-rail slot in a different box
           than it centres the board — so the two were arithmetically chased
           into alignment and still landed a full column apart. One grid, one
           set of columns, and a card cannot drift from its file. */
        primary={(
          <div className="checkers-stage">
            <AddressRail
              addresses={fileAddresses}
              orientation="horizontal"
              active={activeFile}
              className="checkers-stage__file-rail"
            />
            <AddressRail
              addresses={rankAddresses}
              orientation="vertical"
              active={activeRank}
              className="checkers-stage__rank-rail"
            />
            <CheckersBoard game={game} selected={game.forcedFrom ?? selected} hint={hint} />
          </div>
        )}
        leftRail={(
          <GameRail label="Opponent">
            <GameSlot>
              <OpponentPanel
                opponent={opponent}
                level={level}
                status={thinking ? 'Thinking…' : game.status.gameOver ? 'Game over' : 'Ready'}
                thinkMs={thinking ? thinkMs : null}
                speech={dialogue.speech}
                ladder={{ position: level, total: LADDER_LEVELS, wins: ladder?.wins ?? 0, needed: ladder?.wins_required ?? ladder?.needed ?? 3 }}
                onOpenRoster={() => setRosterOpen(true)}
              />
            </GameSlot>
            {/* A tally, so "am I ahead?" is answerable at a glance rather than by
                counting discs across the board. */}
            <GameSlot label={<><Icon name="game-checkers" /> Pieces</>}>
              <p className="checkers-tally">
                <span className="checkers-tally__side checkers-tally__side--player">
                  <span className="checkers-tally__count">{red}</span> You
                </span>
                <span className="checkers-tally__side checkers-tally__side--opponent">
                  <span className="checkers-tally__count">{blue}</span> {opponentName}
                </span>
              </p>
            </GameSlot>
          </GameRail>
        )}
        rightRail={{ render: ({ settingsTrigger }) => (
          <GameRail
            label="Controls"
            foot={settingsTrigger}
          >
            <GameSlot label={<><Icon name="shuffle" /> Board map</>}>
              <GameToggle
                label="Shuffle each game"
                checked={addressing.shuffle !== 'never'}
                onChange={(value) => updateConfig({
                  addressing: { shuffle: value ? 'each_game' : 'never' },
                })}
              />
              <DealNotice cadence={addressing.shuffle} dealKey={`${seed}-${moves.length}`} />
            </GameSlot>
            <GameSlot label={<><Icon name="hand-right" /> Hint</>} variant="plain">
              <div className="pg-rail-cue" aria-label="Play seven keys together for a hint">
                <strong>7 keys</strong><span>Best move</span>
              </div>
            </GameSlot>
          </GameRail>
        ) }}
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
      settings={{
        rail: 'right', open: settingsOpen,
        onOpen: () => setSettingsOpen((open) => !open),
        content: <GameSheet title="Settings" onClose={() => setSettingsOpen(false)}><AddressingSettings config={config} axisSize={AXIS} onChange={updateConfig} /></GameSheet>,
      }}
      opening={opening && !game.status.gameOver ? <BoardGameOpening opponent={opponent} turnLabel="Your move" /> : null}
      result={game.status.gameOver ? (
        <BoardGameResult
          result={result}
          opponent={opponent}
          level={level}
          speech={dialogue.speech}
          message={status}
          promoted={ladder?.promoted === true}
          metrics={[["Your pieces", red], [opponentName, blue]]}
          onPlayAgain={restart}
        />
      ) : null}
    >
      {rosterOpen && <OpponentRosterSheet roster={ladder?.opponents || CHECKERS_OPPONENTS} position={level} onClose={() => setRosterOpen(false)} />}
    </BoardGameFrame>
  );
}
