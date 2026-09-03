/**
 * History — the year's bookshelf (book-shelf UI design §3).
 *
 * Finished and set-aside books as the same tiles the shelf uses, with a date
 * where the bar was, grouped by the month they were last touched, most recent
 * group first. Nothing on it is editable: the tiles are not buttons, and the
 * only ways out are `‹ back` and the parent's `Done`.
 *
 * The month is read from `projection.lastAt` as a string — the server already
 * decided which day the event belongs to. Items arrive most-recently-touched
 * first from the hook and keep that order inside a group.
 */
import ShelfTile from './ShelfTile.jsx';

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
    const key = monthKey(item.projection?.lastAt);
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
 * @param {() => void} props.onBack
 */
export default function History({ items = [], onBack }) {
  const groups = groupByMonth(items);
  return (
    <div className="school-books-history" data-testid="book-history">
      <button type="button" className="school-books__back" onClick={onBack}>‹ back</button>
      {groups.length === 0 ? (
        <p className="school-books__empty">Nothing finished yet</p>
      ) : (
        <div className="school-books__grid school-books-history__scroll">
          {groups.map((group) => (
            <section key={group.key || 'earlier'} className="school-books-history__group" data-testid="book-history-group">
              <h3 className="school-books-history__month">{group.label}</h3>
              <div className="school-books-history__tiles">
                {group.items.map((item) => (
                  <ShelfTile key={item.itemId} item={item} finished />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
