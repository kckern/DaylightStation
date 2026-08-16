import './gameChrome.scss';

/**
 * A slot on the rail — the platform's one unit of furniture.
 *
 * Its whole point is `reserve`: a slot holds its size whether or not it has
 * anything to say. The rails size the stage, so a read-out that grows a line as
 * fingers land moves the BOARD — during the exact half-second the player is
 * looking at it. Pass the height measured above the slot's TALLEST state, never
 * a floor below it: a floor reserves nothing, because the box still shrinks for
 * shorter messages, which is the defect it was supposed to fix.
 *
 * Variants are states, not skins:
 *   active — live right now (accent border + a tint of the same accent)
 *   muted  — available, but nothing to use it on yet (dimmed, never hidden)
 *   lift   — nested, or carrying the game's own voice
 *   well   — a socket: an inset lip that reads as "something goes here"
 *   plain  — the label and the reservation without an edge of its own
 */
export default function GameSlot({
  label = null,
  reserve = null,
  variant = null,
  center = false,
  as: Element = 'section',
  className = '',
  children,
  ...rest
}) {
  const variants = (Array.isArray(variant) ? variant : [variant])
    .filter(Boolean)
    .map((name) => `pg-slot--${name}`)
    .join(' ');
  const classes = ['pg-slot', variants, center ? 'pg-slot--center' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <Element
      className={classes}
      style={reserve ? { '--pg-slot-reserve': reserve } : undefined}
      {...rest}
    >
      {/* h2 rather than a styled span: a rail is a list of named regions, and a
          screen reader should be able to jump between them. */}
      {label && <h2 className="pg-slot__label">{label}</h2>}
      <div className="pg-slot__body">{children}</div>
    </Element>
  );
}
