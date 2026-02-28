import { useEffect, useMemo, Suspense } from 'react';
import { configure as configureLogger } from '../../lib/logging/Logger.js';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { CurrentChordStaff } from './components/CurrentChordStaff';
import { useMidiSubscription } from './useMidiSubscription';
import { computeKeyboardRange } from './noteUtils.js';
import './PianoVisualizer.scss';
import { useGameActivation } from './useGameActivation.js';
import { getGameEntry } from './gameRegistry.js';
import { usePianoConfig } from './usePianoConfig.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { useSessionTracking } from './useSessionTracking.js';

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function PianoVisualizer({ onClose, onSessionEnd, initialGame = null }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const { gamesConfig } = usePianoConfig();

  const activation = useGameActivation(activeNotes, gamesConfig, initialGame);

  const activeGameEntry = activation.activeGameId ? getGameEntry(activation.activeGameId) : null;
  const isFullscreenGame = activeGameEntry?.layout === 'replace';

  const { inactivityState, countdownProgress } = useInactivityTimer(activeNotes, noteHistory, isFullscreenGame, onClose);
  const { sessionDuration } = useSessionTracking(noteHistory);

  // Configure root logger so child components using getLogger() directly
  // also get sessionLog: true (routes their events to the JSONL session file)
  useEffect(() => {
    configureLogger({ context: { app: 'piano', sessionLog: true } });
    return () => {
      configureLogger({ context: { sessionLog: false } });
    };
  }, []);

  const { startNote, endNote } = useMemo(
    () => computeKeyboardRange(null),
    []
  );

  useEffect(() => {
    if (sessionInfo?.event === 'session_end' && onSessionEnd) {
      const timer = setTimeout(() => { onSessionEnd(sessionInfo); }, 2000);
      return () => clearTimeout(timer);
    }
  }, [sessionInfo, onSessionEnd]);

  return (
    <div className={`piano-visualizer${isFullscreenGame ? ' tetris-mode' : ''}`}>
      <div className="piano-header">
        <div className="header-left">
          <div className="session-timer">
            <span className="timer-value">{formatDuration(sessionDuration)}</span>
            <span className="note-count">{noteHistory.length} notes</span>
          </div>
          {sustainPedal && <span className="pedal-indicator">Sustain</span>}
          {inactivityState === 'countdown' && (
            <div className="inactivity-timer">
              <div className="timer-bar" style={{ width: `${countdownProgress}%` }} />
            </div>
          )}
        </div>
        <div className="header-center">
          <CurrentChordStaff activeNotes={activeNotes} />
        </div>
      </div>

      <div className="waterfall-container">
        <NoteWaterfall
          noteHistory={noteHistory}
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
        />
      </div>

      <div className="keyboard-container">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={startNote}
          endNote={endNote}
          showLabels={true}
        />
      </div>

      {sessionInfo?.event === 'session_end' && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}

      {isFullscreenGame && activeGameEntry?.LazyComponent && (
        <div className="tetris-fullscreen">
          <Suspense fallback={null}>
            <activeGameEntry.LazyComponent
              activeNotes={activeNotes}
              noteHistory={noteHistory}
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
