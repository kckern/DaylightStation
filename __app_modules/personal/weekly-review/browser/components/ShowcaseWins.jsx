// A child's own wins on their showcase slide: what they earned this week, and
// a quiet all-time line under it. Celebrate, never compare: only this child's
// numbers, never balances, and nothing for a zero or an unknown (null) value.
import React from 'react';
import CoinIcon from '@/lib/icons/CoinIcon.jsx';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import RingIcon from '@/lib/icons/RingIcon.jsx';

const fmt = (n) => n.toLocaleString('en-US');

const KINDS = [
  {
    key: 'silver',
    unit: () => 'silver',
    spoken: (n) => `${fmt(n)} silver coin${n === 1 ? '' : 's'}`,
    Icon: (props) => <CoinIcon metal="silver" {...props} />,
  },
  {
    key: 'gems',
    unit: (n) => (n === 1 ? 'gem' : 'gems'),
    spoken: (n) => `${fmt(n)} gem${n === 1 ? '' : 's'}`,
    Icon: (props) => <GemIcon {...props} />,
  },
  {
    key: 'rings',
    unit: (n) => (n === 1 ? 'ring' : 'rings'),
    spoken: (n) => `${fmt(n)} ring${n === 1 ? '' : 's'}`,
    Icon: (props) => <RingIcon {...props} />,
  },
];

const shown = (n) => Number.isFinite(n) && n > 0;

// The kinds worth showing from one { silver, gems, rings } block.
export function winParts(block) {
  return KINDS.filter(k => shown(block?.[k.key])).map(k => ({ ...k, n: block[k.key] }));
}

export function hasWins(wins) {
  return winParts(wins?.week).length > 0 || winParts(wins?.allTime).length > 0;
}

export default function ShowcaseWins({ wins }) {
  const week = winParts(wins?.week);
  const allTime = winParts(wins?.allTime);
  if (!week.length && !allTime.length) return null;
  return (
    <div className="showcase-wins">
      {week.length > 0 && (
        <ul className="showcase-wins-week">
          {week.map(({ key, n, unit, spoken, Icon }) => (
            <li
              key={key}
              className={`showcase-win showcase-win--${key}`}
              aria-label={`${spoken(n)} earned this week`}
            >
              <Icon className="showcase-win-icon" size="1em" />
              <span className="showcase-win-figure" aria-hidden="true">+{fmt(n)}</span>
              <span className="showcase-win-unit" aria-hidden="true">{unit(n)}</span>
            </li>
          ))}
        </ul>
      )}
      {allTime.length > 0 && (
        <div className="showcase-wins-all-time">
          All time: {allTime.map(({ key, n, unit }) => `${fmt(n)} ${unit(n)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}
