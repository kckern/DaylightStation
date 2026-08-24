import './gameChrome.scss';

/**
 * The only button in a piano game.
 *
 * Three voices — primary (the one thing to do next), ghost (a way out), icon
 * (settings, help) — and one guarantee: every one of them clears `--pg-tap`.
 * The "Play again" pill that ended a finished game was `.45rem .9rem` tall,
 * roughly 30px, on a tablet with no pointer, and it was the only way to start
 * the next game.
 *
 * `type="button"` by default because none of these submit anything, and a bare
 * <button> inside a <form> defaults to submit.
 */
export default function GameButton({
  variant = null,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const classes = ['pg-btn', variant ? `pg-btn--${variant}` : '', className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest}>{children}</button>;
}
