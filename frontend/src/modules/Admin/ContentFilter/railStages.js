import { runState } from './ReviewHeader.jsx';

/**
 * The film's three stages as the rail shows them (ReviewRail.jsx; owner 2026-11-22: "a process
 * chevron interlocking rail that also serves as tabs"). Pure: every word and state comes from the
 * review payload, so a stage never claims more than the data does.
 *
 * state: complete (a check) | current (the stage to work on now) | waiting (not its turn, or it
 * cannot start; the text says why) | stuck (a run that has stopped moving).
 */
const open = (job) => Boolean(job && (job.status === 'queued' || job.status === 'running'));
// Why a film has no parts to review yet.
const NO_PARTS = { checking: 'Checking the result…', 'check-failed': 'The check failed', running: 'Waiting for the run', refine: 'Nothing until the film is refined', none: 'No filters yet' };

export function railStages({ data, tally = { done: 0, total: 0 }, roughRefine = 0, roughLeft = 0, now = Date.now() }) {
  const job = data?.job || null;
  const running = open(job);
  const next = data?.status?.next || null;
  const rows = data?.rows?.length || 0;
  const notMatched = data?.match === 'unmatched';
  const run = running ? runState(job, data?.worker, now) : null;

  let refine;
  if (running) refine = run?.stuck ? { stuck: true, text: run.brief || run.text, title: run.text } : { text: run?.text || 'Working…' };
  else if (roughRefine) refine = notMatched ? { blocked: true, text: `${roughRefine} to refine · not matched to Plex` } : { text: `${roughRefine} to refine` };
  else if (!rows && next === 'refine') refine = notMatched ? { blocked: true, text: 'Not matched to Plex' } : { text: 'Not refined yet' };
  else if (!rows && next === 'none') refine = { blocked: true, text: 'No filters yet' };
  else refine = { done: true, text: roughLeft ? `Done · ${roughLeft} rough after refine (check by eye)` : 'Done' };

  let review;
  if (!tally.total) review = rows ? { done: true, text: 'Nothing is filtered' } : { blocked: true, text: NO_PARTS[next] || 'No parts yet' };
  else {
    const count = `${tally.done} of ${tally.total} reviewed`;
    review = tally.done === tally.total ? { done: true, text: count }
      // Review on rough timing is allowed, but a refine moves a part and drops its verdict.
      : { text: count, waitText: `${count} · refine first` };
  }

  const signOff = data?.signOff || null;
  let approve;
  if (signOff?.parent) approve = { done: true, text: `Approved by ${signOff.parent.by}` };
  else if (next === 'approve') approve = { ready: true, text: 'Ready' };
  else approve = { blocked: true, text: signOff?.missing?.length ? `Not yet: ${signOff.missing[0]}` : 'Not yet' };

  let found = false;
  return [['refine', 'Refine', refine], ['review', 'Review', review], ['approve', 'Approve', approve]].map(([key, label, s]) => {
    let state;
    if (s.done) state = 'complete';
    else if (s.stuck) { state = 'stuck'; found = true; }
    else if (s.ready || (!s.blocked && !found)) { state = 'current'; found = true; }
    else state = 'waiting';
    const text = state === 'waiting' && s.waitText ? s.waitText : s.text;
    return { key, label, state, text, title: s.title || text };
  });
}

/** The tab a film opens on: its first stage still to do; a finished film opens on Approve. */
export function defaultStage(stages) {
  const first = stages.find((s) => s.state === 'current' || s.state === 'stuck');
  if (first) return first.key;
  return stages.every((s) => s.state === 'complete') ? 'approve' : 'review';
}
