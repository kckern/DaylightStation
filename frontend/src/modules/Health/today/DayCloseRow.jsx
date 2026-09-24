import { useState } from 'react';
import { Button } from '@mantine/core';
import { IconCheck, IconMoon } from '@tabler/icons-react';
import { sumCounted } from '@shared-contracts/nutrition/countedRows.mjs';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { showDayStatus } from '../healthResources.js';

const logger = createAppLogger('health').child('day-close');

/**
 * `DaylightAPI` throws `HTTP 400: Bad Request - {"error":"…"}`. A refusal's
 * sentence is the part a person should read; anything else is a retry.
 */
function errorSentence(err) {
  if (err?.status >= 400 && err?.status < 500) {
    const body = String(err.message || '').split(' - ').slice(1).join(' - ');
    try { const parsed = JSON.parse(body); if (parsed?.error) return parsed.error; } catch { /* not JSON */ }
  }
  return 'Could not save. Try again.';
}

/**
 * End-of-day row: close the viewed day as "Done logging" or "Fasted", or
 * reopen it. The health coach treats an unclosed day under the completeness
 * threshold as MISSING DATA (meals not logged), not low intake — this is the
 * web equivalent of the nutribot /done, /fast and /reopen commands, and writes
 * the same record they do.
 *
 * Shown for today (always — a day in progress may be closed early, e.g. a
 * fast), for any closed day (to reopen it), and for a past day under the
 * threshold. A complete past day needs nothing, so it shows nothing.
 *
 * The coach reads the head of household's closures; a second signed-in adult
 * closes their own day file, which only their own coaching would read.
 *
 * @param {Object} props
 * @param {string} props.date - viewed day, YYYY-MM-DD
 * @param {{status: 'done'|'fasting'|null, minCalories: number, today?: string}|null} props.dayStatus - from GET /day
 * @param {Array} props.items - the day's rows (counted the same way the coach counts them)
 * @param {() => void} props.onChanged
 */
export function DayCloseRow({ date, dayStatus, items = [], onChanged }) {
  const [busy, setBusy] = useState(null); // 'done' | 'fasting' | 'reopen' | null
  const [error, setError] = useState(null);
  const [errorFor, setErrorFor] = useState(date);
  if (errorFor !== date) { setErrorFor(date); setError(null); }

  if (!dayStatus) return null;
  const { status, minCalories } = dayStatus;
  const calories = Math.round(sumCounted(items, 'calories'));
  const isToday = date === dayStatus.today;
  const flagged = !status && !isToday && calories < minCalories;
  if (!status && !isToday && !flagged) return null;

  const set = async (next) => {
    if (busy) return;
    setBusy(next ?? 'reopen'); setError(null);
    logger.info('day-status.set.start', { date, status: next });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/day-status', { date, status: next }, 'POST');
      // The server's answer is the truth: patch the cached day so the row (and
      // anything else reading it) updates now; the refetch follows.
      showDayStatus(date, result);
      logger.info('day-status.set.success', { date, status: result?.status ?? null });
      onChanged?.();
    } catch (err) {
      logger.warn('day-status.set.failed', { date, status: next, httpStatus: err?.status ?? null, error: err?.message });
      setError(errorSentence(err));
    } finally {
      setBusy(null);
    }
  };

  const errorLine = error ? <span className="health-dayclose__error" role="alert">{error}</span> : null;

  if (status) {
    return (
      <div className={`health-dayclose health-dayclose--closed health-dayclose--${status}`} role="status">
        <span className="health-dayclose__icon" aria-hidden="true">
          {status === 'fasting' ? <IconMoon size={18} /> : <IconCheck size={18} />}
        </span>
        <span className="health-dayclose__line">
          {status === 'fasting' ? 'Fasting day' : 'Logging done'}
          <span className="health-dayclose__sub"> · coaching treats this day's totals as final.</span>
        </span>
        <Button size="sm" variant="subtle" loading={busy === 'reopen'} disabled={Boolean(busy)}
          onClick={() => set(null)}>Reopen</Button>
        {errorLine}
      </div>
    );
  }

  const line = flagged
    ? `${calories > 0 ? `Only ${calories} cal logged.` : 'Nothing logged.'} Coaching treats this day as incomplete until you close it.`
    : 'Finished eating for today?';

  return (
    <div className={`health-dayclose${flagged ? ' health-dayclose--flagged' : ''}`}>
      <span className="health-dayclose__line">{line}</span>
      <div className="health-dayclose__actions">
        <Button size="sm" variant="light" leftSection={<IconCheck size={16} />}
          loading={busy === 'done'} disabled={Boolean(busy)} onClick={() => set('done')}>Done logging</Button>
        <Button size="sm" variant="light" leftSection={<IconMoon size={16} />}
          loading={busy === 'fasting'} disabled={Boolean(busy)} onClick={() => set('fasting')}>Fasted</Button>
      </div>
      {errorLine}
    </div>
  );
}

export default DayCloseRow;
