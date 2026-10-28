import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import { LoadingState, ErrorState, EmptyState } from '@/lib/ui';
import { composeNow } from '../now/composeStatus.js';
import homeLogger from '../homeLogger.js';
import { useTimeline } from './useTimeline.js';
import { dayWindow, hourTicks } from './laneGeometry.js';
import { TimelineLane } from './TimelineLane.jsx';
import { LaneDetailSheet } from './LaneDetailSheet.jsx';
import '../ui/home-ui.scss';
import './TodayView.scss';

const logger = homeLogger.child({ component: 'today' });

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'Week' },
];
const RANGE_KEY = 'home.today.range';

// The range is a per-viewer convenience; storage may be unavailable.
function readSavedRange() {
  try {
    const saved = window.localStorage.getItem(RANGE_KEY);
    return RANGES.some((r) => r.value === saved) ? saved : 'today';
  } catch { return 'today'; }
}
function saveRange(range) {
  try { window.localStorage.setItem(RANGE_KEY, range); } catch { /* storage unavailable */ }
}

/** The 6-hour guides and labels for a day, memoised per window. */
function useTicks(timeZone) {
  return useMemo(() => {
    const cache = new Map();
    return (window) => {
      const key = `${window.startMs}|${window.endMs}`;
      if (!cache.has(key)) cache.set(key, hourTicks(window, timeZone));
      return cache.get(key);
    };
  }, [timeZone]);
}

/** The hour labels under the last lane, on the strip's column. */
function HourScale({ ticks, week }) {
  return (
    <div className={`home-today__scale${week ? ' home-today__scale--week' : ''}`} aria-hidden="true">
      <span className="home-today__scale-track">
        {ticks.map((t) => (
          <span key={t.label} className="home-today__tick" style={{ left: `${t.x / 10}%` }}>{t.label}</span>
        ))}
      </span>
    </div>
  );
}

function Timeline({ timeline, onOpen }) {
  const tz = timeline.timeZone;
  const ticksFor = useTicks(tz);
  const rows = useMemo(
    () => timeline.days.map((d) => ({ day: d.day, window: dayWindow(d, tz) })),
    [timeline.days, tz],
  );
  const week = rows.length > 1;
  // Label the scale from a whole day (today's row is only part-written).
  const scaleWindow = (rows.find((r) => r.window.nowMs == null) || rows[0]).window;
  return (
    <div className={`home-today__lanes${week ? ' home-today__lanes--week' : ''}`}>
      {timeline.lanes.map((lane) => (
        <TimelineLane key={lane.id} lane={lane} rows={rows} ticksFor={ticksFor} onOpen={onOpen} />
      ))}
      <HourScale ticks={ticksFor(scaleWindow)} week={week} />
    </div>
  );
}

/**
 * Today: the house in one sentence, then its day as lanes — power drawn,
 * rings at the door, rooms occupied, screens on — for today, yesterday, or
 * the week. A lane opens its drawer: the entity's history and what the lane
 * adds (where the power goes, the rings' clips).
 */
export function TodayView({ entities, rooms, summary, haUrl, toggle }) {
  const [range, setRange] = useState(readSavedRange);
  const [openLaneId, setOpenLaneId] = useState(null);
  const { timeline, loading, error, reload } = useTimeline(range);
  const sentence = useMemo(() => composeNow({ entities, rooms, summary }).sentences[0] || null, [entities, rooms, summary]);

  useEffect(() => {
    logger.info('home.today.mount', { range });
    return () => logger.info('home.today.unmount', {});
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeRange = (next) => {
    logger.info('home.today.range', { from: range, to: next });
    setRange(next);
    saveRange(next);
  };
  const openLane = useCallback((lane) => {
    logger.info('home.lane.open', { laneId: lane.id, kind: lane.kind });
    setOpenLaneId(lane.id);
  }, []);
  const closeLane = useCallback(() => setOpenLaneId(null), []);
  // The drawer follows the shown range (and each poll), not the lane as tapped.
  const shownLane = openLaneId && timeline ? timeline.lanes.find((l) => l.id === openLaneId) || null : null;

  let body;
  if (!timeline && error) body = <ErrorState error={error} onRetry={reload} label="Timeline" />;
  else if (!timeline) body = <LoadingState label="the timeline" rows={6} />;
  else if (!timeline.lanes?.length) {
    body = <EmptyState title="No timeline lanes" hint="Add lanes under timeline.lanes in household/home/dashboard.yml" />;
  } else body = <Timeline timeline={timeline} onOpen={openLane} />;

  return (
    <div className="home-today">
      {sentence ? <p className="home-today__now">{sentence}</p> : null}
      <div className="home-today__range">
        <SegmentedControl size="sm" data={RANGES} value={range} onChange={changeRange} aria-label="Timeline range" />
      </div>
      {body}
      <LaneDetailSheet
        lane={shownLane}
        entities={entities}
        summary={summary}
        haUrl={haUrl}
        toggle={toggle}
        onClose={closeLane}
        timeZone={timeline?.timeZone}
      />
    </div>
  );
}

export default TodayView;
