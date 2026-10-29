/**
 * LogBookSheet — "this book, these kids, today" (quick-log design, 2026-10-20).
 *
 * One sheet, three steps on one screen: scan (or type) the number, see the
 * book, pick who read it and what happened. The console decides nothing the
 * server already decides: who logged it today, who is reading it now and the
 * default tracking mode come from `GET /teacher/books/:isbn/readers`, and each
 * save is one of the existing per-child verbs (`logBookPlan.js`).
 *
 * Each book is its own `BookStep`, remounted per book: its selections,
 * results, write errors and per-child retry state cannot follow the grown-up
 * to the next book. A batch still running when its book goes away stops
 * before its next child.
 *
 * The whole batch runs inside ONE `useTeacherWrite` run, so a teacher who has
 * not claimed or unlocked is asked once and the batch replays once. A 403
 * mid-batch hands back to that machinery; children already saved are skipped
 * on the replay. Any other failure is that child's alone: their face shows ✗
 * and a Retry that resends only them.
 *
 * Retrying, per child (`progressRef`):
 * - one idempotency key per child per choice (what happened, the page, and
 *   for a new reading the tracking mode). Changing the choice after a clear
 *   refusal mints a new key: the server refuses a key replayed with different
 *   details.
 * - after an UNKNOWN outcome (no answer, a timeout, a 5xx) the request may
 *   have landed, so that child is frozen on what was first chosen: same
 *   request, same key, whatever the grown-up picks next. The server dedupes.
 * - a NEW reading is resent as the same request on the same key.
 * - an edit to an OPEN reading is re-planned from a fresh readers view, aimed
 *   at the reading the first try was aimed at: it may turn out already
 *   finished (✓, nothing sent) or changed under us (said, nothing sent).
 * - a child already ✓ is never sent again.
 */
import { useEffect, useRef, useState } from 'react';
import { useBarcodeScanner } from "../../../../../../frontend/src/lib/camera/useBarcodeScanner.js";
import ProfileAvatar from "../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx";
import { teacherWorkspaceApi } from "../teacherWorkspaceApi.js";
import { useTeacherWrite } from "../useTeacherWrite.js";
import { useTeacherProfile } from "../TeacherProfileContext.jsx";
import { useBookFacts } from "../useBookFacts.js";
import { teacherLog } from "../teacherLog.js";
import { HAPPENED, failureMessage, mintLogKey, performPlan, planFor } from "./logBookPlan.js";
import BookCover from "../../books/BookCover.jsx";
import { presentBook } from "../../books/bookPresentation.js";
import { checkIsbn, hintFor } from "../../books/isbn.js";

const PANEL = 'log-book';
const WRITE_KEY = 'log-book';
const NOT_A_BOOK = 'That is not a book number. Scan the barcode with 978 or 979 under it.';
const FROZEN_NOTE = 'Retry sends what you chose first. Fix it on their shelf afterwards if needed.';
/** What a batch returns once its book has gone away: no re-ask, no replay. */
const STOPPED = Object.freeze({ ok: false, status: 0, data: { error: 'Stopped: the sheet moved on.' } });

/** How a child's last try ended, as a mark, a word for a screen reader, and whether Retry is offered. */
const RESULT = Object.freeze({
  saved: { glyph: '✓', word: 'saved', retry: false },
  failed: { glyph: '✗', word: 'didn’t save', retry: true },
  skipped: { glyph: '✗', word: 'not saved', retry: false },
  unsent: { glyph: '–', word: 'not sent', retry: true },
});

const scanLog = {
  info: (event, data) => teacherLog.read(`log-book.${event}`, data),
  warn: (event, data) => teacherLog.fetch(`log-book.${event}`, data),
};

const wholeNumber = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return n > 0 ? n : null;
};

/**
 * The part of the grown-up's choice that one child's request is made of. A
 * mode toggle changes nothing about an edit to an open reading (it keeps its
 * own tracking), so it only counts for a child whose save opens a reading.
 */
const choiceFor = (progress, { happened, page, mode }) => [
  happened,
  happened === HAPPENED.PARTWAY ? page : '',
  progress?.aimedAt ? '' : mode,
].join('|');

const entryOf = (plan) => (plan?.kind === 'open' && plan.entry ? JSON.stringify(plan.entry) : null);

/** The server's refusal code, in either error shape the API serves. */
const refusalCode = (outcome) => outcome?.data?.code ?? outcome?.data?.error?.code ?? null;

/** No answer, a timeout or a server error: the write may have landed. */
const isUnknown = (outcome) => !outcome.ok && !outcome.skipped
  && (outcome.status === 0 || outcome.status === 408 || outcome.status >= 500);

/** Step 1: the camera, with the typed number always one tap away. */
function ScanStep({ onNumber }) {
  const videoRef = useRef(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [hint, setHint] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const accept = (raw, via) => {
    const check = checkIsbn(String(raw ?? ''), { submit: true });
    if (check.state === 'valid') {
      teacherLog.read('log-book.number', { via, isbn: check.isbn13 });
      onNumber(check.isbn13);
      return;
    }
    teacherLog.read('log-book.not-a-book', { via });
    setHint(hintFor(check) ?? NOT_A_BOOK);
    if (via === 'camera') setAttempt((n) => n + 1); // keep scanning
  };

  const { cameraState } = useBarcodeScanner({
    active: !typing, videoRef, restartKey: attempt, logger: scanLog,
    onDecode: (raw) => accept(raw, 'camera'),
  });
  const denied = cameraState === 'denied';
  const manual = typing || denied;
  const live = checkIsbn(typed);
  const final = checkIsbn(typed, { submit: true });

  return (
    <section className="teacher-logbook__scan" aria-label="Scan the book">
      {!manual && <video ref={videoRef} className="teacher-logbook__video" muted playsInline aria-label="Camera" />}
      {denied && (
        <p className="teacher-logbook__note">The camera isn’t available. Type the number under the barcode.</p>
      )}
      {hint && <p className="teacher-logbook__note" role="alert">{hint}</p>}
      {manual ? (
        <>
          <div className="teacher-logbook__field">
            <label htmlFor="log-book-isbn">ISBN</label>
            <input
              id="log-book-isbn"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              onChange={(event) => { setTyped(event.target.value); setHint(null); }}
            />
            <button type="button" disabled={final.state !== 'valid'} onClick={() => accept(typed, 'typed')}>
              Use this number
            </button>
          </div>
          {hintFor(live) && <p className="teacher-logbook__note">{hintFor(live)}</p>}
          {!denied && (
            <button type="button" className="teacher-logbook__link" onClick={() => { setTyping(false); setHint(null); }}>
              Use the camera
            </button>
          )}
        </>
      ) : (
        <button type="button" className="teacher-logbook__link" onClick={() => { setTyping(true); setHint(null); }}>
          Type the number
        </button>
      )}
    </section>
  );
}

/** Step 2: the book. A lookup never blocks a log, so a miss is still a card. */
function BookCard({ isbn, facts }) {
  if (facts.bookStatus === 'loading' || facts.bookStatus === 'idle') {
    return (
      <div className="teacher-logbook__book teacher-logbook__book--bare" aria-busy="true">
        <div><strong>ISBN {isbn}</strong><span>Looking it up…</span></div>
      </div>
    );
  }
  if (!facts.book) {
    return (
      <div className="teacher-logbook__book teacher-logbook__book--bare">
        <div>
          <strong>ISBN {isbn}</strong>
          <span>{facts.bookStatus === 'not-found'
            ? 'We couldn’t find a book with that number. You can still log it.'
            : 'That number couldn’t be looked up just now. You can still log it.'}</span>
        </div>
      </div>
    );
  }
  const shown = presentBook(facts.book);
  const pages = Number.isInteger(facts.book.pageCount) && facts.book.pageCount > 0 ? `${facts.book.pageCount} pages` : null;
  return (
    <div className="teacher-logbook__book">
      <BookCover book={facts.book} />
      <div>
        <strong>{shown.title}</strong>
        {shown.author && <span>{shown.author}</span>}
        {pages && <span>{pages}</span>}
        <small>ISBN {isbn}</small>
      </div>
    </div>
  );
}

/** Steps 2 and 3 for one book. Remounted per book (see the module note). */
function BookStep({ isbn, onAnother, onSaving }) {
  const {
    currentTeacher, openPicker, openPinPrompt, invalidateAuthorization, authorization,
  } = useTeacherProfile();
  const { run, errors } = useTeacherWrite({ panel: PANEL });
  const [reloadKey, setReloadKey] = useState(0);
  // An unlock or a claim (the PIN prompt, the picker) reads the readers again.
  const facts = useBookFacts(isbn, {
    reloadKey: `${reloadKey}:${authorization?.active ? 1 : 0}:${currentTeacher?.id ?? ''}`,
  });
  const [selected, setSelected] = useState(() => new Set());
  const [happenedChoice, setHappened] = useState(HAPPENED.FINISHED);
  const [page, setPage] = useState('');
  const [modeChoice, setModeChoice] = useState(null);
  const [results, setResults] = useState({});
  const [saving, setSaving] = useState(false);
  // Per child: { key, choice, made, plan, aimedAt, entryDone, landedEntry,
  // frozen, rekey, done }.
  const progressRef = useRef({});
  const inFlightRef = useRef(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);
  useEffect(() => {
    onSaving?.(saving);
  }, [saving, onSaving]);
  useEffect(() => () => onSaving?.(false), [onSaving]);

  const view = facts.readers;
  const readers = view?.readers ?? [];
  const mode = modeChoice ?? view?.suggestedMode ?? 'check';
  const chosen = readers.filter((reader) => selected.has(reader.learnerId));
  // A child with a result stays listed even if deselected: a failure is
  // never hidden by a tap.
  const listed = readers.filter((reader) => selected.has(reader.learnerId) || results[reader.learnerId]);
  // Partway needs a page: a new reading in page mode, or a child already
  // reading this book by page.
  const partwayOffered = mode === 'page' || chosen.some((reader) => reader.openReading?.progressMode === 'page');
  const happened = happenedChoice === HAPPENED.PARTWAY && !partwayOffered ? HAPPENED.FINISHED : happenedChoice;
  const pageNumber = wholeNumber(page);
  const anyResult = Object.keys(results).length > 0;
  const allSaved = listed.length > 0 && listed.every((reader) => results[reader.learnerId]?.state === 'saved');

  const toggle = (learnerId) => setSelected((value) => {
    const next = new Set(value);
    if (next.has(learnerId)) next.delete(learnerId); else next.add(learnerId);
    return next;
  });

  // The server just said the console is locked, so whatever the console
  // believes about its unlock is stale: drop it and ask. The authorization
  // flip in the reload key reads the readers again once it is answered.
  const unlock = () => {
    if (!currentTeacher) { openPicker(); return; }
    invalidateAuthorization?.();
    openPinPrompt();
  };

  const choice = { happened, page: pageNumber, mode };

  const batch = (learnerIds, touched) => async ({ actorId }) => {
    if (disposedRef.current) return STOPPED;
    // Read the readers again at save time: the revision count an open
    // reading's edit must carry is only as fresh as the last read of it.
    const fresh = await teacherWorkspaceApi.bookReaders(isbn, currentTeacher?.id ?? null);
    if (disposedRef.current) return STOPPED;
    if (fresh.status === 403) return fresh;
    const current = fresh.ok && Array.isArray(fresh.data?.readers) ? fresh.data : view;
    for (const learnerId of learnerIds) {
      if (disposedRef.current) return STOPPED;
      let progress = progressRef.current[learnerId];
      if (progress?.done) continue;
      if (progress?.rekey || (!progress?.frozen && (!progress || progress.choice !== choiceFor(progress, choice)))) {
        // A first try, or a new choice after a clear refusal: a new key. The
        // reading an earlier try was aimed at is kept, so a finish that
        // landed unseen is never followed by a second, duplicate reading.
        progress = {
          key: mintLogKey(), choice: null, made: choice, plan: null, aimedAt: progress?.aimedAt ?? null,
          entryDone: false, landedEntry: progress?.landedEntry ?? null, frozen: false, rekey: false, done: false,
        };
        progress.choice = choiceFor(progress, choice);
        progressRef.current[learnerId] = progress;
      }
      const made = progress.frozen ? progress.made : choice;
      // A new reading keeps its first plan: its key is bound to that request,
      // and the server dedupes the replay. Anything else is planned again on
      // the fresh view.
      if (progress.plan?.kind !== 'new') {
        const reader = current?.readers?.find((row) => row.learnerId === learnerId) ?? null;
        progress.plan = planFor(
          reader,
          { isbn, happened: made.happened, page: made.page, mode: made.mode, studyDay: current?.studyDay },
          { previousReadingId: progress.aimedAt },
        );
        if (progress.plan.kind === 'open' && !progress.aimedAt) {
          progress.aimedAt = progress.plan.readingId;
          // The signature drops the mode once the child is known to be
          // reading it: keep the one the next try will compare against.
          if (!progress.frozen) progress.choice = choiceFor(progress, made);
        }
        // An entry that already landed is not sent again, as long as it is
        // the same entry.
        progress.entryDone = progress.landedEntry !== null && entryOf(progress.plan) === progress.landedEntry;
      }
      const { plan } = progress;
      teacherLog.write('attempted', {
        panel: PANEL, learnerId, action: 'reading.quick-log', plan: plan.kind, happened: made.happened,
      });
      const outcome = await performPlan(teacherWorkspaceApi, { learnerId, progress, actorId });
      if (progress.entryDone && progress.landedEntry === null) progress.landedEntry = entryOf(plan);
      if (disposedRef.current) return STOPPED;
      if (outcome.status === 403) return outcome; // re-ask once and replay; saved children are skipped
      if (outcome.ok) {
        progress.done = true;
      } else {
        const entryUnseen = plan.kind === 'open' && Boolean(plan.entry) && !progress.entryDone;
        progress.frozen = isUnknown(outcome) && (plan.kind === 'new' || entryUnseen);
        // The server says this key already carries a DIFFERENT entry (the
        // study day rolled over, say) and none of ours landed under it: the
        // same key can never go through again, so the next try mints one.
        progress.rekey = entryUnseen && progress.landedEntry === null && refusalCode(outcome) === 'IDEMPOTENCY_KEY_REUSED';
      }
      touched.add(learnerId);
      setResults((value) => ({
        ...value,
        [learnerId]: outcome.ok
          ? { state: 'saved' }
          : { state: outcome.skipped ? 'skipped' : 'failed', message: failureMessage(outcome), frozen: progress.frozen },
      }));
      teacherLog.write(outcome.ok ? 'saved' : 'refused', {
        panel: PANEL, learnerId, action: 'reading.quick-log', status: outcome.status,
        ...(outcome.alreadyDone ? { alreadyDone: true } : {}),
        ...(outcome.code ? { code: outcome.code } : {}),
        ...(progress.frozen ? { frozen: true } : {}),
      });
    }
    return { ok: true, status: 200, data: null };
  };

  const save = async (learnerIds) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaving(true);
    const touched = new Set();
    try {
      // A run blocked on the teacher picker stays this save until its replay
      // ends (or the picker closes with nobody chosen), so a second Save, a
      // Retry or "Log another book" cannot overlap it.
      const sent = await run(WRITE_KEY, batch(learnerIds, touched), {
        awaitClaim: true,
        onSuccess: () => { if (!disposedRef.current) setReloadKey((n) => n + 1); },
      });
      // A run that ended without finishing (a second 403, a refused PIN, a
      // picker closed with nobody chosen) says so on every child it never
      // reached.
      if (!sent && !disposedRef.current) {
        const unsent = learnerIds.filter((id) => !touched.has(id) && !progressRef.current[id]?.done);
        if (unsent.length) {
          setResults((value) => ({
            ...value,
            ...Object.fromEntries(unsent.map((id) => [id, { state: 'unsent', message: 'Not sent.' }])),
          }));
        }
      }
    } finally {
      inFlightRef.current = false;
      if (!disposedRef.current) setSaving(false);
    }
  };

  const canSave = facts.readersStatus === 'ok' && chosen.length > 0
    && (happened !== HAPPENED.PARTWAY || pageNumber !== null) && !saving;
  const faceLabel = (reader) => [
    reader.name,
    reader.today && 'logged today',
    reader.openReadingId && 'reading now',
    reader.unreadable && 'shelf unreadable',
    results[reader.learnerId] && RESULT[results[reader.learnerId].state]?.word,
  ].filter(Boolean).join(', ');

  return (
    <>
      <BookCard isbn={isbn} facts={facts} />
      {!anyResult && (
        <button type="button" className="teacher-logbook__link" disabled={saving} onClick={onAnother}>Scan a different book</button>
      )}

      {facts.readersStatus === 'loading' && <p className="teacher-logbook__note">Checking who has this book…</p>}
      {facts.readersStatus === 'locked' && (
        <div className="teacher-logbook__actions">
          <p className="teacher-logbook__note">Teacher tools are locked. Unlock them to log this book.</p>
          <button type="button" onClick={unlock}>Unlock</button>
        </div>
      )}
      {facts.readersStatus === 'error' && (
        <div className="teacher-logbook__actions">
          <p className="teacher-logbook__note">Couldn’t check who has this book.</p>
          <button type="button" onClick={() => setReloadKey((n) => n + 1)}>Try again</button>
        </div>
      )}

      {facts.readersStatus === 'ok' && (
        <>
          <div className="teacher-logbook__faces" role="group" aria-label="Who read it">
            {readers.map((reader) => {
              const result = results[reader.learnerId];
              const shown = result ? RESULT[result.state] : null;
              const pressed = selected.has(reader.learnerId);
              return (
                <div key={reader.learnerId} className="teacher-logbook__face-wrap">
                  <button
                    type="button"
                    className="teacher-logbook__face"
                    aria-pressed={pressed}
                    aria-label={faceLabel(reader)}
                    disabled={Boolean(reader.unreadable) || result?.state === 'saved'}
                    onClick={() => toggle(reader.learnerId)}
                  >
                    <span aria-hidden="true"><ProfileAvatar id={reader.learnerId} name={reader.name} /></span>
                    <span className="teacher-logbook__face-name">{reader.name}</span>
                    {reader.today && <b className="teacher-logbook__badge">Logged today</b>}
                    {reader.openReadingId && <b className="teacher-logbook__badge teacher-logbook__badge--open">Reading now</b>}
                    {reader.unreadable && <b className="teacher-logbook__badge teacher-logbook__badge--warn">Shelf unreadable</b>}
                    {shown && <i aria-hidden="true">{shown.glyph}</i>}
                  </button>
                  {pressed && reader.today && !result && (
                    <p className="teacher-logbook__note">Already logged today. Saving logs it again.</p>
                  )}
                  {result?.state === 'skipped' && <p className="teacher-logbook__note">{result.message}</p>}
                  {shown?.retry && (
                    <>
                      <p className="teacher-panel__error">{result.message}</p>
                      {result.frozen && <p className="teacher-logbook__note">{FROZEN_NOTE}</p>}
                      <button
                        type="button"
                        className="teacher-logbook__retry"
                        aria-label={`Retry ${reader.name}`}
                        disabled={saving}
                        onClick={() => save([reader.learnerId])}
                      >
                        Retry
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {!allSaved && (
            <>
              <div className="teacher-logbook__happened" role="group" aria-label="What happened">
                <button type="button" aria-pressed={happened === HAPPENED.FINISHED} onClick={() => setHappened(HAPPENED.FINISHED)}>Finished today</button>
                <button type="button" aria-pressed={happened === HAPPENED.STARTED} onClick={() => setHappened(HAPPENED.STARTED)}>Started today</button>
                {partwayOffered && (
                  <button type="button" aria-pressed={happened === HAPPENED.PARTWAY} onClick={() => setHappened(HAPPENED.PARTWAY)}>Partway</button>
                )}
              </div>
              {happened === HAPPENED.PARTWAY && (
                <div className="teacher-logbook__field">
                  <label htmlFor="log-book-page">Page they are on</label>
                  <input id="log-book-page" inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} />
                </div>
              )}
              <div className="teacher-logbook__mode" role="group" aria-label="Tracking">
                <span>Tracking:</span>
                <button type="button" aria-pressed={mode === 'check'} onClick={() => setModeChoice('check')}>Check-ins</button>
                <button type="button" aria-pressed={mode === 'page'} onClick={() => setModeChoice('page')}>Pages</button>
              </div>
              {chosen.some((reader) => reader.openReadingId) && (
                <p className="teacher-logbook__note">A book someone is reading now keeps its own tracking.</p>
              )}
              <div className="teacher-logbook__actions">
                <button type="button" className="teacher-primary" disabled={!canSave}
                  onClick={() => save(chosen.map((reader) => reader.learnerId))}>Save</button>
              </div>
            </>
          )}

          {errors[WRITE_KEY] && <p className="teacher-panel__error">{errors[WRITE_KEY]}</p>}
          {anyResult && (
            <>
              <p className="teacher-logbook__summary" role="status">
                {listed.map((reader, index) => {
                  const shown = RESULT[results[reader.learnerId]?.state];
                  return (
                    <span key={reader.learnerId}>
                      {index > 0 && ' · '}
                      {reader.name}{' '}
                      <span aria-hidden="true">{shown?.glyph ?? '…'}</span>
                      <span className="teacher-visually-hidden">{` ${shown?.word ?? 'saving'}`}</span>
                    </span>
                  );
                })}
              </p>
              <div className="teacher-logbook__actions">
                <button type="button" disabled={saving} onClick={onAnother}>Log another book</button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

const FOCUSABLE = 'button, select, input, [tabindex]:not([tabindex="-1"])';

export default function LogBookSheet({ open, onClose, returnFocusRef = null }) {
  const { pinPromptOpen, pickerOpen } = useTeacherProfile();
  const [isbn, setIsbn] = useState(null);
  const [generation, setGeneration] = useState(0);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const headingRef = useRef(null);
  const returnRef = useRef(null);
  const stepRef = useRef(null);
  const overlayRef = useRef({ pinPromptOpen: false, pickerOpen: false });

  const reset = () => {
    setIsbn(null);
    setGeneration((n) => n + 1);
  };
  useEffect(() => { if (!open) reset(); }, [open]);

  // A real dialog (PinPrompt's and EnrollmentDrawer's pattern): focus lands
  // inside on open, Tab wraps, Escape closes, and focus goes back on close.
  useEffect(() => {
    if (!open) return undefined;
    returnRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      // The control that opened the sheet, when the caller names it: a tap
      // does not focus a button on every browser, so activeElement may be the
      // page itself.
      const back = returnFocusRef?.current ?? returnRef.current;
      returnRef.current = null;
      if (back?.isConnected && typeof back.focus === 'function') back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's ref is stable
  }, [open]);

  // A step change unmounts whatever held focus (the ISBN field, a face):
  // put it on the heading rather than leaving it on the page.
  const step = open ? `${generation}:${isbn ?? ''}` : null;
  useEffect(() => {
    const previous = stepRef.current;
    stepRef.current = step;
    if (step && previous && previous !== step) headingRef.current?.focus();
  }, [step]);

  // The PIN prompt and the teacher picker sit above the sheet and take focus;
  // when one closes, focus comes back into the sheet if it landed outside.
  useEffect(() => {
    const before = overlayRef.current;
    overlayRef.current = { pinPromptOpen: Boolean(pinPromptOpen), pickerOpen: Boolean(pickerOpen) };
    const closed = (before.pinPromptOpen && !pinPromptOpen) || (before.pickerOpen && !pickerOpen);
    if (open && closed && !sheetRef.current?.contains(document.activeElement)) headingRef.current?.focus();
  }, [open, pinPromptOpen, pickerOpen]);

  if (!open) return null;

  const close = () => {
    if (saving) return; // a running batch finishes, or stops, before the sheet goes
    reset();
    onClose?.();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...(sheetRef.current?.querySelectorAll(FOCUSABLE) ?? [])].filter((el) => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="teacher-logbook" role="dialog" aria-modal="true" aria-label="Log a book" ref={sheetRef} onKeyDown={onKeyDown}>
      <div className="teacher-logbook__card">
        <header className="teacher-logbook__head">
          <h2 ref={headingRef} tabIndex={-1}>Log a book</h2>
          <button type="button" className="teacher-logbook__close" ref={closeRef} disabled={saving} onClick={close}>Close</button>
        </header>
        {isbn
          ? <BookStep key={generation} isbn={isbn} onAnother={reset} onSaving={setSaving} />
          : <ScanStep key={generation} onNumber={setIsbn} />}
      </div>
    </div>
  );
}
