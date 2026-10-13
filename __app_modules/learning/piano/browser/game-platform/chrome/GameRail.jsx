import './gameChrome.scss';

/**
 * A rail — the fixed-width column of slots beside the board.
 *
 * A rail FITS the width it is given; it never sets it. Both rails claim the same
 * `--pg-rail-w`, which is what makes the board centred as a property of the
 * layout rather than as a coincidence of the current content length — one long
 * refusal message must not shove the board sideways.
 *
 * `foot` is pinned to the bottom of the rail, so a game's actions sit in the
 * same place whether the rail above them is full or nearly empty.
 */
export default function GameRail({ label = null, foot = null, className = '', children, ...rest }) {
  return (
    <aside className={`pg-rail ${className}`.trim()} aria-label={label ?? undefined} {...rest}>
      {children}
      {foot && <div className="pg-rail__foot">{foot}</div>}
    </aside>
  );
}
