import { nutrientSummary } from '@shared-contracts/nutrition/countedRows.mjs';

const labels = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

export function MacroBadges({ rows, className = '' }) {
  return <span className={`health-macros ${className}`}>
    {Object.entries(nutrientSummary(rows)).map(([key, { value, covered, total }]) => {
      const partial = value !== null && covered < total;
      const label = `${labels[key]}: ${value === null ? 'unknown' : `${Math.round(value)} grams${partial ? ', some food has unknown nutrition' : ''}`}`;
      return <span key={key} className={`health-macro-badge health-macro-tone--${key}`} role="img" aria-label={label} title={label}>
        {value === null ? '—' : `${Math.round(value)}${partial ? '+' : ''}`}
      </span>;
    })}
  </span>;
}
