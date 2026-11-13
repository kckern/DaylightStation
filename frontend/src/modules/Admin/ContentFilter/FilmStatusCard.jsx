import { useState } from 'react';
import { Button, Group, Loader, Progress, Stack, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { formatEta, measureEta, runPhases } from './runProgress.js';

/**
 * One film's two answers (are there filters? are they refined?) and the one thing to do next
 * (filmStatus.mjs `next`), or, while a run works, its phases, the measured count, an ETA, the
 * latest parts in words and Stop. Replaces the "Stage again" dropdown: no pipeline step is a choice.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const KIND = { visual: 'picture', speech: 'word', said: 'word', heard: 'sound' };

function outcomeText({ cue, kind, status, detail }) {
  const what = `${cue} ${KIND[kind] || kind}`;
  if (status === 'refined') return `${what}: ${detail}`;
  if (status === 'giveup') return `${what}: not found`;
  if (status === 'region') return `${what}: tracked, edges approximate`;
  return `${what}: couldn't pin the edges${detail ? ` (${detail})` : ''}`;
}

export function FilmStatusCard({ ratingKey, status, job = null, approvedBy = null, auditError = null, worker = null, onChanged = () => {}, onReview = () => {} }) {
  const [pending, setPending] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [notice, setNotice] = useState(null);
  if (!status) return null;
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const act = async (action, path, body) => {
    setPending(true); setNotice(null);
    logger.info('review.status.action', { ratingKey, action });
    try { await DaylightAPI(path, body, 'POST'); onChanged(); } catch (err) {
      logger.warn('review.status.action_failed', { ratingKey, action, error: err.message });
      setNotice(err.message || 'That did not work.');
    } finally { setPending(false); setConfirmStop(false); }
  };

  const { filters, refined, certified, next } = status;
  const running = next === 'running' && job;
  const progress = job?.steps?.find((s) => s.name === 'refine')?.progress || null;
  const eta = running ? formatEta(measureEta({ progress, now: Date.now() })) : null;

  return (
    <Stack gap={6} className="cf-status" data-next={next}>
      <Text size="sm" fw={600}>{filters.present ? `Filters: Yes — ${filters.parts} parts` : 'Filters: None for this film yet'}</Text>
      {filters.present ? (
        <Text size="sm">{refined.present ? `Refined: Yes — ${refined.measured} of ${refined.of} measured to the millisecond` : 'Refined: No'}</Text>
      ) : null}
      {certified === 'parent' ? <Text size="sm" c="green">{approvedBy ? `Approved for family by ${approvedBy}` : 'Approved for family'}</Text>
        : certified === 'machine' ? <Text size="sm" c="green">Machine-certified</Text> : null}

      {running ? (
        <Stack gap={4} className="cf-status__run">
          {job.status === 'queued' && worker && !worker.alive ? <Text size="sm" c="orange">Waiting for the filter worker. It isn't running on the server.</Text> : null}
          {runPhases(job).map((p) => (
            <Text key={p.key} size="sm" className="cf-status__phase" data-state={p.state} c={p.state === 'waiting' ? 'dimmed' : p.state === 'failed' ? 'red' : undefined}>
              {p.count ? `${p.label} — ${p.count.done} of ${p.count.total}` : p.label}
            </Text>
          ))}
          {progress?.phase === 'measure' && progress.total ? <Progress value={(100 * progress.done) / progress.total} size="sm" aria-label="Measured" /> : null}
          {eta ? <Text size="sm">{`ETA ${eta}`}</Text> : null}
          {(progress?.recent || []).slice(0, 5).map((o, i) => <Text key={`${o.cue}-${i}`} size="xs" c="dimmed" ff="monospace">{outcomeText(o)}</Text>)}
          {confirmStop ? (
            <Group gap="xs">
              <Text size="sm">Stop this run? Nothing from this run is saved.</Text>
              <Button size="compact-xs" color="red" loading={pending} onClick={() => { logger.info('review.status.cancel', { ratingKey, runId: job.id }); act('stop', `${base}/jobs/${encodeURIComponent(job.id)}/cancel`, {}); }}>Stop run</Button>
              <Button size="compact-xs" variant="subtle" onClick={() => setConfirmStop(false)}>Keep running</Button>
            </Group>
          ) : <Group><Button size="compact-xs" variant="light" color="red" onClick={() => setConfirmStop(true)}>Stop</Button></Group>}
        </Stack>
      ) : null}

      {next === 'refine' ? <Group><Button size="xs" loading={pending} onClick={() => act('refine', `${base}/jobs`, { kind: 'make' })}>Refine</Button></Group> : null}
      {next === 'checking' ? <Group gap="xs"><Loader size="xs" /><Text size="sm">Checking the result…</Text></Group> : null}
      {next === 'check-failed' ? (
        <Group gap="xs">
          <Text size="sm" c="red">{`The check failed: ${auditError?.error || 'no report'}`}</Text>
          <Button size="compact-xs" variant="light" loading={pending} onClick={() => act('retry-check', `${base}/jobs`, { kind: 'stage', stage: 'audit' })}>Retry</Button>
        </Group>
      ) : null}
      {next === 'review' ? <Group><Button size="xs" onClick={() => { logger.info('review.status.action', { ratingKey, action: 'review' }); onReview(); }}>Review</Button></Group> : null}
      {next === 'approve' ? <Group><Button size="xs" loading={pending} onClick={() => act('approve', `${base}/signoff`, {})}>Approve for family</Button></Group> : null}
      {notice ? <Text size="sm" role="status" c="red">{notice}</Text> : null}
    </Stack>
  );
}

export default FilmStatusCard;
