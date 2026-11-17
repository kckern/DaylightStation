import { StateMessage, LoadingState } from "#frontend/lib/ui/states.jsx";
import { SchoolButton } from '../../portal/SchoolButton.jsx';
/**
 * The one panel wrapper (spec §4.3): renders usePanelFetch's five states the
 * same way everywhere. `unavailableCopy` is the quiet per-panel notice for a
 * feature this install doesn't have; when a tab shows its single lifecycle
 * banner instead, it passes `suppressUnavailable` and the panel goes silent.
 *
 * `alwaysRender` is for panels whose children are a FORM, not fetched
 * content — an editable panel where a 404/empty read still offers its
 * affordances (assignments for an unassigned learner, milestones with none
 * set). State chrome renders above the children; `emptyCopy` is suppressed
 * because the form itself is the empty-state affordance.
 */
export default function PanelFrame({
  title, state, retry, children,
  emptyCopy = 'Nothing here yet.',
  // The server's own sentence, where a panel has one. Default stays the
  // generic line: most reads cannot say more than that they failed.
  errorCopy = null,
  unavailableCopy = 'Not available on this install.',
  suppressUnavailable = false,
  alwaysRender = false,
}) {
  return (
    <section className="teacher-panel" data-state={state}>
      <h2 className="teacher-panel__title">{title}</h2>
      {state === 'loading' && <LoadingState label={title} className="teacher-panel__skeleton" />}
      {state === 'error' && (
        <StateMessage state="error" role="alert" className="teacher-panel__error" title={errorCopy ?? <>Couldn&rsquo;t load {title}.</>}>
          {retry && <SchoolButton variant="plain" type="button" className="teacher-panel__retry" onClick={retry}>Retry</SchoolButton>}
        </StateMessage>
      )}
      {state === 'empty' && !alwaysRender && <StateMessage className="teacher-panel__empty" title={emptyCopy} />}
      {state === 'unavailable' && !suppressUnavailable && (
        <StateMessage state="unavailable" className="teacher-panel__empty" title={unavailableCopy} />
      )}
      {(state === 'ok' || (alwaysRender && state !== 'loading' && state !== 'unavailable')) && children}
    </section>
  );
}
