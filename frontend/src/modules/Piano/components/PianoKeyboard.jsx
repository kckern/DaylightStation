import React, { useMemo } from 'react';
import { isWhiteKey, getNoteName } from '../noteUtils.js';
import './PianoKeyboard.scss';

/**
 * Visual piano keyboard component
 *
 * @param {Object} props
 * @param {Map<number, { velocity: number }>} props.activeNotes - Currently pressed notes
 * @param {number} props.startNote - First note to display (default: 21 = A0)
 * @param {number} props.endNote - Last note to display (default: 108 = C8)
 * @param {boolean} props.showLabels - Show note labels on white keys
 */
export function PianoKeyboard({
  activeNotes = new Map(),
  startNote = 21,
  endNote = 108,
  showLabels = false,
  targetNotes = null,
  wrongNotes = null
}) {
  const keys = useMemo(() => {
    const result = [];

    for (let note = startNote; note <= endNote; note++) {
      const isActive = activeNotes.has(note);
      const noteData = activeNotes.get(note);
      const velocity = noteData?.velocity || 0;
      const isWhite = isWhiteKey(note);
      const isTarget = targetNotes?.has(note) ?? false;
      const isWrong = wrongNotes?.has(note) ?? false;

      result.push(
        <div
          key={note}
          className={`piano-key ${isWhite ? 'white' : 'black'} ${isActive ? 'active' : ''}${isTarget ? ' target' : ''}${isWrong ? ' wrong' : ''}`}
          style={{ '--velocity': velocity / 127 }}
          data-note={note}
          data-label={getNoteName(note)}
        >
          {showLabels && isWhite && note % 12 === 0 && (
            <span className="note-label">{getNoteName(note)}</span>
          )}
        </div>
      );
    }

    return result;
  }, [activeNotes, startNote, endNote, showLabels, targetNotes, wrongNotes]);

  // Count white keys for sizing
  const whiteKeyCount = useMemo(() => {
    let count = 0;
    for (let note = startNote; note <= endNote; note++) {
      if (isWhiteKey(note)) count++;
    }
    return count;
  }, [startNote, endNote]);

  return (
    <div
      className="piano-keyboard"
      style={{ '--white-key-count': whiteKeyCount }}
    >
      {keys}
    </div>
  );
}

export default PianoKeyboard;
