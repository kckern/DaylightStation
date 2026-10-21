/**
 * "What is waiting on a grown-up" — counted ONCE, for the rail badge, the
 * phone tab bar and the dashboard strip alike. They used to count three
 * different things (audit 2026-10-21 §0.4) and none refreshed when the
 * teacher acted. Answer-sheet pairing is not counted: its list read is
 * itself capability-gated, so a locked console cannot know it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { schoolApi } from "../schoolApi.js";
import { teacherLog } from "./teacherLog.js";

const countOf = (response, pick) => (response.ok ? pick(response.data) : null);
// A 404 is an install without that feature — absent, not broken.
const broken = (response) => !response.ok && response.status !== 404;

export function useBacklog({ pollMs = 60_000 } = {}) {
  const [counts, setCounts] = useState({ review: null, prints: null, quizzes: null, total: 0, failed: false });
  const alive = useRef(true);
  // The 60s poll and an onChanged refresh can overlap; only the latest read
  // may land, or a slow older answer puts back a count the teacher cleared.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    // A hidden tab polls nothing; visibilitychange below catches up on return.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const mine = ++seq.current;
    const [review, prints, quizzes] = await Promise.all([
      schoolApi.lifecycleReview(), schoolApi.printPending(), schoolApi.quizRequests(),
    ]);
    if (!alive.current || mine !== seq.current) return;
    const next = {
      review: countOf(review, (d) => (d?.items ?? []).length),
      prints: countOf(prints, (d) => (Array.isArray(d) ? d.length : 0)),
      // Arrays only: QuizRequestBacklog renders nothing else, and the badge
      // must not count rows the queue will not show.
      quizzes: countOf(quizzes, (d) => (Array.isArray(d) ? d.length : 0)),
    };
    const failed = [review, prints, quizzes].some(broken);
    if (failed) teacherLog.fetch('backlog-failed', { reviewStatus: review.status, printStatus: prints.status, quizStatus: quizzes.status });
    setCounts({ ...next, total: (next.review ?? 0) + (next.prints ?? 0) + (next.quizzes ?? 0), failed });
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const timer = pollMs > 0 ? setInterval(refresh, pollMs) : null;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh, pollMs]);

  return { ...counts, refresh };
}
