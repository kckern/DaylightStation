import { useState } from 'react';

export function segmentNavigationState(segments = [], navigation = {}) {
  const sequential = navigation.sequential === true;
  const firstIncomplete = segments.findIndex((segment) => !segment.complete && !segment.testedOut);
  return segments.map((segment, index) => ({
    ...segment,
    locked: sequential && firstIncomplete >= 0 && index > firstIncomplete,
    recommended: firstIncomplete >= 0 && index === firstIncomplete,
  }));
}

const stateOf = (segment) => segment.locked ? ['locked', 'Locked']
  : segment.testedOut ? ['tested-out', 'Tested out']
  : segment.complete ? ['mastered', 'Mastered']
  : segment.inProgress ? ['in-progress', 'In progress']
  : segment.recommended ? ['next', 'Next'] : ['unstarted', 'Unstarted'];

export default function LearnSegmentRail({ segments = [], selectedId = null, onSelect, onSelectRung, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const selected = segments.find((segment) => segment.id === selectedId) ?? null;
  return (
    <nav className={`piano-learn-segment-rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Piece segments">
      <button
        type="button"
        className="piano-learn-segment-rail__toggle"
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} segment rail`}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >{collapsed ? 'Segments' : 'Hide'}</button>
      {!collapsed && <div className="piano-learn-segment-rail__track">
        {segments.map((segment) => {
          const [state, stateLabel] = stateOf(segment);
          const label = [segment.label, segment.name, segment.barLabel, stateLabel].filter(Boolean).join(', ');
          return <button
            key={segment.id}
            type="button"
            className={`piano-learn-segment-rail__segment${segment.id === selectedId ? ' is-selected' : ''}`}
            data-state={state}
            disabled={segment.locked}
            aria-label={label}
            onClick={() => onSelect?.(segment.id)}
          >
            <span className="piano-learn-segment-rail__title">{segment.label}</span>
            {segment.name && <span className="piano-learn-segment-rail__name">{segment.name}</span>}
            <small>{segment.barLabel}</small>
            <span className="piano-learn-segment-rail__state">{stateLabel}</span>
          </button>;
        })}
      </div>}
      {!collapsed && selected && <div className="piano-learn-segment-rail__ladder" role="group" aria-label={`${selected.label} practice ladder`}>
        <button type="button" className="piano-learn-segment-rail__close" onClick={onClose} aria-label={`Close ${selected.label}`}>×</button>
        {selected.rungs.map((rung) => <button
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
