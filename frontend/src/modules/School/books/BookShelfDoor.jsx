/**
 * BookShelfDoor — "I want to log a book", asked from the panel's resting state.
 *
 * THE MIRROR OF A SCAN. `BookScanEntry` has the book and asks who is reading
 * it; this has neither and asks who first, then opens that child's shelf
 * straight at the ISBN pad. It exists because the printed-card route to the
 * same pad costs five steps — scan your card, wait for the thermal print, read
 * the six digits off the tape, type them, then find `Add a book` — and the
 * paper's only job in that chain is carrying identity.
 *
 * IT DOES NOT LIVE INSIDE THE STATUS BOARD. `AgendaStatusBoard` is
 * deliberately non-interactive and its pane sets `pointer-events: none`; it
 * also renders nothing at all on a settled-empty day, which is exactly when a
 * child most needs a way in. So this mounts beside the board, inside the same
 * pane, and re-enables pointer events on itself alone. The board stays a board.
 *
 * ONE TAP IS ALL THE PROOF THERE IS, and the server knows it: the grant this
 * returns is minted with a short TTL precisely because a face on a shared wall
 * panel is not a printed code (see `OpenBookShelfAtPanel`).
 */
import { useCallback, useRef, useState } from 'react';
import Icon from '../home/icons/Icon.jsx';
import { schoolApi } from '../schoolApi.js';
import { schoolLog } from '../schoolLog.js';
import LearnerChoice from './LearnerChoice.jsx';

export default function BookShelfDoor({ screenId, roster = [], onLaunch }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The shelf is a workspace on a shared panel, so the same rule as everywhere
  // else here: a late answer may not open anything the child has walked away
  // from. Closing the sheet bumps this and the response is dropped.
  const generation = useRef(0);
  const inFlight = useRef(false);

  const close = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setAsking(false);
    setBusy(false);
    setError(null);
  }, []);

  const choose = useCallback(async (learnerId) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    setBusy(true);
    setError(null);
    const result = await schoolApi.bookScans.open({ screenId, learnerId });
    if (gen !== generation.current) return;
    inFlight.current = false;
    setBusy(false);
    if (!result.ok || !result.data?.launchTarget?.bookGrant) {
      setError(result.data?.error?.message ?? 'Could not open your books. Try again.');
      schoolLog.bookShelfError('door.open-failed', { status: result.status });
      return;
    }
    schoolLog.bookShelf('door.open', { screenId });
    setAsking(false);
    // `openAdd` is the whole point of this door: the child came to type a
    // number, so the shelf must not make them find `Add a book` first.
    onLaunch({ ...result.data.launchTarget, bookEntry: null, openAdd: true }, learnerId);
  }, [screenId, onLaunch]);

  if (!asking) {
    return (
      <button
        type="button"
        className="school-book-door"
        data-testid="book-shelf-door"
        onClick={() => { schoolLog.bookShelf('door.asked', {}); setAsking(true); }}
      >
        <Icon name="english" className="school-book-door__icon" />
        <span className="school-book-door__label">Log a book</span>
      </button>
    );
  }

  return (
    <section className="school-book-scan" role="dialog" aria-modal="true" aria-label="Who is logging a book">
      <div className="school-book-scan__preview">
        <h2>Who&apos;s reading?</h2>
        <div className="school-book-scan__actions">
          <LearnerChoice roster={roster} busy={busy} onChoose={choose} />
          {error && <p role="alert">{error}</p>}
          <button type="button" className="school-books__back" onClick={close}>Never mind</button>
        </div>
      </div>
    </section>
  );
}
