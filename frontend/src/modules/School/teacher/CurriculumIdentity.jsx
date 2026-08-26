import Icon from '../home/icons/Icon.jsx';
import SafeImg from './panels/SafeImg.jsx';
import { SUBJECTS, subjectLabel } from '../home/subjects.js';
import { labelize } from './labelize.js';

export function SubjectIdentity({ subject, className = '' }) {
  // `subject` is a stable shelf id.  It is never presentation copy: the
  // canonical shelf label owns punctuation and capitalization (e.g.
  // "English & Literature").  Keep the fallback for third-party catalogues
  // whose subject has not yet been promoted to a school shelf.
  const title = subject
    ? (SUBJECTS.some((s) => s.id === subject) ? subjectLabel(subject) : labelize(subject))
    : 'School';
  return <span className={`teacher-subject-identity ${className}`.trim()}>
    <Icon name={subject ?? 'school'} className="teacher-subject-identity__icon" />
    <span>{title}</span>
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
