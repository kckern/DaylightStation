import { TouchButton } from '../../../../../lib/ui/index.js';
import Icon from '../../../home/icons/Icon.jsx';

/**
 * The sitting header (owner-approved layout):
 *
 *   [back] Exit   Review [tick] › LEARN › Sort › Quiz › Match › Practice   3 left
 *            Round 1 · New words
 *   [time bar]
 *   Meet each new word.                              ← once per step
 *
 * The trail is `stepTrail()`'s output; this only draws it. On a narrow stage
 * the trail collapses to its current step (a container query in the SCSS).
 */
export default function CardLadderHeader({
  trail, onExit, right = null, timePct = 0, hint = null,
}) {
  return (
    <>
      <header className="wl-header">
        <TouchButton variant="secondary" className="wl-header__exit" onClick={onExit}>
          <Icon name="back" /> Exit
        </TouchButton>
        {trail.steps.length > 0 ? (
        <ol className="wl-trail" aria-label="Today's steps">
          {trail.steps.map((step) => (
            <li
              key={step.id}
              className={`wl-trail__step is-${step.state}${step.locked ? ' is-locked' : ''}`}
              data-state={step.state}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              {step.state === 'done' && <Icon name="keep" className="wl-trail__tick" />}
              <span className="wl-trail__label">{step.label}</span>
              {step.note && <span className="wl-trail__note">{step.note}</span>}
            </li>
          ))}
        </ol>
        ) : <span className="wl-trail" />}
        <div className="wl-header__right">{right}</div>
        <p className="wl-header__round" aria-label="Progress">{trail.subLine}</p>
        <div className="wl-header__time" aria-hidden="true"><div style={{ transform: `scaleX(${timePct / 100})` }} /></div>
      </header>
      <div className="wl-hint" aria-live="polite">
        {hint && <p key={hint.step} className={`wl-hint__text${hint.leaving ? ' is-leaving' : ''}`}>{hint.text}</p>}
      </div>
    </>
  );
}
