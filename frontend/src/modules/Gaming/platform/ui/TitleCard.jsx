import React from 'react';
import './components.scss';

export function TitleCard({ title, subtitle = null }) {
  return (
    <div className="gp-titlecard" data-testid="title-card">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}
export default TitleCard;
