import { nutrientSummary } from '@shared-contracts/nutrition/countedRows.mjs';

const labels = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const shortLabels = { protein: 'P', carbs: 'C', fat: 'F' };

export function MacroBadges({ rows, className = '', showLabels = false }) {
  return <span className={`health-macros ${className}`}>
    {Object.entries(nutrientSummary(rows)).map(([key, { value, covered, total }]) => {
      const partial = value !== null && covered < total;
      const label = `${labels[key]}: ${value === null ? 'unknown' : `${Math.round(value)} grams${partial ? ', some food has unknown nutrition' : ''}`}`;
      return <span key={key} className={`health-macro-badge health-macro-tone--${key}${showLabels ? ' health-macro-badge--labelled' : ''}`}
        data-short-label={showLabels ? shortLabels[key] : undefined} role="img" aria-label={label} title={label}>
        <span>{value === null ? '—' : `${Math.round(value)}${partial ? '+' : ''}`}</span>
      </span>;
    })}
  </span>;
}
