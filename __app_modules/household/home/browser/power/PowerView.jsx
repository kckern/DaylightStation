import { useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { EmptyState } from '@/lib/ui';
import { HomeSection } from '../ui/HomeSection.jsx';
import { Disclosure } from '../ui/Disclosure.jsx';
import { EntityRow } from '../ui/EntityRow.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import { formatKwh, formatWatts } from '../entities/formatEntityState.js';
import homeLogger from '../homeLogger.js';
import '../ui/home-ui.scss';
import './PowerView.scss';

const logger = homeLogger.child({ component: 'power' });

const wattsOf = (e) => {
  const n = Number(e.state);
  if (!Number.isFinite(n)) return null;
  return (e.unit || '').toLowerCase() === 'kw' ? n * 1000 : n;
};

/** A short name for a circuit: the entity name with its trailing "Power" dropped. */
function circuitName(entity) {
  return entity.name.replace(/\s+(power|minute average)$/i, '');
}

/**
 * Where the power goes: one sentence of totals, the top circuits as a ranked
 * list with a proportional bar, and every meter behind a disclosure.
 */
export function PowerView({ entities, types, summary, haUrl, toggle }) {
  const detail = useEntityDetail(entities);
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const typeLabel = (type) => types.find((t) => t.id === type)?.label;

  const meters = useMemo(() => entities
    .filter((e) => e.type === 'power' && e.domain === 'sensor' && e.deviceClass === 'power' && e.stateClass === 'reading')
    .map((e) => ({ entity: e, watts: wattsOf(e) }))
    .filter((m) => m.watts != null)
    .sort((a, b) => b.watts - a.watts), [entities]);
  const plugsOn = useMemo(() => entities.filter((e) => e.type === 'power' && e.domain !== 'sensor' && e.stateClass === 'on'), [entities]);

  if (!summary) {
    return <EmptyState title="No power summary" hint="This server does not report a house summary yet." />;
  }
  const { wholeHouse, energyToday, energyThisMonth, topConsumers } = summary.power;
  if (!wholeHouse && !meters.length) {
    return <EmptyState title="No power meters" hint="Add a power sensor in Home Assistant, or name one under power.whole_house in the home dashboard config." />;
  }

  const top = topConsumers.map((c) => ({ ...c, entity: byId.get(c.entityId) })).filter((c) => c.entity);
  const scale = top[0]?.watts || 1;
  const totals = [
    wholeHouse ? `Drawing ${formatWatts(wholeHouse.watts)} right now.` : null,
    energyToday ? `${formatKwh(energyToday.kwh)} so far today` : null,
    energyThisMonth ? `${formatKwh(energyThisMonth.kwh)} this month` : null,
  ].filter(Boolean);
  const sentence = totals.length > 1 ? `${totals[0]} ${totals.slice(1).join(', ')}.` : totals[0];

  return (
    <div className="home-power">
      {sentence ? <p className="home-status">{sentence}</p> : null}
      {wholeHouse ? (
        <p className="home-status__asof">
          <UnstyledButton className="home-power__meter" onClick={() => detail.open(byId.get(wholeHouse.entityId))}>
            Measured by {byId.get(wholeHouse.entityId)?.name || wholeHouse.entityId}
          </UnstyledButton>
        </p>
      ) : null}

      <HomeSection title="Where it goes" aside={top.length ? `top ${top.length} circuits` : undefined} empty={!top.length}>
        <ol className="home-power__ranked">
          {top.map((c) => (
            <li key={c.entityId} className="home-power__item">
              <UnstyledButton className="home-power__circuit" onClick={() => detail.open(c.entity)} aria-label={`${circuitName(c.entity)}, ${formatWatts(c.watts)}`}>
                <span className="home-power__name">{circuitName(c.entity)}</span>
                <span className="home-power__watts">{formatWatts(c.watts)}</span>
                <span className="home-power__bar" aria-hidden="true">
                  <span className="home-power__fill" style={{ width: `${Math.max(2, Math.round((c.watts / scale) * 100))}%` }} />
                </span>
              </UnstyledButton>
            </li>
          ))}
        </ol>
      </HomeSection>

      <HomeSection title="Plugs on" aside={String(plugsOn.length)} empty={!plugsOn.length}>
        <div className="home-rows--ruled">
          {plugsOn.map((e) => <EntityRow key={e.id} entity={e} sub={e.room?.name || null} control="switch" onToggle={toggle} onOpen={detail.open} />)}
        </div>
      </HomeSection>

      <HomeSection title="Every meter" aside={String(meters.length)} empty={!meters.length}>
        <Disclosure
          label={`Show all ${meters.length}`}
          onToggle={(open) => logger.debug('home.power.meters', { open, count: meters.length })}
        >
          <div className="home-rows--ruled">
            {meters.map(({ entity, watts }) => (
              <EntityRow key={entity.id} entity={entity} sub={entity.room?.name || null} value={formatWatts(watts)} onOpen={detail.open} />
            ))}
          </div>
        </Disclosure>
      </HomeSection>

      <EntityDetailSheet entity={detail.selected} haUrl={haUrl} onToggle={toggle} onClose={detail.close} typeLabel={detail.selected ? typeLabel(detail.selected.type) : null} />
    </div>
  );
}

export default PowerView;
