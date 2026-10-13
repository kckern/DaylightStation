export default function TimelineSection({ data, onNavigateToItem }) {
  if (!data?.items?.length) return null;

  return (
    <div className="detail-timeline">
      {data.label && <div className="detail-timeline-label">{data.label}</div>}
      <ol className="detail-timeline-list">
        {data.items.map(entry => (
          <li key={entry.id}>
            <button
              type="button"
              className={`detail-timeline-entry${entry.isCurrent ? ' detail-timeline-entry--current' : ''}`}
              onClick={() => onNavigateToItem?.(entry)}
              disabled={entry.isCurrent}
              aria-current={entry.isCurrent ? 'true' : undefined}
            >
              <span className="detail-timeline-dot" />
              <span className="detail-timeline-info">
                <span className="detail-timeline-date">{entry.title}</span>
                <span className="detail-timeline-preview">{entry.preview}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
