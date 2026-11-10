/**
 * FlashcardReviewsPanel — a grown-up's read of a learner's ordinary (not
 * card-ladder) flashcard decks: each study session, and in it every card the
 * learner rated, its two faces, and the rating they gave (Again / Hard /
 * Good / Easy).
 *
 * Reads `POST /flashcards/teacher-report` (teacher-gated; the school router
 * fills the console's capability in from its cookie), whose `sessions` come
 * from the append-only review events. Shown for every deck the learner is
 * enrolled in, and for any other deck they have reviewed.
 */
import { useState } from 'react';
import { schoolApi } from "../../schoolApi.js";
import { usePanelFetch } from "../usePanelFetch.js";
import { useTeacherProfileOptional } from "../TeacherProfileContext.jsx";
import { teacherLog } from "../teacherLog.js";
import PanelFrame from "./PanelFrame.jsx";
import { humanDateTime } from "../teacherDates.js";
import { clockOf, minutesOf } from "../cardLadderDayLog.js";

const PANEL = 'flashcard-reviews';
const RATING_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

/** A card face as text: its first readable block, or what kind of thing it shows. */
export function faceLabel(face) {
  const blocks = Array.isArray(face?.blocks) ? face.blocks : [];
  const readable = blocks.find((block) => ['text', 'tts'].includes(block?.type) && block.text)
    ?? blocks.find((block) => block?.type === 'image' && block.alt)
    ?? blocks.find((block) => ['audio', 'video'].includes(block?.type) && block.transcript);
  if (readable) return readable.text ?? readable.alt ?? readable.transcript;
  const kind = blocks.find((block) => block?.type)?.type;
  return kind ? `(${kind})` : null;
}

function Session({ session, onOpen }) {
  const [open, setOpen] = useState(false);
  const minutes = Number.isFinite(session.activeSeconds) ? minutesOf(session.activeSeconds * 1000) : null;
  const tally = session.reviews.reduce((counts, review) => ({ ...counts, [review.rating]: (counts[review.rating] ?? 0) + 1 }), {});
  return (
    <li className={`teacher-ladder-day${open ? ' is-open' : ''}`}>
      <button type="button" className="teacher-ladder-day__head" aria-expanded={open} onClick={() => { if (!open) onOpen?.(session.sessionId); setOpen((value) => !value); }}>
        <span className="teacher-ladder-day__date">{humanDateTime(session.startedAt) ?? 'Unknown time'}</span>
        <span className="teacher-ladder-day__facts">
          {session.reviews.length} card{session.reviews.length === 1 ? '' : 's'}{minutes ? ` · ${minutes}` : ''}
          {' · '}{Object.keys(RATING_LABEL).filter((key) => tally[key]).map((key) => `${tally[key]} ${RATING_LABEL[key]}`).join(', ')}
        </span>
        <span className="teacher-ladder-day__chevron" aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="teacher-ladder-day__answers">
          {session.reviews.map((review, index) => {
            // The face the learner was shown first, then the one they recalled.
            const [shown, hidden] = review.direction === 'back_to_front' ? [review.back, review.front] : [review.front, review.back];
            return (
              <li key={`${review.at}:${index}`} className={`teacher-ladder-day__answer is-rating-${review.rating}`}>
                <span className="teacher-ladder-day__time">{clockOf(review.at) ?? ''}</span>
                <span className="teacher-ladder-day__word"><strong>{faceLabel(shown) ?? review.cardId}</strong>{faceLabel(hidden) && <small>{faceLabel(hidden)}</small>}</span>
                <span className="teacher-ladder-day__step">{review.mode === 'learn' ? 'Learn' : 'Review'}</span>
                <span className="teacher-ladder-day__given">{RATING_LABEL[review.rating] ?? review.rating ?? '—'}</span>
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

/**
 * @param {object} props
 * @param {string} props.learnerId
 * @param {string} [props.learnerName]
 * @param {string[]} [props.enrolledDeckIds] - the learner's ordinary flashcard
 *   enrollments; each is listed even before its first review
 */
export default function FlashcardReviewsPanel({ learnerId, learnerName = null, enrolledDeckIds = [] }) {
  const profile = useTeacherProfileOptional();
  const actorId = profile?.currentTeacher?.id ?? null;
  const enrolled = new Set(enrolledDeckIds);
  const shown = (data) => (data?.decks ?? []).filter((deck) => enrolled.has(deck.id) || (deck.sessions ?? []).length);
  const record = usePanelFetch(() => (actorId
    ? schoolApi.flashcardTeacherReport({ learnerId, actorId })
    : Promise.resolve({ ok: true, status: 200, data: null })), {
    deps: [learnerId, actorId, enrolledDeckIds.join('|')], panel: PANEL, notFoundAs: 'unavailable',
    isEmpty: (d) => !shown(d).length,
  });
  const decks = shown(record.data);
  if (!actorId) return <p className="teacher-muted">Pick a teacher to read {learnerName ?? learnerId}’s flashcard reviews.</p>;
  // Not enrolled in any ordinary deck: a panel only once there is something
  // to read, so a learner without flashcards never sees a skeleton flash by.
  if (!enrolledDeckIds.length && (record.state === 'loading' || record.state === 'empty')) return null;
  return (
    <PanelFrame title="Flashcard reviews" state={record.state} retry={record.retry}
      emptyCopy="No flashcard reviews yet."
      unavailableCopy="Flashcards are not available on this install.">
      {decks.map((deck) => (
        <section key={deck.id} className="teacher-flashcard-deck">
          <h3 className="teacher-panel__subtitle">{deck.title ?? deck.id}</h3>
          {(deck.sessions ?? []).length
            ? <ol className="teacher-ladder-days">
              {deck.sessions.map((session) => (
                <Session key={session.sessionId} session={session}
                  onOpen={(sessionId) => teacherLog.read('opened', { panel: PANEL, learnerId, deckId: deck.id, sessionId })} />
              ))}
            </ol>
            : <p className="teacher-panel__empty">No reviews yet.</p>}
        </section>
      ))}
    </PanelFrame>
  );
}
