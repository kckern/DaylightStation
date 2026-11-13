/**
 * A pipeline run as the grown-up sees it: phases in plain words, the measured count and an ETA.
 * Pure. The run record comes from the review payload (`job`), the refine step's `progress` from
 * the worker (refineProgress.mjs). Pipeline step names never reach the screen.
 */
const LABELS = {
  preflight: 'Checking the machine',
  sync: "Syncing the film's clock",
  measure: 'Measuring each part',
  scenes: 'Building scenes',
  cards: 'Drafting cards',
  audit: 'Checking the result',
};

function phaseKeys(job) {
  if (job.kind === 'send-back') return ['preflight', 'sync', 'measure', 'audit'];
  if (job.kind === 'stage') {
    if (job.stage === 'refine') return ['preflight', 'sync', 'measure', 'audit'];
    if (job.stage === 'scenes') return ['preflight', 'scenes', 'audit'];
    if (job.stage === 'cards') return ['cards', 'audit'];
    return ['audit'];
  }
  return ['preflight', 'sync', 'measure', 'scenes', 'cards', 'audit'];
}

const stateOf = (status) => (status === 'done' || status === 'skipped' ? 'done'
  : status === 'running' ? 'running' : status === 'failed' || status === 'interrupted' ? 'failed' : 'waiting');

/** @returns {Array<{ key, label, state: 'done'|'running'|'waiting'|'failed', count?: { done, total } }>} */
export function runPhases(job) {
  if (!job) return [];
  const steps = new Map((job.steps || []).map((s) => [s.name, s]));
  const refine = steps.get('refine');
  const p = refine?.progress || null;
  const measuring = p?.phase === 'measure';
  return phaseKeys(job).map((key) => {
    let state;
    if (key === 'sync' || key === 'measure') {
      const s = stateOf(refine?.status);
      if (s === 'running' && p) state = key === 'sync' ? (measuring ? 'done' : 'running') : (measuring ? 'running' : 'waiting');
      else if (s === 'failed' && key === 'sync' && measuring) state = 'done';
      else state = s;
    } else state = stateOf(steps.get(key)?.status);
    const out = { key, label: LABELS[key], state };
    if (key === 'measure' && state === 'running' && measuring && p.total) out.count = { done: p.done, total: p.total };
    return out;
  });
}

/** Seconds left in the measure phase, from the pace since the first part; null until 3 parts. */
export function measureEta({ progress, now = Date.now() }) {
  if (!progress || progress.phase !== 'measure' || !progress.firstAt || !progress.total || (progress.done || 0) < 3) return null;
  const elapsed = (now - Date.parse(progress.firstAt)) / 1000;
  if (!(elapsed > 0)) return null;
  return Math.round((elapsed / progress.done) * (progress.total - progress.done));
}

export function formatEta(seconds) {
  if (seconds == null) return null;
  if (seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  if (min < 60) return `about ${min} min`;
  return `about ${Math.floor(min / 60)} h ${min % 60} min`;
}
