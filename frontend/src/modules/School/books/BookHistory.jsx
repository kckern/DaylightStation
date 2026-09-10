/**
 * Book history — everything a child is DONE with, one shelf per day.
 *
 * It replaced "Finished and set aside" (one endless sideways row) and the
 * separate "See all history" screen (grouped by month, a screen away). Both
 * hid the thing a child actually remembers, which is the DAY: "I finished
 * two on Saturday". So the history is a stack of days, newest first, each
 * day a horizontal shelf that runs off the panel edge, and the stack scrolls
 * down as far as the record goes — revealing itself a week at a time as the
 * child reaches the bottom, so a year of reading costs nothing until it is
 * looked at.
 *
 * The day heading carries the date, so the cards do not: a card wearing the
 * same date as the line above it was saying it twice.
 */
import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import ShelfTile from './ShelfTile.jsx';
import { outcomeDay } from './readingHistory.js';
import { addDays, dayLabel } from '../shared/dayGrid/dayGridModel.js';

const DONE = new Set(['finished', 'set-aside']);
const PAGE_DAYS = 7;

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

export default function BookHistory({ items = [], today = null, onSelect = null, pageDays = PAGE_DAYS }) {
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

  if (!groups.length) return null;
  const visible = groups.slice(0, shown);
  return (
    <section className="school-books-history" aria-label="Book history" data-testid="book-history">
      <h3 className="school-books__shelf-title">Book history</h3>
      <div className="school-books-history__scroll" data-testid="book-history-scroll">
        {visible.map((group) => (
          <section key={group.key || 'earlier'} className="school-books-history__day" data-testid="book-history-group" data-day={group.key || undefined}>
            <h4 className="school-books-history__heading">{dayHeading(group.key, today)}</h4>
            <div className="school-books__row school-books__row--history">
              {group.items.map(({ item, times }) => (
                <ShelfTile key={item.itemId} item={item} history times={times} onSelect={onSelect} />
              ))}
            </div>
          </section>
        ))}
        {shown < groups.length && (
          <div ref={sentinel} className="school-books-history__more" data-testid="book-history-more" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}

BookHistory.propTypes = {
  items: PropTypes.array,
  /** The study day, so the top shelf can be called Today. */
  today: PropTypes.string,
  onSelect: PropTypes.func,
  pageDays: PropTypes.number,
};
