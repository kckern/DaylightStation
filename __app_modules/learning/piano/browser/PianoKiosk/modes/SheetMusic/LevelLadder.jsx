import PassageCoin from './PassageCoin.jsx';
import GemIcon from '../../../../../../../frontend/src/lib/icons/GemIcon.jsx';
import { POLISH_DIAMOND_COLOR } from './polishAwards.js';
import './LevelLadder.scss';

/** A level not earned yet: the outline of its coin or stone. */
const Outline = ({ level }) => (level === 'diamond'
  ? <svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><path d="M18 31 4.5 14.5 10 6.5h16l5.5 8z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg>
  : <svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true"><circle cx="18" cy="18" r="14.5" fill="none" stroke="currentColor" strokeWidth="3" /></svg>);
const Earned = ({ item }) => (item.level === 'diamond' ? <GemIcon size="100%" color={POLISH_DIAMOND_COLOR} /> : <PassageCoin state={item.coin} size="100%" />);

/**
 * The one level ladder of a piece: Bronze → Silver → Gold → Diamond (`levelLadder` in passageRail.js).
 * Earned levels show their coin, the lap the child is on is ringed with its count under the row
 * ("Bronze · 2 of 3"), later levels are outlines in the muted ink. The path and the board both draw
 * it; the board adds the one quiet "earn a gem" (`gemOffered`) under the count when that lap pays one.
 */
export default function LevelLadder({ ladder, gemOffered = false, className = '' }) {
  if (!ladder) return null;
  const gem = gemOffered && ladder.gemLevel;
  return <div className={`piano-level-ladder${className ? ` ${className}` : ''}`} role="group" data-level={ladder.current}
    aria-label={`Levels for this piece: ${ladder.text}${gem ? ', earn a gem' : ''}`}>
    <ol className="piano-level-ladder__rungs" aria-hidden="true">
      {ladder.levels.map((item) => <li key={item.level} data-level={item.level} data-state={item.state}>
        {item.state === 'earned' ? <Earned item={item} /> : <Outline level={item.level} />}
      </li>)}
    </ol>
    <p className="piano-level-ladder__count" aria-hidden="true">
      <strong>{ladder.text}</strong>
      {gem && <span>earn a gem</span>}
    </p>
  </div>;
}
