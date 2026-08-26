import Icon from '../home/icons/Icon.jsx';
import SafeImg from './panels/SafeImg.jsx';
import { SUBJECTS, subjectLabel } from '../home/subjects.js';
import { labelize } from './labelize.js';

export function SubjectIdentity({ subject, className = '', iconOnly = false }) {
  // `subject` is a stable shelf id.  It is never presentation copy: the
  // canonical shelf label owns punctuation and capitalization (e.g.
  // "English & Literature").  Keep the fallback for third-party catalogues
  // whose subject has not yet been promoted to a school shelf.
  const title = subject
    ? (SUBJECTS.some((s) => s.id === subject) ? subjectLabel(subject) : labelize(subject))
    : 'School';
  // `iconOnly` is for places where the shelf is carried by the mark alone and
  // the name would not fit — the roster's day dots.  The label is still in the
  // tree, visually hidden, so the icon is never a shape with no name for a
  // screen reader.
  return <span className={`teacher-subject-identity ${className}`.trim()}>
    <Icon name={subject ?? 'school'} className="teacher-subject-identity__icon" />
    <span className={iconOnly ? 'teacher-visually-hidden' : undefined}>{title}</span>
  </span>;
}

/** A curriculum reference is never only a title: it carries subject and course identity. */
export function LessonIdentity({
  subject, courseTitle, moduleTitle, lessonTitle, posterUrl, heading = false, compact = false,
}) {
  const Title = heading ? 'h2' : 'strong';
  const courseLabel = courseTitle ?? 'Course unavailable';
  return <div className={`teacher-lesson-identity${compact ? ' teacher-lesson-identity--compact' : ''}`}>
    <SubjectIdentity subject={subject} />
    {posterUrl && <SafeImg className="teacher-lesson-identity__poster" src={posterUrl} alt={`${courseLabel} cover`} fallback="" />}
    <div className="teacher-lesson-identity__copy">
      <Title>{lessonTitle ?? 'Lesson'}</Title>
      <span>{courseLabel}</span>
      {/* This is authored display copy, not an id.  `labelize` would quietly
          damage capitalization such as US or a proper unit name. */}
      {moduleTitle && <small>{moduleTitle}</small>}
    </div>
  </div>;
}
