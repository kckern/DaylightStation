/** A recognizable cover plus server-projected progress or effective finish date. */
import BookCover from './BookCover.jsx';
import Icon from '../home/icons/Icon.jsx';
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

/**
 * What happened to a book, as a MARK rather than a sentence.
 *
 * The history row mixes outcomes — finished, set aside — and a child scanning
 * it should be able to tell them apart before reading any words. A green check
 * is the one symbol every child in the house already reads as "done"; the
 * bookmark says the book is waiting rather than beaten.
 */
const OUTCOME_MARK = Object.freeze({
  finished: { icon: 'book-finished', label: 'Finished', modifier: 'is-finished' },
  'set-aside': { icon: 'bookmark', label: 'Set aside', modifier: 'is-set-aside' },
});

/** `3h 20m` / `2h` / `45m` from integer minutes. */
export function formatMinutes(minutes) {
  const n = Math.max(0, Math.floor(Number(minutes) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * @param {object} props
 * @param {object} props.item - a shelf item as `useBookShelf` returns it.
 * @param {(itemId: string) => void} [props.onSelect] - absent on History.
 * @param {string|null} [props.incompatibleMetric] - the obligation's metric
 *   this book cannot count toward, when the shelf says so.
 * @param {boolean} [props.finished] - History mode; otherwise read from
 *   `projection.status`.
 * @param {boolean} [props.history] - on the day-shelf history: cover first, no date.
 * @param {number} [props.times] - how many times this book was finished that
 *   day; above one it wears a `×N` badge instead of repeating the card.
 */
export default function ShelfTile({ item, onSelect = null, incompatibleMetric = null, finished = false, history = false, times = 1 }) {
  const status = item.projection?.status ?? 'reading';
  const onHistory = finished || history || status === 'finished' || status === 'set-aside';
  const presentation = presentBook(item);
  const title = presentation.title;
  const mark = onHistory ? (OUTCOME_MARK[status] ?? OUTCOME_MARK.finished) : null;

  const showBar = !onHistory && item.progressMode === 'page' && item.pageCount !== null && item.pageCount !== undefined;
  const percent = Math.min(100, Math.max(0, Number(item.projection?.percent) || 0));

  const body = (
    <>
      {/* The cover and its mark are one object: the badge sits ON the art, so
          the outcome is read at the same glance as the book. */}
      <span className="school-books-tile__art">
        <BookCover book={item} className="school-books-tile__cover" loading="lazy" />
        {mark && (
          <span className={`school-books-tile__mark ${mark.modifier}`} role="img" aria-label={mark.label}>
            <Icon name={mark.icon} />
          </span>
        )}
        {/* The same book, more than once in a day: one card, a count. */}
        {times > 1 && (
          <span className="school-books-tile__times" aria-label={`${times} times`}>×{times}</span>
        )}
        {/* PROGRESS RIDES ON THE ART. The card has no text column any more, so
            a book being read shows how far along it is as a bar across the foot
            of its own cover rather than as a caption beneath it. */}
        {showBar && (
          <span className="school-books-tile__bar" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${percent}% read`}>
            <span className="school-books-tile__fill" style={{ width: `${percent}%` }} />
          </span>
        )}
        {!onHistory && incompatibleMetric && (
          <span className="school-books-tile__tag">{`doesn't count toward ${METRIC_WORDS[incompatibleMetric] ?? incompatibleMetric}`}</span>
        )}
      </span>
      {/* The text column owns its own vertical rhythm. It used to share a
          fixed four-row grid with the cover, one row of which was reserved for
          a progress bar a finished book never has — which is what sliced every
          second title line through the x-height. */}
    </>
  );

  // THE COVER IS THE CARD. The title used to sit under the art in up to three
  // wrapped lines — on a shelf of picture books, three lines of chrome per cell
  // and a grid that was mostly text. A book is recognised by its cover; the
  // words move to the panel a tap opens, and survive here as the accessible
  // name and the tooltip, so nothing is lost to a screen reader or a mouse.
  const classes = `school-books-tile${onHistory ? ' school-books-tile--history' : ''}`;
  if (!onSelect) {
    return <div className={`${classes} school-books-tile--still`} title={title}>{body}</div>;
  }
  return (
    <button type="button" className={classes} title={title} aria-label={`Open ${title}`} onClick={() => onSelect(item.itemId)}>
      {body}
    </button>
  );
}
