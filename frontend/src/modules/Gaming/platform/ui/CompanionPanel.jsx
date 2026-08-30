import React from 'react';
import './components.scss';

export function CompanionPanel({ title = 'Host controller', url, size = 96 }) {
  if (!url) return null;
  const src = `/api/v1/qrcode?data=${encodeURIComponent(url)}&size=${Math.max(96, size * 2)}`;
  return (
    <aside className="gp-companion" aria-label={title}>
      <img src={src} alt={`Scan to open ${title.toLowerCase()}`} width={size} height={size} />
      <span>{title}</span>
    </aside>
  );
}

export default CompanionPanel;
