import PropTypes from 'prop-types';
import Icon from '../home/icons/Icon.jsx';
import './screenHeader.scss';

/**
 * ScreenHeader — the one header every School screen wears.
 *
 * Three screens had each invented one: the shelf's `Reading` + chip + a
 * capitalised `Done`, the sub-views' lowercase `‹ back` sitting in the body,
 * the keypad's bare title. Same height, padding and type from here on, and
 * ONE RULE ABOUT EXITS: a screen has one exit in its header. `Done` leaves
 * the screen; `Back` steps within it (a sub-view returning to the shelf), and
 * both appear only in that case — never two ways out of the same place.
 *
 *   [‹ Back]  Title  ·identity·                              [Done]
 *
 * Back is an icon plus the word, sentence case, sized like a keypad key so a
 * child's thumb finds it where every other tappable thing on these screens
 * is. The identity chip rides beside the title — who this screen belongs to,
 * a walk-away safeguard on a shared kiosk, not a decoration.
 */
export default function ScreenHeader({
  title, identity = null, onBack = null, backLabel = 'Back', backDisabled = false,
  onDone = null, doneLabel = 'Done', doneDisabled = false, className = '', testId = 'screen-header',
}) {
  return (
    <header className={`school-screen-header ${className}`.trim()} data-testid={testId}>
      <div className="school-screen-header__lead">
        {onBack ? (
          <button
            type="button"
            className="school-screen-header__back"
            disabled={backDisabled}
            onClick={() => { if (!backDisabled) onBack(); }}
            data-testid="screen-header-back"
          >
            <Icon name="back" className="school-screen-header__back-icon" />
            <span>{backLabel}</span>
          </button>
        ) : null}
        {title ? <h2 className="school-screen-header__title">{title}</h2> : null}
        {identity ? <div className="school-screen-header__identity">{identity}</div> : null}
      </div>
      {onDone ? (
        <button
          type="button"
          className="school-screen-header__done"
          disabled={doneDisabled}
          onClick={() => { if (!doneDisabled) onDone(); }}
          data-testid="screen-header-done"
        >
          {doneLabel}
        </button>
      ) : null}
    </header>
  );
}

ScreenHeader.propTypes = {
  title: PropTypes.node,
  /** The learner chip, or anything naming whose screen this is. */
  identity: PropTypes.node,
  /** A step WITHIN the screen. Absent on a screen's root view. */
  onBack: PropTypes.func,
  backLabel: PropTypes.string,
  backDisabled: PropTypes.bool,
  /** The one way OUT of the screen. */
  onDone: PropTypes.func,
  doneLabel: PropTypes.string,
  doneDisabled: PropTypes.bool,
  className: PropTypes.string,
  testId: PropTypes.string,
};
