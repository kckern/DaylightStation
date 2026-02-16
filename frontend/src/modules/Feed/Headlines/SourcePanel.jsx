import './Headlines.scss';

export function SourcePanel({ source, label, items }) {
  return (
    <div className="source-panel">
      <div className="source-panel-header">
        <h3>{label}</h3>
        <span className="source-panel-count">{items.length}</span>
      </div>
      <div className="source-panel-items">
        {items.map((item, i) => (
          <a
            key={i}
            className="headline-row"
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="headline-title">{item.title}</span>
            {item.desc && <span className="headline-desc">{item.desc}</span>}
          </a>
        ))}
        {items.length === 0 && (
          <div className="headline-empty">No headlines</div>
        )}
      </div>
    </div>
  );
}
