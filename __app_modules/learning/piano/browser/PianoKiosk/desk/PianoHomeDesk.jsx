import { useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import { DaylightAPIText } from '../../../../../../frontend/src/lib/api.mjs';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import usePianoList from '../usePianoList.js';
import { usePianoUser } from '../PianoUserContext.jsx';
import { titleFromScoreId } from '../modes/SheetMusic/scoreTitle.js';
import PassageCoin from '../modes/SheetMusic/PassageCoin.jsx';
import Icon from '../../ui/icons/Icon.jsx';
import GemIcon from '../../../../../../frontend/src/lib/icons/GemIcon.jsx';
import { polishStone } from '../modes/SheetMusic/polishAwards.js';
import { cardBadge, coinSize, lessonNumber, lessonTitle, mapColumns, mapRows, nextSkill, nextStep, passageFaded, pieceLabel, scoreHeading, shownCard, stripGroups, piecePolishing, swipeTarget } from './deskModel.js';
import useCardSwipe from './useCardSwipe.js';
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

/**
 * The passage map: one coin per passage, in score order, the next one ringed.
 * A piece holding a Polish gem or diamond ends the row with it, coin-sized,
 * standing beside both rows of a two-row map.
 */
export function PassageMap({ piece, focusId }) {
  const columns = mapColumns(piece.passages.length);
  const stone = polishStone(piece.polish);
  const size = coinSize(piece.passages.length, stone ? 1 : 0);
  const track = `repeat(${columns}, minmax(0, ${size}px))${stone ? ` minmax(0, ${size}px)` : ''}`;
  return (
    <span className="piano-desk__map" style={{ gridTemplateColumns: track }} aria-hidden="true">
      {piece.passages.map((passage) => {
        const current = passage.id === focusId;
        return (
          <i key={passage.id} data-state={passage.state} data-current={current || undefined} data-faded={passageFaded(passage, current) || undefined}>
            <PassageCoin state={passage.state} size="100%" />
          </i>
        );
      })}
      {stone && (
        <i data-stone={stone.kind} style={{ gridColumn: columns + 1, gridRow: `1 / span ${mapRows(piece.passages.length)}` }}>
          <GemIcon size="100%" color={stone.color} />
        </i>
      )}
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
export function PosterArt({ src, title }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="piano-desk__poster" data-stand-in="">
        <span className="piano-desk__note" aria-hidden="true"><Icon name="quarter-note" /></span>
        <span className="piano-desk__stand-in">{title}</span>
        {PLAY}
      </span>
    );
  }
  return <span className="piano-desk__poster"><img src={sized(src, 120, 180)} alt="" decoding="async" onError={() => setFailed(true)} />{PLAY}</span>;
}

/** The next episode's own still, 16:9, so the child knows the lesson by its picture; a tinted play frame when there is none or it fails. */
export function EpisodeStill({ src }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="piano-desk__still" data-stand-in=""><Icon name="play" /></span>;
  }
  return <span className="piano-desk__still"><img src={src} alt="" decoding="async" onError={() => setFailed(true)} /></span>;
}

/**
 * Sheet music: the score poster the card's full height on the left; beside it
 * the badge, the title (two lines), the bars up next and what to do in them,
 * with the passage coins and their Silver/Gold count pinned at the bottom.
 */
function PieceCard({ card }) {
  const title = usePrintedTitle(card.piece.scoreId);
  const badge = cardBadge(card);
  const skill = nextSkill(card);
  return (
    <>
      {/* Keyed by its picture, so a new picture starts fresh after an old one failed. */}
      <PosterArt key={card.piece.cover ?? ''} src={card.piece.cover} title={title} />
      <span className="piano-desk__text">
        <span className="piano-desk__badge" data-level={badge.level}>{badge.label}</span>
        <strong className="piano-desk__title">{title}</strong>
        <span className="piano-desk__step">{nextStep(card)}</span>
        {skill && <span className="piano-desk__skill">{skill}</span>}
        {/* One row of coins has the count beside it, at its right; two rows sit under the count. */}
        <span className="piano-desk__progress" data-kind="piece" data-rows={mapRows(card.piece.passages.length)}>
          <PassageMap piece={card.piece} focusId={card.focus?.id} />
          <PieceCount piece={card.piece} />
        </span>
      </span>
    </>
  );
}

/**
 * Video lessons: the course poster the card's full height on the left; beside
 * it the next episode's still with its lesson number, the lesson title (two
 * lines), and the course's bar and percent at the bottom.
 */
function CourseCard({ card }) {
  const { course } = card;
  const percent = course.total > 0 ? Math.min(100, Math.round((course.completed / course.total) * 100)) : 0;
  const title = course.next?.title ? lessonTitle(course.next.title) : course.courseTitle;
  const number = lessonNumber(course);
  const still = course.next?.thumbnail ?? null;
  return (
    <>
      <PosterArt key={course.thumbnail ?? ''} src={course.thumbnail} title={course.courseTitle} />
      <span className="piano-desk__text">
        <span className="piano-desk__episode">
          <EpisodeStill key={still ?? ''} src={still} />
          {number && <span className="piano-desk__step" data-kind="lesson"><small>Lesson</small> <b>{number}</b></span>}
        </span>
        <strong className="piano-desk__title">{title}</strong>
        <span className="piano-desk__progress" data-kind="course">
          <span className="piano-desk__bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
          <span className="piano-desk__pct">{percent}%</span>
        </span>
      </span>
    </>
  );
}

/** A child's two activities, as tabs in their header: indicators of the card shown, and a tap swaps it. */
const TABS = [
  { kind: 'piece', label: 'Sheet music', icon: 'quarter-note' },
  { kind: 'course', label: 'Video lesson', icon: 'play' },
];

/**
 * One child's panel: their avatar and name over one card. A child with more than
 * one card switches between them with a sideways swipe on the card (wrapping, like
 * a carousel) or a tap on a header tab.
 */
function ChildPanel({ group, card, disabled, onChoose, onSwipe, onOpen }) {
  const [enter, setEnter] = useState(null);
  const many = group.cards.length > 1;
  const swipe = useCardSwipe({
    enabled: many && !disabled,
    onSwipe: (direction) => {
      const target = swipeTarget(group.cards, card.kind, direction);
      if (!target) return;
      setEnter(direction);
      onSwipe(group.userId, card.kind, target.kind);
    },
  });
  const rows = card.kind === 'piece' && mapRows(card.piece.passages.length) > 1 ? 2 : undefined;
  return (
    <div className="piano-desk__child">
      <span className="piano-desk__head">
        <span className="piano-desk__who">
          <ProfileAvatar id={group.userId} name={group.name} />
          <span className="piano-desk__name">{group.name}</span>
        </span>
        {many && (
          <span className="piano-desk__tabs">
            {TABS.filter((tab) => group.cards.some((c) => c.kind === tab.kind)).map((tab) => (
              <button type="button" key={tab.kind} className="piano-desk__tab" data-kind={tab.kind} disabled={disabled}
                aria-label={tab.label} aria-pressed={card.kind === tab.kind}
                onClick={() => { setEnter(null); onChoose(group.userId, tab.kind); }}>
                <Icon name={tab.icon} />
              </button>
            ))}
          </span>
        )}
      </span>
      {/* The deck holds the swipe: it outlives the card, so the click after a swipe is caught here. */}
      <span className="piano-desk__deck" data-swipe={many || undefined} data-dragging={swipe.dragging || undefined}
        style={{ '--piano-desk-drag': `${swipe.offset}px` }} {...swipe.handlers}>
        <button type="button" key={card.key} className="piano-desk__card" data-kind={card.kind} disabled={disabled}
          data-rows={rows} data-enter={enter || undefined}
          aria-label={card.kind === 'piece' ? pieceLabel(card.name, card.piece) : `${card.name}: ${card.course.next?.title ?? card.course.courseTitle}`}
          onClick={() => onOpen(card)}>
          {card.kind === 'piece' ? <PieceCard card={card} /> : <CourseCard card={card} />}
        </button>
      </span>
    </div>
  );
}

/**
 * The progress strip above the home menu: one panel per child (school learners,
 * not parents), headed by their avatar and name, holding one card: the piece
 * they are learning or their video course. A child with both swipes the card
 * sideways to switch, or taps the tabs in the header (a note and a play icon);
 * the most recent is shown first, and the choice lasts while the strip is
 * mounted. Both cards keep a full-height poster on the left. The strip keeps one
 * height whether or not it has cards, so the menu below never moves. The cards
 * share its width: it never scrolls, and a card is never cut off at its edge.
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
  // The card each child last switched to, for as long as the strip is mounted.
  const [chosen, setChosen] = useState({});
  const shown = groups.map((group) => ({ group, card: shownCard(group, chosen[group.userId]) }));
  const cards = shown.map(({ card }) => card);
  const tall = cards.some((card) => card.kind === 'piece' && mapRows(card.piece.passages.length) > 1);
  useEffect(() => {
    logger.debug('piano.desk.view', { cards: cards.map((card) => card.key) });
  }, [logger, cards.map((card) => card.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (userId, kind) => {
    logger.debug('piano.desk.tab', { userId, kind });
    setChosen((prev) => ({ ...prev, [userId]: kind }));
  };
  const swiped = (userId, from, to) => {
    logger.debug('piano.desk.swipe', { userId, from, to });
    setChosen((prev) => ({ ...prev, [userId]: to }));
  };
  const open = (card) => {
    if (card.kind === 'piece' && piecePolishing(card.piece)) {
      // All Gold: the next thing is Polish, the whole piece with the metronome.
      logger.info('piano.desk.open-polish', { userId: card.userId, scoreId: card.piece.scoreId });
      onOpenPassage?.(card.userId, card.piece.scoreId, null, { mode: 'polish' });
    } else if (card.kind === 'piece') {
      logger.info('piano.desk.open-passage', { userId: card.userId, scoreId: card.piece.scoreId, passageId: card.focus?.id ?? null });
      onOpenPassage?.(card.userId, card.piece.scoreId, card.focus?.id);
    } else {
      logger.info('piano.desk.open-course', { userId: card.userId, courseId: card.course.courseId, lessonId: card.course.next?.id ?? null });
      onOpenCourse?.(card.userId, card.course.courseId, card.course.next?.id ?? null);
    }
  };
  return (
    <section className={`piano-desk${disabled ? ' is-disabled' : ''}`} data-tall={tall || undefined} aria-label="Recent progress">
      {shown.map(({ group, card }) => (
        <ChildPanel key={group.userId} group={group} card={card} disabled={disabled}
          onChoose={choose} onSwipe={swiped} onOpen={open} />
      ))}
    </section>
  );
}
