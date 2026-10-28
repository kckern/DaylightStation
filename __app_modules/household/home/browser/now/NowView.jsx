import { useEffect, useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { HomeSection, HomeGroup } from '../ui/HomeSection.jsx';
import { Disclosure } from '../ui/Disclosure.jsx';
import { EntityRow } from '../ui/EntityRow.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import { composeNow, hvacWord } from './composeStatus.js';
import { formatAge, formatDegrees, formatEntityState, formatSince } from '../entities/formatEntityState.js';
import homeLogger from '../homeLogger.js';
import '../ui/home-ui.scss';
import './NowView.scss';

const logger = homeLogger.child({ component: 'now' });

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Turn off both", "Turn off all 3" — the room's lamps, never the house's. */
export function turnOffLabel(n) {
  return n === 2 ? 'Turn off both' : `Turn off all ${n}`;
}

/**
 * The house, right now: one sentence, then only the sections that are not
 * empty. A short page is good news.
 */
export function NowView({ entities, rooms, types, summary, haUrl, fetchedAt, stale, toggle, turnOff }) {
  const now = useMemo(() => composeNow({ entities, rooms, summary }), [entities, rooms, summary]);
  const detail = useEntityDetail(entities);
  const typeLabel = (type) => types.find((t) => t.id === type)?.label;

  useEffect(() => {
    logger.debug('home.now.rendered', { ...now.counts, sentences: now.sentences.length, summary: Boolean(summary) });
    // Each poll re-renders; the counts are what we want to see change.
  }, [now, summary]);

  const asOf = fetchedAt ? new Date(fetchedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase() : null;
  const others = now.counts.othersWord === 'plugs' ? ['plug', 'plugs'] : ['device', 'devices'];
  const onAside = [now.counts.lightsOn ? plural(now.counts.lightsOn, 'light') : null,
    now.counts.othersOn ? plural(now.counts.othersOn, ...others) : null].filter(Boolean).join(', ');

  return (
    <div className="home-now">
      <p className="home-status">{now.sentences.join(' ')}</p>
      {asOf ? (
        <p className="home-status__asof">
          {stale ? `Last read ${asOf}, not refreshing` : `as of ${asOf}`}
        </p>
      ) : null}
      {!summary ? <p className="home-section__note">This server does not report a house summary yet; the Rooms and Browse views still work.</p> : null}

      <HomeSection title="On" aside={onAside} empty={!now.counts.lightsOn && !now.counts.othersOn}>
        {now.on.lights.map((room) => {
          const lit = room.entities.filter((e) => e.controllable && !e.pending);
          return (
            <HomeGroup key={room.id} name={room.name}>
              {room.entities.map((e) => (
                <EntityRow key={e.id} entity={e} control="off" onToggle={toggle} onOpen={detail.open} />
              ))}
              {lit.length > 1 ? (
                <UnstyledButton
                  className="home-textaction home-now__room-off"
                  onClick={() => { logger.info('home.room.off', { roomId: room.id, count: lit.length }); turnOff(lit); }}
                  aria-label={`Turn off all ${lit.length} lights in ${room.name}`}
                >
                  {turnOffLabel(lit.length)}
                </UnstyledButton>
              ) : null}
            </HomeGroup>
          );
        })}
        {now.on.others.length ? (
          <Disclosure
            label={now.counts.lightsOn ? `Also on: ${plural(now.on.others.length, ...others)}` : `${plural(now.on.others.length, ...others)} on`}
            onToggle={(open) => logger.debug('home.now.disclose', { section: 'others-on', open })}
          >
            <div className="home-rows--ruled">
              {now.on.others.map((e) => <EntityRow key={e.id} entity={e} sub={e.room?.name || null} onOpen={detail.open} />)}
            </div>
          </Disclosure>
        ) : null}
      </HomeSection>

      <HomeSection title="Open" aside={String(now.open.length)} empty={!now.open.length}>
        {now.open.map((e) => (
          <EntityRow
            key={e.id}
            entity={e}
            sub={e.label === e.name ? (e.room?.name || null) : null}
            value={formatSince(e.lastChanged) ? `since ${formatSince(e.lastChanged)}` : undefined}
            onOpen={detail.open}
          />
        ))}
      </HomeSection>

      <HomeSection title="Motion" aside={now.motion.length ? plural(now.motion.length, 'room') : undefined} empty={!now.motion.length && !now.people.length}>
        {now.motion.map((room) => (
          <div key={room.id} className="home-row home-row--tappable">
            <UnstyledButton className="home-row__main" onClick={() => detail.open(room.entities[0])} aria-label={`Motion in ${room.name}`}>
              <span className="home-row__text">
                <span className="home-row__name">{room.name}</span>
                {room.entities.length > 1 ? <span className="home-row__sub">{plural(room.entities.length, 'sensor')}</span> : <span className="home-row__sub">{room.entities[0].name}</span>}
              </span>
              <span className="home-row__value">{room.motion?.now ? 'now' : formatAge(room.motion?.at)}</span>
            </UnstyledButton>
          </div>
        ))}
        {now.people.map((e) => (
          <EntityRow key={e.id} entity={e} plain value={formatEntityState(e)} onOpen={detail.open} />
        ))}
      </HomeSection>

      <HomeSection title="Needs attention" empty={!now.counts.stuck && !now.counts.lowBattery && !now.counts.unavailable}>
        {now.counts.stuck ? (
          <Disclosure
            label={`${plural(now.counts.stuck, 'sensor')} stuck on`}
            onToggle={(open) => logger.debug('home.now.disclose', { section: 'stuck', open })}
          >
            <div className="home-rows--ruled">
              {now.attention.stuck.map((e) => (
                <EntityRow key={e.id} entity={e} plain sub={e.room?.name || null} value={formatSince(e.lastChanged) ? `on since ${formatSince(e.lastChanged)}` : 'on'} onOpen={detail.open} />
              ))}
            </div>
          </Disclosure>
        ) : null}
        {now.counts.lowBattery ? (
          <Disclosure
            label={`${plural(now.counts.lowBattery, 'battery', 'batteries')} low`}
            onToggle={(open) => logger.debug('home.now.disclose', { section: 'low-battery', open })}
          >
            <div className="home-rows--ruled">
              {now.attention.lowBattery.map((e) => (
                <EntityRow key={e.id} entity={e} sub={e.room?.name || null} value={`${e.pct}%`} onOpen={detail.open} />
              ))}
            </div>
          </Disclosure>
        ) : null}
        {now.counts.unavailable ? (
          <Disclosure
            label={`${plural(now.counts.unavailable, 'device')} not answering`}
            onToggle={(open) => logger.debug('home.now.disclose', { section: 'unavailable', open })}
          >
            <div className="home-rows--ruled">
              {now.attention.unavailable.map((e) => (
                <EntityRow key={e.id} entity={e} plain sub={typeLabel(e.type) || e.type} value={e.room?.name || ''} onOpen={detail.open} />
              ))}
            </div>
          </Disclosure>
        ) : null}
      </HomeSection>

      <HomeSection title="Climate" aside={now.outdoor != null ? `${formatDegrees(now.outdoor)} outside` : undefined} empty={!now.climate.length}>
        <div className="home-climate">
          {now.climate.map((room) => (
            <div key={room.id} className="home-climate__row">
              <span className="home-climate__room">{room.name}</span>
              <span className="home-climate__temp">{formatDegrees(room.temperature.value)}</span>
              <span className="home-climate__more">
                {hvacWord(room.temperature.thermostat) ? <span>{hvacWord(room.temperature.thermostat)}</span> : null}
                {room.humidity != null ? <span>{Math.round(room.humidity)}% humidity</span> : null}
              </span>
            </div>
          ))}
        </div>
      </HomeSection>

      <EntityDetailSheet entity={detail.selected} haUrl={haUrl} onToggle={toggle} onClose={detail.close} typeLabel={detail.selected ? typeLabel(detail.selected.type) : null} />
    </div>
  );
}

export default NowView;
