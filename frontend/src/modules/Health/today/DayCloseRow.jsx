import { useState } from 'react';
import { Button } from '@mantine/core';
import { IconCheck, IconMoon } from '@tabler/icons-react';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('day-close');

/**
 * End-of-day row: close the viewed day as "Done logging" or "Fasted", or
 * reopen it. The health coach treats an unclosed day under the completeness
 * threshold as MISSING DATA (meals not logged), not low intake — this is the
 * web equivalent of the nutribot /done and /fast commands, and writes the same
 * record they do.
 *
 * @param {Object} props
 * @param {string} props.date - viewed day, YYYY-MM-DD
 * @param {string} props.today
 * @param {{status: 'done'|'fasting'|null, minCalories: number}|null} props.dayStatus - from GET /day
 * @param {Array} props.items - the day's rows (counted the same way the budget counts them)
 * @param {() => void} props.onChanged
 */
export function DayCloseRow({ date, today, dayStatus, items = [], onChanged }) {
  const [busy, setBusy] = useState(null); // 'done' | 'fasting' | 'reopen' | null
  const [error, setError] = useState(null);
  // Optimistic: the day reloads in the background; show the new state now.
  const [override, setOverride] = useState(null);
  const [overrideFor, setOverrideFor] = useState(date);
  if (overrideFor !== date) { setOverrideFor(date); setOverride(null); setError(null); }

  if (!dayStatus) return null;
  // The reloaded day has caught up with the change (or /done came from Telegram).
  if (override && dayStatus.status === override.status) setOverride(null);
  const status = override ? override.status : dayStatus.status;
  const minCalories = dayStatus.minCalories;
  const calories = Math.round(sumCounted(items, 'calories'));
  const isToday = date === today;

  const set = async (next) => {
    const action = next ?? 'reopen';
    if (busy) return;
    setBusy(action); setError(null);
    logger.info('day-status.set.start', { date, status: next });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/day-status', { date, status: next }, 'POST');
      setOverride({ status: result?.status ?? next });
      logger.info('day-status.set.success', { date, status: result?.status ?? next });
      onChanged?.();
    } catch (err) {
      logger.warn('day-status.set.failed', { date, status: next, error: err?.message });
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (status) {
    return (
      <div className={`health-dayclose health-dayclose--closed health-dayclose--${status}`} role="status">
        <span className="health-dayclose__icon" aria-hidden="true">
          {status === 'fasting' ? <IconMoon size={18} /> : <IconCheck size={18} />}
        </span>
        <span className="health-dayclose__line">
          {status === 'fasting' ? 'Fasting day' : 'Logging done'}
          <span className="health-dayclose__sub"> — the coach counts these totals as final.</span>
        </span>
        <Button size="sm" variant="subtle" loading={busy === 'reopen'} disabled={Boolean(busy)}
          onClick={() => set(null)}>Reopen</Button>
        {error ? <span className="health-dayclose__error" role="alert">{error}</span> : null}
      </div>
    );
  }

  // Mid-day, under the threshold is just a day in progress — never flag it.
  const flagged = !isToday && calories < minCalories;
  const line = flagged
    ? `Only ${calories} cal logged. The coach treats this day as incomplete unless you close it.`
    : (isToday ? 'Finished eating for today?' : 'Finished logging this day?');

  return (
    <div className={`health-dayclose${flagged ? ' health-dayclose--flagged' : ''}`}>
      <span className="health-dayclose__line">{line}</span>
      <div className="health-dayclose__actions">
        <Button size="sm" variant="light" leftSection={<IconCheck size={16} />}
          loading={busy === 'done'} disabled={Boolean(busy)} onClick={() => set('done')}>Done logging</Button>
        <Button size="sm" variant="light" leftSection={<IconMoon size={16} />}
          loading={busy === 'fasting'} disabled={Boolean(busy)} onClick={() => set('fasting')}>Fasted</Button>
      </div>
      {error ? <span className="health-dayclose__error" role="alert">{error}</span> : null}
    </div>
  );
}

export default DayCloseRow;
