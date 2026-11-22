import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Badge, Button, Group, Menu, Text, Tooltip } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { runPhases } from './runProgress.js';
import { ApprovalFeedback, useApprovalRegion } from './FilmApprovalControls.jsx';

/**
 * The film's one line (ops design "cf-journey", owner 2026-11-21: the three-meter banner wasted the
 * screen): back to the films, the title, how far the review is, what a run is doing, and the one
 * thing to do next. Everything else sits in the ⋯ menu.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const open = (job) => job && (job.status === 'queued' || job.status === 'running');

/** What the film's run is doing, in a few words ("Refining 5 of 17", "Waiting for the worker"). */
export function runLine(job, worker = null) {
  if (!job) return null;
  if (job.status === 'queued') return worker && !worker.alive ? 'Waiting for the filter worker (not running)' : 'Waiting for the worker';
  if (job.status !== 'running') return null;
  const prog = job.steps?.find((s) => s.name === 'refine')?.progress;
  if (job.step === 'refine' && prog?.phase === 'measure' && prog.total) return `Refining ${prog.done} of ${prog.total}`;
  if (job.step === 'refine') return prog?.phase === 'transcribe' || prog?.phase === 'sync' ? 'Preparing the film (one time)…' : 'Refining…';
  const phase = runPhases(job).find((p) => p.state === 'running');
  return phase ? `${phase.label}…` : 'Working…';
}

function ApproveButton({ approval }) {
  const { regionProps, feedback, start, retry } = useApprovalRegion(approval, 'approve');
  return (
    <span {...regionProps}>
      <Button size="compact-sm" color="green" loading={feedback?.busy} disabled={approval.blocked} onClick={start}>Approve for family</Button>
      <ApprovalFeedback feedback={feedback} onRetry={retry} />
    </span>
  );
}

export function ReviewHeader({ ratingKey, data, tally, roughFiltered, handlers, approval, onChanged = () => {}, flagged = 0, blocked = false }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [pending, setPending] = useState(false);
  const job = data.job;
  const running = open(job);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const post = async (action, path, body) => {
    setPending(true);
    logger.info('review.header.action', { ratingKey, action });
    try { await DaylightAPI(path, body, 'POST'); onChanged(); } catch (err) {
      logger.warn('review.header.action_failed', { ratingKey, action, error: err.message });
    } finally { setPending(false); setConfirmStop(false); }
  };
  const level = data.signOff?.parent ? `Approved by ${data.signOff.parent.by}` : data.certification?.level === 'machine' ? 'Machine-checked' : null;
  const failed = job && (job.status === 'failed' || job.status === 'interrupted');
  // A run's own words, else the check that runs after one (the list waits for it).
  const progress = runLine(job, data.worker) || (data.status?.next === 'checking' ? 'Checking the result…' : null);

  return (
    <div className="cf-head" role="banner" aria-label="Film">
      <Anchor component={Link} to="/admin/content/filter" size="sm" className="cf-head__back">‹ Films</Anchor>
      <Text fw={700} className="cf-head__title" title={data.title || ''}>{data.title || `Film ${ratingKey}`}</Text>
      <Text size="sm" className="cf-head__count">{`${tally.done} of ${tally.total} reviewed`}{roughFiltered ? ` · ${roughFiltered} rough` : ''}</Text>
      {level ? <Badge size="sm" variant="light" color={data.signOff?.parent ? 'green' : 'gray'}>{level}</Badge> : null}
      {failed ? (
        <Tooltip label={job.error || `Stopped at ${job.step || 'a step'}; nothing from it was kept.`} withArrow>
          <Badge size="sm" color="red" variant="light">{job.status === 'interrupted' ? 'Last run interrupted' : `Failed at ${job.step || 'a step'}`}</Badge>
        </Tooltip>
      ) : null}
      {progress ? <Badge size="sm" color="blue" variant="light">{progress}</Badge> : null}
      <span className="cf-head__spacer" />
      {running ? (confirmStop ? (
        <Group gap={4}>
          <Text size="xs">Stop? Nothing from this run is kept.</Text>
          <Button size="compact-xs" color="red" loading={pending} onClick={() => post('stop', `${base}/jobs/${encodeURIComponent(job.id)}/cancel`, {})}>Stop run</Button>
          <Button size="compact-xs" variant="subtle" onClick={() => setConfirmStop(false)}>Keep going</Button>
        </Group>
      ) : <Button size="compact-sm" variant="light" color="red" onClick={() => setConfirmStop(true)}>Stop</Button>)
        : roughFiltered && !blocked ? (
          <Button size="compact-sm" onClick={() => handlers.refineAll?.()}>
            <span className="cf-card__btn">{`Refine all ${roughFiltered}`} <kbd className="cf-keybar__key">⇧R</kbd></span>
          </Button>
        ) : data.status?.next === 'approve' ? <ApproveButton approval={approval} /> : null}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target><Button size="compact-sm" variant="subtle" aria-label="More">⋯</Button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item disabled={!tally.total || blocked} onClick={() => handlers.refineAll?.({ again: true })}>{`Refine all ${tally.total} filtered parts again`}</Menu.Item>
          <Menu.Item disabled={running || pending || blocked} onClick={() => post('make', `${base}/jobs`, { kind: 'make' })}>Refine the whole film (every part, slow)</Menu.Item>
          <Menu.Item disabled={!flagged || running || blocked} onClick={() => handlers.rework?.()}>{`Rework ${flagged} marked redo`}</Menu.Item>
          <Menu.Divider />
          <Menu.Item onClick={() => handlers.bleepLevel?.(-0.05)}>Bleep quieter  [</Menu.Item>
          <Menu.Item onClick={() => handlers.bleepLevel?.(0.05)}>Bleep louder  ]</Menu.Item>
          <Menu.Item onClick={() => handlers.help?.()}>All keys  ?</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export default ReviewHeader;
