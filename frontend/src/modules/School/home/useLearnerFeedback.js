import { useEffect, useRef, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

/**
 * useLearnerFeedback — a learner's own resolved review items, newest first
 * (Task 9, spec R7): a grown-up's marks and notes, delivered where the child
 * can actually see them, not only on the parent's paper receipt or admin
 * queue.
 *
 * Consumes `GET /api/v1/school/review/learner/:learnerId` (`YamlReviewQueue
 * .listForLearner`), which answers a plain array — never a pending item, and
 * never wrapped in an envelope, matching `useTeacherToday`'s own posture.
 *
 * No learnerId (unclaimed panel) fetches nothing and reports the empty
 * zero-state rather than an error — there is nobody's feedback to ask for.
 *
 * Polls every 60s while mounted (advocacy: a kid at the kiosk should see a
 * parent's note land without a reload) and reports `hasNew` when a poll
 * surfaces an item the previous list didn't have.
 *
 * @param {string|null} learnerId
 * @param {{limit?: number}} [opts]
 * @returns {{items: Array<{itemId: string, sessionId: string, unitId: string|null,
 *   verdict: 'correct'|'incorrect', note: string|null, gradedBy: string|null,
 *   gradedAt: string|null, prompt: string|null, questionNumber: number|null}>,
 *   status: 'loading'|'ready'|'empty'|'error'}}
 */
const POLL_MS = 60_000;

export function useLearnerFeedback(learnerId, { limit = 20 } = {}) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(learnerId ? 'loading' : 'empty');
  const [hasNew, setHasNew] = useState(false);
  const seenRef = useRef(null); // itemId set from the previous load; null until first load

  useEffect(() => {
    if (!learnerId) { setItems([]); setStatus('empty'); setHasNew(false); return undefined; }
    let alive = true;
    seenRef.current = null;
    setHasNew(false);
    setStatus('loading');
    const load = () => schoolApi.reviewLearner(learnerId, { limit }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !Array.isArray(data)) {
        schoolLog.feedbackError('fetch-failed', { learnerId });
        // A failed POLL keeps the last good list on screen; only the first
        // load reports the error state.
        if (seenRef.current === null) { setItems([]); setStatus('error'); }
        return;
      }
      const prev = seenRef.current;
      if (prev !== null && data.some((it) => !prev.has(it.itemId))) setHasNew(true);
      seenRef.current = new Set(data.map((it) => it.itemId));
      setItems(data);
      setStatus(data.length ? 'ready' : 'empty');
      schoolLog.feedback('loaded', { learnerId, count: data.length });
    });
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [learnerId, limit]);

  return { items, status, hasNew, markSeen: () => setHasNew(false) };
}

export default useLearnerFeedback;
