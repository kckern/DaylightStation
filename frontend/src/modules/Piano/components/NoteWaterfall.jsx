import { useMemo, useState, useEffect } from 'react';
import './NoteWaterfall.scss';

// White keys in an octave (C, D, E, F, G, A, B)
const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

// Calculate x position for a note (percentage)
const getNotePosition = (note, startNote = 21, endNote = 108) => {
  let whiteKeysBefore = 0;
  let totalWhiteKeys = 0;

  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) {
      totalWhiteKeys++;
      if (n < note) whiteKeysBefore++;
    }
  }

  const isWhite = isWhiteKey(note);
  const keyWidth = 100 / totalWhiteKeys;

  if (isWhite) {
    return whiteKeysBefore * keyWidth + keyWidth / 2;
  } else {
    return whiteKeysBefore * keyWidth + keyWidth * 0.75;
  }
};

const getNoteWidth = (note, startNote = 21, endNote = 108) => {
  let totalWhiteKeys = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) totalWhiteKeys++;
  }
  const keyWidth = 100 / totalWhiteKeys;
  return isWhiteKey(note) ? keyWidth * 0.9 : keyWidth * 0.5;
};

// Color scale based on note pitch (rainbow from low to high)
// Low notes (21) = red/orange, Mid notes (~60) = green/cyan, High notes (108) = blue/purple
const getNoteHue = (note, startNote = 21, endNote = 108) => {
  const range = endNote - startNote;
  const position = (note - startNote) / range;
  // Map to hue: 0 (red) -> 60 (yellow) -> 120 (green) -> 180 (cyan) -> 240 (blue) -> 280 (purple)
  return Math.round(position * 280);
};

const DISPLAY_DURATION = 8000; // Show notes for 8 seconds as they rise
const TICK_INTERVAL = 16; // ~60fps

/**
 * Waterfall display showing notes rising up from the keyboard
 * with Star Wars crawl perspective effect
 *
 * @param {Object} props
 * @param {Array} props.noteHistory - Array of note events with startTime/endTime
 * @param {Map} props.activeNotes - Map of currently pressed notes (note number -> {velocity, timestamp})
 * @param {number} props.startNote - Lowest note on keyboard
 * @param {number} props.endNote - Highest note on keyboard
 */
export function NoteWaterfall({ noteHistory = [], activeNotes = new Map(), startNote = 21, endNote = 108 }) {
  const [tick, setTick] = useState(0);

  // Continuous animation tick
  useEffect(() => {
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, TICK_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  const visibleNotes = useMemo(() => {
    const now = Date.now();

    return noteHistory
      .filter(note => {
        // For active notes, always show them
        const activeNote = activeNotes.get(note.note);
        const isStillActive = activeNote && activeNote.timestamp === note.startTime;
        if (isStillActive) return true;

        // For completed notes, filter based on time since release
        if (note.endTime) {
          const timeSinceRelease = now - note.endTime;
          return timeSinceRelease < DISPLAY_DURATION;
        }

        // Orphaned notes (no endTime, not active) - use age as fallback
        const age = now - note.startTime;
        return age < DISPLAY_DURATION;
      })
      .map(note => {
        // Check if this specific note instance is still active by matching both
        // the note number AND the startTime with the activeNotes map
        const activeNote = activeNotes.get(note.note);
        const isStillActive = activeNote && activeNote.timestamp === note.startTime;

        const duration = isStillActive
          ? now - note.startTime
          : note.endTime
            ? note.endTime - note.startTime
            : now - note.startTime;

        // Calculate position differently for active vs completed notes
        let bottomPercent, progress;
        if (isStillActive) {
          // Active notes stay anchored to the keyboard
          bottomPercent = 0;
          progress = 0;
        } else if (note.endTime) {
          // Completed notes rise based on time since release
          const timeSinceRelease = now - note.endTime;
          progress = timeSinceRelease / DISPLAY_DURATION;
          bottomPercent = progress * 100;
        } else {
          // Orphaned notes - fallback to age-based positioning
          const age = now - note.startTime;
          progress = age / DISPLAY_DURATION;
          bottomPercent = progress * 100;
        }

        return {
          ...note,
          x: getNotePosition(note.note, startNote, endNote),
          width: getNoteWidth(note.note, startNote, endNote),
          hue: getNoteHue(note.note, startNote, endNote),
          duration,
          bottomPercent,
          progress,
          isActive: isStillActive
        };
      });
  }, [noteHistory, activeNotes, startNote, endNote, tick]);

  return (
    <div className="note-waterfall">
      <div className="waterfall-perspective">
        {visibleNotes.map((note, idx) => {
          // Height based on note duration, scaled to match the timeline
          // Notes rise at 100% per DISPLAY_DURATION (8000ms), so height should use same scale
          const heldDuration = note.duration;
          // Convert duration to percentage of timeline (same scale as rising animation)
          const heightPercent = Math.min(95, Math.max(1, (heldDuration / DISPLAY_DURATION) * 100));

          return (
            <div
              key={`${note.note}-${note.startTime}-${idx}`}
              className={`waterfall-note ${note.isActive ? 'active' : ''}`}
              style={{
                '--x': `${note.x}%`,
                '--width': `${note.width}%`,
                '--height': `${heightPercent}%`,
                '--bottom': `${note.bottomPercent}%`,
                '--velocity': note.velocity / 127,
                '--hue': note.hue,
                '--progress': note.progress
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export default NoteWaterfall;
