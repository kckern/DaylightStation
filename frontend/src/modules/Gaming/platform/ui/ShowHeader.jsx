import React from 'react';
import './components.scss';

export function ShowHeader({ eyebrow = null, title, status = null }) {
  return (
    <header className="gp-show-header">
      <span className="gp-show-header__eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <span className="gp-show-header__status">{status}</span>
    </header>
  );
}

export default ShowHeader;
