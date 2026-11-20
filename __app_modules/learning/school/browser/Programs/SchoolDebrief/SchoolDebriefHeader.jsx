import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';

/** Whose debrief this is, step progress and the late badge. */
export default function SchoolDebriefHeader({ view, late, promptIdx, promptCount, learnerId = null, learnerName = null }) {
  const qs = view?.questions ?? null;
  const answered = qs ? Object.keys(view.answers ?? {}).length : 0;
  const finished = ['completed', 'excused', 'rejected'].includes(view?.phase);
  const label = !view || finished ? '' : qs ? `Question ${Math.min(answered + 1, qs.length)} of ${qs.length}` : `Part ${Math.min(promptIdx + 1, promptCount)} of ${promptCount}`;
  return (
    <header className="sd-header">
      <span className="sd-header__title">After-school debrief</span>
      {late && <span className="sd-header__late">Late</span>}
      <span className="sd-header__step">{label}</span>
      {learnerId && <span className="sd-header__learner"><ProfileAvatar id={learnerId} name={learnerName ?? learnerId} size={160} /><span>{learnerName ?? learnerId}</span></span>}
    </header>
  );
}
