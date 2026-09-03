/**
 * AddBook — the three-step add flow (book-shelf UI design §5), one screen
 * per `step`.
 *
 *   number  → the 13-slot pad with an X key; the hook's hint and verdict
 *             ride along (`add.hint`, `add.canSubmit`), and `unavailable`
 *             adds a `Try again`.
 *   lookup  → "Looking it up…" — never a dead screen while the resolve runs.
 *   cover   → the card: cover, title, author, description, Is this your
 *             book? — or, when the shelf already has it open, the duplicate
 *             card with `Open it`.
 *   where   → the three doors.
 *   page    → the page pad (partway).
 *   when    → the DayPicker (already finished).
 *
 * Presentational. The number is the hook's (`add.entry`) so a failed lookup
 * comes back to the digits already typed; every tappable calls one
 * `actions.*`. A write's error is shown in place: on a pad as its hint,
 * otherwise as a line under the control. `‹ back` is on every step; on
 * `lookup` the hook abandons the round trip and returns the pad with the
 * digits kept. No logging from here; the hook owns the story.
 */
import { useCallback, useState } from 'react';
import NumberPad from './NumberPad.jsx';
import DayPicker from './DayPicker.jsx';
import useTapFire from '../selfService/useTapFire.js';

const DOORS = [
  { where: 'starting', label: "I'm just starting it" },
  { where: 'partway', label: "I'm partway through" },
  { where: 'finished', label: 'I already finished it' },
];

function authorsOf(book) {
  const list = Array.isArray(book?.authors) ? book.authors.filter(Boolean) : [];
  return list.join(', ');
}

function Cover({ book, className }) {
  const [failed, setFailed] = useState(false);
  const title = book?.title || book?.isbn13 || 'Untitled';
  if (book?.coverUrl && !failed) {
    return <img className={className} src={book.coverUrl} alt={title} onError={() => setFailed(true)} />;
  }
  return (
    <div className={`school-selfservice-card__poster-placeholder ${className}`} aria-hidden="true">
      <span>✦</span>
    </div>
  );
}

/** The book named once above a step that comes after the cover. */
function BookLine({ book }) {
  if (!book) return null;
  const by = authorsOf(book);
  return (
    <div className="school-books-add__book">
      <Cover book={book} className="school-books-add__thumb" />
      <span className="school-books-add__line">
        {book.title}{by ? ` · ${by}` : ''}
      </span>
    </div>
  );
}

function Fault({ message }) {
  if (!message) return null;
  return <p className="school-books-add__fault" role="alert">{message}</p>;
}

/**
 * @param {object} props
 * @param {'number'|'lookup'|'cover'|'where'|'page'|'when'} props.step
 * @param {object} props.add - the hook's `add` slice.
 * @param {string} props.today - the household study day, `YYYY-MM-DD`.
 * @param {{message: string}|null} props.error
 * @param {boolean} props.busy - a write is in flight.
 * @param {object} props.actions - the hook's actions.
 */
export default function AddBook({ step, add, today, error = null, busy = false, actions }) {
  const tap = useTapFire();
  const press = useCallback((fn) => tap(() => { if (!busy) fn(); }), [tap, busy]);
  const book = add?.resolved?.book ?? null;
  const message = error?.message ?? null;

  let body;
  if (step === 'lookup') {
    body = <p className="school-books__loading" role="status">Looking it up…</p>;
  } else if (step === 'cover') {
    const duplicate = Boolean(add?.duplicateOf);
    body = (
      <div className="school-books-add__card">
        <Cover book={book} className="school-books-add__cover" />
        <div className="school-books-add__about">
          <h3 className="school-books-add__title">{book?.title}</h3>
          {authorsOf(book) && <p className="school-books-add__author">{authorsOf(book)}</p>}
          {book?.description && <p className="school-books-add__description">{book.description}</p>}
        </div>
        <p className="school-books-add__prompt">
          {duplicate ? "You've already got this one" : 'Is this your book?'}
        </p>
        <div className="school-books-add__answers">
          {duplicate ? (
            <button type="button" className="school-books-add__yes" {...press(() => actions.openDuplicate())}>Open it</button>
          ) : (
            <button type="button" className="school-books-add__yes" {...press(() => actions.confirmCover(true))}>Yes</button>
          )}
          <button type="button" className="school-books-add__no" {...press(() => actions.confirmCover(false))}>No</button>
        </div>
        <Fault message={message} />
      </div>
    );
  } else if (step === 'where') {
    body = (
      <div className="school-books-add__where">
        <BookLine book={book} />
        <div className="school-books-add__doors">
          {DOORS.map(({ where, label }) => (
            <button
              key={where}
              type="button"
              className="school-books-add__door"
              disabled={busy}
              {...press(() => actions.choose(where))}
            >
              {label}
            </button>
          ))}
        </div>
        <Fault message={message} />
      </div>
    );
  } else if (step === 'page') {
    body = (
      <div className="school-books-add__page">
        <BookLine book={book} />
        <NumberPad
          label="What page are you on?"
          maxLength={4}
          submitLabel="Save"
          canSubmit={!busy}
          hint={message}
          onSubmit={(entry) => actions.submitPage(Number(entry))}
        />
      </div>
    );
  } else if (step === 'when') {
    body = (
      <div className="school-books-add__when">
        <BookLine book={book} />
        <p className="school-books-add__prompt">When did you finish it?</p>
        <DayPicker key={today} today={today} onConfirm={(key) => { if (!busy) actions.submitDay(key); }} />
        <Fault message={message} />
      </div>
    );
  } else {
    // `number`, and the default for anything the hook has not named yet.
    body = (
      <div className="school-books-add__number">
        <NumberPad
          label="Type the number under the barcode"
          maxLength={13}
          allowX
          submitLabel="Look it up"
          canSubmit={Boolean(add?.canSubmit) && !busy}
          hint={add?.hint ?? message}
          value={typeof add?.entry === 'string' ? add.entry : ''}
          onChange={actions.typeIsbn}
          onSubmit={() => actions.lookup()}
        />
        {add?.canRetry && (
          <button type="button" className="school-books__retry school-books-add__retry" {...press(() => actions.retryLookup())}>
            Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="school-books-add" data-testid="add-book" data-step={step}>
      <button type="button" className="school-books__back" onClick={actions.back}>‹ back</button>
      {body}
    </div>
  );
}
