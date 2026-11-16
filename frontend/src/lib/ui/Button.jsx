import { forwardRef, useRef } from 'react';
import './TouchButton.scss';

/** Native button with house focus, density, pending and optional touch-down activation. */
export const Button = forwardRef(function Button({
  variant = 'primary', density = 'touch', busy = false, activation = 'release',
  type = 'button', disabled = false, className = '', children, keyHint = null,
  onClick, onPointerDown, onPointerCancel, 'aria-busy': ariaBusy, ...rest
}, ref) {
  const suppressPointerClick = useRef(false);
  const unavailable = disabled || busy;
  return <button {...rest} ref={ref} type={type} disabled={unavailable}
    aria-busy={busy || ariaBusy} data-density={density}
    className={`ds-touch ds-touch--${variant} ${className}`.trim()}
    onPointerDown={event => {
      if (unavailable) return;
      onPointerDown?.(event);
      if (activation !== 'press' || event.defaultPrevented || event.button !== 0 || event.isPrimary === false) return;
      // Native click supplies form submission and cancellation semantics. Suppress
      // the subsequent pointer-generated click, while keyboard/AT clicks stay live.
      suppressPointerClick.current = false;
      event.currentTarget.click();
      suppressPointerClick.current = true;
    }}
    onPointerCancel={event => { suppressPointerClick.current = false; onPointerCancel?.(event); }}
    onClick={event => {
      if (unavailable || (activation === 'press' && suppressPointerClick.current && event.detail > 0)) {
        event.preventDefault();
        suppressPointerClick.current = false;
        return;
      }
      suppressPointerClick.current = false;
      onClick?.(event);
    }}>
    <span className="ds-touch__label">{children}</span>
    {keyHint && <kbd className="ds-touch__key" aria-hidden="true">{keyHint}</kbd>}
  </button>;
});
export default Button;
