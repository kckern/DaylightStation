const PROGRESS_LABEL = Object.freeze({
  empty: 'Not started',
  learning: 'Learning',
  learned: 'Learned',
  mastered: 'Mastered',
  locked: 'Locked',
});

// eslint-disable-next-line react-refresh/only-export-components -- pure projection is covered independently
export function learnSegmentProgressState(segment) {
  if (segment.locked) return 'locked';
  if (segment.testedOut) return 'mastered';
  if (segment.complete) return 'learned';
  if (segment.inProgress || segment.rungs?.some((rung) => (rung.passCount ?? 0) > 0)) return 'learning';
  return 'empty';
}

export default function LearnProgressStrip({ segments = [], selectedId = null, onOpenSegment }) {
  if (!segments.length) return null;
  return <nav className="piano-learn-progress" aria-label="Piece learning progress">
    <div className="piano-learn-progress__track">
      {segments.map((segment) => {
        const state = learnSegmentProgressState(segment);
        const label = [segment.label, segment.name, segment.barLabel, PROGRESS_LABEL[state]].filter(Boolean).join(', ');
        return <button
          key={segment.id}
          type="button"
          className="piano-learn-progress__pill"
          data-state={state}
          disabled={state === 'locked'}
          aria-current={segment.id === selectedId ? 'step' : undefined}
          aria-label={label}
          title={label}
          onClick={() => onOpenSegment?.(segment.id)}
        >
          <span className="piano-learn-progress__number" aria-hidden="true">{segment.number ?? segment.order}</span>
          <span className="piano-learn-progress__copy" aria-hidden="true">
            <strong>{segment.name || segment.label}</strong>
            <small>{segment.barLabel}</small>
          </span>
          <span className="piano-learn-progress__state" aria-hidden="true">{PROGRESS_LABEL[state]}</span>
        </button>;
      })}
    </div>
  </nav>;
}
