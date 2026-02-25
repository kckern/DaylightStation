import { useState, useEffect, useMemo, Suspense } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { CurrentChordStaff } from './components/CurrentChordStaff';
import { useMidiSubscription } from './useMidiSubscription';
import { computeKeyboardRange } from './noteUtils.js';
import './PianoVisualizer.scss';
import { useRhythmGame } from './useRhythmGame.js';
import { useGameActivation } from './useGameActivation.js';
import { RhythmOverlay } from './components/RhythmOverlay';
import { getGameEntry } from './gameRegistry.js';
import { usePianoConfig } from './usePianoConfig.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { useSessionTracking } from './useSessionTracking.js';


// Format duration as mm:ss
const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Full-screen piano visualizer that shows real-time MIDI input
 *
 * @param {Object} props
 * @param {function} props.onClose - Called when visualizer should close
 * @param {function} props.onSessionEnd - Called when a piano session ends
 */
export function PianoVisualizer({ onClose, onSessionEnd, initialGame = null }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const { gamesConfig } = usePianoConfig();

  const activation = useGameActivation(activeNotes, gamesConfig, initialGame);
  const rhythmConfig = activation.activeGameId === 'rhythm' ? gamesConfig?.rhythm : null;
  const game = useRhythmGame(activeNotes, noteHistory, rhythmConfig);

  // Auto-start rhythm game when activated
  useEffect(() => {
    if (activation.activeGameId === 'rhythm' && game.gameState === 'IDLE' && rhythmConfig) {
      game.startGame();
    }
  }, [activation.activeGameId, rhythmConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const [screenFlash, setScreenFlash] = useState(false);

  // Determine active game type
  const activeGameEntry = activation.activeGameId ? getGameEntry(activation.activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';
  const isAnyGame = game.isGameMode || isFullscreenGame;

  const { inactivityState, countdownProgress } = useInactivityTimer(activeNotes, noteHistory, isAnyGame, onClose);
  const { sessionDuration } = useSessionTracking(noteHistory);

  // Dynamic range for game mode — expand to at least 2 octaves, center with 1/3 octave padding
  const gameRange = game.isGameMode && game.currentLevel?.range;
  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(gameRange || null),
    [gameRange]
  );

  // Target notes for keyboard highlighting (pitches currently falling)
  const targetNotes = useMemo(() => {
    if (!game.isGameMode) return null;
    const pitches = new Set();
    for (const fn of game.fallingNotes) {
      if (fn.state === 'falling') {
        for (const p of fn.pitches) pitches.add(p);
      }
    }
    return pitches;
  }, [game.isGameMode, game.fallingNotes]);

  const keyboardHeight = game.isGameMode ? '40%' : '25%';

  // Full-screen red flash on wrong press (200ms) — always reset timer on new wrong press
  useEffect(() => {
    if (game.wrongNotes.size > 0) {
      setScreenFlash(true);
      const timer = setTimeout(() => setScreenFlash(false), 200);
      return () => clearTimeout(timer);
    }
    setScreenFlash(false);
  }, [game.wrongNotes]);

  // Handle session end
  useEffect(() => {
    if (sessionInfo?.event === 'session_end' && onSessionEnd) {
      // Delay slightly so user sees the final state
      const timer = setTimeout(() => {
        onSessionEnd(sessionInfo);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [sessionInfo, onSessionEnd]);

  return (
    <div className={`piano-visualizer${game.isGameMode ? ' game-mode' : ''}${isFullscreenGame ? ' tetris-mode' : ''}`}>
      <div className="piano-header">
        {game.isGameMode ? (
          <>
            <div className="header-left">
              <div className="game-score">
                <span className="score-value">{game.score.points}</span>
                {game.score.combo > 1 && (
                  <span className="combo-badge">x{game.score.combo}</span>
                )}
              </div>
            </div>
            <div className="header-center">
              {game.currentLevel && (
                <div className="level-info">
                  <span className="level-name">{game.currentLevel.name}</span>
                  {game.levelProgress && (
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.min(100, (game.levelProgress.pointsEarned / game.levelProgress.pointsNeeded) * 100)}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="header-right">
              {game.levelProgress && (
                <div className="miss-counter">
                  <span className="miss-count">{game.levelProgress.missesUsed}</span>
                  <span className="miss-separator">/</span>
                  <span className="miss-max">{game.levelProgress.missesAllowed}</span>
                  <span className="miss-label">misses</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="header-left">
              <div className="session-timer">
                <span className="timer-value">{formatDuration(sessionDuration)}</span>
                <span className="note-count">{noteHistory.length} notes</span>
              </div>
              {sustainPedal && <span className="pedal-indicator">Sustain</span>}
              {inactivityState === 'countdown' && (
                <div className="inactivity-timer">
                  <div
                    className="timer-bar"
                    style={{ width: `${countdownProgress}%` }}
                  />
                </div>
              )}
            </div>
            <div className="header-center">
              <CurrentChordStaff activeNotes={activeNotes} />
            </div>
          </>
        )}
      </div>

      <div className="waterfall-container">
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          gameMode={game.isGameMode ? game : null}
          wrongColumns={game.isGameMode ? game.wrongNotes : null}
        />

        {game.isGameMode && game.gameState === 'PLAYING' && (
          <div className="life-meter" aria-hidden="true">
            <div className="life-meter__frame">
              {Array.from({ length: game.totalHealth }, (_, i) => (
                <div
                  key={i}
                  className={`life-meter__notch${i < Math.ceil(game.health) ? ' life-meter__notch--active' : ''}${
                    i < Math.ceil(game.health) && game.health <= game.totalHealth * 0.25 ? ' life-meter__notch--danger' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="keyboard-container" style={{ height: keyboardHeight }}>
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
          targetNotes={targetNotes}
          wrongNotes={game.wrongNotes}
        />
      </div>

      {game.isGameMode && (
        <RhythmOverlay
          gameState={game.gameState}
          countdown={game.countdown}
          score={game.score}
          currentLevel={game.currentLevel}
          levelProgress={game.levelProgress}
        />
      )}

      {sessionInfo?.event === 'session_end' && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}

      {screenFlash && <div className="wrong-flash" />}

      {isFullscreenGame && activeGameEntry?.LazyComponent && (
        <div className="tetris-fullscreen">
          <Suspense fallback={null}>
            <activeGameEntry.LazyComponent
              activeNotes={activeNotes}
              gameConfig={gamesConfig?.[activation.activeGameId]}
              onDeactivate={activation.deactivate}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
