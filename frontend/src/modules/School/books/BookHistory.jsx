/**
 * Book history — everything a child is DONE with, one shelf per day.
 *
 * It replaced "Finished and set aside" (one endless sideways row) and the
 * separate "See all history" screen (grouped by month, a screen away). Both
 * hid the thing a child actually remembers, which is the DAY: "I finished
 * two on Saturday". So the history is grouped by day, newest first.
 *
 * ONE FLOWING SHELF, NOT ONE ROW PER DAY. A row per day spent a whole shelf
 * on a single book and left most of the panel black. Instead the cards wrap
 * as one flow, and the DAYS ARE GROUPED BY COLOUR: each day takes the next
 * colour from a cycling palette, and that colour runs as a band along the
 * top of every card of that day — so a day that wraps onto the next row, or
 * two days sharing a row, still read as their own groups. Each day opens
 * with a SPINE: a slim partition in the day's colour, the day-of-month large
 * and upright at its top, the weekday running down it. The flow reveals
 * itself a week of days at a time as the child scrolls the page.
 *
 * The spine carries the date, so the cards do not: a card wearing the same
 * date as the spine beside it was saying it twice.
 */
import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ShelfTile from './ShelfTile.jsx';
import { outcomeDay } from './readingHistory.js';
import { addDays, dayLabel, parseKey, WEEKDAY_NAMES, MONTH_NAMES, isoWeekday } from '../shared/dayGrid/dayGridModel.js';

const DONE = new Set(['finished', 'set-aside']);
const PAGE_DAYS = 7;
/**
 * The day colours, cycling. The household's own accents, not new ones: a
 * palette that already sits on this ground, and six of them so two days on
 * one row never share a colour and a week of days never repeats one.
 */
export const DAY_COLOURS = Object.freeze([
  'var(--school-accent)', 'var(--kind-video)', 'var(--kind-deck)',
  'var(--kind-audio)', 'var(--kind-app)', 'var(--school-warn)',
]);

/** `2026-09-05` from an ISO instant or a study-day key; '' when unreadable. */
function dayKey(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
  return m ? m[1] : '';
}

/** What a day is called from the child's chair: today, yesterday, or its name. */
export function dayHeading(key, today = null) {
  if (!key) return 'Earlier';
  if (today && key === today) return 'Today';
  if (today) {
    try { if (key === addDays(today, -1)) return 'Yesterday'; } catch { /* a bad today names nothing */ }
  }
  try { return dayLabel(key); } catch { return key; }
}

/** What makes two shelf items the same BOOK: the catalogue id, else the ISBN, else the title. */
const bookKey = (item) => item.bookId ?? item.isbn13 ?? item.book?.isbn13 ?? String(item.title ?? item.book?.title ?? item.itemId);

/**
 * What the spine says: the day-of-month as its number, the month BELOW it as
 * its own small line when the month is not this one (a "19" in September is
 * not enough on its own), and the weekday as the word running down it. Today
 * and yesterday keep their words and no number.
 *   Today / —,  Yesterday / —,  6 / Sunday,  19 · Aug / Wednesday,  Earlier / —
 *
 * THE MONTH IS A SEPARATE FIELD, not appended to the number. As one string
 * "19 Aug" wrapped inside the spine's width while a bare "8" did not, so the
 * big numeral sat at a different height on those days and the spines down a
 * column no longer lined up. Its own line keeps every numeral on one baseline.
 */
export function bookendLines(key, today = null) {
  const heading = dayHeading(key, today);
  if (!key || heading === 'Today' || heading === 'Yesterday') return { top: null, month: null, bottom: heading };
  try {
    const ms = parseKey(key);
    const d = new Date(ms);
    let thisMonth = false;
    try { thisMonth = today ? new Date(parseKey(today)).getUTCMonth() === d.getUTCMonth() : false; } catch { thisMonth = false; }
    return {
      top: String(d.getUTCDate()),
      month: thisMonth ? null : MONTH_NAMES[d.getUTCMonth()].slice(0, 3),
      bottom: WEEKDAY_NAMES[isoWeekday(ms) - 1],
    };
  } catch {
    return { top: null, month: null, bottom: heading };
  }
}

/**
 * Group the done items by the day of their outcome, newest day first — and
 * WITHIN a day, one card per book. A three-year-old who has the same board
 * book read to them three times before lunch has three finish entries, and
 * three identical cards in a row said nothing the first one had not. The
 * card keeps the first entry (the one a tap opens) and wears the count.
 */
export function groupByDay(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (!item || !DONE.has(item.projection?.status)) continue;
    const key = dayKey(outcomeDay(item).day);
    if (!groups.has(key)) groups.set(key, new Map());
    const day = groups.get(key);
    const book = bookKey(item);
    if (day.has(book)) day.get(book).times += 1;
    else day.set(book, { item, times: 1 });
  }
  // Keys sort as strings; '' (unreadable) sorts last.
  return [...groups.entries()]
    .sort(([a], [b]) => (b > a ? 1 : b < a ? -1 : 0))
    .map(([key, day]) => ({ key, items: [...day.values()] }));
}

/** The day's partition: its number, its month when that needs saying, its weekday. */
function Spine({ lines, label }) {
  return (
    <h4 className="school-books-history__bookend" aria-label={label}>
      {lines.top ? <span className="school-books-history__bookend-top">{lines.top}</span> : null}
      {lines.month ? <span className="school-books-history__bookend-month">{lines.month}</span> : null}
      <span className="school-books-history__bookend-bottom">{lines.bottom}</span>
    </h4>
  );
}

/**
 * A SPINE IS NEVER THE LAST THING ON A ROW.
 *
 * A day's partition landing in the final cell of a row announced a day whose
 * books were all on the row below — it read as a label for the wrong shelf,
 * and the row it closed ended on a colour that belonged to nothing above it.
 * Flex wrapping has no "keep these together", so the spine and the day's FIRST
 * book are one flow item: they wrap as a pair, and the pair cannot leave the
 * spine stranded. Everything after the first book wraps freely, which is what
 * lets a long day flow across rows the way it should.
 */
function Opening({ spine, children }) {
  return <div className="school-books-history__opening">{spine}{children}</div>;
}

/**
 * @param {object} props
 * @param {Array} props.items - everything DONE, grouped into day segments.
 * @param {Array} [props.reading] - what is in progress. Its own segment at the
 *   head of the grid: a book being read has no finish day to file it under,
 *   and burying it among finished days would hide the one thing a child came
 *   to the shelf to act on.
 * @param {React.ReactNode} [props.lead] - the Add tile, always the first cell.
 */
export default function BookHistory({ items = [], reading = [], lead = null, today = null, onSelect = null, incompatibleMetricFor = null, pageDays = PAGE_DAYS }) {
  const groups = groupByDay(items);
  const [shown, setShown] = useState(pageDays);
  const sentinel = useRef(null);

  // Reveal another week of days when the sentinel scrolls into view. A panel
  // without IntersectionObserver (none in the house) simply shows the first
  // page; nothing is lost, only deferred.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !sentinel.current || shown >= groups.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown((n) => Math.min(groups.length, n + pageDays));
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [shown, groups.length, pageDays]);

  const visible = groups.slice(0, shown);
  // ONE GRID. Today and history used to be two stacked sections with their own
  // headings; they are one flow now, so the eye runs from the book being read
  // straight back through every day without a seam.
  return (
    <section className="school-books-history" aria-label="Books" data-testid="book-history">
      <div className="school-books-history__scroll" data-testid="book-history-scroll">
        <div className="school-books-history__flow" data-testid="book-grid">
          {lead}
          {reading.length > 0 && (
            // A segment like a day's, without a date — because "now" is not a
            // day you look back on. `display: contents`, so its cards join the
            // same wrap as every other cell.
            <section className="school-books-history__day school-books-history__day--reading"
              data-testid="book-reading-group" style={{ '--day-colour': 'var(--school-accent)' }}>
              <Opening spine={<Spine lines={{ top: null, month: null, bottom: 'Reading' }} label="Reading now" />}>
                {reading.length > 0 && (
                  <ShelfTile key={reading[0].itemId} item={reading[0]} onSelect={onSelect}
                    incompatibleMetric={incompatibleMetricFor?.(reading[0]) ?? null} />
                )}
              </Opening>
              {reading.slice(1).map((item) => (
                <ShelfTile key={item.itemId} item={item} onSelect={onSelect}
                  incompatibleMetric={incompatibleMetricFor?.(item) ?? null} />
              ))}
            </section>
          )}
          {visible.map((group, index) => {
            const lines = bookendLines(group.key, today);
            return (
              // `display: contents`: the section keeps the day's spine and
              // books together in the DOM (and for anyone reading it), while
              // the flow lays them out as one wrapping shelf. The day's colour
              // is set here and inherited by the spine and every card.
              <section
                key={group.key || 'earlier'}
                className="school-books-history__day"
                data-testid="book-history-group"
                data-day={group.key || undefined}
                style={{ '--day-colour': DAY_COLOURS[index % DAY_COLOURS.length] }}
              >
                <Opening spine={<Spine lines={lines} label={dayHeading(group.key, today)} />}>
                  <ShelfTile key={group.items[0].item.itemId} item={group.items[0].item}
                    history times={group.items[0].times} onSelect={onSelect} />
                </Opening>
                {group.items.slice(1).map(({ item, times }) => (
                  <ShelfTile key={item.itemId} item={item} history times={times} onSelect={onSelect} />
                ))}
              </section>
            );
          })}
        </div>
        {shown < groups.length && (
          <div ref={sentinel} className="school-books-history__more" data-testid="book-history-more" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}

BookHistory.propTypes = {
  items: PropTypes.array,
  reading: PropTypes.array,
  lead: PropTypes.node,
  /** (item) => metric|null — the obligation metric this book cannot count toward. */
  incompatibleMetricFor: PropTypes.func,
  /** The study day, so the top shelf can be called Today. */
  today: PropTypes.string,
  onSelect: PropTypes.func,
  pageDays: PropTypes.number,
};
