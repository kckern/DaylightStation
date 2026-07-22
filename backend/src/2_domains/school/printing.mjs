/**
 * Print-quota policy (pure). A child prints their own worksheets, but a
 * runaway "print 500 pages" is the thing to prevent — so a rolling page
 * budget per window gates it: within budget prints immediately, over budget
 * needs a grown-up's approval, and a single oversized job is refused outright
 * (approval is for "a bit much", not "the whole book"). No I/O, no Date —
 * `now` and the job history are supplied by the caller.
 */

/**
 * @typedef {Object} PrintPolicy
 * @property {number} windowMinutes  - rolling window length
 * @property {number} pagesPerWindow - pages a child may print unattended per window
 * @property {number} maxPagesPerJob - hard ceiling on a single job (approval can't bypass this)
 */
export const DEFAULT_PRINT_POLICY = Object.freeze({
  windowMinutes: 60,
  pagesPerWindow: 5,
  maxPagesPerJob: 20,
});

/**
 * Decide what happens to a print request.
 *
 * @param {Object} input
 * @param {Array<{at:string, pages:number}>} input.recentJobs - this user's prior jobs (any age; filtered here)
 * @param {number} input.pages - pages this request would print (copies already multiplied in)
 * @param {number} input.now - epoch ms "now"
 * @param {PrintPolicy} [input.policy]
 * @returns {{decision:'allow'|'approval'|'deny', pagesInWindow:number, remaining:number, reason:?string}}
 */
export function evaluatePrintQuota({ recentJobs = [], pages, now, policy = DEFAULT_PRINT_POLICY }) {
  const { windowMinutes, pagesPerWindow, maxPagesPerJob } = { ...DEFAULT_PRINT_POLICY, ...policy };

  if (!Number.isFinite(pages) || pages <= 0) {
    return { decision: 'deny', pagesInWindow: 0, remaining: pagesPerWindow, reason: 'Nothing to print' };
  }
  if (pages > maxPagesPerJob) {
    return {
      decision: 'deny',
      pagesInWindow: 0,
      remaining: pagesPerWindow,
      reason: `That's too many pages to print at once (max ${maxPagesPerJob})`,
    };
  }

  const cutoff = now - windowMinutes * 60000;
  const pagesInWindow = recentJobs.reduce((sum, j) => {
    const at = Date.parse(j.at);
    // Strictly-inside window: a job exactly `windowMinutes` ago has aged out.
    return Number.isFinite(at) && at > cutoff ? sum + (Number(j.pages) || 0) : sum;
  }, 0);

  const remaining = Math.max(0, pagesPerWindow - pagesInWindow);
  const decision = pagesInWindow + pages <= pagesPerWindow ? 'allow' : 'approval';
  return {
    decision,
    pagesInWindow,
    remaining,
    reason: decision === 'approval' ? 'Over the hourly limit — a grown-up needs to say yes' : null,
  };
}
