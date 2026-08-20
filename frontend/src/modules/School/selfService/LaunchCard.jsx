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
 *
 * WORDING IS NOT DECIDED HERE. Every button renders `action.label` verbatim.
 * `offeredActions` is the ONE authority on what a card offers and what each
 * button says — its own header cites the duplicated judgement in
 * `offerSession.mjs:133-145` that drifted and had to be deleted. A second
 * wording authority in the frontend is that same failure one layer up, and it
 * shows as a button whose text disagrees with what the backend is offering.
 * `action.kind` is the action's IDENTITY (it is what `/act` looks up); `label`
 * is for the child's eyes only.
 */

/**
 * @param {object} props
 * @param {object} props.card - the `/resolve` payload: `{subject, title,
 *   sentence, actions}`. `sentence` is the planner's own wording for a card
 *   with nothing to do (served / locked / waiting) and is shown verbatim.
 * @param {'card'|'confirm'|'sentence'} props.view
 * @param {string|null} [props.sentence] - the `/act` outcome's words.
 * @param {boolean} [props.busy]
 * @param {(action: object) => void} props.onAction
 * @param {(printed: boolean) => void} props.onConfirm
 * @param {() => void} props.onExit
 */
export default function LaunchCard({
  card,
  view = 'card',
  sentence = null,
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
            {actions.map((action, i) => (
              <button
                key={`${action.kind}-${i}`}
                type="button"
                className={`school-selfservice-card__action school-selfservice-card__action--${action.kind}`}
                /* Addressable by KIND, which is the action's stable identity.
                   Labels belong to `offeredActions` and change with the
                   session state and the config, so nothing should have to
                   find a button by what it says. */
                data-testid={`selfservice-action-${action.kind}`}
                onClick={() => (action.kind === 'exit' ? onExit() : onAction(action))}
                disabled={busy}
              >
                {/* Verbatim. The domain owns this wording — see the header. */}
                {action.label}
              </button>
            ))}
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
