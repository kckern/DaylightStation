/** Learner reading workspace: bounded collections, focused editors, and inline save results. */
import { useBookShelf } from './useBookShelf.js';
import ShelfTile from './ShelfTile.jsx';
import History from './History.jsx';
import UpdateBook from './UpdateBook.jsx';
import AddBook from './AddBook.jsx';
import SaveReceipt from './SaveReceipt.jsx';
import CompletedBook from './CompletedBook.jsx';
import { recentFinishes } from './readingHistory.js';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';

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
      <ProfileAvatar id={avatarId} name={name} size={96} />
      <span>{name}</span>
    </div>
  );
}

function AddTile({ first, onSelect, disabled = false }) {
  return (
    <button type="button" className="school-books-tile school-books-tile--add" disabled={disabled} onClick={onSelect}>
      <span className="school-books-tile__plus" aria-hidden="true">+</span>
      <span className="school-books-tile__add-label">{first ? 'Add your first book' : 'Add a book'}</span>
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

function Shelf({ shelf, error, actions, receipt, busy, needsRefresh }) {
  const items = (shelf?.items ?? []).filter((item) => ON_SHELF.has(item?.projection?.status ?? 'reading'));
  const finished = recentFinishes(shelf?.items);
  const awaitingShelf = busy || needsRefresh;
  const obligation = shelf?.obligation ?? null;
  const sentence = obligationSentence(obligation);
  const incompatible = new Set(obligation?.incompatibleBooks ?? []);
  return (
    <>
      {sentence && <p className="school-books__obligation">{sentence}</p>}
      <Fault error={error} onRetry={actions.retry} needsRefresh={needsRefresh} busy={busy} />
      {receipt && <SaveReceipt receipt={receipt} busy={busy} inline onUndo={actions.undoFinish} />}
      <div className="school-books__collections">
        <div className="school-books__row-heading">
          <h3>Reading now</h3>
          <button type="button" className="school-books__retry" disabled={awaitingShelf} onClick={actions.startAdd}>+ Add a book</button>
        </div>
        <div className="school-books__grid school-books__row" data-testid="book-shelf-grid">
          {items.map((item) => <ShelfTile key={item.itemId} item={item} onSelect={awaitingShelf ? null : actions.openItem}
            incompatibleMetric={incompatible.has(item.bookId) ? obligation.metric : null} />)}
          {items.length === 0 && (shelf?.items ?? []).length === 0 && <AddTile first disabled={awaitingShelf} onSelect={actions.startAdd} />}
          {items.length === 0 && (shelf?.items ?? []).length > 0 && <p className="school-books__empty">Ready for your next book</p>}
        </div>
        {finished.length > 0 && <section className="school-books__recent" aria-label="Recently finished">
          <h3>Recently finished</h3>
          <div className="school-books__row" data-testid="recently-finished-row">
            {finished.slice(0, 12).map(item => <ShelfTile key={item.itemId} item={item} onSelect={awaitingShelf ? null : actions.openItem} />)}
          </div>
        </section>}
      </div>
      <footer className="school-books__footer">
        <button type="button" className="school-books__history-link" disabled={awaitingShelf} onClick={actions.openHistory}>See all history</button>
      </footer>
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
  } else if (view === 'history') {
    body = <History items={shelf?.items ?? []} onBack={actions.back} onSelect={needsRefresh ? null : actions.openItem} />;
  } else if (view === 'completed' && current) {
    body = <CompletedBook item={current} actions={actions} />;
  } else if (view === 'update' && current) {
    body = <UpdateBook key={current.itemId} item={current} today={today} earliestDay={earliestFinishDay} error={error} busy={busy} actions={actions} />;
  } else if (view === 'add') {
    body = <AddBook key={add.entryId ?? 'isbn'} step={step} add={add} today={today} earliestDay={earliestFinishDay} error={error} busy={busy} actions={actions} />;
  } else {
    body = <Shelf shelf={shelf} error={error} actions={actions} receipt={receipt} busy={busy} needsRefresh={needsRefresh} />;
  }

  return (
    <section className="school-books" data-testid="book-shelf" onClickCapture={actions.noteActivity} onPointerDownCapture={actions.noteActivity} onInputCapture={actions.noteActivity}>
      <header className="school-books__header">
        <div className="school-books__who">
          <h2 className="school-books__title">Reading</h2>
          <LearnerChip learner={learner} />
        </div>
        <button type="button" className="school-books__done" onClick={actions.done}>Done</button>
      </header>
      {body}
    </section>
  );
}
