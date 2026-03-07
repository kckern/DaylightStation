// Pure spam detection functions for piano kiosk mode.
// Each function independently detects a specific spam pattern.
// Consumed by useSpamDetection hook — no React, no side effects.

/**
 * Detect note-count spam: 15+ simultaneous notes.
 * Real pianists max out at 10 fingers; sustain pedal can hold more,
 * but 15+ concurrent notes with no pedal indicates fist/forearm smashing.
 * @param {Map} activeNotes - Currently held notes (key = MIDI note)
 * @returns {boolean}
 */
export function detectNoteCountSpam(activeNotes) {
  return activeNotes.size >= 15;
}

/**
 * Detect dense-cluster spam: 10+ simultaneous notes with density > 0.7.
 *
 * Density = noteCount / (pitchRange + 1).
 * A sliding window over every group of 10+ consecutive sorted pitches is checked.
 * Real chords span wide intervals (density < 0.5); fist-smashing hits
 * many adjacent keys (density > 0.7).
 *
 * @param {Map} activeNotes - Currently held notes (key = MIDI note)
 * @returns {boolean}
 */
export function detectDenseClusterSpam(activeNotes) {
  if (activeNotes.size < 10) return false;

  const pitches = Array.from(activeNotes.keys()).sort((a, b) => a - b);
  const n = pitches.length;

  // Sliding window: check every window of size w from 10..n
  for (let w = 10; w <= n; w++) {
    for (let i = 0; i <= n - w; i++) {
      const range = pitches[i + w - 1] - pitches[i];
      const density = w / (range + 1);
      if (density > 0.7) return true;
    }
  }

  return false;
}

/**
 * Detect rapid-fire spam: 40+ note_on events within a 3-second window.
 *
 * Fast scale runs at 120 BPM 16th notes = ~32 notes in 3s.
 * Threshold of 40 accommodates virtuoso passages while catching
 * random key mashing (which produces 60+ events in 3s).
 *
 * @param {Array<{startTime: number}>} noteHistory - Chronological note events
 * @param {number} now - Current timestamp (ms)
 * @returns {boolean}
 */
export function detectRapidFireSpam(noteHistory, now) {
  const windowMs = 3000;
  const threshold = 40;
  let count = 0;

  for (let i = noteHistory.length - 1; i >= 0; i--) {
    if (now - noteHistory[i].startTime > windowMs) break;
    count++;
    if (count >= threshold) return true;
  }

  return false;
}
