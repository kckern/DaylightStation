/** Compact book details with direct finish/check-in actions and opt-in progress/date tasks. */
import { useCallback, useState } from 'react';
import NumberPad from './NumberPad.jsx';
import DayPicker from './DayPicker.jsx';
import BookCover from './BookCover.jsx';
import { presentBook } from './bookPresentation.js';
import { formatMinutes } from './ShelfTile.jsx';
import useTapFire from '../selfService/useTapFire.js';
import Icon from '../home/icons/Icon.jsx';

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
export default function UpdateBook({ item, today, earliestDay = null, error = null, busy = false, actions }) {
  const [progressing, setProgressing] = useState(false);
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
        <DayPicker key={today} compact initiallyOpen today={today} minDay={earliestDay} busy={busy} onConfirm={(key) => { if (!busy) actions.finish(key); }} />
        <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => setFinishing(false))}>never mind</button>
        {message && <p className="school-books-update__fault" role="alert">{message}</p>}
      </div>
    );
  } else if (progressing) {
    control = <>
      <NumberPad
        label={mode === 'minutes' ? 'How long did you read?' : 'What page are you on?'}
        maxLength={mode === 'minutes' ? 3 : 4}
        submitLabel={mode === 'minutes' ? 'Save minutes' : 'Save page'}
        canSubmit={!busy} disabled={busy} hint={message}
        onChange={actions.noteActivity} onSubmit={submitPad}
      />
      <button type="button" className="school-books-update__quiet" disabled={busy} {...press(() => setProgressing(false))}>never mind</button>
    </>;
  } else {
    control = <>
      <div className="school-books-update__actions">
        <button type="button" className="school-books-add__door" disabled={busy}
          {...press(() => mode === 'check' ? actions.checkIn() : setProgressing(true))}>
          <Icon name="book-partway" className="school-books-add__door-icon" />
          <span>{mode === 'check' ? 'I read some today' : mode === 'minutes' ? 'Log minutes' : 'Update page'}</span>
        </button>
        <button type="button" className="school-books-add__door" disabled={busy} {...press(() => actions.finish(today))}>
          <Icon name="book-finished" className="school-books-add__door-icon" /><span>Finished today</span>
        </button>
      </div>
      {message && <p className="school-books-update__fault" role="alert">{message}</p>}
    </>;
  }

  return (
    <div className="school-books-update school-books-task-view" data-testid="update-book" data-task={choosing ? 'mode' : finishing ? 'date' : progressing ? 'progress' : 'book'}>
      <div className="school-books-task">
        <div className="school-books-update__book school-books-task__context">
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
              onClick={() => { if (!busy) { setChoosing((c) => !c); setFinishing(false); setProgressing(false); } }}
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

        <div className="school-books-task__controls">
        {control}

        {!choosing && !finishing && !progressing && (
          <div className="school-books-update__outcomes">
            <button
              type="button"
              className="school-books-update__quiet"
              disabled={busy}
              {...press(() => setFinishing(true))}
            >
              Finished on another day
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
      </div>
    </div>
  );
}
