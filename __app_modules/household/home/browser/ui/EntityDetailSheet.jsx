import { lazy, Suspense, useState } from 'react';
import { SegmentedControl, Switch } from '@mantine/core';
import { Sheet, Skeleton, ErrorState } from '@/lib/ui';
import { displayName, formatEntityState, formatSince } from '../entities/formatEntityState.js';
import { useEntityHistory } from '../history/useEntityHistory.js';
import { hasReadings } from '../history/historyChart.js';
import homeLogger from '../homeLogger.js';
import './home-ui.scss';

// Highcharts stays out of the home bundle until a drawer opens.
const HistoryChart = lazy(() => import('../history/HistoryChart.jsx'));

const logger = homeLogger.child({ component: 'entity-detail' });

const RANGES = [{ value: '24h', label: '24 h' }, { value: '7d', label: '7 d' }];
/** Chart height by shape: a reading needs a y-axis; a band or marks do not. */
const CHART_HEIGHT = { line: 150, state: 76, events: 64 };

const ROOM_SOURCE = { config: 'set in the dashboard config', provider: 'set in Home Assistant', inferred: 'guessed from the name' };

/** HA's history page is the one entity deep link that works on every install. */
export function haEntityLink(haUrl, entityId) {
  return haUrl ? `${haUrl}/history?entity_id=${encodeURIComponent(entityId)}` : null;
}

/**
 * What the drawer shows below the history when the caller passes no `extra`.
 * A ring lane (`kind: 'events'` with a camera) gets its clips here in Task 10
 * (`<RingClips camera={history.camera} marks={history.marks} />`); until then,
 * nothing. Takes no argument yet: Task 10 adds the history it needs.
 */
function defaultExtra() {
  return null;
}

/** The history section: a 24 h / 7 d switch over the chart, or why there is none. */
function EntityHistory({ entity, range, onRange, history, loading, error, reload }) {
  const kind = history?.kind;
  const height = CHART_HEIGHT[kind] || CHART_HEIGHT.line;
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} label="History" />;
  else if (loading || !history) body = <Skeleton height={height} radius="sm" />;
  else if (!history.hasData || !hasReadings(history)) body = <p className="home-history__empty">No history in this range</p>;
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
 * state in large type, a switch when the household allows one, its recent
 * history (24 h or 7 d), whatever the caller adds (`extra` — a lane drawer's
 * own detail), where it is and how we know, when it last changed, its id —
 * and, last, the link into Home Assistant.
 */
export function EntityDetailSheet({ entity, haUrl, onToggle, onClose, typeLabel, extra = null }) {
  const open = Boolean(entity);
  if (!open) return null;
  return (
    <Sheet open={open} onClose={onClose} title={displayName(entity)} placement="side">
      <EntityDetailBody key={entity.id} entity={entity} haUrl={haUrl} onToggle={onToggle} typeLabel={typeLabel} extra={extra} />
    </Sheet>
  );
}

function EntityDetailBody({ entity, haUrl, onToggle, typeLabel, extra }) {
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
  const below = extra ?? defaultExtra();
  return (
    <div className={`home-detail${lit ? ' home-detail--lit' : ''}${silent ? ' home-detail--silent' : ''}`} data-entity-id={entity.id}>
      <p className="home-detail__state">{formatEntityState(entity)}</p>
      {entity.controllable ? (
        <div className="home-detail__control">
          <span>{entity.stateClass === 'on' ? 'On' : 'Off'}</span>
          <Switch
            checked={entity.stateClass === 'on'}
            onChange={() => onToggle?.(entity)}
            disabled={Boolean(entity.pending)}
            aria-label={`${entity.name}: turn ${entity.stateClass === 'on' ? 'off' : 'on'}`}
            size="lg"
          />
        </div>
      ) : null}
      <EntityHistory entity={entity} range={range} onRange={onRange} history={history} loading={loading} error={error} reload={reload} />
      {below ? <div className="home-detail__extra">{below}</div> : null}
      <dl className="home-detail__facts">
        <dt>Room</dt>
        <dd>{entity.room ? `${entity.room.name} (${ROOM_SOURCE[entity.room.source] || entity.room.source})` : 'Not placed in a room'}</dd>
        <dt>Kind</dt>
        <dd>{typeLabel || entity.type}</dd>
        {since ? <><dt>Changed</dt><dd>{since}</dd></> : null}
        <dt>Id</dt>
        <dd>{entity.id}</dd>
      </dl>
      {link ? (
        <a className="home-detail__link" href={link} target="_blank" rel="noreferrer">Open in Home Assistant</a>
      ) : null}
    </div>
  );
}

export default EntityDetailSheet;
