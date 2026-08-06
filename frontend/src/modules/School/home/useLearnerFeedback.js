import { useEffect, useState } from 'react';
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
 * @param {string|null} learnerId
 * @param {{limit?: number}} [opts]
 * @returns {{items: Array<{itemId: string, sessionId: string, unitId: string|null,
 *   verdict: 'correct'|'incorrect', note: string|null, gradedBy: string|null,
 *   gradedAt: string|null, prompt: string|null, questionNumber: number|null}>,
 *   status: 'loading'|'ready'|'empty'|'error'}}
 */
export function useLearnerFeedback(learnerId, { limit = 20 } = {}) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(learnerId ? 'loading' : 'empty');

  useEffect(() => {
    if (!learnerId) { setItems([]); setStatus('empty'); return undefined; }
    let alive = true;
    setStatus('loading');
    schoolApi.reviewLearner(learnerId, { limit }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !Array.isArray(data)) {
        schoolLog.feedbackError('fetch-failed', { learnerId });
        setItems([]);
        setStatus('error');
        return;
      }
      setItems(data);
      setStatus(data.length ? 'ready' : 'empty');
      schoolLog.feedback('loaded', { learnerId, count: data.length });
    });
    return () => { alive = false; };
  }, [learnerId, limit]);

  return { items, status };
}

export default useLearnerFeedback;
