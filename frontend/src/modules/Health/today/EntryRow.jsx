import { UnstyledButton } from '@mantine/core';

const NOOM = { green: 'var(--ds-success)', yellow: 'var(--ds-warning)', orange: 'var(--ds-danger)' };

export function EntryRow({ row, onTap }) {
  const portion = [row.amount, row.unit].filter(Boolean).join(' ') || (row.grams ? `${row.grams} g` : '');
  return (
    <UnstyledButton className="health-row" onClick={() => onTap(row)}>
      <span className="health-row__dot" style={{ background: NOOM[row.color] || 'var(--ds-text-low)' }} />
      <span className="health-row__name">{row.name || row.item || row.label}</span>
      <span className="health-row__portion">{portion}</span>
      <span className="health-row__kcal">{Math.round(row.calories || 0)}</span>
    </UnstyledButton>
  );
}
export default EntryRow;
