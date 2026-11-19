import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPIText } from '../../../../../../frontend/src/lib/api.mjs';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import usePianoList from '../usePianoList.js';
import { titleFromScoreId } from '../modes/SheetMusic/scoreTitle.js';
import { pieceCount, relativeTime, scoreHeading, stripCards } from './deskModel.js';
import './PianoHomeDesk.scss';

const players = (response) => (Array.isArray(response?.players) ? response.players : []);
const headings = new Map();

/** The printed title, read once per score and kept for the session. */
function usePrintedTitle(scoreId) {
  const [title, setTitle] = useState(() => headings.get(scoreId) ?? null);
  useEffect(() => {
    if (!scoreId) return undefined;
    let live = true;
    if (headings.has(scoreId)) { setTitle(headings.get(scoreId)); return undefined; }
    DaylightAPIText(`api/v1/proxy/media/stream/${encodeURIComponent(scoreId.replace(/^[a-z]+:/i, ''))}`)
      .then((xml) => { const value = scoreHeading(xml).title; headings.set(scoreId, value); if (live) setTitle(value); })
      .catch(() => { headings.set(scoreId, null); });
    return () => { live = false; };
  }, [scoreId]);
  return title ?? titleFromScoreId(scoreId);
}

function PieceCard({ card }) {
  const title = usePrintedTitle(card.piece.scoreId);
  const bars = card.piece.passages.map((passage) => `${passage.end - passage.start + 1}fr`).join(' ');
  return (
    <span className="piano-desk__body">
      <strong className="piano-desk__title">{title}</strong>
      <span className="piano-desk__map" style={{ gridTemplateColumns: bars }} aria-hidden="true">
        {card.piece.passages.map((passage) => (
          <i key={passage.id} data-state={passage.state} data-current={passage.id === card.focus?.id || undefined} />
        ))}
      </span>
      <small>{pieceCount(card.piece)}{card.piece.gold ? `, ${card.piece.gold} Gold` : ''}</small>
    </span>
  );
}

function CourseCard({ card }) {
  const { course } = card;
  return (
    <span className="piano-desk__body piano-desk__body--course">
      {course.thumbnail
        ? <img src={`${course.thumbnail}${course.thumbnail.includes('?') ? '&' : '?'}w=140&h=200`} alt="" decoding="async" />
        : <span className="piano-desk__poster-fallback" aria-hidden="true" />}
      <span className="piano-desk__course-text">
        <strong className="piano-desk__title">{course.courseTitle}</strong>
        <small>{course.completed} of {course.total} lessons</small>
      </span>
    </span>
  );
}

/**
 * The progress strip above the home menu: one card per child, showing the more
 * recent of their sheet-music piece and their video course. The strip keeps one
 * height whether or not it has cards, so the menu below never moves.
 */
export default function PianoHomeDesk({ disabled, onOpenPassage, onOpenCourse }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-desk' }), []);
  const { data: pieces } = usePianoList('api/v1/piano/activity/desk', players, { alwaysRevalidate: true });
  const { data: courses } = usePianoList('api/v1/piano/activity/recent', players);
  const cards = stripCards({ pieces, courses });
  useEffect(() => {
    logger.debug('piano.desk.view', { cards: cards.map((card) => `${card.userId}:${card.kind}`) });
  }, [logger, cards.map((card) => `${card.userId}:${card.kind}`).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (card) => {
    if (card.kind === 'piece') {
      logger.info('piano.desk.open-passage', { userId: card.userId, scoreId: card.piece.scoreId, passageId: card.focus?.id ?? null });
      onOpenPassage?.(card.userId, card.piece.scoreId, card.focus?.id);
    } else {
      logger.info('piano.desk.open-course', { userId: card.userId, courseId: card.course.courseId });
      onOpenCourse?.(card.userId, card.course.courseId);
    }
  };
  return (
    <section className={`piano-desk${disabled ? ' is-disabled' : ''}`} aria-label="Recent progress">
      {cards.map((card) => (
        <button type="button" key={card.userId} className="piano-desk__card" data-kind={card.kind} disabled={disabled}
          aria-label={card.kind === 'piece' ? `${card.name}: ${pieceCount(card.piece)}` : `${card.name}: ${card.course.courseTitle}`}
          onClick={() => open(card)}>
          <span className="piano-desk__who">
            <ProfileAvatar id={card.userId} name={card.name} />
            <span>{relativeTime(card.at)}</span>
          </span>
          {card.kind === 'piece' ? <PieceCard card={card} /> : <CourseCard card={card} />}
        </button>
      ))}
    </section>
  );
}
