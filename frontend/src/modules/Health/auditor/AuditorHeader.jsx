import { Badge, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { formatUsd, formatWhen, spentToday } from './auditorFormat.js';

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
  if (!resource.data) return resource.error ? <ErrorState error={resource.error} onRetry={resource.reload} label="Auditor status" /> : <LoadingState label="Auditor status" rows={2} />;
  const { settings, runs = [], nextEligibleAt } = resource.data;
  const state = stateOf(settings);
  const lastRun = runs[0];
  const next = nextEligibleAt && Date.parse(nextEligibleAt) > now.getTime() ? formatWhen(nextEligibleAt, now) : 'now';
  const data = spend.data;
  const today = spentToday(data);
  const cap = data?.capUsd ?? settings.dailyCapUsd ?? null;
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
      {spend.error && !data ? <ErrorState error={spend.error} onRetry={spend.reload} label="Auditor spend" /> : null}
      {data ? <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Fact label="Today">
          {cap == null ? `${formatUsd(today, 2)} today` : `${formatUsd(today, 2)} of ${formatUsd(cap, 2)} today`}
          {ledger ? <Text span size="xs" c="dimmed"> (includes failed runs)</Text> : null}
        </Fact>
        <Fact label="Last 7 days">{formatUsd(data.week, 2)}</Fact>
        <Fact label="This month">{formatUsd(data.month, 2)}</Fact>
      </SimpleGrid> : null}
    </Stack>
  </SectionCard>;
}

export default AuditorHeader;
