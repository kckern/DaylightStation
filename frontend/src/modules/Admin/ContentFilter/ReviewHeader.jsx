import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Badge, Button, Group, Menu, Text, Tooltip } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';
import { formatEta, measureEta, runPhases } from './runProgress.js';
import { ApprovalFeedback, useApprovalRegion } from './FilmApprovalControls.jsx';

/**
 * The film's one line (ops design "cf-journey", owner 2026-11-21: the three-meter banner wasted the
 * screen): back to the films, the title, how far the review is, what a run is doing, and the one
 * thing to do next. Everything else sits in the ⋯ menu.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const open = (job) => job && (job.status === 'queued' || job.status === 'running');

// How long each step of a refine normally takes at most; past it, the chip says it may be stuck
// (owner, 2026-11-22: "if stuck you need guardrails, the UI should never lie"). Transcribing a
// two-hour film took 71 min on the server; a film copy about 10 min; one part a few seconds.
const STALL_MIN = { 'copy-wait': 30, copy: 45, transcribe: 150, sync: 10, measure: 10, other: 20 };
const PHASE_WORDS = {
  'copy-wait': 'Waiting for the film copy', copy: 'Making a small copy of the film (one time)',
  transcribe: 'Transcribing the film (one time)', sync: 'Lining up the film\'s clock',
};
const mins = (ms) => Math.max(0, Math.floor(ms / 60000));
const span = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/**
 * What the film's run is doing, in a few words, and for how long: { text, stuck }. `stuck` when the
 * run has sat in one step longer than that step ever takes (its last progress line is that old).
 */
export function runState(job, worker = null, now = Date.now()) {
  if (!job) return null;
  if (job.status === 'queued') return { text: worker && !worker.alive ? 'Waiting for the filter worker (not running)' : 'Waiting for the worker', stuck: Boolean(worker && !worker.alive) };
  if (job.status !== 'running') return null;
  const step = job.steps?.find((s) => s.name === job.step);
  const prog = job.steps?.find((s) => s.name === 'refine')?.progress;
  const since = Date.parse((job.step === 'refine' && prog?.at) || step?.startedAt || '') || null;
  const m = since ? mins(now - since) : null;
  const key = job.step === 'refine' ? (prog?.phase || 'other') : 'other';
  const stuck = m != null && m >= (STALL_MIN[key] ?? STALL_MIN.other);
  let text;
  if (job.step === 'refine' && prog?.phase === 'measure' && prog.total) {
    const eta = formatEta(measureEta({ progress: prog, now }));
    text = `Refining ${prog.done} of ${prog.total}${eta && !stuck ? ` · ${eta} left` : ''}`;
  } else if (job.step === 'refine') {
    text = PHASE_WORDS[prog?.phase] || 'Starting the refine';
  } else {
    const phase = runPhases(job).find((p) => p.state === 'running');
    text = phase ? phase.label : 'Working';
  }
  if (stuck) return { text: `${text}: no progress for ${span(m)}. It may be stuck; Stop it and refine again.`, stuck: true };
  const counting = /\d+ of \d+/.test(text);
  return { text: m != null && m >= 2 && !counting ? `${text} · ${span(m)}` : counting ? text : `${text}…`, stuck: false };
}

/** The run's state as one line (kept for callers that only show text). */
export function runLine(job, worker = null, now = Date.now()) { return runState(job, worker, now)?.text ?? null; }

function ApproveButton({ approval }) {
  const { regionProps, feedback, start, retry } = useApprovalRegion(approval, 'approve');
  return (
    <span {...regionProps}>
      <Button size="compact-sm" color="green" loading={feedback?.busy} disabled={approval.blocked} onClick={start}>Approve for family</Button>
      <ApprovalFeedback feedback={feedback} onRetry={retry} />
    </span>
  );
}

export function ReviewHeader({ ratingKey, data, tally, roughFiltered, roughLeft = 0, refineAllCount = 0, handlers, approval, onChanged = () => {}, flagged = 0, blocked = false }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [confirmWhole, setConfirmWhole] = useState(false);
  const job = data.job;
  const running = open(job);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const post = async (action, path, body) => {
    setPending(true);
    logger.info('review.header.action', { ratingKey, action });
    setError(null);
    try { await DaylightAPI(path, body, 'POST'); onChanged(); } catch (err) {
      logger.warn('review.header.action_failed', { ratingKey, action, error: err.message });
      setError(err.message || `${action === 'stop' ? 'Stop' : 'That'} did not work.`);
    } finally { setPending(false); setConfirmStop(false); setConfirmWhole(false); }
  };
  const level = data.signOff?.parent ? `Approved by ${data.signOff.parent.by}` : data.certification?.level === 'machine' ? 'Auto-checked' : null;
  const failed = job && (job.status === 'failed' || job.status === 'interrupted');
  // A run's own words, else the check that runs after one (the list waits for it).
  const run = runState(job, data.worker);
  const progress = run?.text || (data.status?.next === 'checking' ? 'Checking the result…' : null);

  return (
    <div className="cf-head" role="banner" aria-label="Film">
      <Anchor component={Link} to="/admin/content/filter" size="sm" className="cf-head__back">‹ Films</Anchor>
      <Text fw={700} className="cf-head__title" title={data.title || ''}>{data.title || `Film ${ratingKey}`}</Text>
      <Text size="sm" className="cf-head__count">{`${tally.done} of ${tally.total} reviewed`}{roughFiltered ? ` · ${roughFiltered} to refine` : ''}{roughLeft ? ` · ${roughLeft} rough after refine (check by eye)` : ''}</Text>
      {level ? <Badge size="sm" variant="light" color={data.signOff?.parent ? 'green' : 'gray'}>{level}</Badge> : null}
      {failed ? (
        <Tooltip label={job.error || 'Nothing from it was kept.'} withArrow multiline w={360}>
          <Badge size="sm" color="red" variant="light">{job.status === 'interrupted' ? 'Last refine stopped early; nothing was kept'
            : `Last ${job.step === 'refine' || job.kind === 'send-back' ? 'refine' : 'run'} failed; nothing was kept (hover for why)`}</Badge>
        </Tooltip>
      ) : null}
      {progress ? (run?.stuck
        ? <Text size="sm" c="orange" role="alert" className="cf-head__stuck">{progress}</Text>
        : <Badge size="sm" color="blue" variant="light">{progress}</Badge>) : null}
      <span className="cf-head__spacer" />
      {running ? (confirmStop ? (
        <Group gap={4}>
          <Text size="xs">Stop? Nothing from this run is kept.</Text>
          <Button size="compact-xs" color="red" loading={pending} onClick={() => post('stop', `${base}/jobs/${encodeURIComponent(job.id)}/cancel`, {})}>Stop run</Button>
          <Button size="compact-xs" variant="subtle" onClick={() => setConfirmStop(false)}>Keep going</Button>
        </Group>
      ) : <Button size="compact-sm" variant="light" color="red" onClick={() => setConfirmStop(true)}>Stop</Button>)
        // Approval first whenever the film can be approved: parts refine cannot pin never block it.
        : data.status?.next === 'approve' ? <ApproveButton approval={approval} />
        : roughFiltered && !blocked ? (
          <Button size="compact-sm" onClick={() => handlers.refineAll?.()}>
            <span className="cf-card__btn">{`Refine all ${roughFiltered}`} <kbd className="cf-keybar__key">⇧R</kbd></span>
          </Button>
        ) : null}
      {error ? <Text size="xs" c="red" role="alert">{error}</Text> : null}
      {/* No focus back on ⋯ when it closes: Enter must play the part, not reopen the menu. */}
      <Menu position="bottom-end" withinPortal returnFocus={false} onClose={() => setConfirmWhole(false)}>
        <Menu.Target><Button size="compact-sm" variant="subtle" aria-label="More">⋯</Button></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item disabled={!refineAllCount || blocked} onClick={() => handlers.refineAll?.({ again: true })}>{`Refine all ${refineAllCount} filtered part${refineAllCount === 1 ? '' : 's'} again`}</Menu.Item>
          <Menu.Item disabled={running || pending || blocked} closeMenuOnClick={confirmWhole}
            onClick={() => (confirmWhole ? post('make', `${base}/jobs`, { kind: 'make' }) : setConfirmWhole(true))}>
            {confirmWhole ? 'Click again: refine all parts, including the ones that play (slow)' : 'Refine the whole film (every part, slow)'}
          </Menu.Item>
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
