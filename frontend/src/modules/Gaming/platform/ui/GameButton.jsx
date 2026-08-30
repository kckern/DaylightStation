import React from 'react';
import './components.scss';

export function GameButton({ tone = 'default', className = '', busy = false, children, disabled, ...props }) {
  return (
    <button
      type="button"
      className={`gp-button gp-button--${tone}${className ? ` ${className}` : ''}`}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...props}
    >
      {children}
    </button>
  );
}

export default GameButton;
