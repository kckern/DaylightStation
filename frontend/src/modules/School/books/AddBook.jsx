/** ISBN entry, then one cover/action view; progress and alternate dates open focused tasks. */
import { useCallback, useState } from 'react';
import NumberPad from './NumberPad.jsx';
import DayPicker from './DayPicker.jsx';
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import useTapFire from '../selfService/useTapFire.js';
import Icon from '../home/icons/Icon.jsx';
import FinishContext from './FinishContext.jsx';

// The three doors. A pre-reader typed the number in and then stalled here,
// because three wide bars of text look the same to a child who cannot read
// them; each door carries a mark of its own now — a play, a fast-forward, a
// circled check — and the words stay underneath for the child who can.
const DOORS = [
  { where: 'starting', icon: 'book-starting', label: 'Start reading' },
  { where: 'partway', icon: 'book-partway', label: 'Update page' },
  { where: 'finished', icon: 'book-finished', label: 'Finished today' },
];

/** The book named once above a step that comes after the cover. */
function BookLine({ book }) {
  if (!book) return null;
  const presentation = presentBook(book);
  return (
    <div className="school-books-add__book school-books-task__context">
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
export default function AddBook({ step, add, today, earliestDay = null, error = null, busy = false, actions }) {
  const tap = useTapFire();
  const [rereading, setRereading] = useState(false);
  const press = useCallback((fn) => tap(() => { if (!busy) fn(); }), [tap, busy]);
  const book = add?.resolved?.book ?? null;
  const presentation = presentBook(book);
  const message = error?.message ?? null;

  let body;
  if (step === 'lookup') {
    body = <p className="school-books__loading" role="status">Looking it up…</p>;
  } else if (step === 'cover' || step === 'where') {
    const duplicate = Boolean(add?.duplicateOf);
    const prior = add?.priorRead;
    body = (
      <div className="school-books-add__card school-books-task">
        <div className="school-books-task__context">
        <BookCover book={book} className="school-books-add__cover" />
        <div className="school-books-add__about">
          <h3 className="school-books-add__title" title={presentation.title}>{presentation.title}</h3>
          {presentation.author && <p className="school-books-add__author" title={presentation.allAuthors}>{presentation.author}</p>}
          {presentation.description && <p className="school-books-add__description">{presentation.description}</p>}
          {add?.metadataMissing && <p className="school-books-add__description">We couldn&apos;t find a title or cover. Check that this number matches your book; you can still log it by ISBN.</p>}
          {prior && <FinishContext item={prior} />}
        </div>
        </div>
        <div className="school-books-add__choices school-books-task__controls">
          {duplicate ? <>
            <p className="school-books-add__prompt">You&apos;ve already got this one</p>
            <button type="button" className="school-books-add__yes" disabled={busy} {...press(() => actions.openDuplicate())}>Open it</button>
          </> : prior && !rereading && !add.rereading ? (
            <button type="button" className="school-books-add__yes" disabled={busy} {...press(() => setRereading(true))}>Read again</button>
          ) : <>
            <div className="school-books-add__doors">
              {DOORS.map(({ where, icon, label }) => (
                <button key={where} type="button" className="school-books-add__door" data-where={where} disabled={busy}
                  {...press(() => where === 'finished' ? actions.choose(where, today) : actions.choose(where))}>
                  <Icon name={icon} className="school-books-add__door-icon" />
                  <span className="school-books-add__door-label">{label}</span>
                </button>
              ))}
            </div>
            <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => actions.choose('finished'))}>Finished on another day</button>
          </>}
          <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => actions.confirmCover(false))}>Wrong book? Edit number</button>
          <Fault message={message} />
        </div>
      </div>
    );
  } else if (step === 'page') {
    body = (
      <div className="school-books-add__page school-books-task">
        <BookLine book={book} />
        <div className="school-books-task__controls">
        <NumberPad
          label="What page are you on?"
          maxLength={4}
          submitLabel="Save page"
          canSubmit={!busy}
          disabled={busy}
          hint={message}
          onChange={actions.noteActivity}
          onSubmit={(entry) => actions.submitPage(Number(entry))}
        />
        </div>
      </div>
    );
  } else if (step === 'when') {
    body = (
      <div className="school-books-add__when school-books-task">
        <BookLine book={book} />
        <div className="school-books-task__controls">
        <p className="school-books-add__prompt">When did you finish it?</p>
        <DayPicker key={today} compact initiallyOpen today={today} minDay={earliestDay} busy={busy} onConfirm={(key) => { if (!busy) actions.submitDay(key); }} />
        <Fault message={message} />
        </div>
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
    <div className={`school-books-add${['cover', 'where', 'page', 'when'].includes(step) ? ' school-books-task-view' : ''}`} data-testid="add-book" data-step={step}>
      <button type="button" className="school-books__back" disabled={busy} onClick={() => { if (!busy) actions.back(); }}>‹ back</button>
      {body}
    </div>
  );
}
