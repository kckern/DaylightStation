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
import { useCallback } from 'react';
import NumberPad from './NumberPad.jsx';
import DayPicker from './DayPicker.jsx';
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import useTapFire from '../selfService/useTapFire.js';

const DOORS = [
  { where: 'starting', label: "I'm just starting it" },
  { where: 'partway', label: "I'm partway through" },
  { where: 'finished', label: 'I already finished it' },
];

/** The book named once above a step that comes after the cover. */
function BookLine({ book }) {
  if (!book) return null;
  const presentation = presentBook(book);
  return (
    <div className="school-books-add__book">
      <BookCover book={book} className="school-books-add__thumb" />
      <span className="school-books-add__line" title={presentation.title}>
        <strong>{presentation.title}</strong>
        {presentation.author && <span title={presentation.allAuthors}>{presentation.author}</span>}
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
  const presentation = presentBook(book);
  const message = error?.message ?? null;

  let body;
  if (step === 'lookup') {
    body = <p className="school-books__loading" role="status">Looking it up…</p>;
  } else if (step === 'cover') {
    const duplicate = Boolean(add?.duplicateOf);
    const metadataMissing = Boolean(add?.metadataMissing);
    body = (
      <div className="school-books-add__card">
        <BookCover book={book} className="school-books-add__cover" />
        <div className="school-books-add__about">
          <h3 className="school-books-add__title" title={presentation.title}>{presentation.title}</h3>
          {presentation.author && (
            <p className="school-books-add__author" title={presentation.allAuthors}>{presentation.author}</p>
          )}
          {presentation.description && <p className="school-books-add__description">{presentation.description}</p>}
          {metadataMissing && (
            <p className="school-books-add__description">
              We couldn&apos;t find a title or cover. Check that this number matches your book; you can still log it by ISBN.
            </p>
          )}
        </div>
        <p className="school-books-add__prompt">
          {duplicate
            ? "You've already got this one"
            : (metadataMissing ? 'Is this the ISBN on your book?' : 'Is this your book?')}
        </p>
        <div className="school-books-add__answers">
          {duplicate ? (
            <button type="button" className="school-books-add__yes" disabled={busy} {...press(() => actions.openDuplicate())}>Open it</button>
          ) : (
            <button type="button" className="school-books-add__yes" disabled={busy} {...press(() => actions.confirmCover(true))}>
              {metadataMissing ? 'Yes, log this book' : 'Yes'}
            </button>
          )}
          <button type="button" className="school-books-add__no" disabled={busy} {...press(() => actions.confirmCover(false))}>No, edit number</button>
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
          disabled={busy}
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
        <DayPicker key={today} today={today} busy={busy} onConfirm={(key) => { if (!busy) actions.submitDay(key); }} />
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
          disabled={busy}
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
      <button type="button" className="school-books__back" disabled={busy} onClick={() => { if (!busy) actions.back(); }}>‹ back</button>
      {body}
    </div>
  );
}
