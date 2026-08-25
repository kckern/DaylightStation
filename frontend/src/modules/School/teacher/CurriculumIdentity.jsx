import Icon from '../home/icons/Icon.jsx';
import { labelize } from './labelize.js';

export function SubjectIdentity({ subject, className = '' }) {
  const title = labelize(subject ?? 'school');
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
    {posterUrl && <img className="teacher-lesson-identity__poster" src={posterUrl} alt={`${courseLabel} cover`} />}
    <div className="teacher-lesson-identity__copy">
      <Title>{lessonTitle ?? 'Lesson'}</Title>
      <span>{courseLabel}</span>
      {moduleTitle && <small>{labelize(moduleTitle)}</small>}
    </div>
  </div>;
}
