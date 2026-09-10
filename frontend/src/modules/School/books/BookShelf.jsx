/** Learner reading workspace: bounded collections, focused editors, and inline save results. */
import { useBookShelf } from './useBookShelf.js';
import ShelfTile from './ShelfTile.jsx';
import BookHistory from './BookHistory.jsx';
import ReadingPips from '../reading/ReadingPips.jsx';
import UpdateBook from './UpdateBook.jsx';
import AddBook from './AddBook.jsx';
import SaveReceipt from './SaveReceipt.jsx';
import CompletedBook from './CompletedBook.jsx';
import { recentOutcomes } from './readingHistory.js';
import Icon from '../home/icons/Icon.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import ScreenHeader from '../shared/ScreenHeader.jsx';

/**
 * The window word after the launcher's label (design §3): the label carries
 * no window, and a weekly target would otherwise read like a daily one.
 */
const WINDOW_WORD = { day: ' today', week: ' this week', month: ' this month' };

export function obligationSentence(obligation) {
  if (!obligation) return null;
  const label = typeof obligation.label === 'string' ? obligation.label.trim() : '';
  if (!label) return null;
  return `${label}${WINDOW_WORD[obligation.per] ?? ''}`;
}

const ON_SHELF = new Set(['reading', 'unread']);

/**
 * The panel's local date as a `YYYY-MM-DD` key — the FALLBACK for `today`
 * when the shelf read carried no `studyDay`. Not the study day: see above.
 */
export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function LearnerChip({ learner }) {
  if (!learner) return null;
  const name = learner.name || learner.id || 'Student';
  // A learner id is the household user id, so the portrait lives at the same
  // place LaunchCard reads it from; an avatar override wins when one is set.
  const avatarId = learner.avatar?.kind === 'learner' ? learner.avatar.id : learner.id;
  return (
    <div className="school-selfservice-card__learner">
      <ProfileAvatar id={avatarId} name={name} size={48} />
      <span>{name}</span>
    </div>
  );
}

/**
 * Adding a book is a BOOK on the shelf, not a control beside it.
 *
 * It used to be a button in the row's heading wearing the error-retry class,
 * which put the one thing a child comes to this screen to do in the corner and
 * in the costume of a recovery action. Now it takes a book's own footprint —
 * the same 2:3 slot every cover letterboxes into, drawn empty with a plus —
 * and stands in the row beside whatever is already being read. An empty shelf
 * is then a shelf with one empty book on it, which is an invitation; the
 * sentence it replaced ("Ready for your next book") was only an observation.
 */
function AddTile({ first, onSelect, disabled = false }) {
  return (
    // A POSTER FRAME AND NOTHING AROUND IT: the dashed slot a cover would fill,
    // a plus in it, the words under it. It used to be that slot inside a
    // dashed card — a box in a box — which read as chrome rather than as the
    // empty place on the shelf where the next book goes.
    <button
      type="button"
      className="school-books-tile school-books-tile--add"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="school-books-tile__art">
        <span className="school-books-tile__cover school-books-tile__slot" aria-hidden="true">
          <Icon name="plus" className="school-books-tile__plus" />
        </span>
      </span>
      <span className="school-books-tile__text">
        <span className="school-books-tile__title">{first ? 'Add your first book' : 'Add a book'}</span>
        <span className="school-books-tile__caption">Tap to type the number</span>
      </span>
    </button>
  );
}

function Fault({ error, onRetry, needsRefresh = false, busy = false }) {
  if (!error?.message) return null;
  return (
    <div className="school-books__fault" role="alert">
      <p className="school-books__fault-text">{error.message}</p>
      <button type="button" className="school-books__retry" disabled={busy} onClick={onRetry}>{needsRefresh ? 'Retry shelf' : 'Try again'}</button>
    </div>
  );
}

function Shelf({ shelf, error, actions, receipt, busy, needsRefresh, today }) {
  const items = (shelf?.items ?? []).filter((item) => ON_SHELF.has(item?.projection?.status ?? 'reading'));
  // Finished AND set aside: one row for everything the child is done with, the
  // tile's own mark saying which is which.
  const done = recentOutcomes(shelf?.items);
  const awaitingShelf = busy || needsRefresh;
  const obligation = shelf?.obligation ?? null;
  const sentence = obligationSentence(obligation);
  const incompatible = new Set(obligation?.incompatibleBooks ?? []);
  return (
    <>
      <Fault error={error} onRetry={actions.retry} needsRefresh={needsRefresh} busy={busy} />
      {receipt && <SaveReceipt receipt={receipt} busy={busy} inline onUndo={actions.undoFinish} />}
      <div className="school-books__collections">
        {/* TODAY, with the obligation INSIDE its heading as pips — the same
            notation the living-room rail and the close use, so a child sees
            one object change state across the whole ceremony. It used to be
            a sentence in a chip floating above "Reading now": a count sitting
            apart from the thing it counts. `count`/`target` are the shelf's
            own `actual`/`target`; the sentence survives as the label the
            pips fall back to when the target is unreadable or too large. */}
        <div className="school-books__shelf-heading">
          <h3 className="school-books__shelf-title">Today</h3>
          {obligation && (
            <ReadingPips
              count={Number.isFinite(obligation.actual) ? obligation.actual : 0}
              target={Number.isFinite(obligation.target) ? obligation.target : null}
              label={sentence}
              className="school-books__pips"
              testId="shelf-obligation"
            />
          )}
        </div>
        <div className="school-books__row" data-testid="book-shelf-grid">
          {items.map((item) => <ShelfTile key={item.itemId} item={item} onSelect={awaitingShelf ? null : actions.openItem}
            incompatibleMetric={incompatible.has(item.bookId) ? obligation.metric : null} />)}
          {/* Last, so it stands beside what is already being read — and alone,
              which is the whole row, when nothing is. */}
          <AddTile first={(shelf?.items ?? []).length === 0} disabled={awaitingShelf} onSelect={actions.startAdd} />
        </div>
        {/* One shelf per day, stacked, scrolling down as far as the record
            goes. There is no "See all history" any more: this IS all of it. */}
        <BookHistory items={done} today={today} onSelect={awaitingShelf ? null : actions.openItem} />
      </div>
    </>
  );
}

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {string} props.grant - the `bookGrant` the mount effect carried.
 * @param {number} [props.idleTimeoutSeconds]
 * @param {(reason: 'done'|'idle') => void} [props.onExit]
 */
export default function BookShelf({ learnerId, grant, idleTimeoutSeconds, onExit, initialBookEntry, openAdd = false }) {
  const { view, step, shelf, studyDay, earliestFinishDay, learner, error, busy, needsRefresh = false, current, receipt, add, actions } = useBookShelf({ learnerId, grant, idleTimeoutSeconds, onExit, initialBookEntry, openAdd });

  if (view === 'closed') return null;
  // The server's study day, re-read on every shelf fetch; the DayPickers are
  // keyed on it, so a rollover reaching the next read remounts them with a
  // fresh default. The local date is only for a server that said nothing.
  const today = studyDay ?? localDayKey();

  let body;
  if (view === 'loading') {
    body = error
      ? <Fault error={error} onRetry={actions.retry} />
      : <p className="school-books__loading">Getting your shelf…</p>;
  } else if (view === 'completed' && current) {
    body = <CompletedBook item={current} actions={actions} />;
  } else if (view === 'update' && current) {
    body = <UpdateBook key={current.itemId} item={current} today={today} earliestDay={earliestFinishDay} error={error} busy={busy} actions={actions} />;
  } else if (view === 'add') {
    body = <AddBook key={add.entryId ?? 'isbn'} step={step} add={add} today={today} earliestDay={earliestFinishDay} error={error} busy={busy} actions={actions} />;
  } else {
    body = <Shelf shelf={shelf} error={error} actions={actions} receipt={receipt} busy={busy} needsRefresh={needsRefresh} today={today} />;
  }

  return (
    <section className="school-books" data-testid="book-shelf" onClickCapture={actions.noteActivity} onPointerDownCapture={actions.noteActivity} onInputCapture={actions.noteActivity}>
      {/* ONE HEADER, ONE EXIT. `Done` leaves the shelf; `Back` appears only
          inside a sub-view, as the step back to the shelf. The sub-views draw
          no back of their own — the header owns it, so every screen puts it
          in the same place. */}
      <ScreenHeader
        className="school-books__header"
        title="Reading"
        identity={<LearnerChip learner={learner} />}
        onBack={['completed', 'update', 'add'].includes(view) ? actions.back : null}
        backDisabled={busy}
        onDone={actions.done}
      />
      {body}
    </section>
  );
}
