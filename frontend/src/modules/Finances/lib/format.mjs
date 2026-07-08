/**
 * Canonical currency formatting + chart palette for all Finance UI.
 * This is the ONLY place these live — do not re-implement per file.
 */

export const formatAsCurrency = (value, abr) => {
  if (value == null || !isFinite(value)) return '$Ø';
  const isNegative = value < 0;
  const abs = Math.abs(value);
  if (abr === 'K') {
    const k = (abs / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${isNegative ? '-' : ''}$${k}K`;
  }
  const whole = abs.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${isNegative ? '-' : ''}$${whole}`;
};

/** Compact form for dense chart labels: "$450" under 1K, "$5K" above. */
export const formatCompactCurrency = (value) => {
  if (value == null || !isFinite(value)) return '$Ø';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(0)}K` : `${sign}$${Math.round(abs)}`;
};

/** Shared Finance chart palette. */
export const PALETTE = {
  spent: '#0077b6',
  spentDone: '#023e8a',
  over: '#c1121f',
  overDark: '#82000A',
  remaining: '#AAAAAA',
  gain: '#759c82',
  projectionOk: '#2a9d8f',
  projectionOver: '#780000',
  interest: '#ff9800',
  balance: '#4c8ffc',
  today: '#dc2626',
  income: '#304529',
  cashFlow: '#660000',
  dayToDay: '#432454',
};
