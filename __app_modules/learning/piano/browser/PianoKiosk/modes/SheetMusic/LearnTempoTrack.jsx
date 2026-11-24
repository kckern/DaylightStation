import { useState } from 'react';
import TransportSheet from '../../transport/TransportSheet.jsx';
import Icon from '../../../ui/icons/Icon.jsx';

/**
 * The drill's speed as ONE header button (2026-11-24): the chosen percent, with the flag at full speed,
 * opening an opaque sheet of the speeds as big buttons. No slider and no − / +: with a handful of stops,
 * tapping the stop is the whole job, and there is no end of a range to explain. Ladder rungs are labelled
 * as such; a rung already earned is filled; the stops a pass at the chosen speed would also earn are lit;
 * the beats per minute appear only here. The host removes the button during a take or Listen (its slot
 * stays), so it never shows a control that cannot act.
 */
export default function LearnTempoTrack({ stops, ladder = [], earned = [], value, stepPercent, scoreBpm = null, onChange, onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next) => { setOpenState(next); onOpenChange?.(next); };
  const bpmAt = (percent) => (Number(scoreBpm) > 0 ? Math.round(scoreBpm * percent / 100) : null);
  const lit = stops.filter((percent) => percent <= value && percent > stepPercent && !earned.includes(percent));
  const pick = (percent) => { if (percent !== value) onChange?.(percent); setOpen(false); };
  const bpm = bpmAt(value);
  return <>
    <button type="button" className="piano-learn-lab__action piano-learn-speed" aria-label={`Speed: ${value}%`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen(true)}>
      <Icon name="speed" /><strong>{value}%</strong>{value === 100 && <Icon name="flag" className="piano-learn-speed__flag" />}
    </button>
    <TransportSheet open={open} title="Speed" onClose={() => setOpen(false)} className="piano-learn-speed-sheet">
      <div className="piano-learn-speed-sheet__stops" role="group" aria-label="Tempo">
        {stops.map((percent) => <button key={percent} type="button" aria-label={`${percent}%`} aria-pressed={percent === value}
          data-autofocus={percent === value ? '' : undefined}
          data-rung={ladder.includes(percent) || undefined} data-earned={earned.includes(percent) || undefined}
          data-lit={lit.includes(percent) || undefined} data-step={percent === stepPercent || undefined}
          onClick={() => pick(percent)}>
          <strong>{percent}%</strong>
          {percent === 100 ? <Icon name="flag" className="piano-learn-speed__flag" /> : ladder.includes(percent) ? <small>step</small> : null}
        </button>)}
      </div>
      <p className="piano-learn-speed-sheet__note">
        {bpm && <span>{bpm} bpm</span>}
        {lit.length > 0 && <span>{`A pass at ${value}% also earns ${lit.filter((p) => p !== value).concat(value).join(', ')}%`}</span>}
      </p>
    </TransportSheet>
  </>;
}
