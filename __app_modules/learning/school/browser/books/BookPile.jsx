/**
 * BookPile — the Portal screen for scanning a stack of books and filing them.
 *
 * ONE SESSION, ONE CHILD. Scans stack up as cards; one face tap files every
 * unfiled card to that child, and later scans in the session file to them by
 * themselves (`useBookPile`). Nothing here asks "who?" per book. Giving one
 * book to someone else, or removing a mis-scan, sits behind a card's Change
 * button on purpose: splitting a pile is the exception, not the flow.
 * (Design: ops:docs/superpowers/specs/2026-10-30-portal-book-pile-design.md.)
 *
 * FULL SCREEN ONLY WHILE SOMEONE IS SCANNING. The screen takes the panel while
 * the session is live (filed cards stay on it so a wrong reader can still be
 * fixed) unless set aside with Later. Otherwise unfiled books wait in a corner
 * card — the keypad must never be held hostage by a pile nobody finished, and
 * the cards themselves are kept until the study day ends. A pile of nothing
 * but unreadable barcodes raises no card at all. While the panel is busy the
 * corner card is the only form, and only before a reader is picked: a picked
 * reader files silently.
 */
import { useEffect, useMemo, useState } from 'react';
import useArmedAction from "../../../../../frontend/src/lib/identity/useArmedAction.js";
import BookCover from "./BookCover.jsx";
import LearnerChoice from "./LearnerChoice.jsx";
import ScreenHeader from "../shared/ScreenHeader.jsx";
import { presentBook } from "./bookPresentation.js";
import { useBookPile } from "./useBookPile.js";

function chipFor(card, nameOf) {
  if (card.status === 'loading') return { text: 'Looking up…', tone: 'muted' };
  if (card.error) return { text: card.error, tone: 'danger' };
  if (card.state === 'filing') return { text: 'Filing…', tone: 'muted' };
  if (card.state === 'filed' && card.outcome === 'already-today') return { text: `${nameOf(card.learnerId)} already has it today`, tone: 'note' };
  if (card.state === 'filed') return { text: nameOf(card.learnerId), tone: 'done' };
  if (card.state === 'claimed') return { text: 'Opened on a shelf', tone: 'muted' };
  if (card.status === 'not-found') return { text: 'Not in the catalog — files by number', tone: 'muted' };
  return null;
}

function CornerOffer({ count, confirmExit, onOpen }) {
  const { armed, trigger } = useArmedAction(onOpen, { armMs: 4000 });
  return (
    <aside className="school-book-scan__notice" role="status" data-testid="book-pile-offer">
      <div className="school-book-scan__notice-body">
        <p className="school-book-scan__notice-title">{count === 1 ? '1 book scanned — open when ready' : `${count} books scanned — open when ready`}</p>
        {armed && <p className="school-book-scan__notice-warn">Leave the quiz? Your answers so far won&rsquo;t be saved.</p>}
        <div className="school-book-scan__notice-actions">
          <button type="button" className="school-book-scan__open" onClick={() => (confirmExit ? trigger() : onOpen())}>
            {armed ? 'Yes, open it' : 'Open it'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function ChangeSheet({ card, title, roster, busy, onMove, onRemove, onClose }) {
  const [choosing, setChoosing] = useState(false);
  const others = roster.filter((learner) => learner.id !== card.learnerId);
  return (
    <div className="school-book-pile__sheet" role="dialog" aria-modal="true" aria-label={`Change ${title}`}>
      <div className="school-book-pile__sheet-body">
        <h3>{title}</h3>
        {choosing ? (
          <>
            <p>Who read this one?</p>
            <LearnerChoice roster={others} busy={busy} onChoose={(learnerId) => { onMove(card.id, learnerId); onClose(); }} />
          </>
        ) : (
          <div className="school-book-pile__sheet-actions">
            <button type="button" className="school-book-scan__open" disabled={busy} onClick={() => setChoosing(true)}>Give to someone else</button>
            <button type="button" className="school-books__back" disabled={busy} onClick={() => { onRemove(card.id); onClose(); }}>Remove</button>
          </div>
        )}
        <button type="button" className="school-books__back" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function BookPile({ screenId, roster = [], safe, onOpen = null, confirmExit = false, scopeLearnerId = null }) {
  const { cards, reader, live, lastScanAt, unfiled, busy, error, file, move, remove, enabled } = useBookPile({ screenId, scopeLearnerId });
  const [changing, setChanging] = useState(null);
  // Later sets the screen aside until the next scan; Open brings it back.
  const [laterAt, setLaterAt] = useState(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!live && !unfiled.length) setExpanded(false); }, [live, unfiled.length]);
  const names = useMemo(() => new Map(roster.map((learner) => [learner.id, learner.name || learner.id])), [roster]);
  const nameOf = (id) => names.get(id) ?? id ?? '';

  // An open shelf owns its scans; the pile has nothing to say there.
  if (!enabled || scopeLearnerId) return null;
  const waiting = unfiled.filter((card) => card.status !== 'invalid').length;
  const setAside = laterAt !== null && laterAt === lastScanAt;
  const full = safe && cards.length > 0 && ((live && !setAside) || expanded);
  if (!full) {
    if (waiting === 0 || (!safe && (reader || !onOpen))) return null;
    const open = () => { setLaterAt(null); setExpanded(true); if (!safe) onOpen(); };
    return <CornerOffer count={waiting} confirmExit={!safe && confirmExit} onOpen={open} />;
  }

  const title = unfiled.length === 0 && reader ? `Filing to ${nameOf(reader)}` : `Books to file · ${unfiled.length}`;
  const hint = unfiled.length === 0 && reader ? `New scans go to ${nameOf(reader)}.` : 'Keep scanning. Tap a face to file them.';
  const editing = changing ? cards.find((card) => card.id === changing) : null;

  /* A barcode scanner emits keystrokes; nothing here may be composed. */
  return (
    <section className="school-book-scan school-book-pile" data-ime="off" aria-label="Books to file">
      <div className="school-book-scan__screen">
        <ScreenHeader title={title} onDone={() => { setLaterAt(lastScanAt); setExpanded(false); }} doneLabel={unfiled.length ? 'Later' : 'Done'} />
        <p className="school-book-pile__hint">{hint}</p>
        <ul className="school-book-pile__cards">
          {cards.map((card) => {
            const book = presentBook(card.book ?? { isbn13: card.isbn13 });
            const label = card.book?.title ? book.title : card.isbn13;
            const chip = chipFor(card, nameOf);
            return (
              <li key={card.id} className={`school-book-pile__card school-book-pile__card--${card.state}`}>
                <BookCover book={card.book ?? { isbn13: card.isbn13 }} className="school-book-pile__cover" loading="lazy" />
                <span className="school-book-pile__title" title={label}>{label}</span>
                {chip && <span className={`school-book-pile__chip school-book-pile__chip--${chip.tone}`}>{chip.text}</span>}
                {card.duplicates > 0 && <span className="school-book-pile__chip school-book-pile__chip--note">Scanned twice</span>}
                {(card.state === 'unfiled' || card.state === 'filed') && (
                  <button type="button" className="school-book-pile__change" aria-label={`Change ${label}`} onClick={() => setChanging(card.id)}>
                    Change
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {error && <p className="school-book-scan__error" role="alert">{error}</p>}
        <div className="school-book-pile__faces">
          <LearnerChoice roster={roster} busy={busy} onChoose={file} />
        </div>
      </div>
      {editing && (
        <ChangeSheet card={editing} title={editing.book?.title ? presentBook(editing.book).title : editing.isbn13}
          roster={roster} busy={busy} onMove={move} onRemove={remove} onClose={() => setChanging(null)} />
      )}
    </section>
  );
}
