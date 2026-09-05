/**
 * ShelfTile — one cover and one caption (book-shelf UI design §3).
 *
 * The cover is the recognition cue: a child finds Hatchet by its picture. A
 * book with no cover, or whose cover fails to load, gets the calm placeholder
 * the launch card already uses — never an invented one. The tile is laid out
 * for a ~500px cover and never upscales it (the grid column caps the width).
 *
 * The caption is the mode's own number, straight from `projectShelfItem` on
 * the server: `p. 84` under a bar (page), `3h 20m` (minutes), `read on 12
 * days` (check). The tile derives nothing — status, page, percent and days
 * arrive computed; formatting a duration and a date is all it does itself.
 *
 * On History the same tile shows the day instead of a bar and is not a
 * button: nothing there is editable. No `<h1>`, no logging — the parent owns
 * the story.
 */
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `Jul 14` from an ISO instant or a study-day key. Reads the date from the
 * string rather than the clock: the server already decided which day the
 * event belongs to, and re-zoning it here could move it across midnight.
 */
export function shortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${Number(m[3])}`;
}

// Spelled the way the obligation line spells them (see BookLogProgramLauncher).
const METRIC_WORDS = { checkins: 'check-ins' };

/** `3h 20m` / `2h` / `45m` from integer minutes. */
export function formatMinutes(minutes) {
  const n = Math.max(0, Math.floor(Number(minutes) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function captionFor(item) {
  const p = item.projection ?? {};
  switch (item.progressMode) {
    case 'minutes':
      return p.minutes > 0 ? formatMinutes(p.minutes) : 'Just started';
    case 'check':
      return p.daysRead > 0 ? `read on ${p.daysRead} ${p.daysRead === 1 ? 'day' : 'days'}` : 'Just started';
    case 'page':
    default:
      return Number.isFinite(p.page) && p.page !== null ? `p. ${p.page}` : 'Just started';
  }
}

function outcomeFor(item) {
  const day = shortDay(item.projection?.lastAt);
  const word = item.projection?.status === 'set-aside' ? 'Set aside' : 'Finished';
  return day ? `${word} ${day}` : word;
}

/**
 * @param {object} props
 * @param {object} props.item - a shelf item as `useBookShelf` returns it.
 * @param {(itemId: string) => void} [props.onSelect] - absent on History.
 * @param {string|null} [props.incompatibleMetric] - the obligation's metric
 *   this book cannot count toward, when the shelf says so.
 * @param {boolean} [props.finished] - History mode; otherwise read from
 *   `projection.status`.
 */
export default function ShelfTile({ item, onSelect = null, incompatibleMetric = null, finished = false }) {
  const status = item.projection?.status ?? 'reading';
  const onHistory = finished || status === 'finished' || status === 'set-aside';
  const presentation = presentBook(item);
  const title = presentation.title;

  const showBar = !onHistory && item.progressMode === 'page' && item.pageCount !== null && item.pageCount !== undefined;
  const percent = Math.min(100, Math.max(0, Number(item.projection?.percent) || 0));

  const body = (
    <>
      <BookCover book={item} className="school-books-tile__cover" loading="lazy" />
      <span className="school-books-tile__title" title={title}>{title}</span>
      {presentation.author && (
        <span className="school-books-tile__author" title={presentation.allAuthors}>{presentation.author}</span>
      )}
      {showBar && (
        <div
          className="school-books-tile__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={`${percent}% read`}
        >
          <div className="school-books-tile__fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      <span className="school-books-tile__caption">{onHistory ? outcomeFor(item) : captionFor(item)}</span>
      {!onHistory && incompatibleMetric && (
        <span className="school-books-tile__tag">{`doesn't count toward ${METRIC_WORDS[incompatibleMetric] ?? incompatibleMetric}`}</span>
      )}
    </>
  );

  if (!onSelect) {
    return <div className="school-books-tile school-books-tile--still">{body}</div>;
  }
  return (
    <button type="button" className="school-books-tile" aria-label={`Open ${title}`} onClick={() => onSelect(item.itemId)}>
      {body}
    </button>
  );
}
