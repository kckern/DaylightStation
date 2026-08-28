import { useMemo, useEffect } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import PianoGameHost from '../game-platform/host/PianoGameHost.jsx';
import { ActionStaff } from '../components/ActionStaff.jsx';
import { useSideScrollerGame } from './useSideScrollerGame.js';
import { useAutoGameLifecycle } from '../useAutoGameLifecycle.js';
import { RunnerCanvas } from './components/RunnerCanvas.jsx';
import { SideScrollerOverlay } from './components/SideScrollerOverlay.jsx';
import { computeKeyboardRange } from '../noteUtils.js';
import { PLAYER_X } from './sideScrollerEngine.js';
import { useAnyKeyToContinue } from '../game-platform/input/useAnyKeyToContinue.js';
import { useMatchRematch } from '../game-platform/host/useMatchRematch.js';
import { usePianoRunSession } from '../game-platform/runtime/usePianoRunSession.js';
import './SideScrollerGame.scss';

export function SideScrollerGame({ activeNotes, gameConfig, onDeactivate, onNoteOn, onNoteOff }) {
  const logger = useMemo(() => getChildLogger({ component: 'side-scroller-game' }), []);

  const game = useSideScrollerGame(activeNotes, gameConfig);
  usePianoRunSession({
    gameId: 'side-scroller', phase: game.phase, initialPhase: 'IDLE', score: game.score,
    metrics: { level: game.level, health: game.health, distance: game.distance },
    activePhases: ['IDLE', 'STARTING', 'PLAYING'], terminalPhases: ['GAME_OVER'], logger,
  });
  useAutoGameLifecycle(game.phase, game.startGame, onDeactivate, logger, 'side-scroller');
  // A replay is a match boundary, so it goes through the host (D12) — this is
  // the ONLY path back into a new run, and a gate that stood at entry but not
  // here would be paid once and replayed past forever. `useAutoGameLifecycle`
  // above keeps the raw `startGame`: that is the FIRST run after entering,
  // which the gate has already been paid for.
  const playAgain = useMatchRematch(game.startGame);
  useAnyKeyToContinue({ enabled: game.phase === 'GAME_OVER', activeNotes, onContinue: playAgain });

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

  // Staff opacity hints — early levels (single complexity) highlight the relevant staff
  const isSingleComplexity = (currentLevelConfig?.complexity ?? 'single') === 'single';
  const jumpStaffOpacity = isSingleComplexity && game.nextObstacleType === 'high' ? 0.4 : 1;
  const duckStaffOpacity = isSingleComplexity && game.nextObstacleType === 'low' ? 0.4 : 1;

  // Expose game state for testing
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;
    window.__SIDE_SCROLLER_DEBUG__ = {
      phase: game.phase,
      world: game.world,
      level: game.level,
      targets: game.targets,
      score: Math.floor(game.score),
      health: game.health,
      matchedActions: game.matchedActions ? [...game.matchedActions] : [],
      activeNotesCount: activeNotes?.size ?? 0,
      activeNotesList: activeNotes ? [...activeNotes.keys()] : [],
    };
    return () => { delete window.__SIDE_SCROLLER_DEBUG__; };
  }, [game.phase, game.world, game.level, game.targets, game.score, game.health, game.matchedActions, activeNotes]);

  // Performance diagnostics during gameplay: temporarily raise the always-on
  // app-wide cadence (60s, started by PianoShell) to 5s, and hand it back on
  // exit rather than stopping it (startDiagnostics re-arms in place).
  useEffect(() => {
    if (game.phase === 'PLAYING') {
      getLogger().startDiagnostics({ intervalMs: 5000 });
      return () => getLogger().startDiagnostics({ intervalMs: 60000 });
    }
  }, [game.phase]);

  return (
    <PianoGameHost
      gameId="side-scroller"
      phase={game.phase}
      phaseMapping={{ GAME_OVER: 'result', COMPLETE: 'result' }}
      className="side-scroller"
      instrumentClassName="side-scroller__keyboard"
      instrument={{ activeNotes, startNote, endNote, showLabels: true, targetNotes: keyboardTargets, onNoteOn, onNoteOff }}
      overlay={<SideScrollerOverlay phase={game.phase} countdown={game.countdown} score={game.score} level={game.level + 1} levelName={game.levelName} />}
    >
      {/* Play area */}
      <div className="side-scroller__play-area">
        {/* Health bar — far left */}
        {game.phase === 'PLAYING' && (
          <div
            className="side-scroller__life-meter"
            role="meter"
            aria-label="Health"
            aria-valuemin="0"
            aria-valuemax={game.totalHealth}
            aria-valuenow={Math.max(0, Math.ceil(game.health))}
          >
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

        {/* Game canvas — full width */}
        <div className="side-scroller__canvas">
          <RunnerCanvas world={game.world} invincible={invincible} phase={game.phase} theme={game.theme} />

          {/* Jump staff — 45° up-right from player */}
          <div className="side-scroller__staff-above" style={{ left: `${(PLAYER_X + 0.12) * 100}%`, opacity: jumpStaffOpacity }}>
            <ActionStaff
              action="jump"
              targetPitches={game.targets?.jump ?? []}
              matched={game.matchedActions?.has('jump') ?? false}
              activeNotes={activeNotes}
            />
          </div>

          {/* Duck staff — 45° down-right from player */}
          <div className="side-scroller__staff-below" style={{ left: `${(PLAYER_X + 0.12) * 100}%`, opacity: duckStaffOpacity }}>
            <ActionStaff
              action="duck"
              targetPitches={game.targets?.duck ?? []}
              matched={game.matchedActions?.has('duck') ?? false}
              activeNotes={activeNotes}
            />
          </div>

          {/* Score overlay */}
          {game.phase === 'PLAYING' && (
            <div className="side-scroller__hud">
              <div className="side-scroller__score">
                <span className="side-scroller__score-value">{Math.floor(game.score)}</span>
                <span className="side-scroller__score-label">SCORE</span>
              </div>
              <div className="side-scroller__level-badge">
                {game.levelName}
              </div>
            </div>
          )}
        </div>
      </div>

    </PianoGameHost>
  );
}

export default SideScrollerGame;
