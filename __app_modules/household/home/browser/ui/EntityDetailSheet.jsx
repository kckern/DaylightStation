import { lazy, Suspense, useState } from 'react';
import { SegmentedControl, Switch } from '@mantine/core';
import { Sheet, Skeleton, ErrorState } from '@/lib/ui';
import { displayName, formatEntityState, formatSince } from '../entities/formatEntityState.js';
import { useEntityHistory } from '../history/useEntityHistory.js';
import { RingClips } from '../doorbell/RingClips.jsx';
import homeLogger from '../homeLogger.js';
import './home-ui.scss';

// Highcharts stays out of the home bundle until a drawer opens.
const HistoryChart = lazy(() => import('../history/HistoryChart.jsx'));

const logger = homeLogger.child({ component: 'entity-detail' });

const RANGES = [{ value: '24h', label: '24 h' }, { value: '7d', label: '7 d' }];
/** Chart height by shape: a reading needs a y-axis; a band or marks do not. */
const CHART_HEIGHT = { line: 150, state: 76, events: 64 };

/** HA's history page is the one entity deep link that works on every install. */
export function haEntityLink(haUrl, entityId) {
  return haUrl ? `${haUrl}/history?entity_id=${encodeURIComponent(entityId)}` : null;
}

/**
 * What the drawer shows below the history when the caller passes no `extra`:
 * a doorbell (an `events` history the server tied to a camera) gets the
 * clips of the rings in the chart's range, so it reads the same opened from
 * anywhere. Anything else adds nothing.
 */
function defaultExtra(history) {
  if (history?.kind !== 'events' || !history.camera) return null;
  // The server names the household zone; without it the browser's stands in.
  return <RingClips camera={history.camera} marks={history.marks || []} timeZone={history.timeZone || undefined} />;
}

/** The history section: a 24 h / 7 d switch over the chart, or why there is none. */
function EntityHistory({ entity, range, onRange, history, loading, error, reload }) {
  const kind = history?.kind;
  const height = CHART_HEIGHT[kind] || CHART_HEIGHT.line;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} label="History" />;
  else if (loading || !history) body = <Skeleton height={height} radius="sm" />;
  // hasData: the entity held a known value somewhere in the range. A lamp off
  // all day, a door kept shut or a doorbell nobody rang still has a history
  // (a flat band, an empty axis); only no known value at all is "none".
  else if (!history.hasData) body = <p className="home-history__empty">No history in this range</p>;
  else {
    body = (
      <Suspense fallback={<Skeleton height={height} radius="sm" />}>
        <HistoryChart history={history} unit={entity.unit || null} height={height} />
      </Suspense>
    );
  }
  return (
    <section className="home-history" aria-label="History">
      <div className="home-history__head">
        <h4 className="home-history__title">History</h4>
        <SegmentedControl size="xs" data={RANGES} value={range} onChange={onRange} aria-label="History range" />
      </div>
      {body}
    </section>
  );
}

/**
 * Everything about one entity, on demand, in a panel beside the page: the
 * state in large type with the switch beside it when the household allows
 * one, its recent history (24 h or 7 d), whatever the caller adds (`extra` —
 * a lane drawer's own detail), its room (italic when guessed from the id) and
 * when it last changed, the link into Home Assistant, and its id, muted, last.
 */
export function EntityDetailSheet({ entity, haUrl, onToggle, onClose, extra = null }) {
  const open = Boolean(entity);
  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} title={displayName(entity)} placement="side">
      <EntityDetailBody key={entity.id} entity={entity} haUrl={haUrl} onToggle={onToggle} extra={extra} />
    </Sheet>
  );
}

function EntityDetailBody({ entity, haUrl, onToggle, extra }) {
  const [range, setRange] = useState('24h');
  const { history, loading, error, reload } = useEntityHistory(entity.id, range);
  const onRange = (next) => {
    logger.info('home.history.range', { entityId: entity.id, from: range, to: next });
    setRange(next);
  };
  const lit = entity.stateClass === 'on' && (entity.type === 'light' || entity.type === 'power' || entity.type === 'media');
  const silent = entity.stateClass === 'unavailable';
  const link = haEntityLink(haUrl, entity.id);
  const since = formatSince(entity.lastChanged);
  const below = extra ?? defaultExtra(history);
  return (
    <div className={`home-detail${lit ? ' home-detail--lit' : ''}${silent ? ' home-detail--silent' : ''}`} data-entity-id={entity.id}>
      <div className="home-detail__state">
        <span>{formatEntityState(entity)}</span>
        {entity.controllable ? (
          <Switch
            checked={entity.stateClass === 'on'}
            onChange={() => onToggle?.(entity)}
            disabled={Boolean(entity.pending)}
            aria-label={`${entity.name}: turn ${entity.stateClass === 'on' ? 'off' : 'on'}`}
            size="lg"
          />
        ) : null}
      </div>
      <EntityHistory entity={entity} range={range} onRange={onRange} history={history} loading={loading} error={error} reload={reload} />
      {below ? <div className="home-detail__extra">{below}</div> : null}
      {entity.room || since ? (
        <dl className="home-detail__facts">
          {entity.room ? (
            <>
              <dt>Room</dt>
              {/* A room guessed from the id reads in italic, as it does in every list. */}
              <dd className={entity.room.source === 'inferred' ? 'home-inferred' : undefined}>{entity.room.name}</dd>
            </>
          ) : null}
          {since ? <><dt>Changed</dt><dd>{since}</dd></> : null}
        </dl>
      ) : null}
      {link ? (
        <a className="home-detail__link" href={link} target="_blank" rel="noreferrer">Open in Home Assistant</a>
      ) : null}
      <p className="home-detail__id">{entity.id}</p>
    </div>
  );
}

export default EntityDetailSheet;
