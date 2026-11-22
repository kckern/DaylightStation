import './MediaRadioOption.scss';

/** Native radio behavior with a label that callers can style as a choice card. */
export function MediaRadioOption({
  name,
  value,
  checked,
  onChange,
  children,
  className = '',
  contentClassName = '',
  disabled = false,
  ariaDisabled = false,
  testId,
}) {
  return (
    <label
      className={`media-radio-option ${className}`.trim()}
      data-checked={checked ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-aria-disabled={ariaDisabled ? 'true' : undefined}
      data-testid={testId}
    >
      <input
        className="media-radio-option__input"
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-disabled={ariaDisabled || undefined}
        onChange={() => onChange(value)}
      />
      <span className={`media-radio-option__content ${contentClassName}`.trim()}>{children}</span>
    </label>
  );
}

export default MediaRadioOption;
