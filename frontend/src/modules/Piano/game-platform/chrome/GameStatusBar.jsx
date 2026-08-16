import './gameChrome.scss';

/**
 * The one sentence under the board, in the game's own voice.
 *
 * `role="status"` so a turn change, a refusal and a result all announce — the
 * two newest games said all three in a bare <span> that no assistive technology
 * ever read. Height is reserved for the same reason a slot's is: the action
 * appearing at game over must not lift the board.
 *
 * `aside` is a qualifier on the sentence rather than part of it ("local
 * practice", "unranked"), so it takes the quieter voice and never competes with
 * the thing it qualifies.
 */
export default function GameStatusBar({ children, aside = null, action = null, className = '' }) {
  return (
    <div className={`pg-status ${className}`.trim()} role="status">
      <span className="pg-status__text">
        {children}
        {aside && <span className="pg-status__aside"> · {aside}</span>}
      </span>
      {action}
    </div>
  );
}
