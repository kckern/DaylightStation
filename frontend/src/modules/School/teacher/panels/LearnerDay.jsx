/**
 * The expanded dashboard record for work completed today.
 *
 * This intentionally reads only the teacher session projection.  The old
 * version joined planner hints, a transient "printable" queue, lifecycle
 * rows, and score summaries; those are different concepts and produced
 * contradictory statements about one lesson.  A completed session instead
 * owns its issued worksheet and result-receipt artifacts.
 */
import { usePanelFetch } from '../usePanelFetch.js';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import IssuedArtifactCard from './IssuedArtifactCard.jsx';

const isReceipt = (artifact) => artifact.kind === 'result-receipt' || artifact.role === 'result-receipt';

function SessionArtifacts({ summary }) {
  const sessionId = summary.sessionId;
  const detail = usePanelFetch(
    () => teacherWorkspaceApi.session(sessionId),
    { deps: [sessionId], panel: `today-session-${sessionId}`, notFoundAs: 'unavailable' },
  );
  const session = detail.data;
  const taxonomy = session?.taxonomy ?? summary;
  const artifacts = session?.artifacts ?? [];
  // An unavailable artifact is still important evidence: hiding it behind a
  // generic empty state implies nothing was issued.  Show its honest archival
  // status beside retained originals instead.
  const worksheet = artifacts.find((artifact) => !isReceipt(artifact));
  const receipt = artifacts.find(isReceipt);
  const lessonTitle = taxonomy.lessonTitle ?? summary.lessonTitle ?? 'Lesson';

  return <section className="teacher-today-record">
    {detail.state === 'loading' && <p className="teacher-panel__empty">Loading the issued files…</p>}
    {detail.state === 'error' && <p className="teacher-panel__error">Couldn&rsquo;t load this lesson&rsquo;s issued files. <button type="button" onClick={detail.retry}>Retry</button></p>}
    {detail.state === 'unavailable' && <p className="teacher-panel__empty">The historical record is unavailable.</p>}
    {detail.state === 'ok' && <div className="teacher-today-record__artifacts">
      {worksheet && <IssuedArtifactCard artifact={worksheet} lessonTitle={lessonTitle} />}
      {receipt && <IssuedArtifactCard artifact={receipt} lessonTitle={lessonTitle} />}
      {!worksheet && !receipt && <p className="teacher-panel__empty">No issued worksheet or result receipt is linked to this session.</p>}
    </div>}
  </section>;
}

export default function LearnerDay({ sessions = [] }) {
  if (!sessions.length) return null;
  return <section className="teacher-issued-records" aria-label="Today’s issued materials and results">
    <h3>Today&rsquo;s paper and results</h3>
    <p>Open retained originals for each completed lesson. If an older print was not archived, that record says so plainly.</p>
    {sessions.filter((session) => session.sessionId).map((session) => (
      <SessionArtifacts key={session.sessionId} summary={session} />
    ))}
  </section>;
}
