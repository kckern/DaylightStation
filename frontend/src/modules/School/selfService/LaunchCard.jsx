/**
 * LaunchCard — what a correct code opens (design §3).
 *
 * The lesson, the one action it is at, and a way out. Three views, all of them
 * ending somewhere: the card itself, the "Did it print?" confirm, and a plain
 * sentence with a Done. Nothing here decides anything — `useSelfService` owns
 * the transitions, `offeredActions` owns which buttons exist and what they say.
 *
 * No learner name: the card is reached by a code that already named them, and
 * keeping the panel anonymous end to end means one less rule to remember.
 */

const PRINT_KINDS = new Set(['print', 'retry']);

/**
 * @param {object} props
 * @param {object} props.card - the `/resolve` payload: `{subject, title,
 *   sentence, actions}`. `sentence` is the planner's own wording for a card
 *   with nothing to do (served / locked / waiting) and is shown verbatim.
 * @param {'card'|'confirm'|'sentence'} props.view
 * @param {string|null} [props.sentence] - the `/act` outcome's words.
 * @param {boolean} [props.printAgain] - the child said it did NOT print, so
 *   the print button says so rather than repeating "Print your sheet".
 * @param {boolean} [props.busy]
 * @param {(action: object) => void} props.onAction
 * @param {(printed: boolean) => void} props.onConfirm
 * @param {() => void} props.onExit
 */
export default function LaunchCard({
  card,
  view = 'card',
  sentence = null,
  printAgain = false,
  busy = false,
  onAction,
  onConfirm,
  onExit,
}) {
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  // Every card ends with an exit — the paper path's never-dead-end rule. The
  // backend supplies one, but a card that somehow arrived without it must not
  // trap a child on a wall panel with no browser chrome behind it.
  const hasExit = actions.some((a) => a.kind === 'exit');

  return (
    <section className="school-selfservice-card" data-testid="selfservice-card">
      <header className="school-selfservice-card__head">
        {card?.subject && <p className="school-selfservice-card__subject">{card.subject}</p>}
        {card?.title && <h1 className="school-selfservice-card__title">{card.title}</h1>}
      </header>

      {view === 'card' && (
        <>
          {card?.sentence && <p className="school-selfservice-card__sentence">{card.sentence}</p>}
          <div className="school-selfservice-card__actions">
            {actions.map((action, i) => {
              const label = printAgain && PRINT_KINDS.has(action.kind) ? 'Print it again' : action.label;
              return (
                <button
                  key={`${action.kind}-${i}`}
                  type="button"
                  className={`school-selfservice-card__action school-selfservice-card__action--${action.kind}`}
                  onClick={() => (action.kind === 'exit' ? onExit() : onAction(action))}
                  disabled={busy}
                >
                  {label}
                </button>
              );
            })}
            {!hasExit && (
              <button
                type="button"
                className="school-selfservice-card__action school-selfservice-card__action--exit"
                onClick={onExit}
                disabled={busy}
              >
                Go back
              </button>
            )}
          </div>
        </>
      )}

      {view === 'confirm' && (
        <div className="school-selfservice-card__confirm">
          <p className="school-selfservice-card__sentence">Did it print?</p>
          <div className="school-selfservice-card__actions">
            <button type="button" className="school-selfservice-card__action" onClick={() => onConfirm(true)}>Yes</button>
            <button type="button" className="school-selfservice-card__action" onClick={() => onConfirm(false)}>No</button>
          </div>
        </div>
      )}

      {view === 'sentence' && (
        <div className="school-selfservice-card__outcome">
          {sentence && <p className="school-selfservice-card__sentence">{sentence}</p>}
          <div className="school-selfservice-card__actions">
            <button type="button" className="school-selfservice-card__action" onClick={onExit}>Done</button>
          </div>
        </div>
      )}
    </section>
  );
}
