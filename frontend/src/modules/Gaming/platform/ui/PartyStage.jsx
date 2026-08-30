import React from 'react';
import './components.scss';

export function PartyStage({ children, theme = null, phase = null, className = '' }) {
  return (
    <section
      className={`gp-stage${className ? ` ${className}` : ''}`}
      data-gp-theme={theme || undefined}
      data-phase={phase || undefined}
    >
      {children}
    </section>
  );
}

export default PartyStage;
