/**
 * PrintPendingView — over-budget print jobs awaiting a grown-up, with
 * approve/deny (wave 2, teacher.print.decide). Approve prints and logs with
 * the approver's stamp; deny drops the job. Server-authoritative refresh;
 * a refusal marks only its own job.
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import PanelFrame from './PanelFrame.jsx';

export default function PrintPendingView({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const pending = usePanelFetch(() => schoolApi.printPending(), { panel: 'print-pending' });
  const { run, busy, errors } = useTeacherWrite({ panel: 'print-pending' });

  const decide = (job, decision) => run(job.id, ({ actorId, pin }) => (
    decision === 'approve'
      ? schoolApi.printApprove(job.id, { approver: actorId, pin })
      : schoolApi.printDeny(job.id, { approver: actorId, pin })
  ), { onSuccess: pending.retry });

  return (
    <PanelFrame title="Print approvals" state={pending.state} retry={pending.retry} emptyCopy="No prints waiting.">
      <ul className="teacher-prints">
        {(pending.data ?? []).map((job) => (
          <li key={job.id} className="teacher-prints__job">
            <span>{nameFor(job.userId)}</span>
            <span>{job.label ?? job.printableId}</span>
            <span>{job.pages} pages × {job.copies}</span>
            <span className="teacher-prints__actions">
              <button type="button" disabled={busy === job.id} onClick={() => decide(job, 'approve')}>Approve</button>
              <button type="button" disabled={busy === job.id} onClick={() => decide(job, 'deny')}>Deny</button>
            </span>
            {errors[job.id] && <p className="teacher-panel__error">{errors[job.id]}</p>}
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
