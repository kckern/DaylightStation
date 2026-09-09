import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import { useBookScanEntry } from './useBookScanEntry.js';

export default function BookScanEntry({ screenId, safe, roster, onLaunch }) {
  const { intent, claiming, error, claim, dismiss, enabled } = useBookScanEntry({ screenId, safe, onLaunch });
  if (!enabled) return null;
  if (!intent) return error ? <p className="school-book-scan__notice" role="status">{error}</p> : null;
  const book = presentBook(intent.book ?? { isbn13: intent.isbn13 });
  if (!safe) return <p className="school-book-scan__notice" role="status">Book scanned — open when ready</p>;
  /* A barcode scanner emits keystrokes; nothing here may be composed. */
  return <section className="school-book-scan" data-ime="off" role="dialog" aria-modal="true" aria-label="This book was just scanned">
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
            <div className="school-book-scan__learners">{roster.map(learner => <button type="button" key={learner.id} disabled={claiming} onClick={() => claim(learner.id)} aria-label={learner.name || learner.id}>
              <ProfileAvatar id={learner.id} name={learner.name || learner.id} size={144} /><span>{learner.name || learner.id}</span>
            </button>)}</div>
          </>}
          <button type="button" className="school-books__back" onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  </section>;
}
