import { Children } from 'react';
import { BOARD_LAYOUTS } from './contracts.js';
import './InstrumentBoardStage.scss';

export default function InstrumentBoardStage({
  layout = BOARD_LAYOUTS.SINGLE,
  leftRail = null,
  rightRail = null,
  topRail = null,
  primary,
  secondary = null,
  status = null,
  className = '',
  children = null,
}) {
  // Compatibility composition for a dense board migrating from an equivalent
  // hand-rolled three-column stage. Order is left rail, primary, right rail;
  // new callers should prefer the named props above.
  if (children) {
    const slots = Children.toArray(children);
    [leftRail, primary, rightRail] = slots;
  }
  return (
    <section className={`instrument-board-stage instrument-board-stage--${layout} ${className}`.trim()}>
      {/* Above the left rail's own content (settings default to the RIGHT
          rail, and the left rail is where Connect Four/Checkers already put
          the "who you're playing" panel — turn-taking state reads naturally
          stacked over it). A named grid area, not a nested child of the rail
          aside: that is what lets the >850px layout give it its own thin band
          in the LEFT column while `board` and the right rail span straight
          through it untouched — see InstrumentBoardStage.scss. Below the rail
          breakpoint the same media query falls back to a full-width row under
          the board, because a status tucked inside a collapsed, hidden rail
          is a status nobody can read. */}
      {status && <div className="instrument-board-stage__status">{status}</div>}
      <aside className="instrument-board-stage__rail instrument-board-stage__rail--left">{leftRail}</aside>
      <main className="instrument-board-stage__boards">
        {/* Above `primary`, inside the SAME centred column it is — not a
            fourth rail spanning the whole stage. This is what lets Connect
            Four's seven staff cards and Checkers' file rail sit flush with
            the board's own width instead of the far wider left/right rails. */}
        {topRail && <div className="instrument-board-stage__top-rail">{topRail}</div>}
        <div className="instrument-board-stage__primary">{primary}</div>
        {secondary && <div className="instrument-board-stage__secondary">{secondary}</div>}
      </main>
      <aside className="instrument-board-stage__rail instrument-board-stage__rail--right">{rightRail}</aside>
    </section>
  );
}
