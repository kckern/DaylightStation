import React from 'react';
import './components.scss';

// Clues range from one-liners to paragraph length; bucket the type size by
// character count so long prompts still fit the fixed 960x540 frame.
function promptSize(prompt) {
  const len = (prompt || '').length;
  if (len > 200) return 'sm';
  if (len > 120) return 'md';
  return 'lg';
}

export function RevealPanel({ prompt, revealed = false, answer = null }) {
  return (
    <div className="gs-reveal" data-testid="reveal-panel">
      <div className={`gs-reveal__prompt gs-reveal__prompt--${promptSize(prompt)}`}>{prompt}</div>
      {revealed && answer && <div className="gs-reveal__answer">{answer}</div>}
    </div>
  );
}
export default RevealPanel;
