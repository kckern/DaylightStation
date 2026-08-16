import './gameChrome.scss';

/**
 * A setting that is on or off.
 *
 * Replaces a bare `<input type="checkbox">`, which on the kiosk's 2018 WebView
 * renders as a light-grey OS widget sitting on a charcoal panel, at a hit size a
 * child misses. The whole row is the target, and the switch says which way it is
 * pointing by position as well as by colour.
 *
 * A real button with `role="switch"`, not a restyled input: the label is inside
 * the control, so there is nothing to mis-associate.
 */
export function GameToggle({ label, checked = false, onChange, className = '', ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`pg-toggle ${className}`.trim()}
      onClick={() => onChange?.(!checked)}
      {...rest}
    >
      <span className="pg-toggle__label">{label}</span>
      <span className="pg-toggle__track" aria-hidden="true">
        <span className="pg-toggle__knob" />
      </span>
    </button>
  );
}

/**
 * A setting with a small, fixed set of answers.
 *
 * Replaces a native `<select>` — the only one in any piano game, and the only
 * control in the kiosk that opens an OS picker. Every option is visible at once,
 * because a dropdown hides the thing the player is choosing between behind a tap
 * and gives them nothing to compare.
 *
 * `radiogroup`/`radio` rather than a listbox: these are peers, exactly one is
 * chosen, and arrow keys should walk them.
 */
export function GameChoice({ label = null, value, options = [], onChange, className = '' }) {
  return (
    <div className={`pg-choice-group ${className}`.trim()}>
      {label && <span className="pg-slot__label">{label}</span>}
      <div className="pg-choice" role="radiogroup" aria-label={label ?? undefined}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className="pg-choice__opt"
            onClick={() => onChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default GameToggle;
