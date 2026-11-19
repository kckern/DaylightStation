import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import ProfileAvatar from '../../../../../../frontend/src/lib/identity/ProfileAvatar.jsx';
import { usePianoUser } from '../PianoUserContext.jsx';
import usePianoList from '../usePianoList.js';
import { Skeleton } from '../Skeleton.jsx';
import { titleFromScoreId } from '../modes/SheetMusic/scoreTitle.js';
import { deskView, passageBars, pieceCount } from './deskModel.js';
import './PianoHomeDesk.scss';

const DeskNotation = lazy(() => import('./DeskNotation.jsx'));
const players = (response) => (Array.isArray(response?.players) ? response.players : []);
const STATE_WORDS = { todo: 'Not started', learning: 'Learning', silver: 'Silver', gold: 'Gold' };

function PassageMap({ piece, focusId, disabled, onOpen }) {
  const bars = piece.passages.map((passage) => `${passage.end - passage.start + 1}fr`).join(' ');
  return (
    <ol className="piano-desk__map" style={{ gridTemplateColumns: bars }} aria-label="Passages in this piece">
      {piece.passages.map((passage) => (
        <li key={passage.id}>
          <button type="button" className="piano-desk__passage" data-state={passage.state} disabled={disabled}
            aria-current={passage.id === focusId ? 'step' : undefined}
            aria-label={`${passageBars(passage)}, ${STATE_WORDS[passage.state]}`} onClick={() => onOpen(passage)}>
            <span>{passage.start + 1}</span>
            {passage.state === 'learning' && (
              <span className="piano-desk__steps" aria-hidden="true">
                {Array.from({ length: passage.steps.total }, (_, index) => <i key={index} data-done={index < passage.steps.done} />)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The home screen's working surface: the active player's piece, the passage to
 * play next, and how far the whole piece has come. Its frame never changes size,
 * so nothing around it moves while data and notation arrive.
 */
export default function PianoHomeDesk({ disabled, onOpenPassage, onOpenCourse, onOpenLibrary }) {
  const logger = useMemo(() => getLogger().child({ component: 'piano-desk' }), []);
  const { currentUser, setCurrentUser } = usePianoUser();
  const { data: deskPlayers, loading } = usePianoList('api/v1/piano/activity/desk', players, { alwaysRevalidate: true });
  const { data: courses } = usePianoList('api/v1/piano/activity/recent', players);
  const [heading, setHeading] = useState({ scoreId: null, title: null, composer: null });
  const view = deskView({ players: deskPlayers, courses, currentUser });
  const { player, piece, course, focus, action } = view;
  const scoreId = piece?.scoreId ?? null;
  const onHeading = useCallback((value) => setHeading({ scoreId, ...value }), [scoreId]);
  useEffect(() => {
    logger.info('piano.desk.view', { userId: currentUser ?? null, scoreId, passageId: focus?.id ?? null, silver: piece?.silver ?? null, gold: piece?.gold ?? null });
  }, [logger, currentUser, scoreId, focus?.id, piece?.silver, piece?.gold]);
  const printed = heading.scoreId === scoreId ? heading : {};
  const openPassage = (passage) => {
    logger.info('piano.desk.open-passage', { userId: currentUser, scoreId, passageId: passage.id });
    onOpenPassage?.(scoreId, passage.id);
  };
  const choosePlayer = (userId) => {
    logger.info('piano.desk.switch-player', { from: currentUser ?? null, to: userId });
    setCurrentUser(userId);
  };
  return (
    <section className="piano-desk" aria-label="Your music" aria-busy={loading}>
      <div className="piano-desk__paper">
        {piece ? <>
          <header className="piano-desk__head">
            <h2>{printed.title ?? titleFromScoreId(scoreId)}</h2>
            {printed.composer && <span>{printed.composer}</span>}
          </header>
          <div className="piano-desk__stage">
            <Suspense fallback={null}><DeskNotation scoreId={scoreId} passage={focus} onHeading={onHeading} /></Suspense>
          </div>
        </> : loading ? <Skeleton className="piano-desk__paper-skeleton" /> : (
          <div className="piano-desk__blank">
            <h2>{currentUser && currentUser !== 'guest' ? 'Choose a piece to learn' : 'Who is playing?'}</h2>
          </div>
        )}
      </div>

      <div className="piano-desk__side">
        <div className="piano-desk__family" role="group" aria-label="Who is playing">
          {(deskPlayers ?? []).map((item) => (
            <button type="button" key={item.userId} aria-label={item.name} aria-pressed={item.userId === currentUser}
              disabled={disabled} onClick={() => choosePlayer(item.userId)}>
              <ProfileAvatar id={item.userId} name={item.name} />
            </button>
          ))}
        </div>
        <div className="piano-desk__next">
          {piece ? <>
            <p className="piano-desk__bars">{passageBars(focus)}</p>
            <p className="piano-desk__task">{action.detail}</p>
            <button type="button" className="piano-desk__go" disabled={disabled || !focus} onClick={() => openPassage(focus)}>{action.label}</button>
            <p className="piano-desk__count">{pieceCount(piece)}</p>
          </> : !loading && player ? (
            <button type="button" className="piano-desk__go" disabled={disabled} onClick={onOpenLibrary}>Find a piece</button>
          ) : null}
        </div>
        <div className="piano-desk__course">
          {course && (
            <button type="button" disabled={disabled} onClick={() => {
              logger.info('piano.desk.open-course', { userId: currentUser, courseId: course.courseId });
              onOpenCourse?.(course.courseId, currentUser);
            }}>
              {course.thumbnail && <img src={`${course.thumbnail}${course.thumbnail.includes('?') ? '&' : '?'}w=96&h=136`} alt="" decoding="async" />}
              <span><strong>{course.courseTitle}</strong><small>{course.completed} of {course.total} lessons</small></span>
            </button>
          )}
        </div>
      </div>

      <div className="piano-desk__progress">
        {piece ? <PassageMap piece={piece} focusId={focus?.id} disabled={disabled} onOpen={openPassage} />
          : !loading && <p className="piano-desk__progress-empty">Your piece’s passages will appear here.</p>}
      </div>
    </section>
  );
}
