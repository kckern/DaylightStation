import { useEffect, useRef, useState } from 'react';
import { detectKey } from '../../MusicNotation/model/keySignature.js';

// Shared rolling key detection for the piano theory triptych.
//
// The circle of fifths and the grand staff must agree on ONE key. This hook owns
// the rolling detection: it watches the live MIDI surface, records the pitch
// class of each NEWLY pressed note into a time-and-size bounded buffer, and runs
// the tonic-weighted `detectKey` over that buffer. Releases and note decay never
// move the key — only new notes do. Safe to call unconditionally every render.

const KEY_BUFFER_MAX_AGE = 10_000; // 10 seconds
const KEY_BUFFER_MAX_NOTES = 30; // keep the last 30 notes

/**
 * @param {Map<number, any>} activeNotes - live MIDI surface (Map<midi, data>); only keys matter
 * @returns {string} detected major key name (e.g. 'C', 'G', 'Bb')
 */
export function useDetectedKey(activeNotes) {
  const [key, setKey] = useState('C');
  const lastKeysRef = useRef(new Set());
  const bufferRef = useRef([]); // rolling [{ pitchClass, timestamp }]

  useEffect(() => {
    const currentKeys = new Set(activeNotes.keys());
    const lastKeys = lastKeysRef.current;
    const newNotes = [...currentKeys].filter((k) => !lastKeys.has(k));
    lastKeysRef.current = currentKeys;

    // Only new notes advance the key; releases/decay leave it untouched.
    if (newNotes.length === 0) return;

    const now = Date.now();
    newNotes.forEach((note) => {
      bufferRef.current.push({ pitchClass: note % 12, timestamp: now });
    });
    bufferRef.current = bufferRef.current
      .filter((n) => now - n.timestamp < KEY_BUFFER_MAX_AGE)
      .slice(-KEY_BUFFER_MAX_NOTES);

    const pitchClasses = bufferRef.current.map((n) => n.pitchClass);
    setKey((prev) => detectKey(pitchClasses, prev));
  }, [activeNotes]);

  return key;
}

export default useDetectedKey;
