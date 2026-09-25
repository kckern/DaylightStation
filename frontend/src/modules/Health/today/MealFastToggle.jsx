import { useMemo, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconCircleOff } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { showDayStatus } from '../healthResources.js';

/**
 * A meal's "didn't eat anything here" toggle: one small ⊘ icon beside the
 * meal heading. Marking a meal skipped (a meal-level fast) closes that meal —
 * the empty slot is intentional — and makes the day's total trusted, like
 * "Done logging" (docs/reference/health/README.md, "Closing a day"). Tapping
 * it again undoes the skip.
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

  const action = fasted ? `Undo skipped ${label}` : `Skipped ${label} — didn't eat anything`;
  return <>
    <Tooltip label={action} withinPortal openDelay={400}>
      <ActionIcon className={`health-meal__skip${fasted ? ' health-meal__skip--on' : ''}`} variant="subtle" size="sm"
        aria-label={action} aria-pressed={fasted} loading={busy} onClick={toggle}>
        <IconCircleOff size={15} aria-hidden="true" />
      </ActionIcon>
    </Tooltip>
    {error ? <span className="health-meal__fast-error" role="alert">{error}</span> : null}
  </>;
}

export default MealFastToggle;
