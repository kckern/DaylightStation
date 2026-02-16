import './Scroll.scss';

export function ScrollCard({ item }) {
  const age = getAge(item.timestamp);

  return (
    <a
      className={`scroll-card scroll-card--${item.type}`}
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="scroll-card-source">
        <span className="scroll-card-source-label">{item.sourceLabel || item.source}</span>
        <span className="scroll-card-age">{age}</span>
      </div>
      <h3 className="scroll-card-title">{item.title}</h3>
      {item.desc && <p className="scroll-card-desc">{item.desc}</p>}
    </a>
  );
}

function getAge(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
