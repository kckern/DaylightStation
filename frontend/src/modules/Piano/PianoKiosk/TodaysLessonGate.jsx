import { useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
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
export default function TodaysLessonGate({ lesson, unit, course, basePath, navigate }) {
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
