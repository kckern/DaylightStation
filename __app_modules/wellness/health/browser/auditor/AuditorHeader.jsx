import { Badge, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState, useRetryRegion } from "../../../../../frontend/src/lib/ui/index.js";
import { formatUsd, formatWhen, spentToday } from "./auditorFormat.js";

const stateOf = settings => (!settings.enabled ? 'Off' : settings.dryRun ? 'Preview only' : 'On');

function Fact({ label, children }) {
  return <Stack gap={0}>
    <Text size="xs" c="dimmed">{label}</Text>
    <Text size="sm">{children}</Text>
  </Stack>;
}

/**
 * Where the auditor stands: on/off, model, last and next run, and spend
 * against the daily cap. `resource` is the cleanup status poll, `spend` the
 * spend summary.
 */
export function AuditorHeader({ resource, spend, now = new Date() }) {
  const { data } = resource;
  const { regionProps, retry } = useRetryRegion(resource.reload, !data && resource.loading);
  return <section {...regionProps} aria-label="Auditor status">
    {data ? <AuditorSummary status={data} spend={spend} now={now} />
      : resource.error ? <ErrorState error={resource.error} onRetry={retry} label="Auditor status" />
      : <LoadingState label="Auditor status" rows={2} />}
  </section>;
}

function AuditorSummary({ status, spend, now }) {
  const { settings, runs = [], nextEligibleAt } = status;
  const state = stateOf(settings);
  const lastRun = runs[0];
  // Off: nothing is eligible. Never run: no gap to wait out yet, and no history to measure from.
  const next = !settings.enabled ? 'Off' : !lastRun && !nextEligibleAt ? '—'
    : nextEligibleAt && Date.parse(nextEligibleAt) > now.getTime() ? formatWhen(nextEligibleAt, now) : 'now';
  const data = spend.data;
  const { regionProps, retry } = useRetryRegion(spend.reload, !data && spend.loading);
  const today = spentToday(data);
  // The cap comes from the status poll, which a settings save updates at once; spend may lag a moment.
  const cap = settings.dailyCapUsd ?? null;
  const ledger = Number.isFinite(data?.ledgerTodayUsd);
  return <SectionCard title="Nutrition auditor" actions={<Group gap="xs">
    <Badge variant={state === 'On' ? 'filled' : 'light'} color={state === 'Off' ? 'gray' : undefined}>{state}</Badge>
    {data?.cappedToday ? <Badge color="var(--ds-danger)">Over cap</Badge> : null}
  </Group>}>
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Fact label="Model">{settings.model || '—'}</Fact>
        <Fact label="Last run">{lastRun ? formatWhen(lastRun.completedAt || lastRun.createdAt, now) : 'Never'}</Fact>
        <Fact label="Next eligible">{next}</Fact>
        <Fact label="Daily cap">{cap == null ? 'No daily cap' : formatUsd(cap, 2)}</Fact>
      </SimpleGrid>
      {data || spend.error || spend.loading ? <section {...regionProps} aria-label="Auditor spend summary">
        {data ? <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <Fact label="Today">
            {cap == null ? `${formatUsd(today, 2)} today` : `${formatUsd(today, 2)} of ${formatUsd(cap, 2)} today`}
            {ledger ? <Text span size="xs" c="dimmed"> (includes failed runs)</Text> : null}
          </Fact>
          <Fact label="Last 7 days">{formatUsd(data.week, 2)}</Fact>
          <Fact label="This month">{formatUsd(data.month, 2)}</Fact>
        </SimpleGrid> : spend.error ? <ErrorState error={spend.error} onRetry={retry} label="Auditor spend" />
          : <LoadingState label="Auditor spend" rows={1} />}
      </section> : null}
    </Stack>
  </SectionCard>;
}

export default AuditorHeader;
