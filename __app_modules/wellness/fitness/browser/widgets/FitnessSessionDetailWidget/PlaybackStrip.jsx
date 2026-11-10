import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import './PlaybackStrip.scss';

const LABELS = {
  waiting: 'Waiting to unlock', playing: 'Playing', warning: 'Playing · warning',
  governance_paused: 'Paused · exercise required', paused: 'Paused', buffering: 'Buffering', unknown: 'Playback not recorded',
};
const REASONS = {
  startup_gate: 'Startup effort required', requirements_not_met: 'Exercise requirement not met',
  challenge_failed: 'Challenge missed', manual: 'Manual pause', voice_memo: 'Voice memo', emergency: 'Emergency pause', buffering: 'Buffering',
};
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const keyFor = s => `${s.playbackRunId}:${s.startMs}:${s.state}:${s.contentId}`;
const labelFor = s => s.firstPlaying ? 'Video started' : s.observedStart ? 'Playing observed' : LABELS[s.state] || LABELS.unknown;

/**
 * Saved detail only: the SVG retains true duration, independent of button hit
 * areas. The chart shows the timeline and nothing else; tapping a section opens
 * its details (and the colour key) in a modal.
 */
export default function PlaybackStrip({ intervals = [], width }) {
  const [selection, setSelection] = useState(null);
  const id = useId();
  const selected = intervals.find(s => keyFor(s) === selection);
  if (!intervals.length || !(width > 0)) return null;
  const evidence = selected?.evidence;
  const capitalized = value => value ? `${String(value)[0].toUpperCase()}${String(value).slice(1)}` : null;
  const observedProof = evidence ? [evidence.participantName || evidence.participantId, evidence.zone ? `Zone: ${capitalized(evidence.zone)}` : null, Number.isFinite(evidence.hrBpm) ? `${evidence.hrBpm} BPM` : null, evidence.requiredZone ? `Required: ${capitalized(evidence.requiredZone)}${Number.isFinite(evidence.requiredThresholdBpm) ? ` · ${evidence.requiredThresholdBpm} BPM` : ''}` : Number.isFinite(evidence.thresholdBpm) ? `${capitalized(evidence.zone) || 'Zone'} threshold: ${evidence.thresholdBpm} BPM` : null].filter(Boolean).join(' · ') : null;
  const proof = evidence?.zone && evidence.reason === 'startup_gate' && selected?.firstPlaying
    ? `${evidence.participantName || evidence.participantId ? `${evidence.participantName || evidence.participantId} · ` : ''}${evidence.zone[0].toUpperCase()}${evidence.zone.slice(1)} reached${Number.isFinite(evidence.hrBpm) ? ` · ${evidence.hrBpm} BPM` : ''}${Number.isFinite(evidence.thresholdBpm) ? ` (threshold ${evidence.thresholdBpm} BPM)` : ''}` : null;
  const close = () => setSelection(null);
  return (
    <section className="playback-strip" aria-label="Video playback timeline" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="playback-strip__track">
        <svg width={width} height="28" aria-hidden="true">
          <defs><pattern id={`${id}-unknown`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="currentColor" opacity="0.18" /><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" opacity="0.5" /></pattern></defs>
          {intervals.map(s => (
            <g key={keyFor(s)} className={`playback-strip__segment playback-strip__segment--${s.state}`}>
              <rect data-playback-state={s.state} x={s.x} y="6" width={s.width} height="14" rx="1" fill={s.state === 'unknown' || s.state === 'buffering' ? `url(#${id}-unknown)` : 'currentColor'} />
              {s.firstPlaying && <path d={`M${s.x},2 v22 m0,-20 l6,3 -6,3`} stroke="currentColor" fill="none" />}
            </g>
          ))}
        </svg>
        {intervals.map(s => (
          <button key={keyFor(s)} type="button" className="playback-strip__hit"
            style={{ left: Math.max(0, Math.min(width - 24, s.x - Math.max(0, 24 - s.width) / 2)), width: Math.max(24, Math.min(s.width, width)), zIndex: s.width < 24 ? 2 : 1 }}
            aria-label={`${labelFor(s)} · ${clock(s.startMs)}–${clock(s.endMs)} · ${s.title || s.contentId || 'Video'}`}
            aria-haspopup="dialog" aria-pressed={selection === keyFor(s)}
            onClick={() => setSelection(keyFor(s))} />
        ))}
      </div>
      {selected && <PlaybackDetails id={id} intervals={intervals} selected={selected} selection={selection}
        text={[clock(selected.startMs), selected.title || selected.contentId || 'Video', labelFor(selected), proof || observedProof, REASONS[selected.reason]].filter(Boolean).join(' · ')}
        onSelect={setSelection} onClose={close} />}
    </section>
  );
}

/**
 * The strip's explanation, on demand: what the tapped section was and why, the
 * colour key, and every transition (so a 1 s pause hidden under its neighbour
 * is still reachable). Portalled to the body so it never takes chart space;
 * React still bubbles its events through the strip, which stops them before
 * they can scrub the recap.
 */
function PlaybackDetails({ id, intervals, selected, selection, text, onSelect, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="playback-strip-modal" onPointerDown={e => e.stopPropagation()}>
      <div className="playback-strip-modal__backdrop" data-testid="playback-strip-backdrop" onClick={onClose} />
      <div className="playback-strip-modal__panel" role="dialog" aria-modal="true" aria-label="Playback details">
        <div className="playback-strip-modal__head">
          <span className={`playback-strip-modal__state playback-strip__segment--${selected.state}`}><i />{labelFor(selected)}</span>
          <button type="button" className="playback-strip-modal__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="playback-strip-modal__detail" role="status">{text}</div>
        <div className="playback-strip-modal__legend">
          {[...new Set(intervals.map(s => s.state))].map(state => <span key={state} className={`playback-strip-modal__legend-item playback-strip__segment--${state}`}><i />{LABELS[state] || LABELS.unknown}</span>)}
        </div>
        <div id={`${id}-transitions`} className="playback-strip-modal__transitions" role="group" aria-label="All playback transitions">
          {intervals.map(s => <button type="button" key={keyFor(s)} aria-current={keyFor(s) === selection ? 'true' : undefined}
            className={`playback-strip-modal__transition playback-strip__segment--${s.state}`} onClick={() => onSelect(keyFor(s))}>
            {clock(s.startMs)}–{clock(s.endMs)} · {labelFor(s)}
          </button>)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
