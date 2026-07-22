/**
 * Materials player -- PLACEHOLDER (Task 7 replaces the internals; this task
 * only establishes the props contract so MaterialsSection's grid -> detail ->
 * player flow is wired and testable end-to-end).
 *
 * Props contract: {material, unit, userId, onExit}. Task 7 owns actual
 * playback, progress writes (`schoolApi.unitProgress`) and the no-write rule
 * for guests -- none of that is implemented here.
 */
export default function SchoolMaterialPlayer({ material, unit, userId, onExit }) {
  return (
    <div className="school-material-player" data-user-id={userId ?? ''}>
      <button type="button" className="school-material-player__back" onClick={onExit}>
        <svg className="school-back-chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {material?.title}
      </button>
      <p className="school-material-player__loading">Loading player… {unit?.title}</p>
    </div>
  );
}
