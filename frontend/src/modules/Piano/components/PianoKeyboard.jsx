import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { isWhiteKey, getNoteName } from '../noteUtils.js';
import { reportRender } from '../../../lib/logging/jankProbes.js';
import { RomanChord } from './roman/RomanProgression.jsx';
import './PianoKeyboard.scss';

/**
 * One key. Memoized so a note-on/off re-renders ONLY the key that changed — not
 * all 88. Before this, `activeNotes` (a fresh Map per note) was a dependency of a
 * useMemo that rebuilt every key element on every note, so playing pegged the
 * Chromium renderer (reconcile + repaint of 88 nodes per event). React.memo here
 * bails out the unchanged keys: their props are identical primitives and the
 * pointer handlers are referentially stable (see the refs in PianoKeyboard).
 */
const PianoKey = React.memo(function PianoKey({
  note,
  isWhite,
  isActive,
  isLoop,
  velocity,
  isTarget,
  isWrong,
  isDestroyed,
  rebuildProgress,
  isPerc,
  isSplitStart,
  showLabel,
  interactive,
  onNoteOn,
  onNoteOff,
}) {
  const label = getNoteName(note);
  const className = `piano-key ${isWhite ? 'white' : 'black'} ${isActive ? 'active' : ''}`
    + `${isLoop ? ' loop' : ''}${isTarget ? ' target' : ''}${isWrong ? ' wrong' : ''}${isDestroyed ? ' destroyed' : ''}`
    + `${isPerc ? ' perc' : ''}${isSplitStart ? ' split-start' : ''}`;

  return (
    <div
      className={className}
      style={{
        '--velocity': velocity / 127,
        ...(isDestroyed ? { '--rebuild-progress': rebuildProgress } : {}),
      }}
      data-note={note}
      data-label={label}
      onPointerDown={interactive ? (e) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
        onNoteOn(note, 90);
      } : undefined}
      onPointerUp={interactive ? (e) => { e.preventDefault(); onNoteOff(note); } : undefined}
      onPointerCancel={interactive ? () => onNoteOff(note) : undefined}
    >
      {showLabel && <span className="note-label">{label}</span>}
      {isDestroyed && <div className="rebuild-bar" />}
    </div>
  );
});

/**
 * Visual piano keyboard component
 *
 * @param {Object} props
 * @param {Map<number, { velocity: number }>} props.activeNotes - Currently pressed notes
 * @param {number} props.startNote - First note to display (default: 21 = A0)
 * @param {number} props.endNote - Last note to display (default: 108 = C8)
 * @param {boolean} props.showLabels - Show note labels on white keys
 * @param {boolean} [props.dimTarget] - Render target keys in a muted "half shade"
 *   (a hint rather than a full spoiler light) — used by Sheet Music Learn mode.
 * @param {Map<number, { destroyedAt: number, cooldownMs: number }>} [props.destroyedKeys] - Destroyed keys with cooldown
 * @param {(note: number, velocity: number) => void} [props.onNoteOn] - When provided, keys become touch/clickable (press)
 * @param {(note: number) => void} [props.onNoteOff] - Release handler paired with onNoteOn
 * @param {number} [props.splitNote] - When set, keys below it render as the
 *   percussion zone (tinted) and the rest as melodic, with a divider at the split.
 */
export function PianoKeyboard({
  activeNotes = new Map(),
  loopNotes = null,
  startNote = 21,
  endNote = 108,
  showLabels = false,
  targetNotes = null,
  dimTarget = false,
  wrongNotes = null,
  destroyedKeys = null,
  onNoteOn = null,
  onNoteOff = null,
  splitNote = null,
  handChordLabel = null,
}) {
  const interactive = typeof onNoteOn === 'function';

  // Stable handler identities so PianoKey's React.memo can bail on unchanged keys
  // even if the parent passes fresh onNoteOn/onNoteOff each render.
  const onNoteOnRef = useRef(onNoteOn);
  const onNoteOffRef = useRef(onNoteOff);
  onNoteOnRef.current = onNoteOn;
  onNoteOffRef.current = onNoteOff;
  const handleNoteOn = useCallback((note, vel) => onNoteOnRef.current?.(note, vel), []);
  const handleNoteOff = useCallback((note) => onNoteOffRef.current?.(note), []);

  // Tick for animating rebuild progress bars (games only — destroyedKeys present).
  const [rebuildTick, setRebuildTick] = useState(0);
  useEffect(() => {
    if (!destroyedKeys || destroyedKeys.size === 0) return undefined;
    const id = setInterval(() => setRebuildTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [destroyedKeys?.size]);

  // Structural descriptors — stable across note changes (depend only on layout).
  const descriptors = useMemo(() => {
    const result = [];
    let splitMarked = false;
    for (let note = startNote; note <= endNote; note++) {
      const isWhite = isWhiteKey(note);
      const isPerc = splitNote != null && note < splitNote;
      const isSplitStart = splitNote != null && !splitMarked && note >= splitNote && isWhite;
      if (isSplitStart) splitMarked = true;
      result.push({
        note,
        isWhite,
        isPerc,
        isSplitStart,
        showLabel: showLabels && isWhite && note % 12 === 0,
      });
    }
    return result;
  }, [startNote, endNote, splitNote, showLabels]);

  const whiteKeyCount = useMemo(
    () => descriptors.reduce((n, d) => n + (d.isWhite ? 1 : 0), 0),
    [descriptors],
  );

  const now = (destroyedKeys && destroyedKeys.size) ? Date.now() : 0;

  // Telemetry: container re-render frequency (the memoized keys bail out, so a
  // high count here means the whole board is being asked to reconcile often).
  useEffect(() => {
    reportRender('PianoKeyboard', { nodes: descriptors.length });
  });

  return (
    <div
      className={`piano-keyboard${interactive ? ' interactive' : ''}${dimTarget ? ' target-dim' : ''}`}
      style={{ '--white-key-count': whiteKeyCount }}
    >
      {descriptors.map((d) => {
        const noteData = activeNotes.get(d.note);
        const destroyed = destroyedKeys?.get(d.note);
        const rebuildProgress = destroyed
          ? Math.min(1, (now - destroyed.destroyedAt) / destroyed.cooldownMs)
          : 0;
        return (
          <PianoKey
            key={d.note}
            note={d.note}
            isWhite={d.isWhite}
            isPerc={d.isPerc}
            isSplitStart={d.isSplitStart}
            showLabel={d.showLabel}
            isActive={activeNotes.has(d.note)}
            isLoop={loopNotes?.has(d.note) ?? false}
            velocity={noteData?.velocity || 0}
            isTarget={targetNotes?.has(d.note) ?? false}
            isWrong={wrongNotes?.has(d.note) ?? false}
            isDestroyed={!!destroyed}
            rebuildProgress={rebuildProgress}
            interactive={interactive}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
          />
        );
      })}
      {handChordLabel && (
        <div className="piano-keyboard__hand-label">
          <RomanChord token={handChordLabel} />
        </div>
      )}
    </div>
  );
}

export default PianoKeyboard;
