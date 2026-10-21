/** Step progress and the late badge. */
export default function SchoolDebriefHeader({ view, late, promptIdx, promptCount }) {
  const qs = view?.questions ?? null;
  const answered = qs ? Object.keys(view.answers ?? {}).length : 0;
  const label = !view ? '' : qs ? `Question ${Math.min(answered + 1, qs.length)} of ${qs.length}` : `Part ${Math.min(promptIdx + 1, promptCount)} of ${promptCount}`;
  return (
    <header className="sd-header">
      <span className="sd-header__title">After-school debrief</span>
      {late && <span className="sd-header__late">Late</span>}
      <span className="sd-header__step">{label}</span>
    </header>
  );
}
