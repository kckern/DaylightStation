import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPIText } from '../../../../../../frontend/src/lib/api.mjs';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import usePianoList from '../usePianoList.js';
import { usePianoUser } from '../PianoUserContext.jsx';
import { titleFromScoreId } from '../modes/SheetMusic/scoreTitle.js';
import PassageCoin from '../modes/SheetMusic/PassageCoin.jsx';
import { cardBadge, coinSize, lessonTitle, mapColumns, mapRows, nextStep, passageFaded, pieceCount, scoreHeading, stripGroups } from './deskModel.js';
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

const PLAY = <span className="piano-desk__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></span>;

/** A card's tall poster: the picture, or a tinted stand-in with a title when there is none or it fails. */
function PosterArt({ src, title }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <span className="piano-desk__poster" data-stand-in="">
        <span className="piano-desk__note" aria-hidden="true">♪</span>
        <span className="piano-desk__stand-in">{title}</span>
        {PLAY}
      </span>
    );
  }
  return <span className="piano-desk__poster"><img src={sized(src, 120, 180)} alt="" decoding="async" onError={() => setFailed(true)} />{PLAY}</span>;
}

/** One layout for both kinds: poster left; badge, title and next step beside it; progress under. */
function Card({ card, poster, title, standIn = title, progress }) {
  const badge = cardBadge(card);
  return (
    <>
      <span className="piano-desk__top">
        <PosterArt src={poster} title={standIn} />
        <span className="piano-desk__text">
          <span className="piano-desk__badge" data-level={badge.level}>{badge.label}</span>
          <strong className="piano-desk__title">{title}</strong>
          <span className="piano-desk__step">{nextStep(card)}</span>
        </span>
      </span>
      <span className="piano-desk__progress">{progress}</span>
    </>
  );
}

function PieceCard({ card }) {
  const title = usePrintedTitle(card.piece.scoreId);
  return <Card card={card} poster={card.piece.cover} title={title} progress={<PassageMap piece={card.piece} focusId={card.focus?.id} />} />;
}

function CourseCard({ card }) {
  const { course } = card;
  const percent = course.total > 0 ? Math.min(100, Math.round((course.completed / course.total) * 100)) : 0;
  const title = course.next?.title ? lessonTitle(course.next.title) : course.courseTitle;
  return (
    <Card card={card} poster={course.thumbnail} title={title} standIn={course.courseTitle} progress={(
      <>
        <span className="piano-desk__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
        <span className="piano-desk__pct">{percent}%</span>
      </>
    )} />
  );
}

/**
 * The progress strip above the home menu: one panel per child (school learners,
 * not parents), headed once by their avatar and name, holding a card for the
 * piece they are learning and one for their video course. Both cards share one
 * layout: a tall poster on the left, the badge, title and very next step beside
 * it, and the progress (passage coins, or a course bar and percent) underneath.
 * The strip keeps one height whether or not it has cards, so the menu below
 * never moves. The cards share its width: it never scrolls, and a card is never
 * cut off at its edge.
 */
export default function PianoHomeDesk({ disabled, onOpenPassage, onOpenCourse }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-desk' }), []);
  const { data: pieces } = usePianoList('api/v1/piano/activity/desk', players, { alwaysRevalidate: true });
  const { data: courses } = usePianoList('api/v1/piano/activity/recent', players);
  // The strip is for the children; school learners are the roster's children.
  const { users } = usePianoUser();
  const children = new Set((users ?? []).filter((user) => user.schoolLearner === true).map((user) => user.id));
  // Both lists or neither: cards that arrived in two waves would reflow the strip.
  const loaded = pieces !== null && courses !== null;
  const groups = loaded ? stripGroups({ pieces, courses }).filter((group) => children.has(group.userId)) : [];
  const cards = groups.flatMap((group) => group.cards);
  const tall = cards.some((card) => card.kind === 'piece' && mapRows(card.piece.passages.length) > 1);
  useEffect(() => {
    logger.debug('piano.desk.view', { cards: cards.map((card) => card.key) });
  }, [logger, cards.map((card) => card.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (card) => {
    if (card.kind === 'piece') {
      logger.info('piano.desk.open-passage', { userId: card.userId, scoreId: card.piece.scoreId, passageId: card.focus?.id ?? null });
      onOpenPassage?.(card.userId, card.piece.scoreId, card.focus?.id);
    } else {
      logger.info('piano.desk.open-course', { userId: card.userId, courseId: card.course.courseId, lessonId: card.course.next?.id ?? null });
      onOpenCourse?.(card.userId, card.course.courseId, card.course.next?.id ?? null);
    }
  };
  return (
    <section className={`piano-desk${disabled ? ' is-disabled' : ''}`} data-tall={tall || undefined} aria-label="Recent progress">
      {groups.map((group) => (
        <div key={group.userId} className="piano-desk__child">
          <span className="piano-desk__who">
            <ProfileAvatar id={group.userId} name={group.name} />
            <span className="piano-desk__name">{group.name}</span>
          </span>
          <span className="piano-desk__cards">
            {group.cards.map((card) => (
              <button type="button" key={card.key} className="piano-desk__card" data-kind={card.kind} disabled={disabled}
                data-rows={card.kind === 'piece' && mapRows(card.piece.passages.length) > 1 ? 2 : undefined}
                aria-label={card.kind === 'piece' ? `${card.name}: ${pieceCount(card.piece)}` : `${card.name}: ${card.course.next?.title ?? card.course.courseTitle}`}
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
