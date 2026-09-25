import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Group, NumberInput, Select, Stack, Switch, Text, UnstyledButton } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState, EmptyState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import getLogger from '../../../lib/logging/Logger.js';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { changeValue } from '../cleanup/RepairChanges.jsx';
import { TRIGGER_LABELS, formatDuration, formatUsd, formatWhen, runCounts, triggerLabel } from './auditorFormat.js';

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

/** "Rice · grams 100 → 150 (+2 more)" for a run's first recorded change, or null. */
export function firstChangeText(row) {
  const changes = (row.outcomes || []).filter(o => ['applied', 'proposed'].includes(o.status));
  const total = changes.reduce((sum, o) => sum + (o.changes?.length || 0) + (o.changesOmitted || 0), 0);
  const first = changes.find(o => o.changes?.length)?.changes[0];
  if (!first) return null;
  const more = total - 1;
  return `${first.name || first.id} · ${first.field} ${changeValue(first.from)} → ${changeValue(first.to)}${more > 0 ? ` (+${more} more)` : ''}`;
}

// Row content is spans only: the whole row is one button.
const Line = ({ className = '', children }) => <Text component="span" size="xs" className={`health-auditor-run__line ${className}`.trim()}>{children}</Text>;

function RunRow({ row, onOpen }) {
  const failed = row.status === 'failed';
  const change = firstChangeText(row);
  return <UnstyledButton className="health-auditor-run" onClick={() => onOpen({ runId: row.runId, at: row.at })}>
    <span className="health-auditor-run__head">
      <Text component="span" size="sm" fw={600}>{formatWhen(row.at)}</Text>
      <Text component="span" size="sm" className="health-auditor-run__cost">{formatUsd(row.costUsd)}</Text>
    </span>
    <span className="health-auditor-run__chips">
      {(row.trigger || []).map(kind => <Badge component="span" key={kind} size="xs" variant="light">{triggerLabel(kind)}</Badge>)}
      {row.dryRun ? <Badge component="span" size="xs" variant="outline">Preview</Badge> : null}
      {row.backfilled ? <Badge component="span" size="xs" variant="outline">from transcript</Badge> : null}
    </span>
    <Line className={failed ? 'health-auditor-run__failed' : 'health-auditor-run__meta'}>
      {failed ? 'Failed' : 'Completed'} · {row.model || 'unknown model'} · {formatDuration(row.at, row.completedAt)}
    </Line>
    <Line>{countsText(row)}</Line>
    {change ? <Line className="health-auditor-run__meta">{change}</Line> : null}
  </UnstyledButton>;
}

function SkipRow({ row }) {
  return <div className="health-auditor-run health-auditor-run--skipped">
    <Text size="xs">{formatWhen(row.at)} · {skipText(row)}</Text>
  </div>;
}

/**
 * One page of the journal; the last page offers "Load more". `onShown`
 * reports how many rows survive the min-cost filter, so the timeline can say
 * when none on any loaded page do.
 */
function JournalPage({ filters, offset, minCost, isLast, onMore, onOpen, onShown }) {
  const page = useApiResource(journalPath({ ...filters, offset }), { swr: true });
  const rows = (page.data?.rows || []).filter(row => minCost == null || (row.runId && (row.costUsd ?? 0) >= minCost));
  const shown = page.data ? rows.length : null;
  useEffect(() => { onShown(offset, shown); }, [onShown, offset, shown]);
  useEffect(() => () => onShown(offset, null), [onShown, offset]);
  if (!page.data) return page.error ? <ErrorState error={page.error} onRetry={page.reload} label="Run timeline" /> : <LoadingState label="Run timeline" />;
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
  const [shown, setShown] = useState({});
  const onShown = useCallback((offset, n) => setShown(current => (current[offset] === n ? current : { ...current, [offset]: n })), []);
  const filters = useMemo(() => ({ changed, trigger }), [changed, trigger]);
  const cost = typeof minCost === 'number' && minCost > 0 ? minCost : null;
  const counts = Array.from({ length: pages }, (_, i) => shown[i * PAGE_SIZE]);
  const filteredEmpty = cost != null && counts.every(n => n === 0);
  return <SectionCard title="Runs">
    <Stack gap="sm">
      <Group gap="sm" align="flex-end">
        <Switch label="Changed something" checked={changed} onChange={event => {
          const next = event.currentTarget.checked; setChanged(next); setPages(1); logger.debug('health-auditor.filter', { changed: next });
        }} />
        <Select label="Trigger" placeholder="All triggers" data={TRIGGER_OPTIONS} value={trigger} clearable size="xs"
          onChange={value => { setTrigger(value); setPages(1); logger.debug('health-auditor.filter', { trigger: value }); }} />
        <NumberInput label="Min cost ($)" value={minCost} min={0} step={0.01} decimalScale={4} size="xs" w={110}
          onChange={value => { setMinCost(value); logger.debug('health-auditor.filter', { minCost: value }); }} />
      </Group>
      <Stack gap="xs">
        {filteredEmpty ? <EmptyState title={`No runs at or above ${formatUsd(cost)} on the loaded pages`} /> : null}
        {Array.from({ length: pages }, (_, i) => <JournalPage key={`${changed}:${trigger}:${i}`} filters={filters}
          offset={i * PAGE_SIZE} minCost={cost} isLast={i === pages - 1} onMore={() => setPages(pages + 1)} onOpen={onOpen} onShown={onShown} />)}
      </Stack>
    </Stack>
  </SectionCard>;
}

export default RunTimeline;
