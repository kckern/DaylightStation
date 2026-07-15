import React from 'react';
import './components.scss';

export function clampWager(amount, { score, roundMax }) {
  const max = Math.max(score, roundMax);
  const n = Number.isFinite(amount) ? Math.floor(amount) : 5;
  return Math.min(Math.max(n, 5), max);
}

const STEP = 100;

export function WagerPanel({ teamName, score, roundMax, value, onChange, onConfirm }) {
  const bounds = { score, roundMax };
  return (
    <div className="gs-wager" data-testid="wager-panel">
      <div className="gs-wager__team">{teamName} — wager</div>
      <div className="gs-wager__row">
        <button type="button" onClick={() => onChange(clampWager(value - STEP, bounds))}>−{STEP}</button>
        <div className="gs-wager__amount">{clampWager(value, bounds).toLocaleString()}</div>
        <button type="button" onClick={() => onChange(clampWager(value + STEP, bounds))}>+{STEP}</button>
      </div>
      <button type="button" className="gs-wager__confirm" onClick={() => onConfirm(clampWager(value, bounds))}>
        Lock wager
      </button>
    </div>
  );
}
export default WagerPanel;
