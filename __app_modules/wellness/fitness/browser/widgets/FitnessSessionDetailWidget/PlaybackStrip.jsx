import React, { useId, useState } from 'react';
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
const labelFor = s => s.firstPlaying ? 'Video started' : LABELS[s.state] || LABELS.unknown;

/** Saved detail only: the SVG retains true duration, independent of button hit areas. */
export default function PlaybackStrip({ intervals = [], width }) {
  const [selection, setSelection] = useState(null);
  const id = useId();
  const selected = intervals.find(s => keyFor(s) === selection);
  if (!intervals.length || !(width > 0)) return null;
  const evidence = selected?.evidence;
  const proof = evidence?.zone && evidence.reason === 'startup_gate' && selected?.firstPlaying
    ? `${evidence.participantName || evidence.participantId ? `${evidence.participantName || evidence.participantId} · ` : ''}${evidence.zone[0].toUpperCase()}${evidence.zone.slice(1)} reached${Number.isFinite(evidence.hrBpm) ? ` · ${evidence.hrBpm} BPM` : ''}${Number.isFinite(evidence.thresholdBpm) ? ` (threshold ${evidence.thresholdBpm} BPM)` : ''}` : null;
  return (
    <section className="playback-strip" aria-label="Video playback timeline" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="playback-strip__heading"><span>VIDEO PLAYBACK</span><span>Tap a section for details</span></div>
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
            aria-describedby={`${id}-detail`} aria-pressed={selection === keyFor(s)}
            onClick={() => setSelection(keyFor(s))} onFocus={() => setSelection(keyFor(s))} />
        ))}
      </div>
      <div className="playback-strip__legend">
        {[...new Set(intervals.map(s => s.state))].map(state => <span key={state} className={`playback-strip__legend-item playback-strip__segment--${state}`}><i />{LABELS[state] || LABELS.unknown}</span>)}
      </div>
      <div className="playback-strip__detail" id={`${id}-detail`} role="status">
        {selected ? [clock(selected.startMs), selected.title || selected.contentId || 'Video', labelFor(selected), proof,
          !selected.firstPlaying && REASONS[selected.reason]].filter(Boolean).join(' · ') : 'Select a section to see playback timing and reasons.'}
      </div>
    </section>
  );
}
