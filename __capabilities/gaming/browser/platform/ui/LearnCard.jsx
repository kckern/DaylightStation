import React from 'react';
import "./components.scss";

// The optional "learn" note a game shows after an answer (e.g. the verse a clue
// came from). Game-agnostic: takes only the content's `learn` object.
function textSize(text) {
  const len = (text || '').length;
  if (len > 220) return 'sm';
  if (len > 110) return 'md';
  return 'lg';
}

export function LearnCard({ learn }) {
  if (!learn?.text) return null;
  return (
    <figure className="gp-learn" data-testid="learn-card">
      {learn.ref && (
        <figcaption className="gp-learn__ref">
          {learn.ref}
          {learn.translation && <span className="gp-learn__translation">{learn.translation}</span>}
        </figcaption>
      )}
      <blockquote className={`gp-learn__text gp-learn__text--${textSize(learn.text)}`}>{learn.text}</blockquote>
      {learn.note && <p className="gp-learn__note">{learn.note}</p>}
    </figure>
  );
}
export default LearnCard;
