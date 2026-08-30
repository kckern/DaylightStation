import React from 'react';
import '@gaming-ui/components.scss';
import { clampWager } from './wager.js';

const STEP = 100;

export function WagerPanel({ teamName, score, roundMax, value, onChange, onConfirm }) {
  const bounds = { score, roundMax };
  return (
    <div className="gp-wager" data-testid="wager-panel">
      <div className="gp-wager__team">{teamName} — wager</div>
      <div className="gp-wager__row">
        <button type="button" onClick={() => onChange(clampWager(value - STEP, bounds))}>−{STEP}</button>
        <div className="gp-wager__amount">{clampWager(value, bounds).toLocaleString()}</div>
        <button type="button" onClick={() => onChange(clampWager(value + STEP, bounds))}>+{STEP}</button>
      </div>
      <button type="button" className="gp-wager__confirm" onClick={() => onConfirm(clampWager(value, bounds))}>
        Lock wager
      </button>
    </div>
  );
}
export default WagerPanel;
