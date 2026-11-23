import CoinIcon from '../../../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import TomatoIcon from '../../../../../../../frontend/src/lib/icons/TomatoIcon.jsx';
import FlowerIcon from '../../../../../../../frontend/src/lib/icons/FlowerIcon.jsx';

/** The household CoinIcon has gold and silver only; a passage's bronze is its `color` escape hatch. */
const BRONZE = '#cd7f32';

/**
 * A passage's state, as a crowd answers a stage act: a tomato until it is under
 * way, a flower when it is partway (`learning`), then the household economy's
 * bronze coin (a passage), silver coin (a join) and gold coin. The rail, the board and the
 * Silver and Gold ceremonies all draw this one mark.
 */
export default function PassageCoin({ state, size = '1em', label = null, className = '' }) {
  // A passage's first certificate (stored as `silver`) is BRONZE; a join's (`joined`) is the silver coin.
  if (state === 'gold') return <CoinIcon metal="gold" size={size} label={label} className={className} />;
  if (state === 'joined') return <CoinIcon metal="silver" size={size} label={label} className={className} />;
  if (state === 'silver') return <CoinIcon color={BRONZE} size={size} label={label} className={`piano-passage-coin--bronze ${className}`.trim()} />;
  if (state === 'learning') return <FlowerIcon size={size} label={label} className={className} />;
  return <TomatoIcon size={size} label={label} className={className} />;
}

/** One passage changing state: the old mark turns over and the new one lands. */
export function PassageTurn({ from, to, size = '1em' }) {
  return <span className="piano-passage-turn"><PassageCoin state={from} size={size} /><PassageCoin state={to} size={size} /></span>;
}
