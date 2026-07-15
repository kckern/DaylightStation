import React from 'react';
import './components.scss';

export function RevealPanel({ prompt, revealed = false, answer = null }) {
  return (
    <div className="gs-reveal" data-testid="reveal-panel">
      <div className="gs-reveal__prompt">{prompt}</div>
      {revealed && answer && <div className="gs-reveal__answer">{answer}</div>}
    </div>
  );
}
export default RevealPanel;
