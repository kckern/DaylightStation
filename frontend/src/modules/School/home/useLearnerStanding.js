import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

/**
 * useLearnerStanding — kid-visible standing (Task 9, adequacy SHOULD 9): "a
 * child sees where they stand, not only what to fix". Resolves the CURRENT
 * academic period client-side from `GET /periods` (the period whose
 * `startsAt <= now < endsAt`), then reads that period's live report card for
 * every course with a graded session.
 *
 * Two independent zero-states, both silent (no error chrome for something
 * that just hasn't happened yet):
 *   - no current period configured -> `courses: []`, `status: 'empty'`
 *   - a current period exists but nothing is graded in it -> same
 *
 * A genuine fetch failure is logged and also renders as empty — a broken
 * standing panel must never look like a crash to a child.
 */

/** Pure: which configured period (if any) contains `nowIso`. */
export function currentPeriodFor(periods, nowIso = new Date().toISOString()) {
  return (periods ?? []).find((p) => p?.startsAt <= nowIso && nowIso < p?.endsAt) ?? null;
}

/**
 * Pure: the report card's courses, reduced to what a child can read at a
 * glance — only courses with a graded session ('CourseId: N%'), a course's
 * own `label` when the payload carries one (it does not, today) else the
 * bare courseId.
 */
export function deriveStanding(report) {
  if (!report || !Array.isArray(report.courses)) return [];
  return report.courses
    .filter((c) => typeof c?.coursePercent === 'number' && Number.isFinite(c.coursePercent))
    .map((c) => ({
      courseId: c.courseId,
      label: c.label ?? c.courseId,
      percent: Math.round(c.coursePercent),
    }));
}

/**
 * @param {string|null} learnerId
 * @returns {{courses: Array<{courseId: string, label: string, percent: number}>,
 *   status: 'loading'|'ready'|'empty'|'error', periodId: string|null}}
 */
export function useLearnerStanding(learnerId) {
  const [periods, setPeriods] = useState(null);
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    schoolApi.periods().then(({ ok, data }) => {
      if (!alive) return;
      setPeriods(ok && Array.isArray(data) ? data : []);
    });
    return () => { alive = false; };
  }, []);

  const currentPeriod = useMemo(() => currentPeriodFor(periods), [periods]);

  useEffect(() => {
    if (!learnerId) { setReport(null); setStatus('empty'); return undefined; }
    if (periods === null) return undefined; // still awaiting the periods fetch
    if (!currentPeriod) { setReport(null); setStatus('empty'); return undefined; }
    let alive = true;
    setStatus('loading');
    schoolApi.reportCard({ learnerId, periodId: currentPeriod.periodId }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !data) {
        schoolLog.standingError('fetch-failed', { learnerId, periodId: currentPeriod.periodId });
        setReport(null);
        setStatus('error');
        return;
      }
      const found = deriveStanding(data);
      setReport(data);
      setStatus(found.length ? 'ready' : 'empty');
      schoolLog.standing('loaded', { learnerId, periodId: currentPeriod.periodId, courses: found.length });
    });
    return () => { alive = false; };
  }, [learnerId, periods, currentPeriod]);

  const courses = useMemo(() => deriveStanding(report), [report]);

  return { courses, status, periodId: currentPeriod?.periodId ?? null };
}

export default useLearnerStanding;
