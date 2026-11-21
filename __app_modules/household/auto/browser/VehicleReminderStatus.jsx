import { ErrorState, LoadingState, useRetryRegion } from '@/lib/ui';

const missingRemindersError = new Error('The vehicle reminder list was not returned.');

/** Keep the shared vehicle overview retryable without blocking its consumers. */
export default function VehicleReminderStatus({ overview, reminders }) {
  const busy = overview.loading || overview.revalidating;
  const unavailable = overview.error || (overview.hasResult && reminders === null && !busy);
  const { regionProps, retry } = useRetryRegion(overview.reload, busy);

  return (
    <section {...regionProps} aria-label="Vehicle reminder status">
      {unavailable
        ? <ErrorState
          error={overview.error || missingRemindersError}
          onRetry={retry}
          label="Vehicle reminders"
        />
        : !overview.hasResult || busy
          ? <LoadingState label="vehicle reminders" rows={1} />
          : null}
    </section>
  );
}
