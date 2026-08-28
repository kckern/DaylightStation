import { useCallback, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import AskSession from '../ask/AskSession.jsx';
import { openPianoCourseLesson } from './pianoContentOpen.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-lesson-gate-view' });
  return _logger;
}

/**
 * TodaysLessonGate — what the kiosk menu becomes while a learner still owes
 * their assigned piano lesson: one card, one thing to do.
 *
 * It REPLACES the tile grid rather than greying it out. That is deliberately
 * not the curfew treatment (which disables tiles in place and explains why):
 * curfew is "everything is closed", this is "here is the one thing", and a
 * dimmed grid behind a single live card reads as the former.
 *
 * The tap navigates in-app through `openPianoCourseLesson` — the same route
 * a DoNow course-lesson launch lands on. No DoNow dispatch: that bus exists to
 * address a DIFFERENT physical device from a printed slip, and here the tap
 * originates on the tablet already showing this card.
 */
export default function TodaysLessonGate({
  lesson, unit, course, challenge = null, learnerId = null, onCompleted, basePath, navigate,
}) {
  const [completionError, setCompletionError] = useState(null);
  const onLaunch = useCallback(() => {
    logger().info('piano.lesson-gate.launch', { courseId: course?.id, lessonId: lesson?.id });
    const opened = openPianoCourseLesson({
      courseId: course?.id, lessonId: lesson?.id, basePath, navigate,
    });
    // An unreachable id shape must still leave somewhere to go: the course
    // page can always find the lesson, where a dead tap teaches nothing.
    if (!opened && course?.id) {
      logger().warn('piano.lesson-gate.launch-fallback', { courseId: course.id, lessonId: lesson?.id });
      navigate(`${basePath}/videos/${String(course.id).replace(/^plex:/, '')}`);
    }
  }, [course, lesson, basePath, navigate]);

  const onChallengePassed = useCallback(async (result) => {
    if (!challenge?.id || !learnerId || learnerId === 'guest') {
      setCompletionError('This PianoChallenge cannot be saved right now.');
      return;
    }
    setCompletionError(null);
    try {
      await DaylightAPI(
        `api/v1/piano/users/${encodeURIComponent(learnerId)}/school-piano-challenges/${encodeURIComponent(challenge.id)}/completion`,
        {
          assessmentId: result?.assessmentId,
          score: result?.score,
          status: result?.status,
          passed: true,
        },
        'POST',
      );
      logger().info('piano.lesson-gate.challenge-completed', { learnerId, descriptorId: challenge.id });
      await onCompleted?.();
    } catch (error) {
      logger().warn('piano.lesson-gate.challenge-save-failed', {
        learnerId, descriptorId: challenge?.id, error: error?.message ?? String(error),
      });
      setCompletionError('Your pass was not saved. Please ask a grown-up, then try again.');
    }
  }, [challenge, learnerId, onCompleted]);

  if (challenge) {
    return (
      <section className="piano-lesson-gate piano-lesson-gate--challenge">
        <p className="piano-lesson-gate__eyebrow">Today&apos;s PianoChallenge</p>
        <p className="piano-lesson-gate__context">
          {course?.title}{unit?.title ? ` · ${unit.title}` : ''}
        </p>
        <h2 className="piano-lesson-gate__title">{lesson?.title}</h2>
        {challenge.framing && <p className="piano-lesson-gate__description">{challenge.framing}</p>}
        {completionError && <p className="piano-lesson-gate__error" role="alert">{completionError}</p>}
        <AskSession
          ask={challenge.ask}
          materialSpec={challenge.materialSpec}
          intent="challenge"
          framing={challenge.framing}
          onPassed={onChallengePassed}
          onExit={() => navigate(basePath)}
          onUnavailable={() => setCompletionError('This PianoChallenge is not available right now. Try again later.')}
        />
      </section>
    );
  }

  return (
    <section className="piano-lesson-gate">
      {lesson?.thumbnail && (
        <img className="piano-lesson-gate__thumb" src={lesson.thumbnail} alt="" role="presentation" />
      )}
      <p className="piano-lesson-gate__eyebrow">Today&apos;s lesson</p>
      <p className="piano-lesson-gate__context">
        {course?.title}{unit?.title ? ` · ${unit.title}` : ''}
      </p>
      <h2 className="piano-lesson-gate__title">{lesson?.title}</h2>
      {lesson?.description && (
        <p className="piano-lesson-gate__description">{lesson.description}</p>
      )}
      <button type="button" className="piano-lesson-gate__start" onClick={onLaunch}>
        Start today&apos;s lesson
      </button>
    </section>
  );
}
