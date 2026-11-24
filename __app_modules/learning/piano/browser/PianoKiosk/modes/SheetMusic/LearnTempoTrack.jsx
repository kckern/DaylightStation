import { useRef, useState } from 'react';
import Icon from '../../../ui/icons/Icon.jsx';

/**
 * The drill header's tempo: a stepped track of tappable stops (not a slider: each stop is a target,
 * and a drag only ever lands on one), with − and + a stop at a time, and the tempo in PERCENT with the
 * beats per minute small beneath. Ladder rungs are drawn larger and labelled; a rung already earned is
 * filled; the stops a pass at the chosen tempo would fill are lit; 100% carries the flag.
 *
 * `locked` (a take is under way): the stops cannot be touched and − / + are hidden but keep their
 * space, so nothing in the header moves when a take starts or ends.
 */
export default function LearnTempoTrack({ stops, ladder = [], earned = [], value, stepPercent, scoreBpm = null, locked = false, onChange }) {
  const track = useRef(null);
  const [dragging, setDragging] = useState(null);
  const shown = dragging ?? value;
  const at = stops.indexOf(shown);
  const pick = (percent) => { if (!locked && percent !== value) onChange?.(percent); };
  const nearest = (clientX) => {
    const box = track.current?.getBoundingClientRect();
    if (!box?.width || stops.length < 2) return stops[0];
    const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return stops[Math.round(ratio * (stops.length - 1))];
  };
  const position = (index) => (stops.length < 2 ? 50 : (index / (stops.length - 1)) * 100);
  const bpm = Number(scoreBpm) > 0 ? Math.round(scoreBpm * shown / 100) : null;
  const drag = locked ? {} : {
    onPointerDown: (event) => { event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(nearest(event.clientX)); },
    onPointerMove: (event) => { if (dragging != null) setDragging(nearest(event.clientX)); },
    onPointerUp: (event) => { const landed = nearest(event.clientX); setDragging(null); pick(landed); },
    onPointerCancel: () => setDragging(null),
  };
  return <div className="piano-learn-tempo" role="group" aria-label="Tempo" data-locked={locked || undefined}>
    <button type="button" className="piano-learn-tempo__nudge" aria-label="Slower" tabIndex={locked ? -1 : undefined}
      disabled={locked || at <= 0} onClick={() => pick(stops[at - 1])}><Icon name="minus" /></button>
    <div className="piano-learn-tempo__track" ref={track} {...drag}>
      <span className="piano-learn-tempo__rail" aria-hidden="true"><i style={{ width: `${position(Math.max(0, at))}%` }} /></span>
      {stops.map((percent, index) => {
        const rung = ladder.includes(percent);
        return <button key={percent} type="button" className="piano-learn-tempo__stop" style={{ left: `${position(index)}%` }}
          aria-label={`${percent}%`} aria-pressed={percent === shown} disabled={locked} tabIndex={locked ? -1 : undefined}
          data-rung={rung || undefined} data-earned={earned.includes(percent) || undefined}
          data-lit={(percent <= shown && percent > stepPercent && !earned.includes(percent)) || undefined}
          data-step={percent === stepPercent || undefined}
          onPointerDown={(event) => event.stopPropagation()} onClick={() => pick(percent)}>
          <span className="piano-learn-tempo__dot" />
          {percent === 100 ? <Icon name="flag" className="piano-learn-tempo__flag" /> : rung && <span className="piano-learn-tempo__label">{percent}</span>}
        </button>;
      })}
    </div>
    <button type="button" className="piano-learn-tempo__nudge" aria-label="Faster" tabIndex={locked ? -1 : undefined}
      disabled={locked || at >= stops.length - 1} onClick={() => pick(stops[at + 1])}><Icon name="plus" /></button>
    <output className="piano-learn-tempo__readout" aria-live="polite"><strong>{shown}%</strong>{bpm && <small>{bpm} bpm</small>}</output>
  </div>;
}
