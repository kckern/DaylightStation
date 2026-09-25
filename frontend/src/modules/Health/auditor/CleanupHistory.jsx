import { useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { SectionCard, Sheet, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { refreshHealthResources } from '../healthResources.js';
import { cleanupPath, RepairPreview } from '../cleanup/CleanupQuestions.jsx';
import { RepairChanges } from '../cleanup/RepairChanges.jsx';

/**
 * The "Cleanup runs" and "Repair history" cards (moved from Health settings),
 * with the repair details sheet and its Undo. `resource` is the page's shared
 * cleanup status poll.
 */
export function CleanupHistory({ resource }) {
  const [offset, setOffset] = useState(0);
  const history = useApiResource(`${cleanupPath}/history?offset=${offset}`, { swr: true });
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const undo = async record => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`${cleanupPath}/undo/${record.id}`, { operationId: crypto.randomUUID() }, 'POST');
      resource.reload(); history.reload(); refreshHealthResources();
      setSelected(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const runs = resource.data?.runs || [];
  return <>
    <SectionCard title="Cleanup runs"><Stack gap="sm">
      <Text size="sm">{runs[0]?.summary || 'No completed cleanup summary yet.'}</Text>
      <details><summary>Run history ({runs.length})</summary>
      {runs.length ? runs.map(run => <details key={run.id}>
        <summary>{new Date(run.createdAt).toLocaleString()} · {run.dryRun ? 'Preview' : 'Cleanup'} · {run.status}</summary>
        <Text size="sm">{run.summary || run.error || 'Waiting for results'}</Text>
        {(run.outcomes || []).map((outcome, i) => <Stack gap="xs" key={i}><Text size="sm">{outcome.status}{outcome.reason ? `: ${outcome.reason}` : ''}</Text><RepairPreview repair={outcome.proposal} /></Stack>)}
      </details>) : <Text size="sm" c="dimmed">No cleanup runs yet.</Text>}
      </details>
    </Stack></SectionCard>
    <SectionCard title="Repair history"><Stack gap="sm">
      <details><summary>View repairs ({history.data?.total ?? '—'})</summary>
      {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
      {!history.data && history.loading ? <LoadingState label="Repair history" /> : null}
      {history.data?.records.map(record => <Group key={record.id} justify="space-between"><Text size="sm">{new Date(record.at).toLocaleString()} · {record.reason}</Text><Button size="xs" variant="subtle" onClick={() => setSelected(record)}>Details</Button></Group>)}
      {history.data?.total === 0 ? <Text size="sm" c="dimmed">No repairs have been made.</Text> : null}
      <Group><Button variant="subtle" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>Previous</Button><Button variant="subtle" disabled={offset + 30 >= (history.data?.total || 0)} onClick={() => setOffset(offset + 30)}>Next</Button></Group>
      </details>
    </Stack></SectionCard>
    {selected ? <Sheet open title="Repair details" onClose={() => { if (!busy) setSelected(null); }}><Stack gap="sm">
      <Text>{selected.reason}</Text><Text size="sm" c="dimmed">{selected.actor} · {selected.at}</Text>
      <RepairChanges record={selected} />
      <details><summary>Evidence</summary><pre className="health-cleanup-evidence">{JSON.stringify(selected.evidence, null, 2)}</pre></details>
      <Text size="sm">Undo is available even for older repairs, unless a later edit conflicts. Confirmed captures must be edited from the food log.</Text>
      {error ? <Text className="health-auditor__error" role="alert">{error}</Text> : null}
      {!selected.undoOf ? <Button disabled={busy} loading={busy} onClick={() => undo(selected)}>Undo this repair</Button> : null}
    </Stack></Sheet> : null}
  </>;
}

export default CleanupHistory;
