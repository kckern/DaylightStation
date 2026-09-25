import { useState } from 'react';
import { Menu, UnstyledButton } from '@mantine/core';
import { IconCheck, IconMoon, IconChevronDown } from '@tabler/icons-react';
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
 * The day-close pill, in the budget headline: close the viewed day as "Done
 * logging" or "Fasted", or reopen it — a small outline pill with a menu, not a
 * banner (it used to be a full-width row under the meals). The health coach treats an unclosed day under the completeness
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
export function DayClosePill({ date, dayStatus, items = [], onChanged }) {
  const [busy, setBusy] = useState(null); // 'done' | 'fasting' | 'reopen' | null
  const [error, setError] = useState(null);
  const [errorFor, setErrorFor] = useState(date);
  if (errorFor !== date) { setErrorFor(date); setError(null); }

  if (!dayStatus) return null;
  const { status, minCalories } = dayStatus;
  const calories = Math.round(sumCounted(items, 'calories'));
  const isToday = date === dayStatus.today;
  // A skipped (fasted) meal already makes the day trusted — nothing to flag.
  const skippedMeal = (dayStatus.fastedMeals || []).length > 0;
  const flagged = !status && !skippedMeal && !isToday && calories < minCalories;
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

  const Icon = status === 'fasting' ? IconMoon : IconCheck;
  const text = status === 'fasting' ? 'Fasted'
    : status === 'done' ? 'Logging done'
      : flagged ? (calories > 0 ? `Only ${calories} cal logged` : 'Nothing logged')
        : 'Close day';
  const hint = flagged
    ? 'Coaching treats this day as incomplete until you close it.'
    : "Finished eating? Coaching then treats the day's totals as final. (Skipped a meal? Use its ⊘ icon.)";

  return (
    <span className="health-dayclose">
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <UnstyledButton data-testid="dayclose-pill" aria-busy={Boolean(busy)}
            className={['health-dayclose-pill', status && 'health-dayclose-pill--closed', flagged && 'health-dayclose-pill--flagged'].filter(Boolean).join(' ')}
            aria-label={status ? `${text}. Change` : `${text}. Close this day`}>
            <Icon size={13} aria-hidden="true" />
            <span>{text}</span>
            <IconChevronDown size={11} aria-hidden="true" />
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          {status ? (
            <Menu.Item onClick={() => set(null)}>Reopen day</Menu.Item>
          ) : <>
            <Menu.Label>{hint}</Menu.Label>
            <Menu.Item leftSection={<IconCheck size={14} />} onClick={() => set('done')}>Done logging</Menu.Item>
          </>}
        </Menu.Dropdown>
      </Menu>
      {error ? <span className="health-dayclose__error" role="alert">{error}</span> : null}
    </span>
  );
}

export default DayClosePill;
