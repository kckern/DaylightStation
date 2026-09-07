import { nutrientSummary } from '@shared-contracts/nutrition/countedRows.mjs';

import { PortionControl } from './PortionControl.jsx';
import { usePortionControl } from './usePortionDraft.js';
const labels = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const shortLabels = { protein: 'P', carbs: 'C', fat: 'F' };

export function MacroBadges({ rows, className = '', showLabels = false, editRow = null }) {
  const control = usePortionControl();
  return <span className={`health-macros ${className}`}>
    {Object.entries(nutrientSummary(rows)).map(([key, { value, covered, total }]) => {
      const partial = value !== null && covered < total;
      const label = `${labels[key]}: ${value === null ? 'unknown' : `${Math.round(value)} grams${partial ? ', some food has unknown nutrition' : ''}`}`;
      if (editRow && control) return <PortionControl key={key} row={editRow} field={key}
        className={`health-macro-badge health-macro-tone--${key}`}><span role="img" aria-label={label}>{value === null ? '—' : `${Math.round(value)}${partial ? '+' : ''}`}</span></PortionControl>;
      return <span key={key} className={`health-macro-badge health-macro-tone--${key}${showLabels ? ' health-macro-badge--labelled' : ''}`}
        data-short-label={showLabels ? shortLabels[key] : undefined} role="img" aria-label={label} title={label}>
        <span>{value === null ? '—' : `${Math.round(value)}${partial ? '+' : ''}`}</span>
      </span>;
    })}
  </span>;
}
