import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPIText } from '../../../../../../frontend/src/lib/api.mjs';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import usePianoList from '../usePianoList.js';
import { usePianoUser } from '../PianoUserContext.jsx';
import { titleFromScoreId } from '../modes/SheetMusic/scoreTitle.js';
import PassageCoin from '../modes/SheetMusic/PassageCoin.jsx';
import ProgressRing from '../modes/Videos/ProgressRing.jsx';
import { coinSize, mapColumns, passageFaded, pieceCount, scoreHeading, stripGroups } from './deskModel.js';
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
  return title ?? (scoreId ? titleFromScoreId(scoreId) : '');
}

const sized = (url, w, h) => `${url}${url.includes('?') ? '&' : '?'}w=${w}&h=${h}`;

/** A card's poster, or a plain block of the same size when there is none. */
const Poster = ({ src }) => (src
  ? <img className="piano-desk__poster" src={src} alt="" decoding="async" />
  : <span className="piano-desk__poster piano-desk__poster--none" aria-hidden="true" />);

/** The passage map: one coin per passage, in score order, the next one ringed. */
export function PassageMap({ piece, focusId }) {
  const columns = mapColumns(piece.passages.length);
  const size = coinSize(piece.passages.length);
  return (
    <span className="piano-desk__map" style={{ gridTemplateColumns: `repeat(${columns}, ${size}px)` }} aria-hidden="true">
      {piece.passages.map((passage) => {
        const current = passage.id === focusId;
        return (
          <i key={passage.id} data-state={passage.state} data-current={current || undefined} data-faded={passageFaded(passage, current) || undefined}>
            <PassageCoin state={passage.state} size="100%" />
          </i>
        );
      })}
    </span>
  );
}

/** The same counters as the passage board: a coin and how many passages carry it. */
export const PieceCount = ({ piece }) => (
  <span className="piano-desk__count" aria-hidden="true">
    <span data-level="silver"><PassageCoin state="silver" />{piece.silver}/{piece.total}</span>
    {piece.gold > 0 && <span data-level="gold"><PassageCoin state="gold" />{piece.gold}/{piece.total}</span>}
  </span>
);

export { usePrintedTitle };

function PieceCard({ card }) {
  const title = usePrintedTitle(card.piece.scoreId);
  return (
    <>
      <span className="piano-desk__top">
        <Poster src={card.piece.cover} />
        <span className="piano-desk__head">
          <strong className="piano-desk__title">{title}</strong>
          <PieceCount piece={card.piece} />
        </span>
      </span>
      <span className="piano-desk__band"><PassageMap piece={card.piece} focusId={card.focus?.id} /></span>
    </>
  );
}

function CourseCard({ card }) {
  const { course } = card;
  const percent = course.total > 0 ? Math.min(100, Math.round((course.completed / course.total) * 100)) : 0;
  return (
    <>
      <span className="piano-desk__top">
        <Poster src={course.thumbnail ? sized(course.thumbnail, 112, 168) : null} />
        <span className="piano-desk__head"><strong className="piano-desk__title">{course.courseTitle}</strong></span>
      </span>
      {/* Lessons done, as a ring that fills; no sentence. */}
      <span className="piano-desk__band"><ProgressRing percent={percent} label={`${percent}%`} size="44px" /></span>
    </>
  );
}

/**
 * The progress strip above the home menu: for each child (school learners, not
 * parents), a card for the piece they are learning and one for their video course, under one
 * avatar and name per child. The strip keeps one
 * height whether or not it has cards, so the menu below never moves. The cards share its width:
 * it never scrolls, and a card is never cut off at its edge.
 */
export default function PianoHomeDesk({ disabled, onOpenPassage, onOpenCourse }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-desk' }), []);
  const { data: pieces } = usePianoList('api/v1/piano/activity/desk', players, { alwaysRevalidate: true });
  const { data: courses } = usePianoList('api/v1/piano/activity/recent', players);
  // The strip is for the children; school learners are the roster's children.
  const { users } = usePianoUser();
  const children = new Set((users ?? []).filter((user) => user.schoolLearner === true).map((user) => user.id));
  const groups = stripGroups({ pieces, courses }).filter((group) => children.has(group.userId));
  const cards = groups.flatMap((group) => group.cards);
  useEffect(() => {
    logger.debug('piano.desk.view', { cards: cards.map((card) => card.key) });
  }, [logger, cards.map((card) => card.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
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
      {groups.map((group) => (
        <div key={group.userId} className="piano-desk__child">
          {/* One avatar and name heads the child's cards. */}
          <span className="piano-desk__who">
            <ProfileAvatar id={group.userId} name={group.name} />
            <span className="piano-desk__name">{group.name}</span>
          </span>
          <span className="piano-desk__cards">
            {group.cards.map((card) => (
              <button type="button" key={card.key} className="piano-desk__card" data-kind={card.kind} disabled={disabled}
                aria-label={card.kind === 'piece' ? `${card.name}: ${pieceCount(card.piece)}` : `${card.name}: ${card.course.courseTitle}`}
                onClick={() => open(card)}>
                {card.kind === 'piece' ? <PieceCard card={card} /> : <CourseCard card={card} />}
              </button>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}
