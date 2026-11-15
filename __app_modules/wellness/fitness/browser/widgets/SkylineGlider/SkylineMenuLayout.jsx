import React from 'react';
import './SkylineMenuLayout.scss';

/** Finite menu space. Content can scroll without moving the player's controls. */
export default function SkylineMenuLayout({ variant, children, actions, utility = null, className = '' }) {
  return <div className={`skyline-menu-layout ${className}`} data-variant={variant}>
    <div className="skyline-menu-layout__grid">
      <div className="skyline-menu-layout__content" data-skyline-scroll tabIndex={0} role="region" aria-label="Game menu content">{children}</div>
      <div className="skyline-menu-layout__actions">{actions}</div>
      <div className="skyline-menu-layout__utility">{utility}</div>
    </div>
  </div>;
}
