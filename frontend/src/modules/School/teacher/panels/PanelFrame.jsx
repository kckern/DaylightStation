/**
 * The one panel wrapper (spec §4.3): renders usePanelFetch's five states the
 * same way everywhere. `unavailableCopy` is the quiet per-panel notice for a
 * feature this install doesn't have; when a tab shows its single lifecycle
 * banner instead, it passes `suppressUnavailable` and the panel goes silent.
 */
export default function PanelFrame({
  title, state, retry, children,
  emptyCopy = 'Nothing here yet.',
  unavailableCopy = 'Not available on this install.',
  suppressUnavailable = false,
}) {
  return (
    <section className="teacher-panel" data-state={state}>
      <h2 className="teacher-panel__title">{title}</h2>
      {state === 'loading' && <div className="teacher-panel__skeleton" aria-hidden />}
      {state === 'error' && (
        <p className="teacher-panel__error">
          Couldn&rsquo;t load {title}.
          {retry && <button type="button" className="teacher-panel__retry" onClick={retry}>Retry</button>}
        </p>
      )}
      {state === 'empty' && <p className="teacher-panel__empty">{emptyCopy}</p>}
      {state === 'unavailable' && !suppressUnavailable && (
        <p className="teacher-panel__empty">{unavailableCopy}</p>
      )}
      {state === 'ok' && children}
    </section>
  );
}
