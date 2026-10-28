import { useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { EmptyState } from '@/lib/ui';
import { HomeSection } from '../ui/HomeSection.jsx';
import { Disclosure } from '../ui/Disclosure.jsx';
import { EntityRow } from '../ui/EntityRow.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import { formatWatts } from '../entities/formatEntityState.js';
import { RankedCircuits, powerSentence, topCircuits } from '../today/PowerBreakdown.jsx';
import homeLogger from '../homeLogger.js';
import '../ui/home-ui.scss';
import './PowerView.scss';

const logger = homeLogger.child({ component: 'power' });

const wattsOf = (e) => {
  const n = Number(e.state);
  if (!Number.isFinite(n)) return null;
  return (e.unit || '').toLowerCase() === 'kw' ? n * 1000 : n;
};

/**
 * Where the power goes: one sentence of totals, the top circuits as a ranked
 * list with a proportional bar (both shared with the Today view's Power lane
 * drawer, in ../today/PowerBreakdown.jsx), and every meter behind a disclosure.
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
  const { wholeHouse } = summary.power;
  if (!wholeHouse && !meters.length) {
    return <EmptyState title="No power meters" hint="Add a power sensor in Home Assistant, or name one under power.whole_house in the home dashboard config." />;
  }

  const top = topCircuits(entities, summary);
  const sentence = powerSentence(summary);

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
        <RankedCircuits entities={entities} summary={summary} onOpen={detail.open} />
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
