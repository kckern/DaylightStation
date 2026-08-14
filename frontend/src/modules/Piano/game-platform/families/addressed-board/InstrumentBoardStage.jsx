import { BOARD_LAYOUTS } from './contracts.js';
import './InstrumentBoardStage.scss';

export default function InstrumentBoardStage({
  layout = BOARD_LAYOUTS.SINGLE,
  leftRail = null,
  rightRail = null,
  primary,
  secondary = null,
  status = null,
  className = '',
}) {
  return (
    <section className={`instrument-board-stage instrument-board-stage--${layout} ${className}`.trim()}>
      <aside className="instrument-board-stage__rail instrument-board-stage__rail--left">{leftRail}</aside>
      <main className="instrument-board-stage__boards">
        <div className="instrument-board-stage__primary">{primary}</div>
        {secondary && <div className="instrument-board-stage__secondary">{secondary}</div>}
      </main>
      <aside className="instrument-board-stage__rail instrument-board-stage__rail--right">{rightRail}</aside>
      {status && <footer className="instrument-board-stage__status">{status}</footer>}
    </section>
  );
}
