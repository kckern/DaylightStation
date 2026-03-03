// Pure spam detection functions for piano kiosk mode.
// Each function independently detects a specific spam pattern.
// Consumed by useSpamDetection hook — no React, no side effects.

/**
 * Detect note-count spam: 10+ simultaneous notes (humans have 10 fingers).
 * @param {Map} activeNotes - Currently held notes (key = MIDI note)
 * @returns {boolean}
 */
export function detectNoteCountSpam(activeNotes) {
  return activeNotes.size >= 10;
}

/**
 * Detect dense-cluster spam: 6+ simultaneous notes with density > 0.5.
 *
 * Density = noteCount / (pitchRange + 1).
 * A sliding window over every group of 6+ consecutive sorted pitches is checked.
 * If any window exceeds 0.5 density, returns true.
 *
 * @param {Map} activeNotes - Currently held notes (key = MIDI note)
 * @returns {boolean}
 */
export function detectDenseClusterSpam(activeNotes) {
  if (activeNotes.size < 6) return false;

  const pitches = Array.from(activeNotes.keys()).sort((a, b) => a - b);
  const n = pitches.length;

  // Sliding window: check every window of size w from 6..n
  for (let w = 6; w <= n; w++) {
    for (let i = 0; i <= n - w; i++) {
      const range = pitches[i + w - 1] - pitches[i];
      const density = w / (range + 1);
      if (density > 0.5) return true;
    }
  }

  return false;
}

/**
 * Detect rapid-fire spam: 20+ note_on events within a 3-second window.
 *
 * Iterates backwards from end of noteHistory (most recent first)
 * and breaks early when startTime falls outside the window.
 *
 * @param {Array<{startTime: number}>} noteHistory - Chronological note events
 * @param {number} now - Current timestamp (ms)
 * @returns {boolean}
 */
export function detectRapidFireSpam(noteHistory, now) {
  const windowMs = 3000;
  const threshold = 20;
  let count = 0;

  for (let i = noteHistory.length - 1; i >= 0; i--) {
    if (now - noteHistory[i].startTime > windowMs) break;
    count++;
    if (count >= threshold) return true;
  }

  return false;
}
