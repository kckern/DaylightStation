import { UnstyledButton } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('entry-row');

const NOOM = { green: 'var(--ds-success)', yellow: 'var(--ds-warning)', orange: 'var(--ds-danger)' };

export function EntryRow({ row, onTap, onConfirm }) {
  const portion = [row.amount, row.unit].filter(Boolean).join(' ') || (row.grams ? `${row.grams} g` : '');
  // The API serves an EFFECTIVE settled flag per row. Absent or `true` means
  // settled — only an explicit `false` means unsettled. Never treat a
  // missing key as unsettled (older/other row shapes lack the field).
  const unsettled = row.settled === false;

  const confirm = async (e) => {
    e.stopPropagation();
    try {
      await DaylightAPI(`api/v1/health/nutrilist/${row.uuid}`, { settled: true }, 'PUT');
      logger.info('entry.confirm', { uuid: row.uuid });
      onConfirm?.(row);
    } catch (err) {
      logger.error('entry.confirm_failed', { uuid: row.uuid, error: err?.message });
    }
  };

  return (
    <div className={`health-row-line${unsettled ? ' health-row-line--unsettled' : ''}`}>
      <UnstyledButton className={`health-row${unsettled ? ' health-row--unsettled' : ''}`} onClick={() => onTap(row)}>
        <span className="health-row__dot" style={{ background: NOOM[row.color] || 'var(--ds-text-low)' }} />
        <span className="health-row__name">{row.name || row.item || row.label}</span>
        <span className="health-row__portion">{portion}</span>
        <span className="health-row__kcal">{Math.round(row.calories || 0)}</span>
        {/* Text badge, not color alone — perceivable non-visually and in
            greyscale. Static text; no aria-live, so it never spams. */}
        {unsettled ? <span className="health-row__badge">Unconfirmed</span> : null}
      </UnstyledButton>
      {unsettled ? (
        <UnstyledButton className="health-row__confirm" aria-label="Confirm entry" onClick={confirm}>
          <span aria-hidden="true">✓</span>
        </UnstyledButton>
      ) : null}
    </div>
  );
}
export default EntryRow;
