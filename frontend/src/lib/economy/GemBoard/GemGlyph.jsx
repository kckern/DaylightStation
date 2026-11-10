/**
 * GemGlyph — one Gem Board cell at a glance: a gem, a ring of day segments
 * around it while a day-count is still running, a dashed circle around a
 * contest gem that is only held for now. No numerals but a ×n badge.
 */
import GemIcon from '@/lib/icons/GemIcon.jsx';

const REACH_WORDS = { 'on-track': 'on track', tight: 'needs every day left', out: 'out of reach this week' };
const STATE_WORDS = { won: 'won', earned: 'earned', leading: 'leading', pending: 'still in reach', unknown: 'can’t tell yet', none: 'not this week', disabled: 'off' };

/** Which look a cell takes: lit, streak, out, holding, open, unknown, off or none. */
export function glyphLook(cell) {
  const state = cell?.state ?? 'none';
  if ((cell?.week ?? 0) > 0 || state === 'earned' || state === 'won') return 'lit';
  if (cell?.streak) return cell.streak.reach === 'out' ? 'out' : 'streak';
  if (state === 'leading') return 'holding';
  if (state === 'pending') return 'open';
  if (state === 'unknown') return 'unknown';
  if (state === 'disabled') return 'off';
  return 'none';
}

/** The same cell in words, for a screen reader. */
export function glyphWords(cell) {
  const state = cell?.state ?? 'none';
  const s = cell?.streak;
  const run = s ? `${s.have} of ${s.need} days, ${REACH_WORDS[s.reach] ?? 'still in reach'}` : null;
  if (glyphLook(cell) === 'lit') {
    const gems = (cell.week ?? 0) > 1 ? `, ${cell.week} gems` : '';
    // A lit cell whose own state is not a win (a gem earned, a day-count still open) reads "earned".
    const won = state === 'won' ? 'won' : 'earned';
    return `${won}${gems}${run ? `, and ${run}` : ''}`;
  }
  return run ?? STATE_WORDS[state] ?? state;
}

const R = 17;
const GAP = 20; // degrees between segments: wide enough that the round caps leave a visible break
const point = (deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return `${(20 + R * Math.cos(a)).toFixed(2)} ${(20 + R * Math.sin(a)).toFixed(2)}`;
};
/** Segment `i` of `n`, clockwise from the top. */
export function segmentPath(i, n) {
  const span = 360 / n;
  const from = i * span + GAP / 2;
  const to = (i + 1) * span - GAP / 2;
  return `M ${point(from)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

function Ring({ streak, color }) {
  const out = streak.reach === 'out';
  const need = Math.max(1, Math.floor(Number(streak.need) || 0));
  return (
    <svg className={`gem-glyph__ring${streak.reach === 'tight' ? ' is-tight' : ''}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      {/* The colour goes inline: the stylesheet's stroke would beat an SVG attribute. */}
      {Array.from({ length: need }, (_, i) => {
        const done = i < streak.have;
        return <path key={i} className={`gem-glyph__seg${done ? ' is-done' : ''}`} d={segmentPath(i, need)} style={done && !out ? { stroke: color } : undefined} />;
      })}
    </svg>
  );
}

export default function GemGlyph({ cell, color }) {
  const look = glyphLook(cell);
  const ring = cell?.streak && look !== 'holding' ? <Ring streak={cell.streak} color={color} /> : null;
  let inner = null;
  if (look === 'lit' || look === 'streak' || look === 'open' || look === 'holding') inner = <GemIcon className="gem-glyph__gem" color={color} size="1.5em" />;
  else if (look === 'unknown') inner = <span className="gem-glyph__muted">?</span>;
  else if (look === 'off') inner = <span className="gem-glyph__muted">–</span>;
  return (
    <span className="gem-glyph" data-look={look}>
      {ring}
      {look === 'holding' && <svg className="gem-glyph__hold" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r={R} /></svg>}
      {inner}
      {look === 'lit' && cell.week > 1 && <span className="gem-glyph__times">×{cell.week}</span>}
    </span>
  );
}
