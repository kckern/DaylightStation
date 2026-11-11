/**
 * GemGlyph — one Gem Board cell at a glance. A cell is exactly one of:
 *   blank    nothing begun, out of reach, not readable, or still open
 *   a gem    whole and in the area's colour when earned or led (×n past one)
 *   a ring   a day-count with at least one day done and still winnable: the
 *            gem inside it is cut like the ring around it: done days' wedges
 *            in colour, days to go in grey at 30%
 * No icon on the stone; the area is its colour (legend on the board and the
 * family card). Status is never a hue: nothing is amber, and a day-count
 * carries no words: its ring and its cut stone are all it says. The grey
 * wedges are the one see-through thing on the board (the user's spec).
 *
 * The ring is drawn in the colour of the rule whose days it counts (the
 * streak's own part), which in a merged row is still the row's area colour.
 */
import GemIcon from '@/lib/icons/GemIcon.jsx';

const REACH_WORDS = { 'on-track': 'on track', tight: 'every day left', out: 'out of reach this week' };
const STATE_WORDS = { won: 'won', earned: 'earned', leading: 'leading', pending: 'not yet', unknown: 'can’t tell yet', none: 'not this week', disabled: 'off' };

/** A day-count the child has started and can still make: the only one drawn. */
const runningStreak = (cell) => (cell?.streak && cell.streak.have > 0 && cell.streak.reach !== 'out' ? cell.streak : null);

/** Which look a cell takes: lit, holding, streak, unknown, off or none (blank). A lead outranks a day-count: it is a gem held now. */
export function glyphLook(cell) {
  const state = cell?.state ?? 'none';
  if ((cell?.week ?? 0) > 0 || state === 'earned' || state === 'won') return 'lit';
  if (state === 'leading') return 'holding';
  if (runningStreak(cell)) return 'streak';
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
  // A lead held in a row that also counts days: the gem is drawn whole, the days are still said.
  if (run) return state === 'leading' ? `leading, and ${run}` : run;
  return STATE_WORDS[state] ?? state;
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
  const need = Math.max(1, Math.floor(Number(streak.need) || 0));
  return (
    <svg className="gem-glyph__ring" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      {/* The colour goes inline: the stylesheet's stroke would beat an SVG attribute. */}
      {Array.from({ length: need }, (_, i) => {
        const done = i < streak.have;
        return <path key={i} className={`gem-glyph__seg${done ? ' is-done' : ''}`} d={segmentPath(i, need)} style={done ? { stroke: color } : undefined} />;
      })}
    </svg>
  );
}

/**
 * A pie wedge as a CSS clip-path: from the centre, straight up, clockwise
 * through `frac` of a turn. The arc runs at radius 75% so it clears the box's
 * corners; points every 6° make it round enough at gem size. Its edges fall on
 * segment boundaries (i × 360/need), the middle of each ring gap.
 */
export function pieClip(frac) {
  if (frac >= 1) return 'none';
  const f = Math.max(0, Number(frac) || 0);
  if (f === 0) return 'polygon(50% 50%, 50% 50%, 50% 50%)';
  const fmt = (v) => `${Number((50 + 75 * v).toFixed(2))}%`;
  const pts = ['50% 50%'];
  const steps = Math.max(2, Math.ceil((f * 360) / 6));
  for (let i = 0; i <= steps; i += 1) {
    const a = ((f * 360 * i) / steps - 90) * (Math.PI / 180);
    pts.push(`${fmt(Math.cos(a))} ${fmt(Math.sin(a))}`);
  }
  return `polygon(${pts.join(', ')})`;
}

const PENDING_GREY = '#8a93a0';

/** A whole stone, or a stone cut into done (colour) and to-go (grey, 30%) wedges. */
function Stone({ color, size, done = null }) {
  if (done == null) {
    return <span className="gem-glyph__stone" style={{ width: size, height: size }}><GemIcon color={color} size={size} solid /></span>;
  }
  return (
    <span className="gem-glyph__stone gem-glyph__pie" style={{ width: size, height: size }}>
      <span className="gem-glyph__togo"><GemIcon color={PENDING_GREY} size={size} solid /></span>
      <span className="gem-glyph__done" style={{ clipPath: pieClip(done) }}><GemIcon color={color} size={size} solid /></span>
    </span>
  );
}

/**
 * @param {object} props
 * @param {object} props.cell
 * @param {string} props.color - the row's area colour
 * @param {string} [props.area] - the row's area (`move` | `school` | `games`): carried as `data-area`, not drawn
 */
export default function GemGlyph({ cell, color, area = null }) {
  const look = glyphLook(cell);
  const streak = runningStreak(cell);
  const ringColor = (streak && cell.parts?.find((p) => p.ruleId === streak.ruleId)?.color) || color;
  const ring = streak ? <Ring streak={streak} color={ringColor} /> : null;
  // A gem with no ring around it fills the cell; inside a ring it sits within it.
  const ringed = Boolean(ring);
  let inner = null;
  if (look === 'lit' || look === 'holding') inner = <Stone color={color} size={ringed ? '2.6em' : '3.2em'} />;
  else if (look === 'streak') inner = <Stone color={color} size="2.6em" done={streak.have / Math.max(1, streak.need)} />;
  else if (look === 'off') inner = <span className="gem-glyph__muted">–</span>;
  return (
    <span className="gem-glyph" data-look={look} data-area={area ?? undefined} data-ringed={ringed ? '' : undefined} data-reach={streak?.reach ?? undefined}>
      {ring}
      {inner}
      {look === 'lit' && cell.week > 1 && <span className="gem-glyph__times">×{cell.week}</span>}
    </span>
  );
}
