import { Menu, UnstyledButton } from '@mantine/core';
import { IconCheck, IconMoon, IconChevronDown } from '@tabler/icons-react';
import { ActionMenu } from '@/lib/ui';
import { sumCounted } from "../../portable/contracts/nutrition/countedRows.mjs";

/**
 * The day-close pill, in the budget headline: close the viewed day as "Done
 * logging" or reopen it — a small outline pill with a menu, not a banner (it
 * used to be a full-width row under the meals). The health coach treats an
 * unclosed day under the completeness threshold as MISSING DATA (meals not
 * logged), not low intake — this is the web equivalent of the nutribot /done,
 * /fast and /reopen commands, and writes the same record they do.
 *
 * Shown for today (always — a day in progress may be closed early, e.g. a
 * fast), for any closed day (to reopen it), and for a past day under the
 * threshold. A complete past day needs nothing, so it shows nothing.
 *
 * The coach reads the head of household's closures; a second signed-in adult
 * closes their own day file, which only their own coaching would read.
 *
 * Submission lifecycle and server updates are owned by TodayView so pending
 * work survives this pill being removed during a cold date load.
 *
 * @param {Object} props
 * @param {string} props.date - viewed day, YYYY-MM-DD
 * @param {{status: 'done'|'fasting'|null, minCalories: number, today?: string}|null} props.dayStatus - from GET /day
 * @param {Array} props.items - the day's rows (counted the same way the coach counts them)
 * @param {boolean} props.busy
 * @param {string|null} props.error
 * @param {(status: 'done'|null) => void} props.onSet
 */
export function DayClosePill({ date, dayStatus, items = [], busy = false, error = null, onSet = () => {} }) {
  if (!dayStatus) return null;
  const { status, minCalories } = dayStatus;
  const calories = Math.round(sumCounted(items, 'calories'));
  const isToday = date === dayStatus.today;
  // A skipped (fasted) meal already makes the day trusted — nothing to flag.
  const skippedMeal = (dayStatus.fastedMeals || []).length > 0;
  const flagged = !status && !skippedMeal && !isToday && calories < minCalories;
  if (!status && !isToday && !flagged) return null;

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
      <ActionMenu position="bottom-end" withinPortal trigger={
        <UnstyledButton data-testid="dayclose-pill" aria-busy={Boolean(busy)}
          className={['health-dayclose-pill', status && 'health-dayclose-pill--closed', flagged && 'health-dayclose-pill--flagged'].filter(Boolean).join(' ')}
          aria-label={status ? `${text}. Change` : `${text}. Close this day`}>
          <Icon size={13} aria-hidden="true" />
          <span>{text}</span>
          <IconChevronDown size={11} aria-hidden="true" />
        </UnstyledButton>
      }>
        {status ? (
          <Menu.Item disabled={busy} onClick={() => onSet(null)}>Reopen day</Menu.Item>
        ) : <>
          <Menu.Label>{hint}</Menu.Label>
          <Menu.Item disabled={busy} leftSection={<IconCheck size={14} />} onClick={() => onSet('done')}>Done logging</Menu.Item>
        </>}
      </ActionMenu>
      {error ? <span className="health-dayclose__error" role="alert">{error}</span> : null}
    </span>
  );
}

export default DayClosePill;
