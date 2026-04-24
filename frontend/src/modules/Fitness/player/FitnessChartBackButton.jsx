import React from 'react';
import { resolveBackButtonLabel } from './FitnessChartBackButton.js';

export { resolveBackButtonLabel };

/**
 * FitnessChartBackButton — small presentational button rendered in the
 * .fitness-chart-overlay wrapper (NOT inside FitnessChart).
 */
export default function FitnessChartBackButton({ onReturn, historyMode = false }) {
  const { label, title, ariaLabel } = resolveBackButtonLabel({ historyMode });
  return (
    <button
      type="button"
      className="fitness-chart-back-button"
      onClick={onReturn}
      title={title}
      aria-label={ariaLabel}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span className="fitness-chart-back-button__label">{label}</span>
    </button>
  );
}
