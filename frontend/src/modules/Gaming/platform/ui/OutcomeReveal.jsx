import React from 'react';
import './components.scss';

export function OutcomeReveal({ tone = 'neutral', eyebrow = null, title, children }) {
  return (
    <section className={`gp-outcome gp-outcome--${tone}`} role="status">
      {eyebrow && <span>{eyebrow}</span>}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default OutcomeReveal;
