/**
 * The paper trail for ONE lesson, folded shut until asked for.
 *
 * The dashboard used to render every session's artifacts eagerly, which meant
 * a full session-document fetch per session on page load (N+1) and a third
 * separate rendering of a lesson the teacher had already read twice above
 * (UX audit IA1). Here the record belongs to its own row and costs nothing
 * until a teacher opens it.
 */
import { useState } from 'react';
import { usePanelFetch } from '../usePanelFetch.js';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import IssuedArtifactCard from './IssuedArtifactCard.jsx';

const isReceipt = (artifact) => artifact.kind === 'result-receipt' || artifact.role === 'result-receipt';

function PaperBody({ sessionId, lessonTitle }) {
  const detail = usePanelFetch(() => teacherWorkspaceApi.session(sessionId), {
    deps: [sessionId], panel: `paper-${sessionId}`, notFoundAs: 'unavailable',
  });
  if (detail.state === 'loading') return <p className="teacher-panel__empty">Loading the issued files…</p>;
  if (detail.state === 'error') {
    return <p className="teacher-panel__error">Couldn&rsquo;t load this lesson&rsquo;s paper record.
      <button type="button" className="teacher-panel__retry" onClick={detail.retry}>Retry</button></p>;
  }
  if (detail.state === 'unavailable') return <p className="teacher-panel__empty">Paper records are not kept on this install.</p>;
  const artifacts = detail.data?.artifacts ?? [];
  const worksheet = artifacts.find((artifact) => !isReceipt(artifact));
  const receipt = artifacts.find(isReceipt);
  if (!worksheet && !receipt) return <p className="teacher-panel__empty">No worksheet or result receipt is linked to this lesson.</p>;
  const title = detail.data?.taxonomy?.lessonTitle ?? lessonTitle;
  return <div className="teacher-paper-record__cards">
    {worksheet && <IssuedArtifactCard artifact={worksheet} lessonTitle={title} />}
    {receipt && <IssuedArtifactCard artifact={receipt} lessonTitle={title} />}
  </div>;
}

export default function SessionPaperRecord({ sessionId, lessonTitle = 'Lesson' }) {
  const [open, setOpen] = useState(false);
  if (!sessionId) return null;
  return (
    <details className="teacher-paper-record" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Paper record</summary>
      {open && <PaperBody sessionId={sessionId} lessonTitle={lessonTitle} />}
    </details>
  );
}
