/**
 * GemDetail — the box a Gem Board cell opens: which days counted, which
 * milestones were paid, how a contest stands. One block per rule folded into
 * the row (the cell's `parts`). The board at a glance carries none of this.
 * Everything here is about the week on the board: no running totals.
 *
 * Read across a garage by children: every number goes out with its unit
 * (a race time as m:ss, rings as "1,260 rings", day-counts as "2 of 5 days"),
 * a contest names who leads and with what, a milestone says what happened and
 * on which day, in words. Never a raw score.
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
import AreaIcon, { inkOn } from './AreaIcon.jsx';

const DAY_MS = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (day, form) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: form, timeZone: 'UTC' });

/** The week's seven days from its Monday: `[{day, letter, short}]`. */
export function weekDays(from) {
  if (!from) return [];
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i);
    return { day, letter: weekdayOf(day, 'narrow'), short: weekdayOf(day, 'short') };
  });
}

/** `['Monday', 'Tuesday', 'Friday']` → "Monday, Tuesday and Friday". */
export function listWords(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** A day by name, from today's point of view: "today", "yesterday", else "Tuesday". */
export function dayName(day, today = null) {
  if (!day) return null;
  if (today && day === today) return 'today';
  if (today && addDays(day, 1) === today) return 'yesterday';
  return weekdayOf(day, 'long');
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A race time in seconds as a clock reads it: 314 → "5:14", 3725 → "1:02:05". */
export function clockTime(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * A contest value in words, by its unit (gemBoard.mjs `contestEntry`):
 * seconds → "5:14", metres → "2,340 m", rings → "1,260 rings",
 * rings-vs-usual → "36 more rings than usual" / "120 fewer than usual",
 * anything else → a whole number with separators.
 */
export function formatMeasure(value, unit) {
  const n = value == null || value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) return null;
  switch (unit) {
    case 'seconds': return clockTime(n);
    case 'metres': return `${Math.round(n).toLocaleString('en-US')} m`;
    case 'rings': return plural(Math.round(n), 'ring');
    case 'rings-vs-usual': {
      const r = Math.round(n);
      if (r > 0) return `${plural(r, 'ring')} more than usual`;
      if (r < 0) return `${plural(-r, 'ring')} fewer than usual`;
      return 'same as usual';
    }
    default: return Math.round(n).toLocaleString('en-US');
  }
}

/** The short form for a standings row, where the heading already says what is counted. */
function shortMeasure(value, unit) {
  if (unit !== 'rings-vs-usual') return formatMeasure(value, unit);
  const r = Math.round(Number(value));
  if (!Number.isFinite(r)) return null;
  return r > 0 ? `${r.toLocaleString('en-US')} more` : r < 0 ? `${(-r).toLocaleString('en-US')} fewer` : 'same';
}

/** How a day-count stands, in one line. Null when there is nothing to say. */
export function streakLine(part) {
  if (part?.state === 'earned') return 'Earned!';
  const p = part?.progress;
  if (!p) return null;
  const count = `${p.have} of ${plural(p.need, 'day')}`;
  if (part.state !== 'pending') return count;
  const togo = Math.max(0, p.need - p.have);
  if (part.reach === 'on-track') return `${count} · ${togo} more to go`;
  if (part.reach === 'tight') return `${count} · ${togo} more to go, every day left`;
  if (part.reach === 'out') return `${count} · can’t make it this week`;
  return count;
}

/** The days that counted, in words: "Done on Monday and Tuesday". */
export function doneLine(part, from, today) {
  const done = weekDays(from).filter((d) => (part.days ?? []).some((x) => x.day === d.day && x.state === 'done'));
  if (!done.length) return 'No days done yet';
  return `Done ${listWords(done.map((d) => dayName(d.day, today)).map((w) => (w === 'today' || w === 'yesterday' ? w : `on ${w}`)))}`;
}

/**
 * A contest in one sentence, from the learner's side, and who leads:
 * "Ann leads with 5:14 on Sprint 1500", "Ben leads with 410 rings",
 * "Ann and Ben are tied with …", "Nobody is ahead of their usual rings yet".
 */
export function contestHeadline(part, learnerName) {
  const score = part.score;
  const standings = score?.standings ?? [];
  const leaders = standings.filter((r) => r.leader);
  const where = score?.course ? ` on ${score.course}` : '';
  if (!leaders.length) {
    return score?.unit === 'rings-vs-usual' ? 'Nobody is above their usual rings yet' : 'Nobody has a score yet';
  }
  const value = formatMeasure(leaders[0].value, score.unit);
  const won = part.state === 'won';
  if (leaders.length > 1) {
    const names = listWords(leaders.map((r) => r.name));
    return `${names} are tied${won ? '' : ' for first'} with ${value}${where}`;
  }
  const leader = leaders[0];
  const who = leader.name ?? learnerName;
  return `${who} ${won ? 'won' : 'leads'} with ${value}${where}`;
}

const STATE_LINE = { earned: 'Earned!', won: 'Won!', pending: 'Not finished yet', unknown: 'Can’t tell yet' };

const isDayCount = (part) => part.progress != null || (part.days?.length ?? 0) > 0;
/** Does this part have anything to show? */
const partSpeaks = (part) => Boolean(part) && part.state !== 'disabled' && (
  (part.state ?? 'none') !== 'none' || (part.days?.length ?? 0) > 0 || (part.items?.length ?? 0) > 0
  || part.score != null
);

/** The parts of a cell the detail box shows; none means the cell has nothing to open. */
export const detailParts = (cell) => (cell?.parts ?? []).filter(partSpeaks);

/** What the cell holds this week, in words: "2 gems this week", "Holding 1 gem while leading". */
export function gemsLine(cell) {
  const earned = Math.max(0, Number(cell?.week) || 0);
  const held = Math.max(earned, Number(cell?.held) || 0);
  const leading = held - earned;
  if (!held) return 'No gem yet this week';
  if (!leading) return `${plural(earned, 'gem')} this week`;
  if (!earned) return `Holding ${plural(leading, 'gem')} while leading`;
  return `${plural(earned, 'gem')} this week, and ${leading} more while leading`;
}

function DayStrip({ part, color, from, today }) {
  const marks = Object.fromEntries((part.days ?? []).map((d) => [d.day, d.state]));
  const ink = inkOn(color);
  return (
    <div className="gem-detail__strip" aria-hidden="true">
      {weekDays(from).map(({ day, short }) => {
        const mark = marks[day] === 'done' ? 'is-done' : marks[day] === 'short' ? 'is-short' : null;
        const closed = Boolean(part.lastDay) && day > part.lastDay;
        const ahead = !closed && Boolean(today) && day > today;
        const classes = ['gem-detail__day', mark, today && day === today ? 'is-today' : null, ahead ? 'is-ahead' : null, closed ? 'is-closed' : null];
        const style = mark === 'is-done' ? { background: color, borderColor: color, color: ink } : mark === 'is-short' ? { borderColor: color } : undefined;
        return <span key={day} className={classes.filter(Boolean).join(' ')} style={style}>{short}</span>;
      })}
    </div>
  );
}

/** Everyone in the contest, best first; the learner's own row picked out. */
function Standings({ score, learnerId, color }) {
  const rows = score?.standings ?? [];
  if (!rows.length) return null;
  const ink = inkOn(color);
  return (
    <ol className="gem-detail__standings">
      {rows.map((r, i) => {
        const mine = r.learnerId === learnerId;
        return (
          <li key={r.learnerId} className={mine ? 'is-mine' : undefined} style={mine ? { borderColor: color } : undefined}>
            <span className="gem-detail__rank" style={r.leader ? { background: color, color: ink } : undefined}>{i + 1}</span>
            <span className="gem-detail__name">{r.name}</span>
            <span className="gem-detail__value">{shortMeasure(r.value, score.unit)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Part({ part, color, from, today, heading = true, learner }) {
  let status = null;
  let sub = null;
  let body = null;
  if (part.state === 'unknown') {
    status = STATE_LINE.unknown;
  } else if (isDayCount(part)) {
    status = streakLine(part);
    sub = doneLine(part, from, today);
    body = <DayStrip part={part} color={color} from={from} today={today} />;
  } else if (part.cadence === 'contest') {
    status = part.score ? contestHeadline(part, learner.name) : (STATE_LINE[part.state] ?? 'Not this week');
    if (part.score && !(part.score.standings ?? []).some((r) => r.learnerId === learner.learnerId)) {
      sub = `${learner.name}: no score yet this week`;
    } else if (part.score?.unit === 'rings-vs-usual') {
      sub = 'Rings this week, against the usual week';
    }
    body = <Standings score={part.score} learnerId={learner.learnerId} color={color} />;
  } else if (part.cadence === 'milestone') {
    const items = part.items ?? [];
    if (items.length) {
      status = items.length > 1 ? `${items.length} this week` : null;
      body = (
        <ul className="gem-detail__items">
          {items.map((item, i) => (
            <li key={`${item.day}:${i}`}>
              <span className="gem-detail__what">{item.label ?? part.label}</span>
              {item.day && <span className="gem-detail__when">{dayName(item.day, today) === 'today' || dayName(item.day, today) === 'yesterday' ? dayName(item.day, today) : `on ${dayName(item.day, today)}`}</span>}
            </li>
          ))}
        </ul>
      );
    } else {
      status = 'None yet this week';
    }
  } else {
    status = STATE_LINE[part.state] ?? 'Not this week';
  }
  return (
    <div className="gem-detail__part" data-rule={part.ruleId} data-state={part.state ?? 'none'} data-reach={part.reach ?? undefined}>
      {heading && <span className="gem-detail__part-label">{part.label}</span>}
      {status && <span className="gem-detail__line">{status}</span>}
      {body}
      {sub && <span className="gem-detail__sub">{sub}</span>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {{id: string, label: string, color: string, area?: string}} props.row
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
  const heading = !(parts.length === 1 && parts[0].label.toLowerCase() === row.label.toLowerCase());
  const closeRef = useRef(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const area = row.area ?? row.group;
  // Two tall blocks (two contests' standings, two day strips) sit side by side, not stacked past the screen.
  const wide = parts.filter((p) => p.cadence === 'contest' && p.score).length >= 2
    || parts.filter((p) => p.state !== 'unknown' && isDayCount(p)).length >= 2;
  // Not aria-modal: the board around it is the modal dialog, and it makes its grid inert meanwhile.
  return (
    <div className="gem-detail" role="dialog" aria-label={`${learner.name}, ${row.label}`}>
      <div className="gem-detail__backdrop" onClick={() => onClose?.('tap')} />
      <div className={`gem-detail__card${wide ? ' is-wide' : ''}`} style={{ '--gem': row.color }}>
        <div className="gem-detail__head">
          <span className="gem-detail__badge" style={{ background: row.color, color: inkOn(row.color) }}><AreaIcon area={area} /></span>
          <div className="gem-detail__title">
            <span className="gem-detail__row">{row.label}</span>
            <span className="gem-detail__who">{learner.name} · {gemsLine(cell)}</span>
          </div>
          <button ref={closeRef} type="button" className="gem-detail__close" aria-label="Close" onClick={() => onClose?.('tap')}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="gem-detail__parts">
          {parts.length
            ? parts.map((part) => <Part key={part.ruleId} part={part} color={part.color ?? row.color} from={from} today={today} heading={heading} learner={learner} />)
            : <div className="gem-detail__part"><span className="gem-detail__line">Not this week</span></div>}
        </div>
      </div>
    </div>
  );
}
