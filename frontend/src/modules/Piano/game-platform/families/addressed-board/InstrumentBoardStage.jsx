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
}) {
  return (
    <section className={`instrument-board-stage instrument-board-stage--${layout} ${className}`.trim()}>
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
      {status && <footer className="instrument-board-stage__status">{status}</footer>}
    </section>
  );
}
