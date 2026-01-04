import { useState, useEffect, useRef, useMemo } from 'react';
import { PianoKeyboard } from './components/PianoKeyboard';
import { NoteWaterfall } from './components/NoteWaterfall';
import { useMidiSubscription } from './useMidiSubscription';
import './PianoVisualizer.scss';

const GRACE_PERIOD_MS = 10000; // 10 seconds before countdown starts
const COUNTDOWN_MS = 30000;   // 30 seconds countdown

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiNoteToName = (note) => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;

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
  const lastActivityRef = useRef(Date.now());
  const sessionStartRef = useRef(null);
  const timerRef = useRef(null);

  // Get current notes display string
  const currentNotesDisplay = useMemo(() => {
    if (activeNotes.size === 0) return '';
    const notes = Array.from(activeNotes.keys())
      .sort((a, b) => a - b)
      .map(midiNoteToName);
    return notes.join(' ');
  }, [activeNotes]);

  // Reset activity timer when any note event occurs
  useEffect(() => {
    if (noteHistory.length > 0) {
      lastActivityRef.current = Date.now();
      setInactivityState('active');
      setCountdownProgress(100);
    }
  }, [noteHistory.length]);

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
        <div className="header-left">
          <h1 className="title">Piano</h1>
          <div className="session-timer">
            <span className="timer-value">{formatDuration(sessionDuration)}</span>
            <span className="note-count">{noteHistory.length} notes</span>
          </div>
        </div>

        <div className="header-center">
          <div className="current-notes">
            {currentNotesDisplay || <span className="placeholder">Play something...</span>}
          </div>
        </div>

        <div className="header-right">
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
