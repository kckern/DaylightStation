import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Badge, Button, Group, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter: every film that can have a filter, where it stands, and a
 * one-click pipeline run ("Build it" in
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const POLL_MS = 5000;

export const STAGE_LABELS = {
  rough: 'Rough', running: 'Running', refined: 'Refined', scenes: 'Scenes built',
  audited: 'Audited', machine: 'Machine-certified', parent: 'Parent-certified',
};
const STAGE_TONE = { rough: 'gray', running: 'blue', refined: 'gray', scenes: 'gray', audited: 'yellow', machine: 'teal', parent: 'green' };

export function runText(job, worker = null) {
  if (!job) return null;
  if (job.status === 'queued') return worker && !worker.alive ? 'Waiting for a filter worker' : 'Queued';
  if (job.status === 'running') return `Running: ${job.step || 'starting'}`;
  if (job.status === 'failed') return `Failed at ${job.step}${job.error ? `: ${job.error}` : ''}`;
  if (job.status === 'interrupted') return `Interrupted at ${job.step || 'start'}`;
  return null;
}
const active = (job) => job?.status === 'queued' || job?.status === 'running';

export function FilterLibrary() {
  const { data, loading, error, reload } = useApiResource(`${API}/library`, { label: 'content filter library', logger });
  const [stage, setStage] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const films = useMemo(() => data?.films ?? [], [data]);
  const anyActive = films.some((f) => active(f.job));

  useEffect(() => {
    if (!anyActive) return undefined;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [anyActive, reload]);

  const make = useCallback(async (film) => {
    setBusy(film.ratingKey); setNotice(null);
    try {
      const r = await DaylightAPI(`${API}/${encodeURIComponent(film.ratingKey)}/jobs`, { kind: 'make' }, 'POST');
      logger.info('job.queued', { ratingKey: film.ratingKey, runId: r?.run?.id ?? null });
      reload();
    } catch (err) {
      logger.warn('job.queue_failed', { ratingKey: film.ratingKey, error: err.message });
      setNotice(err.message || 'That did not work.');
    } finally { setBusy(null); }
  }, [reload]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return films.filter((f) => (!stage || f.stage === stage) && (!needle || String(f.title || '').toLowerCase().includes(needle)));
  }, [films, stage, q]);

  if (loading && !data) return <LoadingState label="content filter library" rows={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Content filter library" />;
  return (
    <SectionCard title="Content filter">
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap">
          <TextInput size="xs" aria-label="Search titles" placeholder="Search titles" value={q} onChange={(e) => setQ(e.currentTarget.value)} className="cf-library__search" />
          <Select size="xs" aria-label="Stage" placeholder="All stages" clearable value={stage} onChange={setStage}
            data={Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))} />
          <Text size="xs" c="dimmed">{shown.length} of {films.length} films</Text>
        </Group>
        {notice ? <Text size="sm" role="alert">{notice}</Text> : null}
        {data?.worker && !data.worker.alive && films.some((f) => f.job?.status === 'queued') ? (
          <Text size="sm" c="dimmed">No filter worker is running. Queued runs wait until one starts
            (<code>contentfilter worker</code> on a machine with the pipeline's Python tools).</Text>
        ) : null}
        {!shown.length ? <EmptyState title="No films" hint="Nothing matches. Clear the search or the stage." /> : (
          <div className="cf-library__table">
            <Table highlightOnHover verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr><Table.Th>Title</Table.Th><Table.Th>Year</Table.Th><Table.Th>Stage</Table.Th><Table.Th>Run</Table.Th><Table.Th>Reviewed</Table.Th><Table.Th aria-label="Action" /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((f) => (
                  <Table.Tr key={f.ratingKey}>
                    <Table.Td><Anchor component={Link} to={`/admin/content/filter/${f.ratingKey}`}>{f.title || `Film ${f.ratingKey}`}</Anchor></Table.Td>
                    <Table.Td>{f.year ?? ''}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={STAGE_TONE[f.stage]}>{STAGE_LABELS[f.stage] ?? f.stage}</Badge></Table.Td>
                    <Table.Td><Text size="sm" c={f.job?.status === 'failed' ? 'red' : undefined}>{runText(f.job, data?.worker)}</Text></Table.Td>
                    <Table.Td>{f.reviewed ? `${f.reviewed.n} of ${f.reviewed.m}` : ''}</Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant={f.stage === 'rough' ? 'filled' : 'light'} loading={busy === f.ratingKey}
                        disabled={active(f.job) || Boolean(busy)} onClick={() => make(f)}>
                        {f.stage === 'rough' && !f.job ? 'Make filter' : 'Run again'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </Stack>
    </SectionCard>
  );
}

export default FilterLibrary;
