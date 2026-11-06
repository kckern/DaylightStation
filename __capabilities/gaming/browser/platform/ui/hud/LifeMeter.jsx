export default function LifeMeter({
  current,
  maximum,
  dangerAt = 0.25,
  variant = 'notches',
  glyph = '♥',
  emptyGlyph = '♡',
  label = 'Health',
  ariaLabel,
  className = '',
}) {
  const extra = className ? ` ${className}` : '';
  const live = Math.max(0, Number(current) || 0);
  if (variant === 'glyphs') {
    // role="img" must always carry a name; default to "<count> <label>".
    const name = ariaLabel ?? `${live} ${label}`;
    return (
      <span className={`game-hud-life game-hud-life--glyphs${extra}`} role="img" aria-label={name}>
        {glyph.repeat(Math.max(0, Math.floor(live))) || emptyGlyph}
      </span>
    );
  }
  const total = Math.max(0, Math.floor(Number(maximum) || 0));
  const lit = Math.ceil(live);
  return (
    <div
      className={`game-hud-life${extra}`}
      role="meter"
      aria-label={label}
      aria-valuemin="0"
      aria-valuemax={total}
      aria-valuenow={lit}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`game-hud-life__notch${index < lit ? ' is-active' : ''}${
            index < lit && live <= total * dangerAt ? ' is-danger' : ''
          }`}
        />
      ))}
    </div>
  );
}
