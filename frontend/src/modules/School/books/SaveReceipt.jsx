import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import { shortDay } from './ShelfTile.jsx';

export function receiptCopy(receipt) {
  switch (receipt?.kind) {
    case 'finished': {
      const day = shortDay(receipt.finishedOn);
      return { heading: 'Book finished!', detail: `Saved in History${day ? ` · ${day}` : ''}` };
    }
    case 'progress':
      if (receipt.page) {
        const total = receipt.book?.pageCount;
        const mismatch = Number.isFinite(total) && receipt.page > total;
        return {
          heading: 'Reading saved',
          detail: mismatch
            ? `Page ${receipt.page} saved. This edition was listed as ${total} pages, so its page count may be wrong.`
            : `Page ${receipt.page} is on your shelf.`,
        };
      }
      if (receipt.minutes) return { heading: 'Reading saved', detail: `${receipt.minutes} minutes added.` };
      return { heading: 'Reading saved', detail: 'Your shelf is up to date.' };
    case 'checkin':
      return { heading: 'Reading logged', detail: 'You checked in for today.' };
    case 'set-aside':
      return { heading: 'Moved off your shelf', detail: 'You can add it again whenever you want.' };
    case 'reopened':
      return { heading: 'Finish undone', detail: 'The book is back on your shelf.' };
    case 'added':
    default:
      return { heading: 'Added to your shelf', detail: 'It is ready when you are.' };
  }
}

export default function SaveReceipt({ receipt, onBack, onHistory, onUndo, busy = false, error = null }) {
  const presentation = presentBook(receipt?.book);
  const copy = receiptCopy(receipt);
  return (
    <div className="school-books-receipt" data-testid="book-save-receipt">
      <div className="school-books-receipt__message" role="status" aria-live="polite">
        <div className="school-books-receipt__mark" aria-hidden="true">✓</div>
        <BookCover book={receipt?.book} className="school-books-receipt__cover" />
        <div className="school-books-receipt__copy">
          <h3>{copy.heading}</h3>
          <p className="school-books-receipt__title" title={presentation.title}>{presentation.title}</p>
          {presentation.author && (
            <p className="school-books-receipt__author" title={presentation.allAuthors}>{presentation.author}</p>
          )}
          <p className="school-books-receipt__detail">{copy.detail}</p>
        </div>
      </div>
      <div className="school-books-receipt__actions">
        <button type="button" className="school-books-receipt__back" disabled={busy} onClick={() => { if (!busy) onBack?.(); }}>Back to my books</button>
        {receipt?.kind === 'finished' && (
          <>
            <button type="button" className="school-books-receipt__history" disabled={busy} onClick={() => { if (!busy) onHistory?.(); }}>See History</button>
            <button type="button" className="school-books-receipt__undo" disabled={busy} onClick={() => { if (!busy) onUndo?.(); }}>Undo finish</button>
          </>
        )}
      </div>
      {error?.message && <p className="school-books-receipt__fault" role="alert">{error.message}</p>}
    </div>
  );
}
