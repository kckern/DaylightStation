import { useId } from 'react';
import { createAppLogger } from '#frontend/lib/ui/createAppLogger.js';
import { SchoolButton } from './SchoolButton.jsx';
import { useSchoolSurface } from './SchoolSurface.jsx';
import './SchoolPortal.scss';

const log = createAppLogger('school').child('activity-frame');
const layouts = new Set(['workspace', 'focus', 'split', 'media', 'board']);

/** Pedagogy-independent slots, sized by the containing School surface. */
export function SchoolActivityFrame({ layout = 'workspace', title, identity, progress, onBack, onDone, actions, feedback, children, className = '' }) {
  const titleId = useId();
  const { surfaceId, deviceId } = useSchoolSurface();
  const effectiveLayout = layouts.has(layout) ? layout : 'workspace';
  const terminal = (action, callback) => event => {
    log.info(`school.activity.${action}`, { surfaceId, deviceId, layout: effectiveLayout });
    callback(event);
  };
  return <section className={`school-activity school-activity--${effectiveLayout} ${className}`.trim()} data-layout={effectiveLayout} aria-labelledby={title ? titleId : undefined}>
    {(title || identity != null || onBack || onDone) && <header className="school-activity__header">
      {onBack && <SchoolButton variant="plain" onClick={terminal('back', onBack)}>Back</SchoolButton>}
      {title && <h1 id={titleId} className="school-activity__title">{title}</h1>}
      {identity != null && <div className="school-activity__identity">{identity}</div>}
      {onDone && <SchoolButton variant="secondary" onClick={terminal('done', onDone)}>Done</SchoolButton>}
    </header>}
    {progress != null && <div className="school-activity__progress">{progress}</div>}
    <div className="school-activity__content">{children}</div>
    {feedback != null && <div className="school-activity__feedback" role="status">{feedback}</div>}
    {actions != null && <footer className="school-activity__actions">{actions}</footer>}
  </section>;
}
export default SchoolActivityFrame;
