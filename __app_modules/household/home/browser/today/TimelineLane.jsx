import { UnstyledButton } from '@mantine/core';
import { W, intervalRects, linePath, markXs, xOf } from './laneGeometry.js';
import { formatLaneTotal } from './formatLaneTotal.js';
import './TodayView.scss';

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const weekdayOf = (day) => WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()];

/** A lane with no readings on any day: say so, and claim no total. */
export function laneHasHistory(lane) {
  if (lane.hasData === false) return false;
  return (lane.days || []).some((d) => d.hasData);
}

/** The largest reading across the lane's days, so a week's rows share one scale. */
export function laneMax(lane) {
  let max = 0;
  for (const d of lane.days || []) for (const p of d.points || []) if (Number.isFinite(p.v) && p.v > max) max = p.v;
  return max;
}

/** One day's strip: the shapes in viewBox units, with 6-hour guides and the now line. */
function DayStrip({ kind, day, window, height, maxV, ticks }) {
  const nowX = window.nowMs != null ? xOf(window.nowMs, window) : null;
  let shapes = null;
  if (day?.hasData) {
    if (kind === 'power') {
      shapes = <path className="home-lane__area" d={linePath(day.points, window, { height, maxV })} />;
    } else if (kind === 'events') {
      shapes = markXs(day.marks, window).map((x, i) => (
        <line key={i} className="home-lane__mark" x1={x} x2={x} y1={0} y2={height} vectorEffect="non-scaling-stroke" />
      ));
    } else {
      shapes = intervalRects(day.intervals, window).map((r, i) => (
        <rect key={i} className={`home-lane__bar home-lane__bar--${kind}`} x={r.x} width={r.width} y={0} height={height} />
      ));
    }
  }
  return (
    <svg className="home-lane__svg" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect className="home-lane__ground" x={0} y={0} width={nowX ?? W} height={height} />
      {nowX != null ? <rect className="home-lane__ahead" x={nowX} y={0} width={W - nowX} height={height} /> : null}
      {ticks.map((t) => (
        <line key={t.label} className="home-lane__guide" x1={t.x} x2={t.x} y1={0} y2={height} vectorEffect="non-scaling-stroke" />
      ))}
      {shapes}
      {nowX != null ? <line className="home-lane__now" x1={nowX} x2={nowX} y1={0} y2={height} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

/**
 * One row of the timeline: its name, the day as a strip (a week as seven
 * thin rows, today last), and the total. The whole row is one button that
 * opens the lane's drawer — a ring tick included.
 *
 * @param {{lane: Object, rows: Array<{day: string, window: Object}>, ticksFor: Function, onOpen: Function}} props
 */
export function TimelineLane({ lane, rows, ticksFor, onOpen }) {
  const week = rows.length > 1;
  const height = week ? 8 : 24;
  const hasHistory = laneHasHistory(lane);
  const total = hasHistory ? formatLaneTotal(lane.kind, lane.total) : '';
  const maxV = lane.kind === 'power' ? laneMax(lane) : 0;
  const byDay = new Map((lane.days || []).map((d) => [d.day, d]));
  const label = `${lane.label}: ${total || 'No history'}, open details`;

  let strip;
  if (!hasHistory) {
    strip = <span className="home-lane__nohistory">No history</span>;
  } else if (week) {
    strip = (
      <span className="home-lane__week">
        {rows.map((r) => (
          <span key={r.day} className="home-lane__week-row">
            <span className="home-lane__weekday">{weekdayOf(r.day)}</span>
            <DayStrip kind={lane.kind} day={byDay.get(r.day)} window={r.window} height={height} maxV={maxV} ticks={ticksFor(r.window)} />
          </span>
        ))}
      </span>
    );
  } else {
    const [r] = rows;
    strip = <DayStrip kind={lane.kind} day={byDay.get(r.day)} window={r.window} height={height} maxV={maxV} ticks={ticksFor(r.window)} />;
  }

  return (
    <UnstyledButton
      className={`home-lane home-lane--${lane.kind}${week ? ' home-lane--week' : ''}${hasHistory ? '' : ' home-lane--empty'}`}
      data-lane-id={lane.id}
      aria-label={label}
      onClick={() => onOpen(lane)}
    >
      <span className="home-lane__label">{lane.label}</span>
      <span className="home-lane__strip">{strip}</span>
      <span className="home-lane__total">{total}</span>
    </UnstyledButton>
  );
}

export default TimelineLane;
