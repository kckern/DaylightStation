import React from 'react';
import './components.scss';

export function InstructionCard({ eyebrow = null, title, children, footer = null }) {
  return (
    <section className="gp-instruction-card">
      {eyebrow && <span className="gp-instruction-card__eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {children && <div className="gp-instruction-card__body">{children}</div>}
      {footer && <footer>{footer}</footer>}
    </section>
  );
}

export default InstructionCard;
