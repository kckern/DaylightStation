import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, Badge, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, createAppLogger } from '../../../lib/ui/index.js';
import { STAGE_LABELS } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter: every film that can have a filter, where it stands, and a
 * one-click pipeline run ("Build it" in
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const POLL_MS = 5000;

export { STAGE_LABELS };
const STAGE_TONE = { rough: 'gray', running: 'blue', refined: 'gray', scenes: 'gray', audited: 'yellow', machine: 'teal', parent: 'green' };

/** Readiness order, best first. Parent and machine certified films are "Ready tonight". */
export const SECTIONS = [
  { id: 'ready', label: 'Ready tonight', stages: ['parent', 'machine'], open: true },
  { id: 'audited', label: STAGE_LABELS.audited, stages: ['audited'], open: true },
  { id: 'scenes', label: STAGE_LABELS.scenes, stages: ['scenes'], open: false },
  { id: 'refined', label: STAGE_LABELS.refined, stages: ['refined'], open: false },
  { id: 'running', label: STAGE_LABELS.running, stages: ['running'], open: true },
  { id: 'rough', label: STAGE_LABELS.rough, stages: ['rough'], open: false },
];
const OPEN_KEY = 'cf-library-open';
const defaultOpen = () => SECTIONS.filter((x) => x.open).map((x) => x.id);
function loadOpen() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY));
    if (Array.isArray(v)) return v;
  } catch { /* storage unavailable or corrupt: defaults */ }
  return defaultOpen();
}
function saveOpen(v) { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch { /* ignore */ } }

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

  const [openSections, setOpenSections] = useState(loadOpen);
  const onToggle = useCallback((v) => { setOpenSections(v); saveOpen(v); }, []);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => films.filter((f) => (!stage || f.stage === stage) && (!needle || String(f.title || '').toLowerCase().includes(needle))),
    [films, stage, needle],
  );
  const groups = useMemo(() => SECTIONS
    .map((sec) => ({ ...sec, films: shown.filter((f) => sec.stages.includes(f.stage)) }))
    .filter((sec) => sec.films.length), [shown]);

  const card = (f, chip) => <FilmCard key={f.ratingKey} film={f} worker={data?.worker} chip={chip}
    busy={busy} onMake={make} />;
  const meta = data?.meta;

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
        {meta ? (
          <Text size="xs" c="dimmed">
            {`${meta.indexedAt ? `Index from ${String(meta.indexedAt).slice(0, 10)}` : 'Index date unknown'} · ${meta.total} titles · ${meta.unlinked} unlinked`}
          </Text>
        ) : null}
        {notice ? <Text size="sm" role="alert">{notice}</Text> : null}
        {data?.worker && !data.worker.alive && films.some((f) => f.job?.status === 'queued') ? (
          <Text size="sm" c="dimmed">No filter worker is running. Queued runs wait until one starts
            (<code>contentfilter worker</code> on a machine with the pipeline's Python tools).</Text>
        ) : null}
        {!shown.length ? <EmptyState title="No films" hint="Nothing matches. Clear the search or the stage." /> : needle ? (
          <SimpleGrid className="cf-grid" cols={{ base: 2, sm: 4, md: 6, lg: 8 }} spacing="sm">
            {shown.map((f) => card(f, STAGE_LABELS[f.stage] ?? f.stage))}
          </SimpleGrid>
        ) : (
          <Accordion multiple variant="separated" value={openSections} onChange={onToggle}>
            {groups.map((sec) => (
              <Accordion.Item key={sec.id} value={sec.id}>
                <Accordion.Control>
                  <Group gap="xs"><Text fw={600} size="sm">{sec.label}</Text><Badge size="sm" variant="light" color={STAGE_TONE[sec.stages[0]]}>{sec.films.length}</Badge></Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <SimpleGrid className="cf-grid" cols={{ base: 2, sm: 4, md: 6, lg: 8 }} spacing="sm">
                    {sec.films.map((f) => card(f, null))}
                  </SimpleGrid>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Stack>
    </SectionCard>
  );
}

function Poster({ film }) {
  const [broken, setBroken] = useState(false);
  const title = film.title || `Film ${film.ratingKey}`;
  return (
    <div className="cf-card__poster">
      {film.thumb && !broken ? (
        <img src={film.thumb} alt="" width={120} height={180} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : <span className="cf-card__fallback">{title}</span>}
      {film.linked === false ? <span className="cf-card__gone" title="No longer in Plex" aria-label="No longer in Plex">&#x2298;</span> : null}
    </div>
  );
}

function FilmCard({ film: f, worker, chip, busy, onMake }) {
  const text = runText(f.job, worker);
  const unlinked = f.linked === false;
  return (
    <div className={`cf-card${unlinked ? ' is-unlinked' : ''}`}>
      <Link className="cf-card__link" to={`/admin/content/filter/${f.ratingKey}`}>
        <Poster film={f} />
        <span className="cf-card__title">{f.title || `Film ${f.ratingKey}`}</span>
        <span className="cf-card__year">{f.year ?? ''}</span>
      </Link>
      <div className="cf-card__meta">
        {chip ? <Badge size="xs" variant="light" color={STAGE_TONE[f.stage]}>{chip}</Badge> : null}
        {f.reviewed ? <span>{`${f.reviewed.n} of ${f.reviewed.m}`}</span> : null}
      </div>
      <div className={`cf-card__run${f.job?.status === 'failed' ? ' is-failed' : ''}`} title={text || undefined}>{text}</div>
      <Button size="compact-xs" fullWidth variant={f.stage === 'rough' ? 'filled' : 'light'} loading={busy === f.ratingKey}
        disabled={unlinked || active(f.job) || Boolean(busy)} onClick={() => onMake(f)}>
        {f.stage === 'rough' && !f.job ? 'Make filter' : 'Run again'}
      </Button>
    </div>
  );
}

export default FilterLibrary;
