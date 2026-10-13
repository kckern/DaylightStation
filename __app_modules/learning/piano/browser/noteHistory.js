// Shared note-history logic for piano MIDI inputs.
//
// Extracted from useMidiSubscription.js (the WebSocket wall-display transport) so
// the new BLE/Web-MIDI kiosk transport (useWebMidiBLE) feeds the SAME pure
// functions — one note model, two transports. Pure: no React, no refs.

export const MAX_HISTORY_SIZE = 500;
export const STALE_NOTE_MS = 10000;
export const DISPLAY_DURATION = 8000;

/**
 * Find the last entry in history matching a note number with no endTime.
 * Scans backward for O(1) typical case (most recent match is near the end).
 */
export function findLastActive(history, noteNum) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].note === noteNum && !history[i].endTime) return i;
  }
  return -1;
}

/** Close an active note in-place by index, returning a new array. */
export function closeNote(history, idx, endTime) {
  const next = [...history];
  next[idx] = { ...next[idx], endTime };
  return next;
}

/** Trim history: drop expired completed notes, keep all active + recent completed. */
export function trimHistory(history, now) {
  const cutoff = now - DISPLAY_DURATION;
  const trimmed = history.filter((n) => !n.endTime || n.endTime > cutoff);
  if (trimmed.length > MAX_HISTORY_SIZE) {
    const active = trimmed.filter((n) => !n.endTime);
    const completed = trimmed.filter((n) => n.endTime);
    return [...completed.slice(-(MAX_HISTORY_SIZE - active.length)), ...active];
  }
  return trimmed;
}

/**
 * Core note-on handler — pure function on history array.
 * Closes any existing active entry for the pitch (retrigger), then appends.
 */
export function handleNoteOn(history, note, velocity, startTime) {
  const activeIdx = findLastActive(history, note);
  const next = activeIdx >= 0 ? closeNote(history, activeIdx, startTime) : history;
  return [...next, { note, velocity, startTime, endTime: null }];
}

/** Core note-off handler — closes the matching active entry (no-op if none). */
export function handleNoteOff(history, note, endTime) {
  const activeIdx = findLastActive(history, note);
  if (activeIdx < 0) return history;
  return closeNote(history, activeIdx, endTime);
}

/**
 * Parse a raw Web-MIDI message (status + data bytes) into a normalized event.
 * Returns null for messages we don't model.
 *
 * @param {number[]|Uint8Array} bytes - [status, data1, data2]
 * @returns {null | { type, channel, note?, velocity?, controller?, value?, program? }}
 */
export function parseMidiMessage(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const status = bytes[0];
  const command = status & 0xf0;
  const channel = status & 0x0f;

  switch (command) {
    case 0x90: { // note on (velocity 0 == note off)
      const note = bytes[1];
      const velocity = bytes[2] ?? 0;
      return velocity > 0
        ? { type: 'note_on', channel, note, velocity }
        : { type: 'note_off', channel, note, velocity: 0 };
    }
    case 0x80: // note off
      return { type: 'note_off', channel, note: bytes[1], velocity: bytes[2] ?? 0 };
    case 0xb0: // control change
      return { type: 'control', channel, controller: bytes[1], value: bytes[2] ?? 0 };
    case 0xc0: // program change
      return { type: 'program', channel, program: bytes[1] };
    default:
      return null;
  }
}

/** Sustain pedal is CC 64; >= 64 = down. */
export const SUSTAIN_CONTROLLER = 64;
export const isSustainDown = (value) => value >= 64;
