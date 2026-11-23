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
  else if (roughRefine) refine = notMatched ? { blocked: true, text: `${roughRefine} to refine · not matched to Plex` } : { text: `${roughRefine} to refine${roughLeft ? ` · ${roughLeft} timing unsure` : ''}` };
  else if (!rows && next === 'refine') refine = notMatched ? { blocked: true, text: 'Not matched to Plex' } : { text: 'Not refined yet' };
  else if (!rows && next === 'none') refine = { blocked: true, text: 'No filters yet' };
  // Refine has run, but a part it could not vouch for is not "Done" until someone has looked at it.
  else refine = roughLeft ? { done: true, check: roughLeft, text: `${roughLeft} with unsure timing`, title: `Refine could not pin ${roughLeft} part${roughLeft === 1 ? '' : 's'}: listen before approving, and drag the handles to fit` }
    : { done: true, text: 'Done' };

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
    return { key, label, state, text, title: s.title || text, ...(s.check ? { check: s.check } : {}) };
  });
}

/**
 * The same next-step words for a library card (FilterLibrary.jsx), from the library's own facts
 * (ContentFilterLibrary.mjs): `{ text, tone }`. One vocabulary on both pages, so a card never says
 * "Auto-checked" over a film whose page says "15 to refine" (review 2026-11-22).
 */
export function cardStep(film, { runText = null } = {}) {
  const f = film || {};
  const rail = f.rail || {};
  const reviewed = f.reviewed || null;
  if (f.stage === 'parent') return { text: 'Approved', tone: 'done' };
  if (f.job && (f.job.status === 'queued' || f.job.status === 'running')) return { text: runText || 'Refining…', tone: 'busy' };
  if (rail.toRefine) return { text: `${rail.toRefine} to refine`, tone: 'todo' };
  if (!reviewed) return { text: f.stage === 'rough' ? 'Not refined yet' : 'Not checked yet', tone: 'quiet' };
  if (reviewed.n < reviewed.m) return { text: `${reviewed.n} of ${reviewed.m} reviewed`, tone: 'todo', ...(rail.toCheck ? { note: `${rail.toCheck} timing unsure` } : {}) };
  if (rail.redo) return { text: `${rail.redo} marked Redo`, tone: 'check' };
  if (f.stage === 'machine') return { text: 'Ready', tone: 'ready' };
  return { text: f.stage === 'rough' ? 'Not refined yet' : 'Not ready yet', tone: 'check' };
}

/** The tab a film opens on: its first stage still to do; a finished film opens on Approve. */
export function defaultStage(stages) {
  const first = stages.find((s) => s.state === 'current' || s.state === 'stuck');
  if (first) return first.key;
  return stages.every((s) => s.state === 'complete') ? 'approve' : 'review';
}
