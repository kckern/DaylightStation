import CoinIcon from '../../../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import TomatoIcon from '../../../../../../../frontend/src/lib/icons/TomatoIcon.jsx';
import FlowerIcon from '../../../../../../../frontend/src/lib/icons/FlowerIcon.jsx';

/**
 * A passage's state, as a crowd answers a stage act: a tomato until it is under
 * way, a flower when it is partway (`learning`), then the household economy's
 * silver coin and gold coin. The rail, the board and the
 * Silver and Gold ceremonies all draw this one mark.
 */
export default function PassageCoin({ state, size = '1em', label = null, className = '' }) {
  if (state === 'gold' || state === 'silver') return <CoinIcon metal={state} size={size} label={label} className={className} />;
  if (state === 'learning') return <FlowerIcon size={size} label={label} className={className} />;
  return <TomatoIcon size={size} label={label} className={className} />;
}

/** One passage changing state: the old mark turns over and the new one lands. */
export function PassageTurn({ from, to, size = '1em' }) {
  return <span className="piano-passage-turn"><PassageCoin state={from} size={size} /><PassageCoin state={to} size={size} /></span>;
}
