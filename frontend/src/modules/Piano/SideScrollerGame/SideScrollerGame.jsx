import { useMemo, useEffect } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { PianoKeyboard } from '../components/PianoKeyboard';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useSideScrollerGame } from './useSideScrollerGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { RunnerCanvas } from './components/RunnerCanvas.jsx';
import { SideScrollerOverlay } from './components/SideScrollerOverlay.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
import './SideScrollerGame.scss';

export function SideScrollerGame({ activeNotes, gameConfig, onDeactivate }) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller-game' }), []);

  const game = useSideScrollerGame(activeNotes, gameConfig);
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'side-scroller');

  // Keyboard range from current level
  const levels = gameConfig?.levels ?? [];
  const currentLevelConfig = levels[game.level] ?? levels[0];
  const { startNote, endNote } = useMemo(() => {
    const noteRange = currentLevelConfig?.note_range ?? [60, 72];
    return computeKeyboardRange(noteRange);
  }, [currentLevelConfig]);

  // Keyboard target highlights from jump/duck pitches
  const keyboardTargets = useMemo(() => {
    if (!game.targets) return null;
    const pitches = new Set();
    for (const action of ['jump', 'duck']) {
      const actionPitches = game.targets[action];
      if (actionPitches) {
        for (const p of actionPitches) pitches.add(p);
      }
    }
    return pitches.size > 0 ? pitches : null;
  }, [game.targets]);

  // Invincibility check (for flashing)
  const invincible = game.world.invincibleUntil > performance.now();

  // Expose game state for testing
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    window.__SIDE_SCROLLER_DEBUG__ = {
      phase: game.phase,
      world: game.world,
      level: game.level,
      targets: game.targets,
      score: game.score,
      health: game.health,
    };
    return () => { delete window.__SIDE_SCROLLER_DEBUG__; };
  });

  return (
    <div className="side-scroller">
      {/* Play area */}
      <div className="side-scroller__play-area">
        {/* Health bar — far left */}
        {game.phase === 'PLAYING' && (
          <div className="side-scroller__life-meter" aria-hidden="true">
            <div className="side-scroller__life-frame">
              {Array.from({ length: game.totalHealth }, (_, i) => (
                <div key={i} className={[
                  'side-scroller__life-notch',
                  i < Math.ceil(game.health) && 'side-scroller__life-notch--active',
                  i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 && 'side-scroller__life-notch--danger',
                ].filter(Boolean).join(' ')} />
              ))}
            </div>
          </div>
        )}

        {/* Game canvas — fills left */}
        <div className="side-scroller__canvas">
          <RunnerCanvas world={game.world} scrollSpeed={currentLevelConfig?.scroll_speed ?? 3} invincible={invincible} />

          {/* Score overlay */}
          {game.phase === 'PLAYING' && (
            <div className="side-scroller__hud">
              <div className="side-scroller__score">
                <span className="side-scroller__score-value">{game.score}</span>
                <span className="side-scroller__score-label">SCORE</span>
              </div>
              <div className="side-scroller__level-badge">
                {game.levelName}
              </div>
            </div>
          )}
        </div>

        {/* Action staves — stacked right */}
        <div className="side-scroller__staves-right">
          <ActionStaff
            action="jump"
            targetPitches={game.targets?.jump ?? []}
            matched={game.matchedActions?.has('jump') ?? false}
            activeNotes={activeNotes}
          />
          <ActionStaff
            action="duck"
            targetPitches={game.targets?.duck ?? []}
            matched={game.matchedActions?.has('duck') ?? false}
            activeNotes={activeNotes}
          />
        </div>
      </div>

      {/* Piano keyboard */}
      <div className="side-scroller__keyboard">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={keyboardTargets}
        />
      </div>

      {/* Overlay */}
      <SideScrollerOverlay
        phase={game.phase}
        countdown={game.countdown}
        score={game.score}
        level={game.level}
        levelName={game.levelName}
      />
    </div>
  );
}

export default SideScrollerGame;
