import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import FinishContext from './FinishContext.jsx';
import Icon from '../home/icons/Icon.jsx';
// `canReadAgain` is false on a scan-only shelf (`books.manualEntry: false`)
// unless this book is the one just scanned: a re-read is a new reading, and
// the server wants the book in hand for it the same as for a first one.
export default function CompletedBook({ item, actions, canReadAgain = true }) {
  const book = presentBook(item);
  return <div className="school-books-update school-books-task-view" data-testid="completed-book" data-task="completed">
    <div className="school-books-task">
      <div className="school-books-update__book school-books-task__context">
        <BookCover book={item} className="school-books-update__cover" />
        <div className="school-books-update__meta">
          <h3 className="school-books-update__title">{book.title}</h3>
          {book.author && <p className="school-books-update__author">{book.author}</p>}
          <FinishContext item={item} />
        </div>
      </div>
      <div className="school-books-task__controls">
      {canReadAgain ? (
        <button type="button" className="school-books-add__door school-books-completed__again" onClick={actions.readAgain}>
          <Icon name="book-starting" className="school-books-add__door-icon" /><span>Read again</span>
        </button>
      ) : (
        <p className="school-books-add__prompt" data-testid="scan-to-read-again">Reading it again? Scan its barcode.</p>
      )}
      </div>
    </div>
  </div>;
}
