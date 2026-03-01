import { useState, useEffect, useMemo } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { NoteWaterfall } from '../components/NoteWaterfall';
import { useSpaceInvadersGame } from './useSpaceInvadersGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { SpaceInvadersOverlay } from './components/SpaceInvadersOverlay.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
import './SpaceInvadersGame.scss';

/**
 * Self-contained Space Invaders game component.
 * Follows the same pattern as PianoTetris — receives activeNotes/noteHistory/gameConfig/onDeactivate,
 * manages its own game state, renders its own UI.
 *
 * @param {Object} props
 * @param {Map} props.activeNotes - live MIDI note state
 * @param {Array} props.noteHistory - MIDI note history
 * @param {Object} props.gameConfig - games['space-invaders'] from piano.yml
 * @param {function} props.onDeactivate - called to exit the game
 */
export function SpaceInvadersGame({ activeNotes, noteHistory, gameConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'space-invaders-game' }), []);
  const game = useSpaceInvadersGame(activeNotes, noteHistory, gameConfig);
  useAutoGameLifecycle(game.gameState, game.startGame, onDeactivate, logger, 'space-invaders');

  const [screenFlash, setScreenFlash] = useState(false);

  // Keyboard range from current level
  const gameRange = game.currentLevel?.range;
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(gameRange || null),
    [gameRange]
  );

  // Target notes for keyboard highlighting
  const targetNotes = useMemo(() => {
    const pitches = new Set();
    for (const fn of game.fallingNotes) {
      if (fn.state === 'falling') {
        for (const p of fn.pitches) pitches.add(p);
      }
    }
    return pitches.size > 0 ? pitches : null;
  }, [game.fallingNotes]);

  // Performance diagnostics during gameplay
  useEffect(() => {
    if (game.gameState === 'PLAYING') {
      getLogger().startDiagnostics({ intervalMs: 5000 });
      return () => getLogger().stopDiagnostics();
    }
  }, [game.gameState]);

  // Screen flash on wrong press
  useEffect(() => {
    if (game.wrongNotes.size > 0) {
      setScreenFlash(true);
      const timer = setTimeout(() => setScreenFlash(false), 200);
      return () => clearTimeout(timer);
    }
    setScreenFlash(false);
  }, [game.wrongNotes]);

  return (
    <div className="space-invaders-game">
      {/* Game header with score, level, misses */}
      <div className="space-invaders-game__header">
        <div className="space-invaders-game__header-left">
          <div className="space-invaders-game__score">
            <span className="space-invaders-game__score-value">{game.score.points}</span>
            {game.score.combo > 1 && (
              <span className="space-invaders-game__combo-badge">x{game.score.combo}</span>
            )}
          </div>
        </div>
        <div className="space-invaders-game__header-center">
          {game.currentLevel && (
            <div className="space-invaders-game__level-info">
              <span className="space-invaders-game__level-name">{game.currentLevel.name}</span>
              {game.levelProgress && (
                <div className="space-invaders-game__progress-bar">
                  <div className="space-invaders-game__progress-fill"
                    style={{ width: `${Math.min(100, (game.levelProgress.pointsEarned / game.levelProgress.pointsNeeded) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="space-invaders-game__header-right">
          {game.levelProgress && (
            <div className="space-invaders-game__miss-counter">
              <span className="space-invaders-game__miss-count">{game.levelProgress.missesUsed}</span>
              <span className="space-invaders-game__miss-sep">/</span>
              <span className="space-invaders-game__miss-max">{game.levelProgress.missesAllowed}</span>
              <span className="space-invaders-game__miss-label">misses</span>
            </div>
          )}
        </div>
      </div>

      {/* Waterfall with falling notes */}
      <div className="space-invaders-game__waterfall">
        <NoteWaterfall noteHistory={noteHistory} activeNotes={activeNotes}
          startNote={startNote} endNote={endNote}
          gameMode={game}
        />
        {game.gameState === 'PLAYING' && (
          <div className="space-invaders-game__life-meter" aria-hidden="true">
            <div className="space-invaders-game__life-frame">
              {Array.from({ length: game.totalHealth }, (_, i) => (
                <div key={i} className={`space-invaders-game__life-notch${i < Math.ceil(game.health) ? ' space-invaders-game__life-notch--active' : ''}${
                  i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 ? ' space-invaders-game__life-notch--danger' : ''
                }`} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Piano keyboard */}
      <div className="space-invaders-game__keyboard">
        <PianoKeyboard activeNotes={activeNotes} startNote={startNote} endNote={endNote}
          showLabels={true} targetNotes={targetNotes} wrongNotes={game.wrongNotes}
          destroyedKeys={game.destroyedKeys}
        />
      </div>

      {/* Overlay (countdown/banners/victory) */}
      <SpaceInvadersOverlay gameState={game.gameState} countdown={game.countdown}
        score={game.score} currentLevel={game.currentLevel} levelProgress={game.levelProgress}
      />

      {/* Wrong-press screen flash */}
      {screenFlash && <div className="space-invaders-game__wrong-flash" />}
    </div>
  );
}

export default SpaceInvadersGame;
