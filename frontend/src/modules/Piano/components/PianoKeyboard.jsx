import React, { useMemo, useState, useEffect } from 'react';
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
 * @param {Map<number, { destroyedAt: number, cooldownMs: number }>} [props.destroyedKeys] - Destroyed keys with cooldown
 * @param {(note: number, velocity: number) => void} [props.onNoteOn] - When provided, keys become touch/clickable (press)
 * @param {(note: number) => void} [props.onNoteOff] - Release handler paired with onNoteOn
 */
export function PianoKeyboard({
  activeNotes = new Map(),
  startNote = 21,
  endNote = 108,
  showLabels = false,
  targetNotes = null,
  wrongNotes = null,
  destroyedKeys = null,
  onNoteOn = null,
  onNoteOff = null,
}) {
  const interactive = typeof onNoteOn === 'function';
  // Tick for animating rebuild progress bars
  const [rebuildTick, setRebuildTick] = useState(0);
  useEffect(() => {
    if (!destroyedKeys || destroyedKeys.size === 0) return;
    const id = setInterval(() => setRebuildTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, [destroyedKeys?.size]);

  const keys = useMemo(() => {
    const result = [];
    const now = Date.now();

    for (let note = startNote; note <= endNote; note++) {
      const isActive = activeNotes.has(note);
      const noteData = activeNotes.get(note);
      const velocity = noteData?.velocity || 0;
      const isWhite = isWhiteKey(note);
      const isTarget = targetNotes?.has(note) ?? false;
      const isWrong = wrongNotes?.has(note) ?? false;
      const destroyed = destroyedKeys?.get(note);
      const isDestroyed = !!destroyed;

      let rebuildProgress = 0;
      if (destroyed) {
        rebuildProgress = Math.min(1, (now - destroyed.destroyedAt) / destroyed.cooldownMs);
      }

      result.push(
        <div
          key={note}
          className={`piano-key ${isWhite ? 'white' : 'black'} ${isActive ? 'active' : ''}${isTarget ? ' target' : ''}${isWrong ? ' wrong' : ''}${isDestroyed ? ' destroyed' : ''}`}
          style={{
            '--velocity': velocity / 127,
            ...(isDestroyed ? { '--rebuild-progress': rebuildProgress } : {}),
          }}
          data-note={note}
          data-label={getNoteName(note)}
          onPointerDown={interactive ? (e) => {
            e.preventDefault();
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
            onNoteOn(note, 90);
          } : undefined}
          onPointerUp={interactive ? (e) => { e.preventDefault(); onNoteOff?.(note); } : undefined}
          onPointerCancel={interactive ? () => onNoteOff?.(note) : undefined}
        >
          {showLabels && isWhite && note % 12 === 0 && (
            <span className="note-label">{getNoteName(note)}</span>
          )}
          {isDestroyed && (
            <div className="rebuild-bar" />
          )}
        </div>
      );
    }

    return result;
  }, [activeNotes, startNote, endNote, showLabels, targetNotes, wrongNotes, destroyedKeys, rebuildTick, interactive, onNoteOn, onNoteOff]);

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
      className={`piano-keyboard${interactive ? ' interactive' : ''}`}
      style={{ '--white-key-count': whiteKeyCount }}
    >
      {keys}
    </div>
  );
}

export default PianoKeyboard;
