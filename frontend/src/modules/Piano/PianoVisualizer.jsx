import { useState, useEffect, useRef } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { CurrentChordStaff } from './components/CurrentChordStaff';
import { useMidiSubscription } from './useMidiSubscription';
import { DaylightAPI } from '../../lib/api.mjs';
import './PianoVisualizer.scss';

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
export function PianoVisualizer({ onClose, onSessionEnd }) {
  const { activeNotes, sustainPedal, sessionInfo, noteHistory } = useMidiSubscription();
  const [inactivityState, setInactivityState] = useState('active'); // 'active' | 'grace' | 'countdown'
  const [countdownProgress, setCountdownProgress] = useState(100);
  const [sessionDuration, setSessionDuration] = useState(0);
  const lastNoteOffRef = useRef(null); // Track when the last note was released
  const sessionStartRef = useRef(null);
  const timerRef = useRef(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const pianoConfigRef = useRef(null); // Cache piano config for cleanup

  // On mount: Load piano config and run HA script if configured
  useEffect(() => {
    const initPiano = async () => {
      try {
        // Load device config to get module hooks
        const devicesConfig = await DaylightAPI('api/v1/device/config');
        const pianoConfig = devicesConfig?.devices?.['office-tv']?.modules?.['piano-visualizer'] ?? {};
        pianoConfigRef.current = pianoConfig;

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
  }, [onClose, activeNotes.size]);

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
      </div>

      <div className="waterfall-container">
        <NoteWaterfall noteHistory={noteHistory} activeNotes={activeNotes} />
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
