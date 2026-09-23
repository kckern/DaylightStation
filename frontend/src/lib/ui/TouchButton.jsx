import './TouchButton.scss';

/** Kiosk-size, token-driven button (design system). Variants carry meaning, not colour choices at call sites. */
export function TouchButton({ variant = 'primary', keyHint = null, className = '', children, ...rest }) {
  return (
    <button {...rest} type="button" className={`ds-touch ds-touch--${variant} ${className}`.trim()}>
      <span className="ds-touch__label">{children}</span>
      {keyHint && <kbd className="ds-touch__key" aria-hidden="true">{keyHint}</kbd>}
    </button>
  );
}
export default TouchButton;
