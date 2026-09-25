import { useMemo, useState } from 'react';
import { ActionIcon, Menu } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { showDayStatus } from '../healthResources.js';

/**
 * An EMPTY meal's ⋯ menu: mark it skipped (a meal-level fast) or undo that.
 * Information for the coach only — "this meal was intentionally empty, don't
 * ask about it". It never closes the day and never moves the budget bar; the
 * day is still judged by its floor or a day-level Done/Fasted
 * (docs/reference/health/README.md, "Closing a day").
 */
export function MealFastToggle({ date, bucket, label, fasted = false, onChanged }) {
  const logger = useMemo(() => createAppLogger('health').child('meal-fast'), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const toggle = async () => {
    if (busy) return;
    const next = !fasted;
    setBusy(true); setError(null);
    logger.info('meal-fast.set.start', { date, meal: bucket, fasted: next });
    try {
      const result = await DaylightAPI('api/v1/health/nutrition/meal-fast', { date, meal: bucket, fasted: next }, 'POST');
      showDayStatus(date, result);
      logger.info('meal-fast.set.success', { date, meal: bucket, fasted: next });
      onChanged?.();
    } catch (err) {
      logger.warn('meal-fast.set.failed', { date, meal: bucket, fasted: next, error: err?.message });
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Menu position="bottom-end">
      <Menu.Target><ActionIcon className="health-meal__capture-btn" variant="subtle" aria-label={`${label} skip options`} loading={busy}>⋯</ActionIcon></Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={toggle}>{fasted ? `Undo skipped ${label}` : `Mark ${label} as skipped (fasted)`}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
    {error ? <span className="health-meal__fast-error" role="alert">{error}</span> : null}
  </>;
}

export default MealFastToggle;
