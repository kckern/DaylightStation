/**
 * PrintPendingView — over-budget print jobs awaiting a grown-up, with
 * approve/deny (wave 2, teacher.print.decide). Approve prints and logs with
 * the approver's stamp; deny drops the job. Server-authoritative refresh;
 * a refusal marks only its own job.
 *
 * Two reads ride alongside the decision, neither of which may take the panel
 * down (audit 4.3): a preview link to the sheet itself — the same read
 * `previewPrintable` gives an approver by design (teacher reference §6),
 * used until now only by the child's own Print Center — and the requester's
 * rolling quota, so "over budget" comes with "by how much" rather than a
 * bare number of pages. The quota is ONE read per distinct child on the
 * list, not one per job: two pending jobs from the same kid share it.
 */
import { useEffect, useMemo, useState } from 'react';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherLog } from '../teacherLog.js';
import PanelFrame from './PanelFrame.jsx';
import { waitAge } from './waitAge.js';

/**
 * One quota read per distinct `userId` on the current job list, keyed off a
 * joined string so a rerender with the same ids (a busy/error state change,
 * for instance) does not refire it. A failed read simply leaves that child
 * absent from the map — the quota LINE renders nothing, approve/deny are
 * untouched either way.
 */
function useQuotaByUser(userIds) {
  const key = userIds.join(',');
  const [quotaByUser, setQuotaByUser] = useState({});
  useEffect(() => {
    let alive = true;
    if (!key) { setQuotaByUser({}); return undefined; }
    key.split(',').forEach((userId) => {
      schoolApi.printQuota(userId).then((response) => {
        if (!alive) return;
        if (!response.ok) {
          teacherLog.fetch('print-quota-failed', { userId, status: response.status });
          return;
        }
        setQuotaByUser((current) => ({ ...current, [userId]: response.data }));
      }).catch(() => {
        if (alive) teacherLog.fetchError('print-quota-threw', { userId });
      });
    });
    return () => { alive = false; };
     
  }, [key]);
  return quotaByUser;
}

export default function PrintPendingView({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  // 404 = the feature isn't wired on this install — the quiet unavailable
  // copy, never a Retry that can't succeed.
  const pending = usePanelFetch(() => schoolApi.printPending(), { panel: 'print-pending', notFoundAs: 'unavailable' });
  const jobs = useMemo(() => (Array.isArray(pending.data) ? pending.data : []), [pending.data]);
  const { run, busy, errors } = useTeacherWrite({ panel: 'print-pending' });
  const userIds = useMemo(() => [...new Set(jobs.map((job) => job.userId).filter(Boolean))], [jobs]);
  const quotaByUser = useQuotaByUser(userIds);

  const decide = (job, decision) => run(job.id, ({ actorId, pin }) => (
    decision === 'approve'
      ? schoolApi.printApprove(job.id, { approver: actorId, pin })
      : schoolApi.printDeny(job.id, { approver: actorId, pin })
  ), { onSuccess: pending.retry });

  return (
    <PanelFrame title="Print approvals" state={pending.state} retry={pending.retry} emptyCopy="No prints waiting." unavailableCopy="Print approvals aren't enabled on this install.">
      <ul className="teacher-prints">
        {jobs.map((job) => {
          const quota = quotaByUser[job.userId];
          return (
            <li key={job.id} className="teacher-prints__job">
              <span>{nameFor(job.userId)}</span>
              <span>{job.label ?? job.title ?? 'Print request with no published title'}</span>
              <span>{job.pages} pages × {job.copies}</span>
              {waitAge(job.at) && <span className="teacher-review__age">waiting {waitAge(job.at)}</span>}
              {job.printableId && (
                <a className="teacher-prints__preview" href={schoolApi.printablePreviewUrl(job.printableId)} target="_blank" rel="noreferrer">
                  Preview sheet
                </a>
              )}
              {/* A fact beside the job, not a second decision — approve/deny
                  are the only verbs here either way. */}
              {quota && (
                <span className="teacher-prints__quota">
                  {quota.pagesInWindow} of {quota.pagesPerWindow} pages this window
                </span>
              )}
              <span className="teacher-prints__actions">
                <button type="button" disabled={busy === job.id} onClick={() => decide(job, 'approve')}>Approve</button>
                <button type="button" disabled={busy === job.id} onClick={() => decide(job, 'deny')}>Deny</button>
              </span>
              {errors[job.id] && <p className="teacher-panel__error">{errors[job.id]}</p>}
            </li>
          );
        })}
      </ul>
    </PanelFrame>
  );
}
