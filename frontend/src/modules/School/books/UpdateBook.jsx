/**
 * UpdateBook — the overlay a child updates one book from (book-shelf UI
 * design §4).
 *
 * Cover and title at the top, then ONE control matched to the book's
 * `progressMode`: the page pad, the minutes pad, or a single `I read some
 * today` button. The pad starts EMPTY — a child types what they see, they do
 * not edit the last number. `I finished it` opens the DayPicker collapsed on
 * today, so the common case is still one more tap; `set it aside` is small
 * and low because it is a real outcome but not the thing a thumb lands on.
 *
 * The progress line doubles as the mode switch: tapping it opens a
 * three-button chooser, which is how a book that turned out to have no page
 * numbers moves to minutes or check-ins without rewriting anything.
 *
 * Presentational. Every decision — what a blank Save means, whether a write
 * is in flight, what the server said — arrives as props from `useBookShelf`
 * through BookShelf, the hook's only caller. A write's error is shown in
 * place: on the pad as its hint, otherwise as a line under the control. No
 * logging from here; the hook owns the story.
 */
import { useCallback, useState } from 'react';
import NumberPad from './NumberPad.jsx';
import DayPicker from './DayPicker.jsx';
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import { formatMinutes } from './ShelfTile.jsx';
import useTapFire from '../selfService/useTapFire.js';

const MODES = [
  { mode: 'page', label: 'Count pages' },
  { mode: 'minutes', label: 'Count minutes' },
  { mode: 'check', label: 'Just check in' },
];

/** The one line under the title: the mode's own number, from the projection. */
export function progressLine(item) {
  const p = item.projection ?? {};
  switch (item.progressMode) {
    case 'minutes':
      return p.minutes > 0 ? `${formatMinutes(p.minutes)} so far` : 'Just started';
    case 'check':
      return p.daysRead > 0 ? `read on ${p.daysRead} ${p.daysRead === 1 ? 'day' : 'days'}` : 'Just started';
    case 'page':
    default: {
      if (!Number.isFinite(p.page) || p.page === null) return 'Just started';
      const total = Number.isFinite(item.pageCount) ? ` / ${item.pageCount}` : '';
      return `${p.page}${total}`;
    }
  }
}

/**
 * @param {object} props
 * @param {object} props.item - the open shelf item (`current` from the hook).
 * @param {string} props.today - the household study day, `YYYY-MM-DD`.
 * @param {{message: string}|null} props.error
 * @param {boolean} props.busy - a write is in flight.
 * @param {object} props.actions - the hook's actions.
 */
export default function UpdateBook({ item, today, error = null, busy = false, actions }) {
  const [finishing, setFinishing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const tap = useTapFire();
  // A disabled button still sees pointerdown in some engines; the guard is
  // here rather than trusting `disabled` alone.
  const press = useCallback((fn) => tap(() => { if (!busy) fn(); }), [tap, busy]);

  const mode = item.progressMode ?? 'page';
  const presentation = presentBook(item);
  const title = presentation.title;
  const percent = Math.min(100, Math.max(0, Number(item.projection?.percent) || 0));
  const showBar = mode === 'page' && item.pageCount !== null && item.pageCount !== undefined;
  const message = error?.message ?? null;

  const submitPad = useCallback((entry) => {
    const n = Number(entry);
    actions.submitProgress(mode === 'minutes' ? { minutes: n } : { page: n });
  }, [actions, mode]);

  let control;
  if (choosing) {
    control = (
      <div className="school-books-update__chooser" data-testid="mode-chooser">
        <p className="school-books-update__prompt">How do you want to keep track?</p>
        {MODES.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            className={`school-books-update__mode${m === mode ? ' is-current' : ''}`}
            aria-current={m === mode ? 'true' : undefined}
            disabled={busy || m === mode}
            {...press(() => { if (m !== mode) actions.setMode(m); })}
          >
            {label}
          </button>
        ))}
        <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => setChoosing(false))}>never mind</button>
        {message && <p className="school-books-update__fault" role="alert">{message}</p>}
      </div>
    );
  } else if (finishing) {
    control = (
      <div className="school-books-update__finish">
        <p className="school-books-update__prompt">When did you finish it?</p>
        <DayPicker key={today} today={today} busy={busy} onConfirm={(key) => { if (!busy) actions.finish(key); }} />
        <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => setFinishing(false))}>never mind</button>
        {message && <p className="school-books-update__fault" role="alert">{message}</p>}
      </div>
    );
  } else if (mode === 'check') {
    control = (
      <div className="school-books-update__check">
        <button
          type="button"
          className="school-books-update__checkin"
          disabled={busy}
          {...press(() => actions.checkIn())}
        >
          I read some today
        </button>
        {message && <p className="school-books-update__fault" role="alert">{message}</p>}
      </div>
    );
  } else {
    control = (
      <NumberPad
        label={mode === 'minutes' ? 'How long did you read?' : 'What page are you on?'}
        maxLength={mode === 'minutes' ? 3 : 4}
        submitLabel="Save"
        canSubmit={!busy}
        disabled={busy}
        hint={message}
        onSubmit={submitPad}
      />
    );
  }

  return (
    <div className="school-books-update" data-testid="update-book">
      <button type="button" className="school-books__back" disabled={busy} onClick={() => { if (!busy) actions.back(); }}>‹ back</button>

      <div className="school-books-update__book">
        <BookCover book={item} className="school-books-update__cover" />
        <div className="school-books-update__meta">
          <h3 className="school-books-update__title" title={title}>{title}</h3>
          {presentation.author && (
            <p className="school-books-update__author" title={presentation.allAuthors}>{presentation.author}</p>
          )}
          <button
            type="button"
            className="school-books-update__progress"
            aria-expanded={choosing}
            disabled={busy}
            onClick={() => { if (!busy) { setChoosing((c) => !c); setFinishing(false); } }}
          >
            {showBar && (
              <span
                className="school-books-tile__bar school-books-update__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={`${percent}% read`}
              >
                <span className="school-books-tile__fill" style={{ width: `${percent}%` }} />
              </span>
            )}
            <span className="school-books-update__caption">{progressLine(item)}</span>
          </button>
        </div>
      </div>

      {control}

      {!choosing && !finishing && (
        <div className="school-books-update__outcomes">
          <button
            type="button"
            className="school-books-update__finished"
            disabled={busy}
            {...press(() => setFinishing(true))}
          >
            I finished it
          </button>
          <button
            type="button"
            className="school-books-update__aside"
            disabled={busy}
            {...press(() => actions.setAside())}
          >
            set it aside
          </button>
        </div>
      )}
    </div>
  );
}
