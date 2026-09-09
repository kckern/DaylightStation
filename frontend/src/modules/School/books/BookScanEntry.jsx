/**
 * BookScanEntry — what the panel does when a book's barcode arrives.
 *
 * TWO SHAPES, ONE INTENT. A scan is a household-wide interrupt landing on a
 * screen that belongs to whoever is standing at it, so `safe` (computed in
 * `SchoolApp`) decides which one is drawn:
 *
 *   safe   → the full-screen "This book was just scanned" dialog. The panel is
 *            resting on the keypad with nothing running and nothing typed;
 *            taking it over costs no one anything.
 *   !safe  → a corner card. A child is mid-quiz, mid-code, or mid-save, and a
 *            scan must NOT move them. The intent lives on the server for five
 *            minutes either way, so the card is an offer, not a notice: `Open
 *            it` leaves whatever is running (asking first when leaving would
 *            lose work) and hands the panel back to the branch above, which
 *            then asks whose book it is. `Dismiss` retires the intent.
 *
 * The corner card used to be one dead sentence — "Book scanned — open when
 * ready" — with no way into the book and no way to be rid of it. `claim`
 * refuses while unsafe by design, so a child's only recourse was to finish
 * what they were doing and SCAN THE BOOK AGAIN. That is the friction this
 * component now exists to remove.
 */
import useArmedAction from '../../../lib/identity/useArmedAction.js';
import BookCover from './BookCover.jsx';
import LearnerChoice from './LearnerChoice.jsx';
import { presentBook } from './bookPresentation.js';
import { useBookScanEntry } from './useBookScanEntry.js';

/**
 * The corner offer. Never claims anything itself: it clears the way and lets
 * the dialog ask who is reading, so there is one answer to that question and
 * one place it is asked.
 */
function ScanOffer({ book, confirmExit, onOpen, onDismiss }) {
  // On a LOCKED panel there is no apple and no leave-confirm banner — that
  // whole header is `!lock.locked` — so the confirm has to live here. Same
  // hook the apple and the screen-off button use; same two-tap shape.
  const { armed, trigger } = useArmedAction(onOpen, { armMs: 4000 });
  return (
    <aside className="school-book-scan__notice" role="status" data-testid="book-scan-offer">
      <BookCover book={book} className="school-book-scan__notice-cover" />
      <div className="school-book-scan__notice-body">
        <p className="school-book-scan__notice-title">
          {book?.title ? `${book.title} was scanned` : 'A book was scanned'}
        </p>
        {armed && (
          <p className="school-book-scan__notice-warn">
            Leave the quiz? Your answers so far won&rsquo;t be saved.
          </p>
        )}
        <div className="school-book-scan__notice-actions">
          <button type="button" className="school-book-scan__open"
            onClick={() => (confirmExit ? trigger() : onOpen())}>
            {armed ? 'Yes, open it' : 'Open it'}
          </button>
          <button type="button" className="school-books__back" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </aside>
  );
}

export default function BookScanEntry({ screenId, safe, roster, onLaunch, onOpen = null, confirmExit = false }) {
  const { intent, claiming, error, claim, dismiss, enabled } = useBookScanEntry({ screenId, safe, onLaunch });
  if (!enabled) return null;
  if (!intent) return error ? <p className="school-book-scan__notice" role="status">{error}</p> : null;
  const book = presentBook(intent.book ?? { isbn13: intent.isbn13 });
  if (!safe) {
    // Without a way to clear the panel there is nothing to offer, so fall back
    // to saying the book arrived rather than drawing a button that cannot work.
    return onOpen
      ? <ScanOffer book={intent.book} confirmExit={confirmExit} onOpen={onOpen} onDismiss={dismiss} />
      : <p className="school-book-scan__notice" role="status">Book scanned — open when ready</p>;
  }
  return <section className="school-book-scan" role="dialog" aria-modal="true" aria-label="This book was just scanned">
    <div className="school-book-scan__preview">
      <h2>This book was just scanned</h2>
      <div className="school-book-scan__layout">
        <div className="school-book-scan__book">
          <BookCover book={intent.book} className="school-books-add__cover" />
          <h3 title={book.title}>{book.title}</h3>
          {book.author && <p title={book.allAuthors}>{book.author}</p>}
        </div>
        <div className="school-book-scan__actions">
          {intent.status === 'loading' && <p role="status">Looking up the book…</p>}
          {intent.status === 'not-found' && <p>No title or cover found. You can still confirm the book by ISBN.</p>}
          {(error || intent.error) && <p role="alert">{error || intent.error}</p>}
          {['ready', 'not-found'].includes(intent.status) && <>
            <p>Who&apos;s reading this?</p>
            <LearnerChoice roster={roster} busy={claiming} onChoose={claim} />
          </>}
          <button type="button" className="school-books__back" onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  </section>;
}
