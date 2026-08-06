/**
 * useTeacherToday — the household teacher's one-glance "today" digest.
 *
 * Consumes `GET /api/v1/school/teacher/today` (`GetTeacherToday`), which
 * answers a plain array — NOT `{learners: [...]}` — one row per roster
 * learner: `{learnerId, attemptsToday, correctToday, sessionsToday, pendingReview}`.
 * Fetched once per mount, the same posture ReportPanel already uses for
 * `report`/`progress`/`progressOptions`.
 *
 * A failed fetch is reported, never swallowed (house rule: failures are
 * never silent) — the caller renders a visible failed-to-load line rather
 * than leaving the strip blank or pretending nobody did anything today.
 *
 * @module School/report/useTeacherToday
 */
import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';

/**
 * @returns {{byLearner: Map<string, {learnerId: string, attemptsToday: number,
 *   correctToday: number, sessionsToday: Array<{unitId: string|null, state: string|null}>,
 *   pendingReview: number}>, status: 'loading'|'ready'|'error'}}
 */
export function useTeacherToday() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    schoolApi.teacherToday().then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !Array.isArray(data)) {
        schoolLog.teacherTodayError('fetch-failed', {});
        setRows([]);
        setStatus('error');
        return;
      }
      setRows(data);
      setStatus('ready');
      schoolLog.teacherToday('loaded', { learners: data.length });
    });
    return () => { alive = false; };
  }, []);

  const byLearner = useMemo(() => new Map(rows.map((row) => [row.learnerId, row])), [rows]);

  return { byLearner, status };
}

export default useTeacherToday;
