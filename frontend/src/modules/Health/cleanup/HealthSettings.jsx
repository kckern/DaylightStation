import { useState } from 'react';
import { Button, Group, Stack, Switch, Text, Table } from '@mantine/core';
import { SectionCard, Sheet, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { refreshHealthResources } from '../healthResources.js';
import { cleanupPath, useCleanup, CleanupQuestions, RepairPreview } from './CleanupQuestions.jsx';

const keyOf = row => row.uuid || row.id;
function Changes({ record }) {
  const fields = ['name', 'label', 'kind', 'parentId', 'icon', 'foodId', 'date', 'mealTime', 'amount', 'unit', 'grams', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
  const rows = [];
  for (const after of record.after || []) {
    const before = record.before?.find(row => keyOf(row) === keyOf(after));
    for (const field of fields) if (JSON.stringify(before?.[field]) !== JSON.stringify(after[field])) rows.push(
      <Table.Tr key={`${keyOf(after)}:${field}`}><Table.Td>{after.name || after.label || keyOf(after)} · {field}</Table.Td>
        <Table.Td>{String(before?.[field] ?? '—')}</Table.Td><Table.Td>{String(after[field] ?? '—')}</Table.Td></Table.Tr>);
  }
  return <Table.ScrollContainer minWidth={400}><Table><Table.Thead><Table.Tr><Table.Th>Field</Table.Th><Table.Th>Before</Table.Th><Table.Th>After</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows}</Table.Tbody></Table></Table.ScrollContainer>;
}

export function HealthSettings() {
  const resource = useCleanup();
  const [offset, setOffset] = useState(0);
  const history = useApiResource(`${cleanupPath}/history?offset=${offset}`, { swr: true });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mutate = async (path, body, method = 'POST') => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`${cleanupPath}/${path}`, body, method);
      resource.reload(); history.reload(); refreshHealthResources();
      if (path.startsWith('undo/')) setSelected(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  if (!resource.data) return resource.error ? <ErrorState error={resource.error} onRetry={resource.reload} label="Cleanup settings" /> : <LoadingState label="Cleanup settings" />;
  const settings = resource.data.settings;
  return <Stack gap="md">
    <SectionCard title="Nutrition cleanup">
      <Stack gap="md">
        <Text size="sm">Uses older meals as reference; only repairs today and yesterday. Never adds meals, deletes consumed food, or confirms pending captures. Changes and evidence are recorded below.</Text>
        <Switch label="Automatic cleanup" checked={settings.enabled} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, enabled: event.currentTarget.checked }, 'PATCH')} />
        <Switch label="Preview only — do not change food or send questions" checked={settings.dryRun} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, dryRun: event.currentTarget.checked }, 'PATCH')} />
        <Switch label="Also show questions in Telegram" checked={settings.telegram} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, telegram: event.currentTarget.checked }, 'PATCH')} />
        <Text size="sm" c="dimmed">Turning off automatic cleanup cancels active cleanup work. Questions remain available here. Successful repairs stay quiet.</Text>
        <Button variant="light" disabled={busy || resource.data.runs.some(run => ['queued', 'running', 'retry'].includes(run.status))} onClick={() => mutate('run', {})}>{settings.dryRun ? 'Preview cleanup now' : 'Run cleanup now'}</Button>
        {error ? <Text c="red" role="alert">{error}</Text> : null}
      </Stack>
    </SectionCard>
    <CleanupQuestions />
    <SectionCard title="Recent scans"><Stack gap="sm">
      {resource.data.runs.length ? resource.data.runs.map(run => <details key={run.id}>
        <summary>{new Date(run.createdAt).toLocaleString()} · {run.dryRun ? 'Preview' : 'Cleanup'} · {run.status}</summary>
        <Text size="sm">{run.summary || run.error || 'Waiting for results'}</Text>
        {(run.outcomes || []).map((outcome, i) => <Stack gap="xs" key={i}><Text size="sm">{outcome.status}{outcome.reason ? `: ${outcome.reason}` : ''}</Text><RepairPreview repair={outcome.proposal} /></Stack>)}
      </details>) : <Text size="sm" c="dimmed">No scans yet.</Text>}
    </Stack></SectionCard>
    <SectionCard title="Repair history"><Stack gap="sm">
      {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
      {!history.data && history.loading ? <LoadingState label="Repair history" /> : null}
      {history.data?.records.map(record => <Group key={record.id} justify="space-between"><Text size="sm">{new Date(record.at).toLocaleString()} · {record.reason}</Text><Button size="xs" variant="subtle" onClick={() => setSelected(record)}>Details</Button></Group>)}
      {history.data?.total === 0 ? <Text size="sm" c="dimmed">No repairs have been made.</Text> : null}
      <Group><Button variant="subtle" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</Button><Button variant="subtle" disabled={offset + 30 >= (history.data?.total || 0)} onClick={() => setOffset(offset + 30)}>Next</Button></Group>
    </Stack></SectionCard>
    {selected ? <Sheet open title="Repair details" onClose={() => { if (!busy) setSelected(null); }}><Stack gap="sm">
      <Text>{selected.reason}</Text><Text size="sm" c="dimmed">{selected.actor} · {selected.at}</Text>
      <Changes record={selected} />
      <details><summary>Evidence</summary><pre className="health-cleanup-evidence">{JSON.stringify(selected.evidence, null, 2)}</pre></details>
      <Text size="sm">Undo is available even for older repairs, unless a later edit conflicts. Confirmed captures must be edited from the food log.</Text>
      {error ? <Text c="red" role="alert">{error}</Text> : null}
      {!selected.undoOf ? <Button disabled={busy} loading={busy} onClick={() => mutate(`undo/${selected.id}`, { operationId: crypto.randomUUID() })}>Undo this repair</Button> : null}
    </Stack></Sheet> : null}
  </Stack>;
}
