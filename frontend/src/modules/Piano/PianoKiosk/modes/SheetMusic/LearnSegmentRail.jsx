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

const STATE_GLYPH = Object.freeze({
  locked: '▣', 'tested-out': '★', mastered: '✓', 'in-progress': '◐', next: '›', unstarted: '',
});

export default function LearnSegmentRail({ segments = [], selectedId = null, onSelect, onSelectRung, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const selected = segments.find((segment) => segment.id === selectedId) ?? null;
  return (
    <nav className={`piano-learn-segment-rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Piece segments">
      <div className="piano-learn-segment-rail__primary">
        <button
          type="button"
          className="piano-learn-segment-rail__toggle"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} segment rail`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        ><span aria-hidden="true">{collapsed ? 'Segments' : '▾'}</span></button>
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
              <span className="piano-learn-segment-rail__number" aria-hidden="true">{segment.number ?? segment.order}</span>
              {STATE_GLYPH[state] && <span className="piano-learn-segment-rail__glyph" aria-hidden="true">{STATE_GLYPH[state]}</span>}
            </button>;
          })}
        </div>}
      </div>
      {!collapsed && selected && <div className="piano-learn-segment-rail__ladder" role="group" aria-label={`${selected.label} practice ladder`}>
        <div className="piano-learn-segment-rail__identity"><strong>{selected.label}</strong><span>{[selected.name, selected.barLabel].filter(Boolean).join(' · ')}</span></div>
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
