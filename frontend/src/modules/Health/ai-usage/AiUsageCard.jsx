import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Anchor, Group, Stack, Table, Text } from '@mantine/core';
import getLogger from '../../../lib/logging/Logger.js';
import { SectionCard, StatCard, LoadingState, ErrorState, EmptyState } from '../../../lib/ui';
import { formatUsd } from '../auditor/auditorFormat.js';
import { DailyChart } from '../auditor/SpendPanel.jsx';
import { featureLabel, FEATURE_LINKS } from './aiUsageFormat.js';
import { useHealthAiUsage } from './useHealthAiUsage.js';

export const AI_USAGE_ANCHOR = 'ai-usage';

const shortDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A feature whose calls all went unpriced reads "cost unknown", never $0. */
export function featureCost(row) {
  return row.calls > 0 && row.unpriced === row.calls && !row.costUsd ? 'cost unknown' : formatUsd(row.costUsd, 2);
}

/** Readout for one day of the chart: the total, then its features by cost. */
function describeDay(day) {
  const parts = Object.entries(day.byFeature || {}).filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1])
    .map(([feature, usd]) => `${featureLabel(feature)} ${formatUsd(usd, 2)}`);
  return `${shortDate(day.date)}: ${formatUsd(day.total, 2)}${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}

function FeatureName({ feature, linkable }) {
  const to = linkable ? FEATURE_LINKS[feature] : null;
  return to ? <Anchor component={Link} to={to} size="sm">{featureLabel(feature)}</Anchor> : featureLabel(feature);
}

/**
 * Per-feature magnitude as a bar under each row: one hue (the Health accent),
 * length only. Features are too many for a categorical palette, so identity is
 * the row label, not a colour.
 */
function FeatureTable({ rows, linkable, compact }) {
  const peak = Math.max(0, ...rows.map(row => row.costUsd));
  return <Table.ScrollContainer minWidth={280}>
    <Table aria-label="Health AI cost by feature" className="health-ai-usage__table">
      <Table.Thead><Table.Tr>
        <Table.Th>Feature</Table.Th><Table.Th>Calls</Table.Th>{compact ? null : <Table.Th>Avg / call</Table.Th>}<Table.Th>Cost</Table.Th>
      </Table.Tr></Table.Thead>
      <Table.Tbody>{rows.map(row => <Table.Tr key={row.feature}>
        <Table.Td>
          <FeatureName feature={row.feature} linkable={linkable} />
          <div className="health-ai-usage__track" aria-hidden="true">
            <div className="health-ai-usage__fill" style={{ width: `${peak > 0 ? Math.max(2, (row.costUsd / peak) * 100) : 0}%` }} />
          </div>
        </Table.Td>
        <Table.Td>{row.calls}</Table.Td>
        {compact ? null : <Table.Td>{row.avgUsd == null ? 'cost unknown' : formatUsd(row.avgUsd)}</Table.Td>}
        <Table.Td>{featureCost(row)}</Table.Td>
      </Table.Tr>)}</Table.Tbody>
    </Table>
  </Table.ScrollContainer>;
}

function Totals({ data }) {
  return <Group gap="sm" grow className="health-ai-usage__totals">
    <StatCard compact label="Today" value={formatUsd(data.today, 2)} />
    <StatCard compact label="7 days" value={formatUsd(data.week, 2)} />
    <StatCard compact label="This month" value={formatUsd(data.month, 2)} />
  </Group>;
}

function BeforeTracking({ before }) {
  if (!before) return null;
  return <Text size="xs" className="health-ai-usage__note">
    Before tracking: {formatUsd(before.costUsd, 2)} across all apps ({plural(before.calls, 'call')}, not attributable to Health or any one app).
  </Text>;
}

/**
 * What Health's AI features cost (GET /health/ai-usage, 30 household days).
 * `compact` is the Settings version: totals, the top three features and a
 * link to the full card on the auditor page.
 */
export function AiUsageCard({ compact = false }) {
  const logger = useMemo(() => getLogger().child({ component: 'health-ai-usage' }), []);
  const usage = useHealthAiUsage();
  const location = useLocation();
  const cardRef = useRef(null);
  const onAuditorPage = location.pathname.startsWith('/health/auditor');
  const loaded = !!usage.data;

  useEffect(() => { logger.info('health-ai-usage.mounted', { compact }); }, [logger, compact]);
  useEffect(() => {
    if (usage.error) logger.warn('health-ai-usage.load-failed', { error: usage.error.message || String(usage.error) });
  }, [logger, usage.error]);
  useEffect(() => {
    if (!loaded) return;
    logger.debug('health-ai-usage.loaded', { features: usage.data.byFeature?.length ?? 0, month: usage.data.month });
    // Arriving from Settings' "See all" (…/auditor#ai-usage): bring the card into view once it has content.
    if (!compact && location.hash === `#${AI_USAGE_ANCHOR}`) cardRef.current?.scrollIntoView?.({ block: 'start' });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    if (!usage.data) return usage.error ? <ErrorState error={usage.error} onRetry={usage.reload} label="AI usage" /> : <LoadingState label="AI usage" />;
    const { byFeature = [], days = [], beforeTracking = null } = usage.data;
    if (!byFeature.length) return <Stack gap="sm">
      <EmptyState title="No Health AI use in the last 30 days" />
      <BeforeTracking before={beforeTracking} />
    </Stack>;
    const calls = byFeature.reduce((sum, row) => sum + row.calls, 0);
    const total = days.reduce((sum, day) => sum + day.total, 0);
    if (compact) return <Stack gap="sm">
      <Totals data={usage.data} />
      <FeatureTable rows={byFeature.slice(0, 3)} linkable compact />
      <Group justify="flex-end">
        <Anchor component={Link} to={`/health/auditor#${AI_USAGE_ANCHOR}`} size="sm">See all</Anchor>
      </Group>
    </Stack>;
    return <Stack gap="sm">
      <Totals data={usage.data} />
      <Text size="sm">Last 30 days: {formatUsd(total, 2)} over {plural(calls, 'call')}.</Text>
      <DailyChart days={days.map(day => ({ ...day, costUsd: day.total }))} describe={describeDay}
        label="Daily Health AI cost, last 30 days. Arrow keys move between days." />
      <FeatureTable rows={byFeature} linkable={!onAuditorPage} />
      <BeforeTracking before={beforeTracking} />
    </Stack>;
  };

  return <div id={compact ? undefined : AI_USAGE_ANCHOR} ref={cardRef} className="health-ai-usage">
    <SectionCard title="AI usage">{body()}</SectionCard>
  </div>;
}

export default AiUsageCard;
