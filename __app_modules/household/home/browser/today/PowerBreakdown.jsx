import { useMemo } from 'react';
import { UnstyledButton } from '@mantine/core';
import { formatKwh, formatWatts } from '../entities/formatEntityState.js';
import './PowerBreakdown.scss';

/** A short name for a circuit: the entity name with its trailing "Power" dropped. */
export function circuitName(entity) {
  return entity.name.replace(/\s+(power|minute average)$/i, '');
}

/** "Drawing 1.2 kW right now. 17.6 kWh so far today, 520 kWh this month." — or null. */
export function powerSentence(summary) {
  if (!summary?.power) return null;
  const { wholeHouse, energyToday, energyThisMonth } = summary.power;
  const totals = [
    wholeHouse ? `Drawing ${formatWatts(wholeHouse.watts)} right now.` : null,
    energyToday ? `${formatKwh(energyToday.kwh)} so far today` : null,
    energyThisMonth ? `${formatKwh(energyThisMonth.kwh)} this month` : null,
  ].filter(Boolean);
  if (!totals.length) return null;
  if (totals.length === 1) return totals[0].endsWith('.') ? totals[0] : `${totals[0]}.`;
  const [head, ...rest] = totals;
  return head.endsWith('.') ? `${head} ${rest.join(', ')}.` : `${totals.join(', ')}.`;
}

/** The top circuits the summary names that the entity list still has. */
export function topCircuits(entities, summary) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return (summary?.power?.topConsumers || [])
    .map((c) => ({ ...c, entity: byId.get(c.entityId) }))
    .filter((c) => c.entity);
}

/**
 * The top circuits as a ranked list whose bars compare magnitudes — the one
 * place a bar earns its keep. With `onOpen`, each circuit opens its own
 * detail; without, the list is read-only (as inside a drawer).
 */
export function RankedCircuits({ entities, summary, onOpen = null }) {
  const top = useMemo(() => topCircuits(entities, summary), [entities, summary]);
  if (!top.length) return null;
  const scale = top[0].watts || 1;
  return (
    <ol className="home-breakdown__ranked">
      {top.map((c) => {
        const name = circuitName(c.entity);
        const inner = (
          <>
            <span className="home-breakdown__name">{name}</span>
            <span className="home-breakdown__watts">{formatWatts(c.watts)}</span>
            <span className="home-breakdown__bar" aria-hidden="true">
              <span className="home-breakdown__fill" style={{ width: `${Math.max(2, Math.round((c.watts / scale) * 100))}%` }} />
            </span>
          </>
        );
        return (
          <li key={c.entityId} className="home-breakdown__item">
            {onOpen ? (
              <UnstyledButton className="home-breakdown__circuit home-breakdown__circuit--tappable" onClick={() => onOpen(c.entity)} aria-label={`${name}, ${formatWatts(c.watts)}`}>
                {inner}
              </UnstyledButton>
            ) : <div className="home-breakdown__circuit">{inner}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Where the power goes, for the Power lane's drawer: the totals in a sentence, then the ranked circuits. */
export function PowerBreakdown({ entities, summary, onOpen = null }) {
  const sentence = powerSentence(summary);
  const top = topCircuits(entities, summary);
  if (!sentence && !top.length) return null;
  return (
    <section className="home-breakdown" aria-label="Where the power goes">
      {sentence ? <p className="home-breakdown__sentence">{sentence}</p> : null}
      {top.length ? (
        <>
          <h4 className="home-breakdown__title">Where it goes</h4>
          <RankedCircuits entities={entities} summary={summary} onOpen={onOpen} />
        </>
      ) : null}
    </section>
  );
}

export default PowerBreakdown;
