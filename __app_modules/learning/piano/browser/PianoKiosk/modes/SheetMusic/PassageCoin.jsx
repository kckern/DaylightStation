import CoinIcon, { coinPalette } from '../../../../../../../frontend/src/lib/icons/CoinIcon.jsx';
import TomatoIcon from '../../../../../../../frontend/src/lib/icons/TomatoIcon.jsx';
import FlowerIcon from '../../../../../../../frontend/src/lib/icons/FlowerIcon.jsx';
import './PassageCoin.scss';

/** The household CoinIcon has gold and silver only; a passage's bronze is its `color` escape hatch. */
export const BRONZE = '#cd7f32';

// The letter's size in the 36-unit coin, by how many characters it has ("A", "AB", "A–D", "All").
const letterSize = (text) => (text.length <= 1 ? 19 : text.length === 2 ? 15 : text.length === 3 ? 12 : 9.5);

/**
 * A coin or a disc with a letter stamped on it: how the Learn path and its board
 * name a passage (A, B, C…) or a join (A–B, All). The coins are CoinIcon's own
 * palettes (bronze through its `color` hatch), drawn as a plain face so the
 * letter reads at arm's length; the disc is the passage not yet certified: plain
 * dark (`todo`, with a tomato at its shoulder when `tomato` is on: the kids'
 * path, see `sheetmusic.learn.tomatoes`), the same with a flower at its shoulder (`learning`), or a
 * silver-ringed socket (`socket`, a join not yet played through; `ring` names
 * the metal it is reaching for).
 */
export function LetterCoin({ state, letter, size = '1em', ring = 'silver', className = '', tomato = false }) {
  const metal = state === 'gold' ? coinPalette('gold') : state === 'joined' ? coinPalette('silver') : state === 'silver' ? coinPalette('gold', BRONZE) : null;
  const text = String(letter ?? '');
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false"
    className={`piano-letter-coin${className ? ` ${className}` : ''}`} data-state={state} data-ring={state === 'socket' ? ring : undefined}>
    {metal ? <>
      <circle cx="18" cy="19" r="17" fill={metal.rim} />
      <circle cx="18" cy="17" r="17" fill={metal.light} />
      <circle cx="18" cy="17" r="13.5" fill={metal.face} stroke={metal.inner} strokeWidth="1.6" />
    </> : <circle className="piano-letter-coin__disc" cx="18" cy="18" r={state === 'socket' ? 15.5 : 16.5} />}
    <text className="piano-letter-coin__letter" x="18" y={metal ? 17.4 : 18.4} textAnchor="middle" dominantBaseline="central"
      fontSize={letterSize(text)}>{text}</text>
    {state === 'learning' && <g transform="translate(20.5 -3) scale(0.0332)"><FlowerIcon size={511.844} /></g>}
    {/* The tomato wears the flower's shoulder and size (17 units): 17 / 128 = 0.1328. */}
    {state === 'todo' && tomato && <g className="piano-letter-coin__tomato" transform="translate(20.5 -3) scale(0.1328)"><TomatoIcon size={128} /></g>}
  </svg>;
}

/**
 * A passage's state, as a crowd answers a stage act: a tomato until it is under
 * way, a flower when it is partway (`learning`), then the household economy's
 * bronze coin (a passage), silver coin (a join) and gold coin. With a `letter`
 * it is the lettered coin or disc of the Learn path instead: a plain disc is a
 * passage not started, wearing a small tomato when `tomato` is on. The path, the board and the Silver and Gold
 * ceremonies all draw this one mark.
 */
export default function PassageCoin({ state, size = '1em', label = null, className = '', letter = null, ring, tomato = false }) {
  if (letter != null) return <LetterCoin state={state} letter={letter} size={size} ring={ring} className={className} tomato={tomato} />;
  // A passage's first certificate (stored as `silver`) is BRONZE; a join's (`joined`) is the silver coin.
  if (state === 'gold') return <CoinIcon metal="gold" size={size} label={label} className={className} />;
  if (state === 'joined') return <CoinIcon metal="silver" size={size} label={label} className={className} />;
  if (state === 'silver') return <CoinIcon color={BRONZE} size={size} label={label} className={`piano-passage-coin--bronze ${className}`.trim()} />;
  if (state === 'learning') return <FlowerIcon size={size} label={label} className={className} />;
  return <TomatoIcon size={size} label={label} className={className} />;
}

/** One passage changing state: the old mark turns over and the new one lands. */
export function PassageTurn({ from, to, size = '1em', letter = null, ring, tomato = false }) {
  return <span className="piano-passage-turn"><PassageCoin state={from} size={size} letter={letter} ring={ring} tomato={tomato} /><PassageCoin state={to} size={size} letter={letter} ring={ring} tomato={tomato} /></span>;
}
