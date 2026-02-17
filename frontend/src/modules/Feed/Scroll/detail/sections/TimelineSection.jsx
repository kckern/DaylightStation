export default function TimelineSection({ data, onNavigateToItem }) {
  if (!data?.items?.length) return null;

  return (
    <div className="detail-timeline">
      {data.label && <div className="detail-timeline-label">{data.label}</div>}
      <ol className="detail-timeline-list">
        {data.items.map(entry => (
          <li
            key={entry.id}
            className={`detail-timeline-entry${entry.isCurrent ? ' detail-timeline-entry--current' : ''}`}
            onClick={entry.isCurrent ? undefined : () => onNavigateToItem?.(entry)}
          >
            <span className="detail-timeline-dot" />
            <div className="detail-timeline-info">
              <span className="detail-timeline-date">{entry.title}</span>
              <span className="detail-timeline-preview">{entry.preview}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
