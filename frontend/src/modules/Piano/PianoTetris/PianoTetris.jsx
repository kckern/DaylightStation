import { useMemo, useEffect } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { useTetrisGame } from './useTetrisGame.js';
import { TetrisBoard } from './components/TetrisBoard.jsx';
import { ActionStaff } from './components/ActionStaff.jsx';
import { TetrisOverlay } from './components/TetrisOverlay.jsx';
import { ACTIONS } from './useStaffMatching.js';
import './PianoTetris.scss';

/**
 * PianoTetris main layout — assembles 4 ActionStaffs flanking the TetrisBoard,
 * with PianoKeyboard at bottom and HUD at top.
 *
 * Layout:
 * +----------------------------------------------+
 * |  [Move Left]              [Move Right]       |
 * |  [staff]     +----------+ [staff]            |
 * |              |  TETRIS  |                    |
 * |  [Rot CCW]   |  BOARD   |  [Rot CW]         |
 * |  [staff]     +----------+  [staff]           |
 * +----------------------------------------------+
 * |           PIANO KEYBOARD                     |
 * +----------------------------------------------+
 *
 * @param {Object} props
 * @param {Map<number, {velocity: number, timestamp: number}>} props.activeNotes
 * @param {Object|null} props.tetrisConfig - from piano.yml { levels: [...], activation: {...} }
 * @param {function} props.onDeactivate - Called when game should exit
 */
export function PianoTetris({ activeNotes, tetrisConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-tetris-layout' }), []);

  const game = useTetrisGame(activeNotes, tetrisConfig);

  // Auto-start when component mounts and game is IDLE
  useEffect(() => {
    if (game.phase === 'IDLE') {
      logger.info('tetris.auto-start', {});
      game.startGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional mount-only

  // When game finishes (goes back to IDLE after GAME_OVER), deactivate
  const prevPhase = useMemo(() => ({ current: game.phase }), []);
  useEffect(() => {
    if (prevPhase.current !== 'IDLE' && game.phase === 'IDLE') {
      logger.info('tetris.auto-deactivate', {});
      if (onDeactivate) onDeactivate();
    }
    prevPhase.current = game.phase;
  }, [game.phase, onDeactivate, logger]);

  // Calculate keyboard range from current level's note_range with padding
  const levels = tetrisConfig?.levels ?? [];
  const currentLevelConfig = levels[game.level] ?? levels[0];
  const { startNote, endNote } = useMemo(() => {
    const noteRange = currentLevelConfig?.note_range ?? [60, 72];
    const rangeStart = noteRange[0];
    const rangeEnd = noteRange[1];
    const span = rangeEnd - rangeStart;
    const padding = Math.max(4, Math.round(span / 3));
    const minSpan = 24; // At least 2 octaves

    let displayStart = rangeStart - padding;
    let displayEnd = rangeEnd + padding;
    const displaySpan = displayEnd - displayStart;

    if (displaySpan < minSpan) {
      const extra = minSpan - displaySpan;
      displayStart -= Math.floor(extra / 2);
      displayEnd += Math.ceil(extra / 2);
    }

    return {
      startNote: Math.max(21, displayStart),
      endNote: Math.min(108, displayEnd),
    };
  }, [currentLevelConfig]);

  // Build keyboardTargets set from all pitches across all 4 staves
  const keyboardTargets = useMemo(() => {
    if (!game.targets) return null;
    const pitches = new Set();
    for (const action of ACTIONS) {
      const actionPitches = game.targets[action];
      if (actionPitches) {
        for (const p of actionPitches) pitches.add(p);
      }
    }
    return pitches.size > 0 ? pitches : null;
  }, [game.targets]);

  return (
    <div className="piano-tetris">
      {/* HUD bar */}
      <div className="piano-tetris__hud">
        <div className="piano-tetris__hud-left">
          <span className="piano-tetris__score">{game.score.toLocaleString()}</span>
          <span className="piano-tetris__score-label">SCORE</span>
        </div>
        <div className="piano-tetris__hud-center">
          <span className="piano-tetris__level">LVL {game.level}</span>
        </div>
        <div className="piano-tetris__hud-right">
          <span className="piano-tetris__lines">{game.linesCleared}</span>
          <span className="piano-tetris__lines-label">LINES</span>
        </div>
      </div>

      {/* Play area */}
      <div className="piano-tetris__play-area">
        {/* Left staves */}
        <div className="piano-tetris__staves-left">
          <ActionStaff
            action="moveLeft"
            targetPitches={game.targets?.moveLeft ?? []}
            matched={game.matchedActions?.has('moveLeft') ?? false}
            fired={false}
          />
          <ActionStaff
            action="rotateCCW"
            targetPitches={game.targets?.rotateCCW ?? []}
            matched={game.matchedActions?.has('rotateCCW') ?? false}
            fired={false}
          />
        </div>

        {/* Center board */}
        <div className="piano-tetris__board-area">
          <TetrisBoard
            board={game.board}
            currentPiece={game.currentPiece}
            ghostPiece={game.ghostPiece}
            nextPiece={game.nextPiece}
          />
        </div>

        {/* Right staves */}
        <div className="piano-tetris__staves-right">
          <ActionStaff
            action="moveRight"
            targetPitches={game.targets?.moveRight ?? []}
            matched={game.matchedActions?.has('moveRight') ?? false}
            fired={false}
          />
          <ActionStaff
            action="rotateCW"
            targetPitches={game.targets?.rotateCW ?? []}
            matched={game.matchedActions?.has('rotateCW') ?? false}
            fired={false}
          />
        </div>
      </div>

      {/* Piano keyboard */}
      <div className="piano-tetris__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={keyboardTargets}
        />
      </div>

      {/* Overlay (countdown, game over) */}
      <TetrisOverlay
        phase={game.phase}
        countdown={game.countdown}
        score={game.score}
        linesCleared={game.linesCleared}
        level={game.level}
      />
    </div>
  );
}

export default PianoTetris;
