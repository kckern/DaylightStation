/**
 * BookShelf — the reading shelf SchoolApp mounts for `program: 'book-log'`
 * (book-shelf UI design §2–§3).
 *
 * A workspace, not a card: the child stays here, so it carries the two guards
 * every other panel action never needs — an always-visible `Done` and the
 * idle close (both in `useBookShelf`). The learner chip is the third guard: a
 * shelf left open on a shared wall panel is one child's books with another
 * child's hands on them, and the name at the top is how the second child
 * notices.
 *
 * Every tap inside the root re-arms the idle timer through `onClickCapture`,
 * the way Keypad does. The shelf owns its scroll: the locked body clips
 * (`.school-app--locked .school-app__body { overflow: hidden }`), so the tile
 * grid scrolls inside a container sized to leave the header and footer in
 * place.
 *
 * All state lives in the hook; this file paints by `view` and hands the
 * overlays (UpdateBook, AddBook) the hook's values as props — it is the
 * hook's only caller. `today` is the household STUDY DAY the server named
 * on the shelf read (`studyDay`, the launcher's 4am-boundary day) — not the
 * panel's local date, which between midnight and 4am is already tomorrow
 * and would land a "Today" finish on the wrong study day. The local date is
 * only the fallback for a server that did not say. Nothing is logged from
 * here — the hook owns the story.
 */
import { useBookShelf } from './useBookShelf.js';
import ShelfTile from './ShelfTile.jsx';
import History from './History.jsx';
import UpdateBook from './UpdateBook.jsx';
import AddBook from './AddBook.jsx';
import SaveReceipt from './SaveReceipt.jsx';
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

function AddTile({ first, onSelect }) {
  return (
    <button type="button" className="school-books-tile school-books-tile--add" onClick={onSelect}>
      <span className="school-books-tile__plus" aria-hidden="true">+</span>
      <span className="school-books-tile__add-label">{first ? 'Add your first book' : 'Add a book'}</span>
    </button>
  );
}

function Fault({ error, onRetry }) {
  if (!error?.message) return null;
  return (
    <div className="school-books__fault" role="alert">
      <p className="school-books__fault-text">{error.message}</p>
      <button type="button" className="school-books__retry" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Shelf({ shelf, error, actions }) {
  const items = (shelf?.items ?? []).filter((item) => ON_SHELF.has(item?.projection?.status ?? 'reading'));
  const obligation = shelf?.obligation ?? null;
  const sentence = obligationSentence(obligation);
  const incompatible = new Set(obligation?.incompatibleBooks ?? []);
  return (
    <>
      {sentence && <p className="school-books__obligation">{sentence}</p>}
      <Fault error={error} onRetry={actions.retry} />
      <div className="school-books__grid" data-testid="book-shelf-grid">
        {items.map((item) => (
          <ShelfTile
            key={item.itemId}
            item={item}
            onSelect={actions.openItem}
            incompatibleMetric={incompatible.has(item.bookId) ? obligation.metric : null}
          />
        ))}
        <AddTile first={items.length === 0} onSelect={actions.startAdd} />
      </div>
      <footer className="school-books__footer">
        <button type="button" className="school-books__history-link" onClick={actions.openHistory}>history ›</button>
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
export default function BookShelf({ learnerId, grant, idleTimeoutSeconds, onExit }) {
  const { view, step, shelf, studyDay, learner, error, busy, current, receipt, add, actions } = useBookShelf({ learnerId, grant, idleTimeoutSeconds, onExit });

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
    body = <History items={shelf?.items ?? []} onBack={actions.back} />;
  } else if (view === 'update' && current) {
    body = <UpdateBook item={current} today={today} error={error} busy={busy} actions={actions} />;
  } else if (view === 'add') {
    body = <AddBook step={step} add={add} today={today} error={error} busy={busy} actions={actions} />;
  } else if (view === 'receipt' && receipt) {
    body = (
      <SaveReceipt
        receipt={receipt}
        busy={busy}
        error={error}
        onBack={actions.back}
        onHistory={actions.openHistory}
        onUndo={actions.undoFinish}
      />
    );
  } else {
    body = <Shelf shelf={shelf} error={error} actions={actions} />;
  }

  return (
    <section className="school-books" data-testid="book-shelf" onClickCapture={actions.noteActivity}>
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
