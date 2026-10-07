import { TouchButton } from '../../../../../lib/ui/index.js';
import './PracticeAssessmentPanel.scss';
export default function PracticeAssessmentPanel({ progress, busy = false, onPrint, onReview, notice = null }) {
  if (!progress) return null;
  const { stage, resolvedQuestionIds = [], totalQuestions = 0 } = progress;
  const printable = ['quiz_ready', 'retry_ready', 'quiz_issued'].includes(stage);
  const label = stage === 'retry_ready' ? 'Print retry' : stage === 'quiz_issued' ? 'Reprint quiz' : 'Print quiz';
  return <section className="wl-assessment" aria-label="Lesson assessment">
    <p>{stage === 'completed' ? 'Lesson complete' : `${resolvedQuestionIds.length} of ${totalQuestions} questions resolved`}</p>
    {stage === 'practice' && <p>{progress.missingCardIds?.length ?? 0} cards still need recognition and matching before the quiz.</p>}
    {stage === 'quiz_ready' && <p>Your quiz is ready to print.</p>}
    {stage === 'quiz_issued' && <p>Your printed quiz is waiting to be graded.</p>}
    {stage === 'locked' && <p>{progress.message ?? 'This lesson is not ready.'}</p>}
    {stage === 'review' && <><p>Study the missed skills, then pass both card checks to unlock your short retry.</p>{(progress.feedback ?? []).map((f) => <p key={f.questionId}>{f.explanation}</p>)}<TouchButton disabled={busy} onClick={onReview}>Review missed skills</TouchButton></>}
    {printable && <TouchButton disabled={busy} onClick={onPrint}>{label}</TouchButton>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
