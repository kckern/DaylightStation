import { useState, useEffect, useRef, useMemo } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { CurrentChordStaff } from './components/CurrentChordStaff';
import { useMidiSubscription } from './useMidiSubscription';
import { DaylightAPI } from '../../lib/api.mjs';
import { isWhiteKey } from './noteUtils.js';
import './PianoVisualizer.scss';
import { useGameMode } from './useGameMode.js';
import { useGameActivation } from './useGameActivation.js';
import { TOTAL_HEALTH } from './gameEngine.js';
import { GameOverlay } from './components/GameOverlay';
import { PianoTetris } from './PianoTetris/PianoTetris.jsx';
import { PianoFlashcards } from './PianoFlashcards/PianoFlashcards.jsx';
import { getGameEntry } from './gameRegistry.js';

const GRACE_PERIOD_MS = 10000; // 10 seconds before countdown starts
const COUNTDOWN_MS = 30000;   // 30 seconds countdown
const PLACEHOLDER_DELAY_MS = 2000; // 2 seconds before showing "Play something..."


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
  const [inactivityState, setInactivityState] = useState('active'); // 'active' | 'grace' | 'countdown'
  const [countdownProgress, setCountdownProgress] = useState(100);
  const [sessionDuration, setSessionDuration] = useState(0);
  const lastNoteOffRef = useRef(null); // Track when the last note was released
  const sessionStartRef = useRef(null);
  const timerRef = useRef(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [gameConfig, setGameConfig] = useState(null);
  const [gamesConfig, setGamesConfig] = useState(null);
  const pianoConfigRef = useRef(null); // Cache piano config for cleanup

  const game = useGameMode(activeNotes, noteHistory, gameConfig);
  const activation = useGameActivation(activeNotes, gamesConfig, initialGame);
  const [screenFlash, setScreenFlash] = useState(false);

  // Determine active game type
  const activeGameEntry = activation.activeGameId ? getGameEntry(activation.activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';
  const isAnyGame = game.isGameMode || isFullscreenGame;

  // Dynamic range for game mode — expand to at least 2 octaves, center with 1/3 octave padding
  const gameRange = game.isGameMode && game.currentLevel?.range;
  const { startNote, endNote } = useMemo(() => {
    if (!gameRange) return { startNote: 21, endNote: 108 };

    const gameStart = gameRange[0];
    const gameEnd = gameRange[1];
    const gameSpan = gameEnd - gameStart;
    const padding = Math.round(gameSpan / 3); // 1/3 octave padding each side
    const minSpan = 24; // Minimum 2 octaves

    let displayStart = gameStart - padding;
    let displayEnd = gameEnd + padding;
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
  }, [gameRange]);

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

  // On mount: Load piano config and run HA script if configured
  useEffect(() => {
    const initPiano = async () => {
      try {
        // Load device config to get module hooks
        const devicesConfig = await DaylightAPI('api/v1/device/config');
        const pianoConfig = devicesConfig?.devices?.['office-tv']?.modules?.['piano-visualizer'] ?? {};
        pianoConfigRef.current = pianoConfig;

        // Load game config from piano app config
        try {
          const pianoAppConfig = await DaylightAPI('api/v1/admin/apps/piano/config');
          const gc = pianoAppConfig?.parsed?.game ?? null;
          setGameConfig(gc);
          const gamesC = pianoAppConfig?.parsed?.games ?? null;
          setGamesConfig(gamesC);
        } catch (err) {
          // Game mode unavailable — that's fine
        }

        // Run on_open HA script if configured
        if (pianoConfig?.on_open) {
          DaylightAPI(`/api/v1/home/ha/script/${pianoConfig.on_open}`, {}, 'POST')
            .then(() => console.debug('[Piano] HA on_open script executed'))
            .catch(err => console.warn('[Piano] HA on_open script failed:', err.message));
        }
      } catch (err) {
        console.warn('[Piano] Config load failed — HDMI auto-switch disabled:', err.message);
      }
    };
    initPiano();

    // Cleanup: Run on_close HA script if configured
    return () => {
      const config = pianoConfigRef.current;
      if (config?.on_close) {
        DaylightAPI(`/api/v1/home/ha/script/${config.on_close}`, {}, 'POST')
          .catch(err => console.warn('[Piano] HA on_close script failed:', err.message));
      }
    };
  }, []);

  // Track when all notes are released (for inactivity timer)
  useEffect(() => {
    if (activeNotes.size === 0 && noteHistory.length > 0) {
      // All notes released - start inactivity timer from now
      lastNoteOffRef.current = Date.now();
    } else if (activeNotes.size > 0) {
      // Notes are being played - reset the timer reference
      lastNoteOffRef.current = null;
      setInactivityState('active');
      setCountdownProgress(100);
    }
  }, [activeNotes.size, noteHistory.length]);

  // Track session start and update duration
  useEffect(() => {
    if (noteHistory.length > 0 && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
    }
  }, [noteHistory.length]);

  // Update session duration every second
  useEffect(() => {
    const durationTimer = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionDuration((Date.now() - sessionStartRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(durationTimer);
  }, []);

  // Inactivity detection - only starts after last note is released
  useEffect(() => {
    const checkInactivity = () => {
      // Don't auto-close during any game mode
      if (isAnyGame) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }

      // If notes are currently being played, stay active
      if (activeNotes.size > 0) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }

      // If no notes have been released yet, stay active
      if (!lastNoteOffRef.current) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }

      const elapsed = Date.now() - lastNoteOffRef.current;

      if (elapsed < GRACE_PERIOD_MS) {
        setInactivityState('active');
        setCountdownProgress(100);
      } else if (elapsed < GRACE_PERIOD_MS + COUNTDOWN_MS) {
        setInactivityState('countdown');
        const countdownElapsed = elapsed - GRACE_PERIOD_MS;
        const progress = 100 - (countdownElapsed / COUNTDOWN_MS) * 100;
        setCountdownProgress(Math.max(0, progress));
      } else {
        // Time's up - close the visualizer only when countdown reaches zero
        if (onClose) onClose();
      }
    };

    timerRef.current = setInterval(checkInactivity, 100);
    return () => clearInterval(timerRef.current);
  }, [onClose, activeNotes.size, isAnyGame]);

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
              {Array.from({ length: TOTAL_HEALTH }, (_, i) => (
                <div
                  key={i}
                  className={`life-meter__notch${i < Math.ceil(game.health) ? ' life-meter__notch--active' : ''}${
                    i < Math.ceil(game.health) && game.health <= TOTAL_HEALTH * 0.25 ? ' life-meter__notch--danger' : ''
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
        <GameOverlay
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

      {isFullscreenGame && (
        <div className="tetris-fullscreen">
          {activation.activeGameId === 'tetris' && (
            <PianoTetris
              activeNotes={activeNotes}
              tetrisConfig={gamesConfig?.tetris}
              onDeactivate={activation.deactivate}
            />
          )}
          {activation.activeGameId === 'flashcards' && (
            <PianoFlashcards
              activeNotes={activeNotes}
              flashcardsConfig={gamesConfig?.flashcards}
              onDeactivate={activation.deactivate}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
