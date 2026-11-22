import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, Badge, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { browserPreference } from '../../../lib/browserPreference.js';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, createAppLogger, useRetryRegion } from '../../../lib/ui/index.js';
import { STAGE_LABELS } from '../../../../../__app_modules/media/media/browser/content-filter/adminWorkspace.mjs';
import { cardStep } from './railStages.js';
import './ContentFilterAdmin.scss';

/**
 * Admin -> Content filter: every film that can have a filter, where it stands, and a
 * one-click pipeline run ("Build it" in
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const LIBRARY_PATH = `${API}/library`;
const POLL_MS = 5000;
const INVALID_LIBRARY_RESPONSE = Object.freeze(new Error('The library response did not include a film list.'));

export { STAGE_LABELS };
const STAGE_TONE = { rough: 'gray', running: 'blue', refined: 'gray', scenes: 'gray', audited: 'yellow', machine: 'teal', parent: 'green' };

/**
 * Readiness order, best first. Only a film a grown-up approved is "Ready tonight"; a machine-certified
 * film still waits for its review (owner, 2026-11-21: "0 of x is not ready").
 */
// Sections follow the film page's rail (Refine, Review, Approve), not the pipeline's internal steps:
// "Refined", "Scenes built" and "Audited" all meant "there is review work for you" (owner asked what
// they meant, 2026-11-22). The internal step stays as a small chip on the card in To review.
export const SECTIONS = [
  { id: 'ready', label: 'Ready tonight', stages: ['parent'], open: true },
  { id: 'review', label: 'To review', stages: ['machine', 'audited', 'scenes', 'refined'], open: true },
  { id: 'running', label: 'Refining', stages: ['running'], open: true },
  // A rough film you have opened (it has a list) or run: in hand, not lost among the untouched ones.
  { id: 'started', label: 'Started', stages: ['rough'], when: (f) => Boolean(f.reviewed || f.job), open: true },
  { id: 'rough', label: 'Not started', stages: ['rough'], open: false },
];
/** Films the library cannot match to Plex (no key, stale key, another year, several Plex films). */
export const UNMATCHED_SECTION = { id: 'unmatched', label: 'Not matched to Plex' };
const isUnmatched = (f) => f.match === 'unmatched';
const openSectionsPreference = browserPreference('cf-library-open', SECTIONS.filter(section => section.open).map(section => section.id), raw => {
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value : null;
});

export function runText(job, worker = null) {
  if (!job) return null;
  if (job.status === 'queued') return worker && !worker.alive ? 'Waiting for a filter worker' : 'Queued';
  if (job.status === 'running') return `Running: ${job.step || 'starting'}`;
  if (job.status === 'failed') return `Failed at ${job.step}${job.error ? `: ${job.error}` : ''}`;
  if (job.status === 'interrupted') return `Interrupted at ${job.step || 'start'}`;
  if (job.status === 'cancelled') return `Stopped at ${job.step || 'start'}`;
  return null;
}
const active = (job) => job?.status === 'queued' || job?.status === 'running';

export function FilterLibrary() {
  const { data, hasResult, loading, error, reload, poll, revalidating } = useApiResource(LIBRARY_PATH, { label: 'content filter library', logger });
  const [stage, setStage] = useState(null);
  const [q, setQ] = useState('');
  const readBusy = loading || revalidating;
  const { regionProps, retry } = useRetryRegion(reload, readBusy);
  const films = useMemo(() => Array.isArray(data?.films) ? data.films : [], [data]);
  const invalidResponse = hasResult && !Array.isArray(data?.films);
  const readError = error ?? (!readBusy && invalidResponse ? INVALID_LIBRARY_RESPONSE : null);
  const anyActive = films.some((f) => active(f.job));

  useEffect(() => {
    if (data?.meta) logger.debug('library.loaded', { total: data.meta.total, verified: data.meta.verified ?? null, unmatched: data.meta.unmatched ?? null });
  }, [data]);

  useVisibleRefresh({ intervalMs: anyActive ? POLL_MS : undefined, reload, poll });

  const [openSections, setOpenSections] = useState(openSectionsPreference.read);
  const onToggle = useCallback((v) => { setOpenSections(v); openSectionsPreference.write(JSON.stringify(v)); }, []);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => films.filter((f) => (!stage || f.stage === stage) && (!needle || String(f.title || '').toLowerCase().includes(needle))),
    [films, stage, needle],
  );
  // Stage groups hold verified films only; the rest wait apart until Plex has the right film.
  const matched = useMemo(() => shown.filter((f) => !isUnmatched(f)), [shown]);
  const unmatched = useMemo(() => shown.filter(isUnmatched), [shown]);
  const groups = useMemo(() => SECTIONS
    .map((sec, i, all) => ({ ...sec, films: matched.filter((f) => sec.stages.includes(f.stage) && (!sec.when || sec.when(f))
      // A film an earlier section with a test already took stays there.
      && !all.slice(0, i).some((prev) => prev.when && prev.stages.includes(f.stage) && prev.when(f))) }))
    .filter((sec) => sec.films.length), [matched]);

  const card = (f) => <FilmCard key={f.ratingKey} film={f} worker={data?.worker} />;
  const meta = data?.meta;

  return (
    <SectionCard title="Content filter">
      <Stack gap="sm" role="region" aria-label="Content filter library" {...regionProps}>
        <Group gap="sm" wrap="wrap">
          <TextInput size="xs" aria-label="Search titles" placeholder="Search titles" value={q} onChange={(e) => setQ(e.currentTarget.value)} className="cf-library__search" />
          <Select size="xs" aria-label="Stage" placeholder="All stages" clearable value={stage} onChange={setStage}
            data={Object.entries(STAGE_LABELS).map(([value, label]) => ({ value, label }))} />
          {hasResult && Array.isArray(data?.films) ? <Text size="xs" c="dimmed">{shown.length} of {films.length} films</Text> : null}
        </Group>
        {loading && !hasResult ? <LoadingState label="content filter library" rows={6} data-testid="content-filter-library-loading" /> : null}
        {readBusy && hasResult && !films.length ? <LoadingState label="content filter library" rows={2} /> : null}
        {readError ? <ErrorState error={readError} onRetry={retry} label="Content filter library" /> : null}
        {meta ? (
          <Text size="xs" c="dimmed">
            {`${meta.indexedAt ? `Index from ${String(meta.indexedAt).slice(0, 10)}` : 'Index date unknown'} · ${meta.total} titles · ${meta.verified ?? meta.total} matched to Plex · ${meta.unmatched ?? 0} not`}
          </Text>
        ) : null}
        {data?.worker && !data.worker.alive && films.some((f) => f.job?.status === 'queued') ? (
          <Text size="sm" c="dimmed">No filter worker is running. Queued runs wait until one starts
            (<code>contentfilter worker</code> on a machine with the pipeline's Python tools).</Text>
        ) : null}
        {!shown.length && hasResult && !readError && !readBusy ? <EmptyState title="No films" hint="Nothing matches. Clear the search or the stage." /> : null}
        {!matched.length && unmatched.length ? <Text size="sm" c="dimmed">No film matched to Plex fits. See below.</Text> : null}
        {matched.length && needle ? (
          <SimpleGrid className="cf-grid" cols={{ base: 2, sm: 4, md: 6, lg: 8 }} spacing="sm">
            {matched.map((f) => card(f))}
          </SimpleGrid>
        ) : null}
        {(groups.length && !needle) || unmatched.length ? (
          <Accordion multiple variant="separated" value={openSections} onChange={onToggle}>
            {needle ? null : groups.map((sec) => (
              <Accordion.Item key={sec.id} value={sec.id}>
                <Accordion.Control>
                  <Group gap="xs"><Text fw={600} size="sm">{sec.label}</Text><Badge size="sm" variant="light" color={STAGE_TONE[sec.stages[0]]}>{sec.films.length}</Badge></Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <SimpleGrid className="cf-grid" cols={{ base: 2, sm: 4, md: 6, lg: 8 }} spacing="sm">
                    {sec.films.map((f) => card(f))}
                  </SimpleGrid>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
            {unmatched.length ? (
              <Accordion.Item value={UNMATCHED_SECTION.id} className="cf-unmatched">
                <Accordion.Control>
                  <Group gap="xs"><Text fw={600} size="sm">{UNMATCHED_SECTION.label}</Text><Badge size="sm" variant="outline" color="gray">{unmatched.length}</Badge></Group>
                  <Text size="xs" c="dimmed">Not usable until Plex has the right film. Nothing here can be filtered.</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <ul className="cf-unmatched__list">
                    {unmatched.map((f) => (
                      <li key={f.ratingKey} className="cf-unmatched__row">
                        <Link className="cf-unmatched__title" to={`/admin/content/filter/${f.ratingKey}`}>{f.title || `Film ${f.ratingKey}`}</Link>
                        <span className="cf-unmatched__year">{f.year ?? ''}</span>
                        <span className="cf-unmatched__reason">{f.unmatched?.text || 'no Plex film'}</span>
                      </li>
                    ))}
                  </ul>
                </Accordion.Panel>
              </Accordion.Item>
            ) : null}
          </Accordion>
        ) : null}
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

/**
 * One film. Its status is the film page's rail in two short lines (railStages.js `cardStep`): the next
 * step ("15 to refine", "Ready", "Approved"), then the reviewed count, so the card and the page can
 * never disagree (a card said "Auto-checked" over a page with 15 parts to refine: review 2026-11-22).
 */
function FilmCard({ film: f, worker }) {
  const text = runText(f.job, worker);
  const unlinked = f.linked === false;
  const running = active(f.job);
  const step = cardStep(f, { runText: text });
  const count = f.reviewed ? `${f.reviewed.n} of ${f.reviewed.m} reviewed` : null;
  const second = count && count !== step.text ? count : step.note || null;
  return (
    <div className={`cf-card${unlinked ? ' is-unlinked' : ''}`}>
      <Link className="cf-card__link" to={`/admin/content/filter/${f.ratingKey}`}>
        <Poster film={f} />
        <span className="cf-card__title">{f.title || `Film ${f.ratingKey}`}</span>
        <span className="cf-card__year">{f.year ?? ''}</span>
      </Link>
      {f.runtimeWarning ? (
        <span className="cf-card__note" title={`The Plex file runs ${f.runtimeWarning.plexMin} min; VidAngel's figure is ${f.runtimeWarning.edlMin} min. The sync step checks the cut.`}>
          {`Runtime ${f.runtimeWarning.plexMin} min (VidAngel ${f.runtimeWarning.edlMin})`}
        </span>
      ) : null}
      <div className="cf-card__meta">
        <span className={`cf-card__step is-${step.tone}`} data-step={step.tone}>{step.text}</span>
        <span className="cf-card__count">{second}</span>
      </div>
      {/* A run in hand is the step line already; this line is for a run that failed or stopped. */}
      <div className={`cf-card__run${f.job?.status === 'failed' ? ' is-failed' : ''}`} title={text || undefined}>{running ? null : text}</div>
      {/* Refining happens on the film's page, filtered parts only (owner, 2026-11-21); the card opens it. */}
      <Button className="cf-card__run-action" size="compact-xs" fullWidth component={Link} to={`/admin/content/filter/${f.ratingKey}`}
        variant={f.stage === 'machine' || f.reviewed ? 'filled' : 'light'} disabled={unlinked}>
        {f.stage === 'parent' ? 'Open' : step.tone === 'ready' ? 'Approve' : f.rail?.toRefine ? 'Refine' : f.stage === 'machine' || f.reviewed || f.job ? 'Review' : 'Start'}
      </Button>
    </div>
  );
}

export default FilterLibrary;
