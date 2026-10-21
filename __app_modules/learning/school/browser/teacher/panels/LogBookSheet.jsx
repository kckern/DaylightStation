/**
 * LogBookSheet — "this book, these kids, today" (quick-log design, 2026-10-20).
 *
 * One sheet, three steps on one screen: scan (or type) the number, see the
 * book, pick who read it and what happened. The console decides nothing the
 * server already decides: who logged it today, who is reading it now and the
 * default tracking mode come from `GET /teacher/books/:isbn/readers`, and each
 * save is one of the existing per-child verbs (`logBookPlan.js`).
 *
 * The whole batch runs inside ONE `useTeacherWrite` run, so a teacher who has
 * not claimed or unlocked is asked once and the batch replays once. A 403
 * mid-batch hands back to that machinery; children already saved are skipped
 * on the replay. Any other failure is that child's alone: their face shows ✗
 * and a Retry that resends only them.
 *
 * Retrying, per child (`progressRef`):
 * - one idempotency key per child per choice (what happened, the page, and
 *   for a new reading the tracking mode). Changing the choice after a failed
 *   try mints a new key: the server refuses a key replayed with different
 *   details.
 * - a NEW reading is resent as the same request on the same key; the server
 *   dedupes it.
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
            ? 'No book answers to that number. You can still log it.'
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

export default function LogBookSheet({ open, onClose }) {
  const { currentTeacher, openPicker, openPinPrompt, authorization } = useTeacherProfile();
  const { run, busy, errors } = useTeacherWrite({ panel: PANEL });
  const [isbn, setIsbn] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // An unlock or a claim made elsewhere (the PIN prompt, the picker) also
  // reads the readers again: a locked view is only as old as the lock.
  const facts = useBookFacts(open ? isbn : null, {
    reloadKey: `${reloadKey}:${authorization?.active ? 1 : 0}:${currentTeacher?.id ?? ''}`,
  });
  const [selected, setSelected] = useState(() => new Set());
  const [happenedChoice, setHappened] = useState(HAPPENED.FINISHED);
  const [page, setPage] = useState('');
  const [modeChoice, setModeChoice] = useState(null);
  const [results, setResults] = useState({});
  // Per child, for this book: { key, choice, plan, aimedAt, entryDone,
  // landedEntry, done }. Reset when the book changes or the sheet closes.
  const progressRef = useRef({});

  const reset = () => {
    setIsbn(null);
    setSelected(new Set());
    setHappened(HAPPENED.FINISHED);
    setPage('');
    setModeChoice(null);
    setResults({});
    progressRef.current = {};
  };
  useEffect(() => { if (!open) reset(); }, [open]);

  if (!open) return null;

  const view = facts.readers;
  const readers = view?.readers ?? [];
  const mode = modeChoice ?? view?.suggestedMode ?? 'check';
  const chosen = readers.filter((reader) => selected.has(reader.learnerId));
  // Partway needs a page: a new reading in page mode, or a child already
  // reading this book by page.
  const partwayOffered = mode === 'page' || chosen.some((reader) => reader.openReading?.progressMode === 'page');
  const happened = happenedChoice === HAPPENED.PARTWAY && !partwayOffered ? HAPPENED.FINISHED : happenedChoice;
  const pageNumber = wholeNumber(page);
  const anyResult = Object.keys(results).length > 0;
  const allSaved = chosen.length > 0 && chosen.every((reader) => results[reader.learnerId]?.state === 'saved');

  const close = () => { reset(); onClose?.(); };
  const takeNumber = (value) => { reset(); setIsbn(value); };

  const toggle = (learnerId) => setSelected((value) => {
    const next = new Set(value);
    if (next.has(learnerId)) next.delete(learnerId); else next.add(learnerId);
    return next;
  });

  const unlock = async () => {
    if (!currentTeacher) { openPicker(); return; }
    const answer = await openPinPrompt();
    if (answer?.ok) setReloadKey((n) => n + 1);
  };

  const choice = { happened, page: pageNumber, mode };
  const save = (learnerIds) => run(WRITE_KEY, async ({ actorId }) => {
    // Read the readers again at save time: the revision count an open
    // reading's edit must carry is only as fresh as the last read of it.
    const fresh = await teacherWorkspaceApi.bookReaders(isbn);
    if (fresh.status === 403) return fresh;
    const current = fresh.ok && Array.isArray(fresh.data?.readers) ? fresh.data : view;
    for (const learnerId of learnerIds) {
      let progress = progressRef.current[learnerId];
      if (progress?.done) continue;
      const signature = choiceFor(progress, choice);
      if (!progress || progress.choice !== signature) {
        // A first try, or a new choice after a failed one: a new key. The
        // reading an earlier try was aimed at is kept, so a finish that
        // landed unseen is never followed by a second, duplicate reading.
        progress = {
          key: mintLogKey(), choice: null, plan: null, aimedAt: progress?.aimedAt ?? null,
          entryDone: false, landedEntry: progress?.landedEntry ?? null, done: false,
        };
        progress.choice = choiceFor(progress, choice);
        progressRef.current[learnerId] = progress;
      }
      // A new reading keeps its first plan: its key is bound to that request,
      // and the server dedupes the replay. Anything else is planned again on
      // the fresh view.
      if (progress.plan?.kind !== 'new') {
        const reader = current?.readers?.find((row) => row.learnerId === learnerId) ?? null;
        progress.plan = planFor(
          reader,
          { isbn, happened, page: pageNumber, mode, studyDay: current?.studyDay },
          { previousReadingId: progress.aimedAt },
        );
        if (progress.plan.kind === 'open' && !progress.aimedAt) progress.aimedAt = progress.plan.readingId;
        // An entry that already landed is not sent again, as long as it is
        // the same entry.
        progress.entryDone = progress.landedEntry !== null && entryOf(progress.plan) === progress.landedEntry;
      }
      teacherLog.write('attempted', {
        panel: PANEL, learnerId, action: 'reading.quick-log', plan: progress.plan.kind, happened,
      });
      const outcome = await performPlan(teacherWorkspaceApi, { learnerId, progress, actorId });
      if (progress.entryDone && progress.landedEntry === null) progress.landedEntry = entryOf(progress.plan);
      if (outcome.status === 403) return outcome; // re-ask once and replay; saved children are skipped
      if (outcome.ok) progress.done = true;
      setResults((value) => ({
        ...value,
        [learnerId]: outcome.ok
          ? { state: 'saved' }
          : { state: outcome.skipped ? 'skipped' : 'failed', message: failureMessage(outcome) },
      }));
      teacherLog.write(outcome.ok ? 'saved' : 'refused', {
        panel: PANEL, learnerId, action: 'reading.quick-log', status: outcome.status,
        ...(outcome.alreadyDone ? { alreadyDone: true } : {}), ...(outcome.code ? { code: outcome.code } : {}),
      });
    }
    return { ok: true, status: 200, data: null };
  }, { onSuccess: () => setReloadKey((n) => n + 1) });

  const saving = busy === WRITE_KEY;
  const canSave = facts.readersStatus === 'ok' && chosen.length > 0
    && (happened !== HAPPENED.PARTWAY || pageNumber !== null) && !saving;
  const mark = (learnerId) => {
    const state = results[learnerId]?.state;
    if (state === 'saved') return '✓';
    if (state) return '✗';
    return '…';
  };

  return (
    <div className="teacher-logbook" role="dialog" aria-modal="true" aria-label="Log a book">
      <div className="teacher-logbook__card">
        <header className="teacher-logbook__head">
          <h2>Log a book</h2>
          <button type="button" className="teacher-logbook__close" onClick={close}>Close</button>
        </header>

        {!isbn ? <ScanStep onNumber={takeNumber} /> : (
          <>
            <BookCard isbn={isbn} facts={facts} />
            {!anyResult && (
              <button type="button" className="teacher-logbook__link" onClick={reset}>Scan a different book</button>
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
                    const pressed = selected.has(reader.learnerId);
                    return (
                      <div key={reader.learnerId} className="teacher-logbook__face-wrap">
                        <button
                          type="button"
                          className="teacher-logbook__face"
                          aria-pressed={pressed}
                          disabled={Boolean(reader.unreadable) || result?.state === 'saved'}
                          onClick={() => toggle(reader.learnerId)}
                        >
                          <ProfileAvatar id={reader.learnerId} name={reader.name} />
                          <span className="teacher-logbook__face-name">{reader.name}</span>
                          {reader.today && <b className="teacher-logbook__badge">Logged today</b>}
                          {reader.openReadingId && <b className="teacher-logbook__badge teacher-logbook__badge--open">Reading now</b>}
                          {reader.unreadable && <b className="teacher-logbook__badge teacher-logbook__badge--warn">Shelf unreadable</b>}
                          {result && <i aria-hidden="true">{mark(reader.learnerId)}</i>}
                        </button>
                        {reader.unreadable && (
                          <p className="teacher-logbook__note">Their shelf couldn’t be read just now.</p>
                        )}
                        {pressed && reader.today && !result && (
                          <p className="teacher-logbook__note">Already logged today. Saving logs it again.</p>
                        )}
                        {result?.state === 'skipped' && <p className="teacher-logbook__note">{result.message}</p>}
                        {result?.state === 'failed' && (
                          <>
                            <p className="teacher-panel__error">{result.message}</p>
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
                      <button type="button" aria-pressed={mode === 'check'} onClick={() => setModeChoice('check')}>✓ check</button>
                      <button type="button" aria-pressed={mode === 'page'} onClick={() => setModeChoice('page')}>page</button>
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
                      {chosen.map((reader) => `${reader.name} ${mark(reader.learnerId)}`).join(' · ')}
                    </p>
                    <div className="teacher-logbook__actions">
                      <button type="button" onClick={reset}>Log another book</button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
