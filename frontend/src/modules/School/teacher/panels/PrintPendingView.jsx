/**
 * PrintPendingView — over-budget print jobs awaiting a grown-up (read-only;
 * approve/deny is the teacher.print.decide stub until wave 2).
 */
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import PanelFrame from './PanelFrame.jsx';

export default function PrintPendingView({ kids }) {
  const nameFor = (id) => kids.find((k) => k.id === id)?.name ?? id;
  const pending = usePanelFetch(() => schoolApi.printPending(), { panel: 'print-pending' });
  return (
    <PanelFrame title="Print approvals" state={pending.state} retry={pending.retry} emptyCopy="No prints waiting.">
      <ul className="teacher-prints">
        {(pending.data ?? []).map((job) => (
          <li key={job.id} className="teacher-prints__job">
            <span>{nameFor(job.userId)}</span>
            <span>{job.label ?? job.printableId}</span>
            <span>{job.pages} pages × {job.copies}</span>
          </li>
        ))}
      </ul>
    </PanelFrame>
  );
}
