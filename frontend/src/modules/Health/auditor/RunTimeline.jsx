import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Group, NumberInput, Select, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState, EmptyState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import getLogger from '../../../lib/logging/Logger.js';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { TRIGGER_LABELS, formatUsd, formatWhen, runCounts, triggerLabel } from './auditorFormat.js';

const PAGE_SIZE = 50;
const TRIGGER_OPTIONS = Object.entries(TRIGGER_LABELS).map(([value, label]) => ({ value, label }));

export function journalPath({ changed, trigger, offset = 0 }) {
  const params = new URLSearchParams();
  if (changed) params.set('changed', '1');
  if (trigger) params.set('trigger', trigger);
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return `${cleanupPath}/journal${query ? `?${query}` : ''}`;
}

export function skipText(row) {
  if (row.skipped === 'cap') return `Skipped: over daily cap (${formatUsd(row.spentUsd, 2)} of ${formatUsd(row.capUsd, 2)})`;
  if (row.skipped === 'filtered') return `Skipped: only switched-off triggers (${(row.kinds || []).map(triggerLabel).join(', ') || 'none'})`;
  return `Skipped: ${row.skipped}`;
}

function countsText(row) {
  const counts = runCounts(row);
  const parts = [['changed', counts.changed], ['proposed', counts.proposed], ['rejected', counts.rejected],
    ['blocked', counts.blocked], ['asked', counts.asked], ['suppressed', counts.suppressed]]
    .filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`);
  return parts.length ? parts.join(' · ') : 'Nothing changed';
}

function RunRow({ row, onOpen }) {
  const failed = row.status === 'failed';
  return <UnstyledButton className="health-auditor-run" onClick={() => onOpen({ runId: row.runId, at: row.at })}
    aria-label={`Run at ${formatWhen(row.at)}`}>
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" fw={600}>{formatWhen(row.at)}</Text>
      <Text size="sm" className="health-auditor-run__cost">{formatUsd(row.costUsd)}</Text>
    </Group>
    <Group gap={4}>
      {(row.trigger || []).map(kind => <Badge key={kind} size="xs" variant="light">{triggerLabel(kind)}</Badge>)}
      {row.dryRun ? <Badge size="xs" variant="outline">Preview</Badge> : null}
      {row.backfilled ? <Badge size="xs" variant="outline">from transcript</Badge> : null}
    </Group>
    <Text size="xs" className={failed ? 'health-auditor-run__failed' : 'health-auditor-run__meta'}>
      {failed ? 'Failed' : 'Completed'} · {row.model || 'unknown model'}
    </Text>
    <Text size="xs">{countsText(row)}</Text>
  </UnstyledButton>;
}

function SkipRow({ row }) {
  return <div className="health-auditor-run health-auditor-run--skipped">
    <Text size="xs">{formatWhen(row.at)} · {skipText(row)}</Text>
  </div>;
}

/** One page of the journal; the last page offers "Load more". */
function JournalPage({ filters, offset, minCost, isLast, onMore, onOpen }) {
  const page = useApiResource(journalPath({ ...filters, offset }), { swr: true });
  if (!page.data) return page.error ? <ErrorState error={page.error} onRetry={page.reload} label="Run timeline" /> : <LoadingState label="Run timeline" />;
  const rows = page.data.rows.filter(row => minCost == null || (row.runId && (row.costUsd ?? 0) >= minCost));
  if (offset === 0 && !page.data.rows.length) return <EmptyState title="No runs in this range" hint="Runs from the last seven days appear here." />;
  return <>
    {rows.map((row, i) => (row.runId
      ? <RunRow key={`${row.runId}:${row.at}`} row={row} onOpen={onOpen} />
      : <SkipRow key={`skip:${row.at}:${i}`} row={row} />))}
    {isLast && offset + PAGE_SIZE < page.data.total ? <Button variant="subtle" onClick={onMore}>Load more</Button> : null}
  </>;
}

/** The auditor's run journal, newest first, with filters and paging. */
export function RunTimeline({ onOpen }) {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const [changed, setChanged] = useState(false);
  const [trigger, setTrigger] = useState(null);
  const [minCost, setMinCost] = useState('');
  const [pages, setPages] = useState(1);
  const filters = useMemo(() => ({ changed, trigger }), [changed, trigger]);
  useEffect(() => { setPages(1); }, [filters]);
  const cost = typeof minCost === 'number' && minCost > 0 ? minCost : null;
  return <SectionCard title="Runs">
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <Switch label="Changed something" checked={changed} onChange={event => {
          const next = event.currentTarget.checked; setChanged(next); logger.debug('health-auditor.filter', { changed: next });
        }} />
        <Select label="Trigger" placeholder="All triggers" data={TRIGGER_OPTIONS} value={trigger} clearable size="xs"
          onChange={value => { setTrigger(value); logger.debug('health-auditor.filter', { trigger: value }); }} />
        <NumberInput label="Min cost ($)" value={minCost} min={0} step={0.01} decimalScale={4} size="xs" w={110}
          onChange={value => { setMinCost(value); logger.debug('health-auditor.filter', { minCost: value }); }} />
      </Group>
      <Stack gap="xs">
        {Array.from({ length: pages }, (_, i) => <JournalPage key={`${changed}:${trigger}:${i}`} filters={filters}
          offset={i * PAGE_SIZE} minCost={cost} isLast={i === pages - 1} onMore={() => setPages(pages + 1)} onOpen={onOpen} />)}
      </Stack>
    </Stack>
  </SectionCard>;
}

export default RunTimeline;
