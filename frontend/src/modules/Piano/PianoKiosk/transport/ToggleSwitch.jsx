import React from 'react';

/**
 * ToggleSwitch — kiosk on/off switch row: text label on the left, sliding
 * track on the right. The whole row is one ≥48px tap target (touch UI: no
 * tiny thumbs to hit). First consumer: the View sheet's Keyboard row.
 */
export default function ToggleSwitch({ label, checked, onChange, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      className={`piano-toggle${checked ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => onChange?.(!checked)}
    >
      <span className="piano-toggle__label">{label}</span>
      <span className="piano-toggle__track" aria-hidden="true"><span className="piano-toggle__thumb" /></span>
    </button>
  );
}
