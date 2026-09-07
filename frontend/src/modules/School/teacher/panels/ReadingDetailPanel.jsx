/**
 * ReadingDetailPanel — the console a grown-up corrects one child's reading
 * from (teacher reading admin design §2's sketch, and every verb in §3).
 *
 * ## Four bands, and the order is the design
 *
 * Identity, what was read, state, danger — most used first, most consequential
 * last, so no destructive control sits where a browsing thumb lands. History
 * comes after all four, because it is read AFTER a correction rather than
 * during one.
 *
 * ## The three rules that shape every control here
 *
 * 1. **A reason that reaches the child** on the five verbs that make the
 *    child's record smaller: a deleted day, an un-finish, a re-date out of the
 *    counted window, a move to a sibling, a deleted reading. Those five cannot
 *    submit without one, and each says WHY it is asking — because the sentence
 *    typed into that box is the sentence the child reads. Everything else
 *    takes an optional reason that only ever reaches this history.
 * 1b. **The counted window is the server's answer**, served with the reading —
 *    including whether it could be determined at all, so "this child owes no
 *    reading" and "the obligation could not be read" are distinguishable on
 *    screen instead of both reading as silence.
 * 2. **`baseRevisionCount` on every write**, the count that came with the read.
 *    A stale save is REFUSED, and this panel then stops: it shows the server's
 *    reload sentence, disables every write, and retries nothing. Merging would
 *    silently apply one grown-up's edit on top of another's (design §7).
 * 3. **Move and delete arm first, and step up.** Both are two-tap, and both
 *    need a one-use grant scoped to this reading — asked for through
 *    `useTeacherWrite`'s replay loop, never a hand-rolled prompt, so a refusal
 *    always settles the write that opened it (`teacher.md` §1).
 *
 * ## The failure that matters (design §6)
 *
 * A reading that cannot be read is a NAMED ERROR carrying the server's own
 * sentence, with no edit controls under it. `PanelFrame` renders children only
 * in `ok`, which is what makes that true by construction rather than by
 * remembering to check a flag beside every band.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { teacherWorkspaceApi } from '../teacherWorkspaceApi.js';
import { schoolApi } from '../../schoolApi.js';
import { usePanelFetch } from '../usePanelFetch.js';
import { useTeacherWrite } from '../useTeacherWrite.js';
import { teacherLog } from '../teacherLog.js';
import { humanDateTime } from '../teacherDates.js';
import PanelFrame from './PanelFrame.jsx';
import BookCover from '../../books/BookCover.jsx';
import { presentBook } from '../../books/bookPresentation.js';
import { formatMinutes, shortDay } from '../../books/ShelfTile.jsx';
import {
  MODES, OPS, OPTIONAL_ASK, STATUSES, WINDOW_UNKNOWN_NOTE, countedWindowOf,
  countedWindowUnknown, leavesWindow, reasonAsk, revisionChanges,
  revisionPhrase, undoRefusal, undoShrinks, unfinishes,
} from './readingDetail.js';

const PANEL = 'reading-detail';

/** Only used when a 409 arrives with no sentence of its own. */
const STALE_FALLBACK = 'This reading changed since you loaded it — reload and try again.';

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');
const blank = (value) => trimmed(value).length === 0;
const wholeNumber = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** A body that is not a reading is not an empty reading. */
const isReading = (data) => Boolean(data?.reading) && typeof data.reading === 'object'
  && typeof data.reading.id === 'string';

/** Newest day first; two rows on one day fall back to when they were logged. */
const byDayDesc = (a, b) => String(b?.on ?? '').localeCompare(String(a?.on ?? ''))
  || String(b?.at ?? '').localeCompare(String(a?.at ?? ''));

/** What one row of evidence recorded, read off the row and not off the mode. */
function entryValue(entry) {
  if (Number.isFinite(entry?.page)) return `page ${entry.page}`;
  if (Number.isFinite(entry?.minutes)) return formatMinutes(entry.minutes);
  return 'check-in';
}

/** A reason box with the sentence that says who will read what is typed. */
function Reason({ label, ask, value, onChange, required, disabled }) {
  return (
    <div className="teacher-reading-detail__reason">
      <p className="teacher-reading-detail__ask" data-required={required ? 'yes' : 'no'}>{ask}</p>
      <textarea
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
      />
    </div>
  );
}

function Band({ title, children }) {
  return (
    <section className="teacher-reading-detail__band">
      <h3 className="teacher-reading-detail__band-title">{title}</h3>
      {children}
    </section>
  );
}

export default function ReadingDetailPanel({
  learnerId, learnerName = null, readingId, kids = [],
  onClose = null, onChanged = null,
}) {
  const child = learnerName ?? learnerId;
  // usePanelFetch reports the STATE; the sentence a refusal came with is kept
  // here so the error can name what happened rather than only that it did.
  const faultRef = useRef(null);

  const fetcher = useMemo(() => async () => {
    const response = await teacherWorkspaceApi.readingDetail(learnerId, readingId);
    if (!response.ok) {
      faultRef.current = typeof response.data?.error === 'string' ? response.data.error : null;
      return response;
    }
    if (!isReading(response.data)) {
      teacherLog.fetch('reading-detail-unreadable', { panel: PANEL, learnerId, readingId, status: response.status });
      faultRef.current = 'This reading couldn’t be read. Nothing here is safe to act on yet.';
      return { ok: false, status: response.status, data: null };
    }
    faultRef.current = null;
    return response;
  }, [learnerId, readingId]);

  const detail = usePanelFetch(fetcher, {
    deps: [learnerId, readingId],
    isEmpty: () => false,
    panel: PANEL,
  });

  const record = isReading(detail.data) ? detail.data.reading : null;
  // The counted window comes WITH the reading, computed by the same
  // `obligationWindow` the server judges a re-date against. Nothing here
  // recomputes it from an obligation and a study day — that was one rule with
  // two implementations, and the client half went silent rather than wrong.
  const served = isReading(detail.data) ? detail.data.countedWindow ?? null : null;
  const countedWindow = countedWindowOf(served);
  const windowUnknowable = countedWindowUnknown(served);
  const base = Number.isInteger(record?.baseRevisionCount) ? record.baseRevisionCount : 0;
  const presentation = presentBook(record ?? {});
  const book = presentation.title;
  const names = { book, child };

  // Evidence is written against the mode the record is STORED with, not the
  // radio the grown-up may have just moved and not saved: an entry added
  // under an unsaved "minutes" would carry minutes onto a page-mode reading.
  const savedMode = record?.progressMode ?? 'page';

  const { run, busy, errors } = useTeacherWrite({ panel: PANEL });
  const [stale, setStale] = useState(null);
  const locked = Boolean(stale);
  // A stale save has ONE sentence, in the banner. Repeating it beside the
  // control as well would read as two different refusals of the same save.
  const fault = (key) => (stale ? null : errors[key]);

  // Identity band
  const [isbn, setIsbn] = useState('');
  const [mode, setMode] = useState('page');
  const [pageCount, setPageCount] = useState('');
  const [identityReason, setIdentityReason] = useState('');
  const [lookup, setLookup] = useState(null); // { book } | { fault }
  // Evidence band — one form open at a time, so two "Day they read" fields
  // never sit on screen at once.
  const [form, setForm] = useState(null); // { kind: 'add'|'edit'|'delete', entryId, on, value, note, reason, key }
  // State band
  const [status, setStatus] = useState('reading');
  const [finishedOn, setFinishedOn] = useState('');
  const [stateReason, setStateReason] = useState('');
  // Danger band
  const [target, setTarget] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [armed, setArmed] = useState(null); // 'move' | 'delete' | null
  // History
  const [undoing, setUndoing] = useState(null); // { revisionId, reason }

  // The loaded record is the form's starting point, and every successful write
  // reloads it — so what is on screen is always what the server last said.
  useEffect(() => {
    if (!record) return;
    setIsbn(record.isbn ?? record.book?.isbn ?? '');
    setMode(record.progressMode ?? 'page');
    setPageCount(Number.isFinite(record.book?.pageCount) ? String(record.book.pageCount) : '');
    setStatus(record.status === 'unread' ? 'reading' : (record.status ?? 'reading'));
    setFinishedOn(record.finishedOn ?? '');
    setIdentityReason('');
    setStateReason('');
    setForm(null);
    setArmed(null);
    setUndoing(null);
    setLookup(null);
  }, [record]);

  useEffect(() => {
    teacherLog.read('reading-detail-opened', { learnerId, readingId });
  }, [learnerId, readingId]);
  useEffect(() => {
    if (detail.state === 'loading') return;
    teacherLog.read('reading-detail', {
      learnerId, readingId, state: detail.state,
      entries: record?.entries?.length ?? 0, revisions: record?.revisions?.length ?? 0,
    });
  }, [learnerId, readingId, detail.state, record]);

  /**
   * One write. It stamps the loaded revision count on the body, notices a
   * stale-save refusal and STOPS on it, and reloads on success so the next
   * edit is judged against a count the server just confirmed.
   */
  const write = useCallback((key, action, call, { after = 'reload', stepUp = null } = {}) => {
    teacherLog.write('attempted', { panel: PANEL, learnerId, readingId, action });
    return run(key, async (auth) => {
      const response = await call(auth);
      if (response.status === 409) {
        setStale(typeof response.data?.error === 'string' ? response.data.error : STALE_FALLBACK);
        teacherLog.writeRefused('stale-save', { panel: PANEL, learnerId, readingId, action });
      }
      return response;
    }, {
      stepUp,
      onSuccess: () => {
        onChanged?.();
        // A moved or deleted reading is no longer on this shelf; reloading it
        // would ask for a record that is gone and render a 404 over an edit
        // the grown-up just made successfully.
        if (after === 'close') onClose?.();
        else detail.retry();
      },
    });
  }, [run, learnerId, readingId, onChanged, onClose, detail]);

  const body = (extra, reason) => ({
    ...extra, baseRevisionCount: base, reason: blank(reason) ? null : trimmed(reason),
  });

  // ---- identity ------------------------------------------------------------
  const identityPatch = {};
  if (record) {
    if (trimmed(isbn) && trimmed(isbn) !== (record.isbn ?? record.book?.isbn ?? '')) identityPatch.isbn = trimmed(isbn);
    if (mode !== record.progressMode) identityPatch.progressMode = mode;
    const nextCount = blank(pageCount) ? null : wholeNumber(pageCount);
    const wasCount = Number.isFinite(record.book?.pageCount) ? record.book.pageCount : null;
    if (nextCount !== wasCount) identityPatch.pageCount = nextCount;
  }
  const identityChanged = Object.keys(identityPatch).length > 0;
  // Typed nonsense reads as "clear the page count" once it parses to null, and
  // a silently blanked length is a correction nobody asked for.
  const pageCountBroken = !blank(pageCount) && wholeNumber(pageCount) === null;

  const relookup = async () => {
    const id = trimmed(isbn);
    if (!id) return;
    setLookup(null);
    teacherLog.read('reading-isbn-relookup', { learnerId, readingId, isbn: id });
    const response = await schoolApi.books.resolve(id);
    if (response.ok && response.data?.status === 'ok' && response.data.book) {
      setLookup({ book: response.data.book });
      return;
    }
    setLookup({ fault: response.data?.status === 'not-found'
      ? 'No book answers to that number. Nothing was changed.'
      : 'That number couldn’t be looked up just now. Nothing was changed.' });
  };

  const saveIdentity = () => write('identity', 'reading.update', ({ actorId }) => (
    teacherWorkspaceApi.updateReading(learnerId, readingId, body({ ...identityPatch, by: actorId }, identityReason))
  ));

  // ---- evidence ------------------------------------------------------------
  const entries = [...(record?.entries ?? [])].filter(Boolean).sort(byDayDesc);
  const editing = form?.kind === 'edit'
    ? entries.find((entry) => entry.id === form.entryId) ?? null
    : null;
  const redates = Boolean(editing) && form.on !== editing.on
    && leavesWindow(countedWindow, editing.on, form.on);
  const deleting = form?.kind === 'delete'
    ? entries.find((entry) => entry.id === form.entryId) ?? null
    : null;

  const openAdd = () => setForm({
    kind: 'add', on: '', value: '', note: '', reason: '',
    key: `teacher-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  const addEntry = () => write('entry-add', OPS.ENTRY_ADD, ({ actorId }) => (
    teacherWorkspaceApi.addReadingEntry(learnerId, readingId, body({
      on: form.on,
      page: savedMode === 'page' ? wholeNumber(form.value) : null,
      minutes: savedMode === 'minutes' ? wholeNumber(form.value) : null,
      note: blank(form.note) ? null : trimmed(form.note),
      by: actorId,
    }, form.reason), form.key)
  ));

  /** What this edit would actually change. Empty means there is nothing to save. */
  const entryPatch = () => {
    if (!editing) return {};
    const patch = {};
    if (form.on && form.on !== editing.on) patch.on = form.on;
    if (savedMode === 'page') {
      const next = blank(form.value) ? null : wholeNumber(form.value);
      if (next !== (Number.isFinite(editing.page) ? editing.page : null)) patch.page = next;
    } else if (savedMode === 'minutes') {
      const next = blank(form.value) ? null : wholeNumber(form.value);
      if (next !== (Number.isFinite(editing.minutes) ? editing.minutes : null)) patch.minutes = next;
    }
    return patch;
  };

  const saveEntry = () => {
    const patch = entryPatch();
    return write('entry-edit', OPS.ENTRY_UPDATE, ({ actorId }) => (
      teacherWorkspaceApi.updateReadingEntry(learnerId, readingId, editing.id, body({ ...patch, by: actorId }, form.reason))
    ));
  };

  const removeEntry = () => write('entry-delete', OPS.ENTRY_DELETE, ({ actorId }) => (
    teacherWorkspaceApi.deleteReadingEntry(learnerId, readingId, deleting.id, body({ by: actorId }, form.reason))
  ));

  // ---- state ---------------------------------------------------------------
  const statePatch = record
    ? {
      ...(status !== (record.status === 'unread' ? 'reading' : record.status) ? { status } : {}),
      ...(status === 'finished' && finishedOn && finishedOn !== record.finishedOn ? { finishedOn } : {}),
      ...(status === 'finished' && !record.finishedOn && finishedOn ? { finishedOn } : {}),
    }
    : {};
  const stateChanged = Object.keys(statePatch).length > 0;
  const stateShrinks = record ? unfinishes(record, statePatch) : false;
  const needsFinishDay = status === 'finished' && blank(finishedOn);

  const saveState = () => write('state', 'reading.update', ({ actorId }) => (
    teacherWorkspaceApi.updateReading(learnerId, readingId, body({ ...statePatch, by: actorId }, stateReason))
  ));

  // ---- danger --------------------------------------------------------------
  const siblings = kids.filter((kid) => kid.id !== learnerId);
  const targetName = siblings.find((kid) => kid.id === target)?.name ?? null;

  const move = () => write('move', OPS.READING_MOVE, ({ actorId, stepUpToken }) => (
    teacherWorkspaceApi.moveReading(learnerId, readingId, body({ toLearnerId: target, by: actorId }, moveReason), stepUpToken)
  ), { after: 'close', stepUp: { action: 'books.reading.reassign', resource: readingId } });

  const destroy = () => write('delete', OPS.READING_DELETE, ({ actorId, stepUpToken }) => (
    teacherWorkspaceApi.deleteReading(learnerId, readingId, body({ by: actorId }, deleteReason), stepUpToken)
  ), { after: 'close', stepUp: { action: 'books.reading.delete', resource: readingId } });

  // ---- history -------------------------------------------------------------
  const revisions = [...(record?.revisions ?? [])].filter(Boolean).reverse();

  const undo = (revision) => write(`undo:${revision.id}`, 'reading.undo', ({ actorId, stepUpToken }) => (
    teacherWorkspaceApi.undoReadingRevision(
      learnerId, readingId,
      body({ revisionId: revision.id, by: actorId }, undoing?.reason),
      stepUpToken,
    )
  ), {
    // An undo inherits the gate of the verb it inverts: undoing a move needs
    // the same step-up the move needed.
    stepUp: revision.op === OPS.READING_MOVE
      ? { action: 'books.reading.reassign', resource: readingId }
      : null,
  });

  const undoAsk = (revision) => {
    switch (revision.op) {
      case OPS.ENTRY_ADD: return reasonAsk('entry.delete', names);
      case OPS.READING_MOVE: return reasonAsk('move', { ...names, to: null });
      case OPS.READING_UPDATE: return reasonAsk('unfinish', names);
      case OPS.ENTRY_UPDATE: return reasonAsk('entry.redate', names);
      default: return OPTIONAL_ASK;
    }
  };

  return (
    <div className="teacher-reading-detail">
      <div className="teacher-reading-detail__topline">
        <div className="teacher-reading-detail__identity">
          {record && <BookCover book={record} className="teacher-reading-detail__cover" />}
          <div>
            <p className="teacher-reading-detail__title">{record ? book : 'Reading'}</p>
            {record && presentation.author && (
              <p className="teacher-reading-detail__author" title={presentation.allAuthors}>{presentation.author}</p>
            )}
            {record && (
              <p className="teacher-reading-detail__meta">
                {`Opened ${shortDay(record.openedOn) ?? '—'} · ${record.entries?.length ?? 0} day${(record.entries?.length ?? 0) === 1 ? '' : 's'} logged`}
              </p>
            )}
          </div>
        </div>
        <button type="button" className="teacher-reading-detail__done" onClick={() => onClose?.()}>Done</button>
      </div>

      {stale && (
        <div className="teacher-reading-detail__stale" role="alert">
          <p>{stale}</p>
          <button
            type="button"
            onClick={() => { setStale(null); detail.retry(); }}
          >
            Reload this reading
          </button>
        </div>
      )}

      <PanelFrame
        title={record ? book : 'Reading'}
        state={detail.state}
        retry={detail.retry}
        errorCopy={detail.state === 'error' ? faultRef.current : null}
        unavailableCopy="Reading corrections are not available on this install."
      >
        <div className="teacher-reading-detail__bands">
          <Band title="Identity">
            <div className="teacher-reading-detail__field">
              <label htmlFor="reading-isbn">ISBN</label>
              <input
                id="reading-isbn"
                inputMode="numeric"
                value={isbn}
                disabled={locked}
                onChange={(event) => { setIsbn(event.target.value); setLookup(null); }}
              />
              <button type="button" disabled={locked || blank(isbn)} onClick={relookup}>Re-look-up</button>
            </div>
            {lookup?.book && (
              <p className="teacher-reading-detail__lookup" role="status">
                {`That number is ${presentBook(lookup.book).title}${presentBook(lookup.book).author ? ` · ${presentBook(lookup.book).author}` : ''}. Save to keep it.`}
              </p>
            )}
            {lookup?.fault && <p className="teacher-panel__error">{lookup.fault}</p>}

            <fieldset className="teacher-reading-detail__modes">
              <legend>Progress mode</legend>
              {MODES.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="reading-mode"
                    value={option.value}
                    checked={mode === option.value}
                    disabled={locked}
                    onChange={() => setMode(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <div className="teacher-reading-detail__field">
              <label htmlFor="reading-pagecount">Page count</label>
              <input
                id="reading-pagecount"
                inputMode="numeric"
                value={pageCount}
                disabled={locked}
                onChange={(event) => setPageCount(event.target.value)}
              />
            </div>

            <Reason
              label="Reason for correcting the book"
              ask={OPTIONAL_ASK}
              value={identityReason}
              onChange={setIdentityReason}
              required={false}
              disabled={locked}
            />
            <button
              type="button"
              disabled={locked || !identityChanged || pageCountBroken || busy === 'identity'}
              onClick={saveIdentity}
            >
              Save the book
            </button>
            {pageCountBroken && <p className="teacher-panel__empty">A page count is a whole number of pages, or nothing at all.</p>}
            {fault('identity') && <p className="teacher-panel__error">{fault('identity')}</p>}
          </Band>

          <Band title="What was read">
            {entries.length === 0 && <p className="teacher-panel__empty">No days logged against this book yet.</p>}
            {entries.length > 0 && (
              <ul className="teacher-reading-detail__entries">
                {entries.map((entry) => {
                  const day = shortDay(entry.on) ?? entry.on ?? 'Day unrecorded';
                  return (
                    <li key={entry.id} className="teacher-reading-detail__entry">
                      <span className="teacher-reading-detail__entry-day">{day}</span>
                      <span className="teacher-reading-detail__entry-value">{entryValue(entry)}</span>
                      {entry.source === 'teacher' && <span className="teacher-reading-detail__entry-source">added by a grown-up</span>}
                      <button
                        type="button"
                        aria-label={`Edit ${day}`}
                        disabled={locked}
                        onClick={() => setForm({ kind: 'edit', entryId: entry.id, on: entry.on ?? '', value: Number.isFinite(entry.page) ? String(entry.page) : (Number.isFinite(entry.minutes) ? String(entry.minutes) : ''), note: entry.note ?? '', reason: '' })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${day}`}
                        disabled={locked}
                        onClick={() => setForm({ kind: 'delete', entryId: entry.id, reason: '' })}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {editing && (
              <div className="teacher-reading-detail__entry-form">
                <div className="teacher-reading-detail__field">
                  <label htmlFor="entry-day">Day they read</label>
                  <input
                    id="entry-day"
                    type="date"
                    value={form.on}
                    disabled={locked}
                    onChange={(event) => setForm((value) => ({ ...value, on: event.target.value }))}
                  />
                </div>
                {savedMode !== 'check' && (
                  <div className="teacher-reading-detail__field">
                    <label htmlFor="entry-value">{savedMode === 'minutes' ? 'Minutes read' : 'Page reached'}</label>
                    <input
                      id="entry-value"
                      inputMode="numeric"
                      value={form.value}
                      disabled={locked}
                      onChange={(event) => setForm((value) => ({ ...value, value: event.target.value }))}
                    />
                  </div>
                )}
                {form.on !== editing.on && windowUnknowable && (
                  <p className="teacher-reading-detail__note">{WINDOW_UNKNOWN_NOTE}</p>
                )}
                <Reason
                  label="Reason for correcting this day"
                  ask={redates ? reasonAsk('entry.redate', names) : OPTIONAL_ASK}
                  value={form.reason}
                  onChange={(value) => setForm((current) => ({ ...current, reason: value }))}
                  required={redates}
                  disabled={locked}
                />
                <button
                  type="button"
                  disabled={locked || busy === 'entry-edit'
                    || Object.keys(entryPatch()).length === 0
                    || (redates && blank(form.reason))}
                  onClick={saveEntry}
                >
                  Save this day
                </button>
                <button type="button" onClick={() => setForm(null)}>Cancel</button>
                {fault('entry-edit') && <p className="teacher-panel__error">{fault('entry-edit')}</p>}
              </div>
            )}

            {deleting && (
              <div className="teacher-reading-detail__entry-form">
                <Reason
                  label="Reason for removing this day"
                  ask={reasonAsk('entry.delete', names)}
                  value={form.reason}
                  onChange={(value) => setForm((current) => ({ ...current, reason: value }))}
                  required
                  disabled={locked}
                />
                <button
                  type="button"
                  disabled={locked || blank(form.reason) || busy === 'entry-delete'}
                  onClick={removeEntry}
                >
                  Remove this day
                </button>
                <button type="button" onClick={() => setForm(null)}>Cancel</button>
                {fault('entry-delete') && <p className="teacher-panel__error">{fault('entry-delete')}</p>}
              </div>
            )}

            {form?.kind === 'add' ? (
              <div className="teacher-reading-detail__entry-form">
                <div className="teacher-reading-detail__field">
                  <label htmlFor="entry-day">Day they read</label>
                  <input
                    id="entry-day"
                    type="date"
                    value={form.on}
                    disabled={locked}
                    onChange={(event) => setForm((value) => ({ ...value, on: event.target.value }))}
                  />
                </div>
                {savedMode !== 'check' && (
                  <div className="teacher-reading-detail__field">
                    <label htmlFor="entry-value">{savedMode === 'minutes' ? 'Minutes read' : 'Page reached'}</label>
                    <input
                      id="entry-value"
                      inputMode="numeric"
                      value={form.value}
                      disabled={locked}
                      onChange={(event) => setForm((value) => ({ ...value, value: event.target.value }))}
                    />
                  </div>
                )}
                <Reason
                  label="Reason for adding this day"
                  ask={OPTIONAL_ASK}
                  value={form.reason}
                  onChange={(value) => setForm((current) => ({ ...current, reason: value }))}
                  required={false}
                  disabled={locked}
                />
                <button
                  type="button"
                  disabled={locked || blank(form.on) || busy === 'entry-add'
                    || (savedMode !== 'check' && !wholeNumber(form.value))}
                  onClick={addEntry}
                >
                  Add this day
                </button>
                <button type="button" onClick={() => setForm(null)}>Cancel</button>
                {fault('entry-add') && <p className="teacher-panel__error">{fault('entry-add')}</p>}
              </div>
            ) : (
              <button type="button" disabled={locked} onClick={openAdd}>Add a day they read</button>
            )}
          </Band>

          <Band title="State">
            <fieldset className="teacher-reading-detail__states">
              <legend>State</legend>
              {STATUSES.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="reading-status"
                    value={option.value}
                    checked={status === option.value}
                    disabled={locked}
                    onChange={() => setStatus(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
            {status === 'finished' && (
              <div className="teacher-reading-detail__field">
                <label htmlFor="reading-finished-on">Finish day</label>
                <input
                  id="reading-finished-on"
                  type="date"
                  value={finishedOn}
                  disabled={locked}
                  onChange={(event) => setFinishedOn(event.target.value)}
                />
              </div>
            )}
            <Reason
              label="Reason for the state change"
              ask={stateShrinks ? reasonAsk('unfinish', names) : OPTIONAL_ASK}
              value={stateReason}
              onChange={setStateReason}
              required={stateShrinks}
              disabled={locked}
            />
            <button
              type="button"
              disabled={locked || !stateChanged || needsFinishDay || busy === 'state'
                || (stateShrinks && blank(stateReason))}
              onClick={saveState}
            >
              Save the state
            </button>
            {needsFinishDay && <p className="teacher-panel__empty">A finished book needs the day it was finished.</p>}
            {fault('state') && <p className="teacher-panel__error">{fault('state')}</p>}
          </Band>

          <Band title="Danger">
            <div className="teacher-reading-detail__danger">
              <div className="teacher-reading-detail__field">
                <label htmlFor="reading-move-to">Move to</label>
                <select
                  id="reading-move-to"
                  value={target}
                  disabled={locked}
                  onChange={(event) => { setTarget(event.target.value); setArmed(null); }}
                >
                  <option value="">Another child…</option>
                  {siblings.map((kid) => <option key={kid.id} value={kid.id}>{kid.name}</option>)}
                </select>
              </div>
              <Reason
                label="Reason for moving this reading"
                ask={reasonAsk('move', { ...names, to: targetName })}
                value={moveReason}
                onChange={(value) => { setMoveReason(value); setArmed(null); }}
                required
                disabled={locked}
              />
              {armed === 'move' ? (
                <div className="teacher-reading-detail__confirm" role="alert">
                  <span>{`Move ${book} to ${targetName}? It leaves ${child}’s reading year and both children are told why.`}</span>
                  <button type="button" disabled={busy === 'move'} onClick={move}>Confirm the move</button>
                  <button type="button" onClick={() => setArmed(null)}>Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  className="teacher-danger-btn"
                  disabled={locked || !target || blank(moveReason)}
                  onClick={() => setArmed('move')}
                >
                  Move to another child
                </button>
              )}
              {fault('move') && <p className="teacher-panel__error">{fault('move')}</p>}
            </div>

            <div className="teacher-reading-detail__danger">
              <Reason
                label="Reason for deleting this reading"
                ask={reasonAsk('reading.delete', names)}
                value={deleteReason}
                onChange={(value) => { setDeleteReason(value); setArmed(null); }}
                required
                disabled={locked}
              />
              {armed === 'delete' ? (
                <div className="teacher-reading-detail__confirm" role="alert">
                  <span>{`Delete ${book} and the ${record?.entries?.length ?? 0} day${(record?.entries?.length ?? 0) === 1 ? '' : 's'} logged against it? Its history goes with it, so this cannot be undone.`}</span>
                  <button type="button" disabled={busy === 'delete'} onClick={destroy}>Confirm the deletion</button>
                  <button type="button" onClick={() => setArmed(null)}>Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  className="teacher-danger-btn"
                  disabled={locked || blank(deleteReason)}
                  onClick={() => setArmed('delete')}
                >
                  Delete this reading
                </button>
              )}
              {fault('delete') && <p className="teacher-panel__error">{fault('delete')}</p>}
            </div>
          </Band>

          <Band title="History">
            {revisions.length === 0 && <p className="teacher-panel__empty">Nothing has been corrected on this reading.</p>}
            <ol className="teacher-reading-detail__history">
              {revisions.map((revision) => {
                const refusal = undoRefusal(record, revision, { book });
                const phrase = revisionPhrase(revision);
                const shrinks = undoShrinks(record, revision, countedWindow);
                const open = undoing?.revisionId === revision.id;
                return (
                  <li key={revision.id} className="teacher-reading-detail__revision">
                    <p className="teacher-reading-detail__revision-line">
                      <span className="teacher-reading-detail__revision-when">{humanDateTime(revision.at) ?? 'Time unrecorded'}</span>
                      <span className="teacher-reading-detail__revision-who">{revision.by ?? 'someone unrecorded'}</span>
                      <span className="teacher-reading-detail__revision-verb">{phrase}</span>
                    </p>
                    {revisionChanges(revision).map((change) => (
                      <p key={change.field} className="teacher-reading-detail__revision-change">
                        {`${change.field} ${change.from} → ${change.to}`}
                      </p>
                    ))}
                    {revision.reason && <p className="teacher-reading-detail__revision-reason">{`“${revision.reason}”`}</p>}
                    <p className="teacher-reading-detail__revision-told">
                      {revision.toldChild ? `${child} was told` : 'Nothing was sent to the child'}
                    </p>
                    {refusal
                      ? <p className="teacher-reading-detail__revision-refusal">{refusal}</p>
                      : (open ? (
                        <div className="teacher-reading-detail__entry-form">
                          <Reason
                            label="Reason for this undo"
                            ask={shrinks ? undoAsk(revision) : OPTIONAL_ASK}
                            value={undoing.reason}
                            onChange={(value) => setUndoing((current) => ({ ...current, reason: value }))}
                            required={shrinks}
                            disabled={locked}
                          />
                          <button
                            type="button"
                            disabled={locked || busy === `undo:${revision.id}` || (shrinks && blank(undoing.reason))}
                            onClick={() => undo(revision)}
                          >
                            Confirm the undo
                          </button>
                          <button type="button" onClick={() => setUndoing(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Undo ${phrase}, ${humanDateTime(revision.at) ?? 'time unrecorded'}`}
                          disabled={locked}
                          onClick={() => setUndoing({ revisionId: revision.id, reason: '' })}
                        >
                          Undo
                        </button>
                      ))}
                    {fault(`undo:${revision.id}`) && <p className="teacher-panel__error">{fault(`undo:${revision.id}`)}</p>}
                  </li>
                );
              })}
            </ol>
          </Band>
        </div>
      </PanelFrame>
    </div>
  );
}
