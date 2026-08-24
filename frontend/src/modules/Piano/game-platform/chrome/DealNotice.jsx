import { useEffect, useState } from 'react';
import Icon from '../../ui/icons/Icon.jsx';
import './gameChrome.scss';

/**
 * "The map moved."
 *
 * A re-deal is the one change a player cannot see coming and cannot recover from
 * by trying harder: they spell yesterday's square, it is refused, and nothing on
 * screen explains why. Chess has said so since it shipped; Checkers and Connect
 * Four re-deal too and said nothing, which is why `each_turn` was not safe to
 * enable for them.
 *
 * Loud for a beat, then a compact standing reminder. The rail gets a symbol and
 * two words; the complete sentence is announced through the status role.
 *
 * `dealKey` is whatever identifies the current deal (a scheme id, a seed). A
 * change to it is what makes the notice fresh again; rendering with the same key
 * leaves it in its quiet state.
 */
export default function DealNotice({ dealKey = null, freshMs = 2600, cadence = 'never', className = '' }) {
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (dealKey === null || dealKey === undefined) return undefined;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), freshMs);
    return () => clearTimeout(timer);
  }, [dealKey, freshMs]);

  if (cadence === 'never') return null;

  const announcement = fresh
    ? 'New map — read the edges'
    : cadence === 'each_turn' ? 'The map moves every turn' : 'The map moves each game';
  const label = fresh ? 'New map' : cadence === 'each_turn' ? 'Each turn' : 'Each game';

  return (
    <p
      className={`pg-deal-notice${fresh ? ' pg-deal-notice--fresh' : ''} ${className}`.trim()}
      role="status"
      aria-label={announcement}
    >
      <Icon name="shuffle" />
      <span>{label}</span>
    </p>
  );
}
