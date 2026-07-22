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
        ‹ {material?.title}
      </button>
      <p className="school-material-player__loading">Loading player… {unit?.title}</p>
    </div>
  );
}
