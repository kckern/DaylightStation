import { useState } from 'react';
import Icon from '../../../ui/icons/Icon.jsx';

export function segmentNavigationState(segments = [], navigation = {}) {
  const sequential = navigation.sequential === true;
  const firstIncomplete = segments.findIndex((segment) => !segment.complete && !segment.testedOut);
  return segments.map((segment, index) => ({
    ...segment,
    locked: sequential && firstIncomplete >= 0 && index > firstIncomplete,
    recommended: firstIncomplete >= 0 && index === firstIncomplete,
  }));
}

export default function LearnSegmentRail({ segments = [], selectedId = null, onSelectRung, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const selected = segments.find((segment) => segment.id === selectedId) ?? null;
  if (!selected) return null;
  const testOut = selected.rungs?.find((rung) => rung.id === 'test-out');
  const primary = selected.rungs?.find((rung) => rung.id !== 'test-out' && rung.state !== 'locked' && rung.state !== 'complete')
    ?? selected.rungs?.find((rung) => rung.id !== 'test-out' && rung.state !== 'locked');
  const primaryVerb = (primary?.passCount ?? 0) > 0 ? 'Continue' : 'Start';
  return (
    <nav className={`piano-learn-segment-rail${expanded ? ' is-expanded' : ''}`} aria-label="Selected segment">
      <div className="piano-learn-segment-rail__summary">
        <div className="piano-learn-segment-rail__identity"><strong>{selected.label}</strong><span>{[selected.name, selected.barLabel].filter(Boolean).join(' · ')}</span></div>
        {primary && <button type="button" className="piano-learn-segment-rail__start" aria-label={`${primaryVerb} ${primary.label}`} onClick={() => onSelectRung?.(primary.id)}><Icon name="play" />{primaryVerb} <span>{primary.label}</span></button>}
        {testOut && <button type="button" className="piano-learn-segment-rail__test" disabled={testOut.state === 'locked'} onClick={() => onSelectRung?.(testOut.id)}><Icon name="crown" />Test out</button>}
        <button type="button" className="piano-learn-segment-rail__toggle" aria-label={`${expanded ? 'Hide' : 'Show'} practice ladder`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><Icon name={expanded ? 'chevron-down' : 'lessons'} /></button>
        <button type="button" className="piano-learn-segment-rail__done" aria-label="Done" onClick={onClose}><Icon name="close" /><span>Done</span></button>
      </div>
      {expanded && <div className="piano-learn-segment-rail__ladder" role="group" aria-label={`${selected.label} practice ladder`}>
        {selected.rungs.filter((rung) => rung.id !== 'test-out').map((rung) => <button
          key={rung.id}
          type="button"
          disabled={rung.state === 'locked'}
          data-state={rung.state}
          onClick={() => onSelectRung?.(rung.id)}
        ><span>{rung.label}</span><small>{rung.state === 'complete' ? 'Complete' : `${rung.passCount}/${rung.required}`}</small></button>)}
      </div>}
    </nav>
  );
}
