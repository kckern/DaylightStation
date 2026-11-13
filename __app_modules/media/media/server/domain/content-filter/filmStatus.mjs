/**
 * A film's state as a grown-up asks about it (Admin → Content filter, one film): are there
 * filters? are they refined? and the one thing to do next. Pure. The stages a run passes through
 * (filmStage.mjs) stay the library's grouping; this is the page's question-and-answer.
 */
export const NEXT_ACTIONS = Object.freeze(['none', 'refine', 'running', 'checking', 'check-failed', 'review', 'approve', 'done']);

const OPEN = new Set(['queued', 'running']);

/**
 * @param {object} p
 * @param {number} p.rawCueCount   cues in VidAngel's rough EDL (0 when there is none)
 * @param {object|null} p.refined  the refined EDL, or null
 * @param {{ fresh?: boolean }|null} [p.audit]
 * @param {boolean} [p.auditRunning]
 * @param {{ status: string }|null} [p.job]  the film's latest run
 * @param {'none'|'machine'|'parent'} [p.certificationLevel]
 * @param {number} [p.rowsOpen]    rows without a verdict, plus rows waiting for redo
 * @param {boolean} [p.auditFailed] the last check failed (no report) and none is running
 * @param {boolean} [p.signOffReady] approval would be accepted (machine bar, audit passed, all reviewed)
 */
export function filmStatus({ rawCueCount = 0, refined = null, audit = null, auditRunning = false, auditFailed = false, job = null, certificationLevel = 'none', rowsOpen = 0, signOffReady = false } = {}) {
  const of = refined ? (refined.cues || []).length : rawCueCount;
  const status = {
    filters: { present: !!refined || rawCueCount > 0, parts: of },
    refined: { present: !!refined, measured: refined ? Number(refined.timebase?.refinedCount) || 0 : 0, of },
    certified: certificationLevel,
  };
  let next;
  if (!status.filters.present) next = 'none';
  else if (job && OPEN.has(job.status)) next = 'running';
  else if (!refined) next = 'refine';
  else if (auditRunning) next = 'checking';
  else if ((!audit || !audit.fresh) && auditFailed) next = 'check-failed';
  else if (!audit || !audit.fresh) next = 'checking';
  else if (certificationLevel === 'parent') next = 'done';
  // Approve only when it would be accepted; otherwise the review's missing list says what to fix.
  else if (rowsOpen > 0 || !signOffReady) next = 'review';
  else next = 'approve';
  return { ...status, next };
}
