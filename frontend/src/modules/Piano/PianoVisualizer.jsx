import { useState, useEffect, useRef } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { useMidiSubscription } from './useMidiSubscription';
import './PianoVisualizer.scss';

const GRACE_PERIOD_MS = 10000; // 10 seconds before countdown starts
const COUNTDOWN_MS = 30000;   // 30 seconds countdown

/**
 * Full-screen piano visualizer that shows real-time MIDI input
 *
 * @param {Object} props
 * @param {function} props.onClose - Called when visualizer should close
 * @param {function} props.onSessionEnd - Called when a piano session ends
 */
export function PianoVisualizer({ onClose, onSessionEnd }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const [inactivityState, setInactivityState] = useState('active'); // 'active' | 'grace' | 'countdown'
  const [countdownProgress, setCountdownProgress] = useState(100);
  const lastActivityRef = useRef(Date.now());
  const timerRef = useRef(null);

  // Reset activity timer when notes are played
  useEffect(() => {
    if (activeNotes.size > 0) {
      lastActivityRef.current = Date.now();
      setInactivityState('active');
      setCountdownProgress(100);
    }
  }, [activeNotes]);

  // Inactivity detection
  useEffect(() => {
    const checkInactivity = () => {
      const elapsed = Date.now() - lastActivityRef.current;

      if (elapsed < GRACE_PERIOD_MS) {
        setInactivityState('active');
        setCountdownProgress(100);
      } else if (elapsed < GRACE_PERIOD_MS + COUNTDOWN_MS) {
        setInactivityState('countdown');
        const countdownElapsed = elapsed - GRACE_PERIOD_MS;
        const progress = 100 - (countdownElapsed / COUNTDOWN_MS) * 100;
        setCountdownProgress(Math.max(0, progress));
      } else {
        // Time's up - close the visualizer
        if (onClose) onClose();
      }
    };

    timerRef.current = setInterval(checkInactivity, 100);
    return () => clearInterval(timerRef.current);
  }, [onClose]);

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
    <div className="piano-visualizer">
      <div className="piano-header">
        <div className="session-info">
          {sessionInfo?.device && (
            <span className="device-name">{sessionInfo.device}</span>
          )}
        </div>
        <div className="status-indicators">
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
      </div>

      <div className="waterfall-container">
        <NoteWaterfall noteHistory={noteHistory} />
      </div>

      <div className="keyboard-container">
        <PianoKeyboard
          activeNotes={activeNotes}
          startNote={21}
          endNote={108}
          showLabels={true}
        />
      </div>

      {sessionInfo?.event === 'session_end' && (
        <div className="session-summary">
          <p>Session Complete</p>
          <p>{sessionInfo.noteCount} notes in {Math.round(sessionInfo.duration)}s</p>
        </div>
      )}
    </div>
  );
}

export default PianoVisualizer;
