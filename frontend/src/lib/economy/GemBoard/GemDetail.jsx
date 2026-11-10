/**
 * GemDetail — the box a Gem Board cell opens: which days counted, which
 * milestones were paid, how a contest stands. One block per rule folded into
 * the row (the cell's `parts`). The board at a glance carries none of this.
 *
 * No failure marks here either: a past day with nothing on it is plain and
 * dim, never a cross. A day after the rule's own last day (`part.lastDay`: a
 * ring-days rule closes Saturday) is drawn closed, not as a day still to come.
 *
 * `detailParts` is the one rule for "does this cell have anything to say":
 * the box lists those parts, and the board makes a cell a button when there
 * are any.
 */
import { useEffect, useRef } from 'react';

const DAY_MS = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day, form) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: form, timeZone: 'UTC' });

/** The week's seven days from its Monday: `[{day, letter}]`. */
export function weekDays(from) {
  if (!from) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i);
    return { day, letter: weekdayOf(day, 'narrow') };
  });
}

/** How a day-count stands, in one line. Null when there is nothing to say. */
export function streakLine(part) {
  if (part?.state === 'earned') return 'Earned';
  const p = part?.progress;
  if (!p) return null;
  const count = `${p.have} of ${p.need} days`;
  if (part.state !== 'pending') return count;
  if (part.reach === 'on-track') return `${count} · ${part.left} ${part.left === 1 ? 'day' : 'days'} left`;
  if (part.reach === 'tight') return `${count} · needs every day left`;
  if (part.reach === 'out') return `${count} · out of reach this week`;
  return count;
}

const STATE_LINE = { earned: 'Earned', won: 'Won', leading: 'Leading so far', pending: 'Still in reach' };

const isDayCount = (part) => part.progress != null || (part.days?.length ?? 0) > 0;
/** Does this part have anything to show? */
const partSpeaks = (part) => Boolean(part) && part.state !== 'disabled' && (
  (part.state ?? 'none') !== 'none' || (part.days?.length ?? 0) > 0 || (part.items?.length ?? 0) > 0
  || (part.lifetime ?? 0) > 0 || part.score != null
);

/** The parts of a cell the detail box shows; none means the cell has nothing to open. */
export const detailParts = (cell) => (cell?.parts ?? []).filter(partSpeaks);

function DayStrip({ part, color, from, today }) {
  const marks = Object.fromEntries((part.days ?? []).map((d) => [d.day, d.state]));
  const counted = weekDays(from).filter((d) => marks[d.day] === 'done').map((d) => weekdayOf(d.day, 'short'));
  return (
    <div className="gem-detail__strip" role="img" aria-label={counted.length ? `Counted: ${counted.join(', ')}` : 'No days counted yet'}>
      {weekDays(from).map(({ day, letter }) => {
        const mark = marks[day] === 'done' ? 'is-done' : marks[day] === 'short' ? 'is-short' : null;
        const closed = Boolean(part.lastDay) && day > part.lastDay;
        const ahead = !closed && Boolean(today) && day > today;
        const classes = ['gem-detail__day', mark, today && day === today ? 'is-today' : null, ahead ? 'is-ahead' : null, closed ? 'is-closed' : null];
        const style = mark === 'is-done' ? { background: color, borderColor: color } : mark === 'is-short' ? { borderColor: color } : undefined;
        return <span key={day} className={classes.filter(Boolean).join(' ')} style={style}>{letter}</span>;
      })}
    </div>
  );
}

function scoreText(score) {
  if (!score || !Number.isFinite(score.mine)) return null;
  return Number.isFinite(score.best) ? `${score.mine} — best ${score.best}` : `${score.mine}`;
}

function Part({ part, color, from, today, heading = true }) {
  let body;
  if (part.state === 'unknown') {
    body = <div className="gem-detail__line">Can’t tell yet</div>;
  } else if (isDayCount(part)) {
    const line = streakLine(part);
    body = (
      <>
        <DayStrip part={part} color={color} from={from} today={today} />
        {line && <div className="gem-detail__line">{line}</div>}
      </>
    );
  } else if (part.cadence === 'contest') {
    const standing = STATE_LINE[part.state] ?? (part.score ? 'Not leading' : null);
    const score = scoreText(part.score);
    body = (
      <>
        {standing && <div className="gem-detail__line">{standing}</div>}
        {score && <div className="gem-detail__line gem-detail__score">{score}</div>}
      </>
    );
  } else if (part.cadence === 'milestone') {
    const items = part.items ?? [];
    body = items.length
      ? (
        <ul className="gem-detail__items">
          {items.map((item, i) => {
            const when = item.day ? weekdayOf(item.day, 'short') : null;
            return <li key={`${item.day}:${i}`}>{[item.label, when].filter(Boolean).join(' · ')}</li>;
          })}
        </ul>
      )
      : <div className="gem-detail__line">{STATE_LINE[part.state] ?? 'None this week'}</div>;
  } else {
    body = STATE_LINE[part.state] ? <div className="gem-detail__line">{STATE_LINE[part.state]}</div> : null;
  }
  return (
    <div className="gem-detail__part" data-rule={part.ruleId} data-state={part.state ?? 'none'}>
      {heading && <div className="gem-detail__part-label">{part.label}</div>}
      {body}
      {(part.lifetime ?? 0) > 0 && <div className="gem-detail__line gem-detail__life">{part.lifetime} in all</div>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {{id: string, label: string, color: string}} props.row
 * @param {{learnerId: string, name: string}} props.learner
 * @param {object} props.cell - the board cell (`parts` per rule)
 * @param {object} props.windows - the board's `windows` (the strip starts at `school.from`)
 * @param {string|null} props.today
 * @param {(reason: 'tap') => void} props.onClose
 */
export default function GemDetail({ row, learner, cell, windows, today, onClose }) {
  const parts = detailParts(cell);
  const from = windows?.school?.from ?? null;
  // One rule under the row's own name: the title already says it.
  const heading = !(parts.length === 1 && parts[0].label === row.label);
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  // Not aria-modal: the board around it is the modal dialog, and it makes its grid inert meanwhile.
  return (
    <div className="gem-detail" role="dialog" aria-label={`${learner.name}, ${row.label}`}>
      <div className="gem-detail__backdrop" onClick={() => onClose?.('tap')} />
      <div className="gem-detail__card">
        <div className="gem-detail__head">
          <div className="gem-detail__title">
            <span className="gem-detail__who">{learner.name}</span>
            <span className="gem-detail__row">{row.label}</span>
          </div>
          <button ref={closeRef} type="button" className="gem-detail__close" aria-label="Close" onClick={() => onClose?.('tap')}>×</button>
        </div>
        {parts.length
          ? parts.map((part) => <Part key={part.ruleId} part={part} color={part.color ?? row.color} from={from} today={today} heading={heading} />)
          : <div className="gem-detail__line">Not this week</div>}
      </div>
    </div>
  );
}
