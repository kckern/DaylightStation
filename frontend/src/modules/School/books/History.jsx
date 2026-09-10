/** Finished and set-aside reads grouped by effective outcome month; finished tiles open details. */
import ShelfTile from './ShelfTile.jsx';
import { lastFinish } from './readingHistory.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-07` from an ISO instant or a study-day key; '' when unreadable. */
function monthKey(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[1]}-${m[2]}` : '';
}

/** `July 2026`; `Earlier` for the items whose month could not be read. */
function monthLabel(key) {
  if (!key) return 'Earlier';
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

const DONE = new Set(['finished', 'set-aside']);

/** Group the finished/set-aside items by month, most recent month first. */
export function groupByMonth(items = []) {
  const groups = new Map();
  for (const item of items) {
    if (!item || !DONE.has(item.projection?.status)) continue;
    const key = monthKey(item.projection?.status === 'finished' ? lastFinish(item).day : item.projection?.lastAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Keys sort as strings: `2026-08` after `2026-07`, and '' (unreadable) last.
  return [...groups.entries()]
    .sort(([a], [b]) => (b > a ? 1 : b < a ? -1 : 0))
    .map(([key, group]) => ({ key, label: monthLabel(key), items: group }));
}

/**
 * @param {object} props
 * @param {object[]} props.items - every shelf item; this view keeps the done ones.
 */
export default function History({ items = [], onSelect = null }) {
  const groups = groupByMonth(items);
  return (
    <div className="school-books-history" data-testid="book-history">
      {groups.length === 0 ? (
        <p className="school-books__empty">Nothing finished yet</p>
      ) : (
        <div className="school-books-history__scroll" data-testid="book-history-scroll">
          {groups.map((group) => (
            <section key={group.key || 'earlier'} className="school-books-history__group" data-testid="book-history-group">
              <h3 className="school-books-history__month">{group.label}</h3>
              <div className="school-books-history__tiles">
                {group.items.map((item) => (
                  <ShelfTile key={item.itemId} item={item} finished onSelect={item.projection?.status === 'finished' ? onSelect : null} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
