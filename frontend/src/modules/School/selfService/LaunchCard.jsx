/**
 * ContextualLaunchCard — the identified, learner-facing surface opened by a
 * valid panel code. The keypad remains anonymous; this card confirms whose
 * work, where it sits, how far along it is, and the one useful next action.
 *
 * The domain owns wording and action semantics. This component owns geometry,
 * accessibility and the transient print-confirmation/outcome views.
 */
import { useEffect, useRef, useState } from 'react';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';

const PRINT_QUESTION = 'Did it print?';
const CONFIRM_YES = 'Yes';
const CONFIRM_NO = 'No';
const SYNTHESISED_EXIT = 'Close';

function CourseArtwork({ course, subject }) {
  const [failed, setFailed] = useState(false);
  const artworkCourseId = course?.artwork?.kind === 'course-poster'
    ? course.artwork.courseId : course?.id;
  useEffect(() => setFailed(false), [artworkCourseId]);
  const label = course?.title ?? subject?.label ?? 'School';
  if (!artworkCourseId || failed) {
    return (
      <div className="school-selfservice-card__poster-placeholder" aria-label={`${label} artwork`}>
        <span aria-hidden="true">✦</span>
      </div>
    );
  }
  return (
    <img
      className="school-selfservice-card__poster"
      src={`/api/v1/school/self-service/curriculum/${encodeURIComponent(artworkCourseId)}/poster.jpg`}
      alt={`${label} cover`}
      onError={() => setFailed(true)}
    />
  );
}

function ContextTrail({ trail }) {
  if (!trail?.length) return null;
  return (
    <nav className="school-selfservice-card__trail" aria-label="Lesson context">
      <ol>
        {trail.map((item, index) => (
          <li key={`${item.kind}-${item.id}`}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <span aria-current={index === trail.length - 1 ? 'page' : undefined}>{item.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ProgressRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="school-selfservice-card__progress" aria-label="Course progress">
      {rows.map((row) => {
        const total = Math.max(0, Number(row.total) || 0);
        const completed = Math.min(total, Math.max(0, Number(row.completed) || 0));
        const completePct = total ? completed / total * 100 : 0;
        const underwayPct = total && row.inProgress
          ? Math.min(100 - completePct, Number(row.inProgress) / total * 100)
          : 0;
        return (
          <div className="school-selfservice-card__progress-row" key={`${row.scope}-${row.label}`}>
            <div className="school-selfservice-card__progress-copy">
              <span>{row.label}</span>
              <span>{completed} of {total}</span>
            </div>
            <div
              className="school-selfservice-card__progress-track"
              role="progressbar"
              aria-label={`${row.label}: ${completed} of ${total}`}
              aria-valuemin="0"
              aria-valuemax={total}
              aria-valuenow={completed}
            >
              <span className="is-complete" style={{ width: `${completePct}%` }} />
              {underwayPct > 0 && (
                <span className="is-underway" style={{ left: `${completePct}%`, width: `${underwayPct}%` }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardAction({ action, onAction, onExit, busy, actionRef = null }) {
  const role = action.role ?? (action.kind === 'exit' ? 'secondary' : 'primary');
  return (
    <button
      type="button"
      ref={actionRef}
      className={`school-selfservice-card__action is-${role}`}
      data-kind={action.kind}
      data-testid={`selfservice-action-${action.kind}`}
      onClick={() => (action.kind === 'exit' ? onExit() : onAction(action))}
      disabled={busy}
    >
      {action.label}
    </button>
  );
}

/**
 * @param {object} props
 * @param {object} props.card - `/resolve` contextual card (v2, with v1 fallback).
 * @param {'card'|'confirm'|'sentence'} props.view
 */
export default function LaunchCard({
  card,
  view = 'card',
  sentence = null,
  busy = false,
  onAction,
  onConfirm,
  onExit,
}) {
  const actionFocusRef = useRef(null);
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  const hasExit = actions.some((action) => action.kind === 'exit');
  const context = card?.context ?? null;
  const taxonomy = context?.taxonomy ?? {};
  const learner = context?.learner ?? null;
  const learnerAvatarId = learner?.avatar?.kind === 'learner'
    ? learner.avatar.id : learner?.id;
  const subject = taxonomy.subject ?? (card?.subject ? { id: card.subject, label: card.subject } : null);
  const lessonTitle = taxonomy.lesson?.title ?? card?.title ?? 'Lesson';
  const message = card?.presentation?.message ?? card?.sentence ?? null;

  // Each state swap keeps the same contextual shell, but moves keyboard focus
  // to the first decision in the new state. This prevents focus from falling
  // back to the document body when the tapped button is replaced.
  useEffect(() => {
    actionFocusRef.current?.focus();
  }, [view]);

  return (
    <section
      className="school-selfservice-card"
      data-testid="selfservice-card"
      data-status={card?.presentation?.status ?? 'ready'}
    >
      <ContextTrail trail={context?.trail} />
      <div className="school-selfservice-card__shell">
        <aside className="school-selfservice-card__art">
          <CourseArtwork course={taxonomy.course} subject={subject} />
        </aside>

        <div className="school-selfservice-card__content">
          <header className="school-selfservice-card__head">
            {learner && (
              <div className="school-selfservice-card__learner">
                <ProfileAvatar id={learnerAvatarId} name={learner.displayName ?? 'Student'} size={192} />
                <span>{learner.displayName ?? 'Student'}</span>
              </div>
            )}
            {subject?.label && <p className="school-selfservice-card__subject">{subject.label}</p>}
            <h1 className="school-selfservice-card__title">{lessonTitle}</h1>
            {(taxonomy.course?.title || taxonomy.module?.title) && (
              <p className="school-selfservice-card__course-line">
                {[taxonomy.course?.title, taxonomy.module?.title].filter(Boolean).join(' · ')}
              </p>
            )}
          </header>

          <ProgressRows rows={context?.progress} />

          <div className="school-selfservice-card__interaction" aria-busy={busy}>
            {view === 'card' && (
              <>
                {message && <p className="school-selfservice-card__sentence" role="status">{message}</p>}
                <div className="school-selfservice-card__actions">
                  {actions.map((action, index) => (
                    <CardAction
                      key={`${action.kind}-${index}`}
                      action={action}
                      actionRef={index === 0 ? actionFocusRef : null}
                      onAction={onAction}
                      onExit={onExit}
                      busy={busy}
                    />
                  ))}
                  {!hasExit && (
                    <CardAction
                      action={{ kind: 'exit', label: SYNTHESISED_EXIT, role: 'secondary' }}
                      actionRef={actions.length === 0 ? actionFocusRef : null}
                      onAction={onAction}
                      onExit={onExit}
                      busy={busy}
                    />
                  )}
                </div>
              </>
            )}

            {view === 'confirm' && (
              <div className="school-selfservice-card__confirm">
                <p className="school-selfservice-card__sentence" role="status">{PRINT_QUESTION}</p>
                <div className="school-selfservice-card__actions">
                  <button
                    type="button"
                    ref={actionFocusRef}
                    className="school-selfservice-card__action is-primary"
                    data-testid="selfservice-print-ok"
                    onClick={() => onConfirm(true)}
                    disabled={busy}
                  >
                    {CONFIRM_YES}
                  </button>
                  <button
                    type="button"
                    className="school-selfservice-card__action is-secondary"
                    data-testid="selfservice-print-failed"
                    onClick={() => onConfirm(false)}
                    disabled={busy}
                  >
                    {CONFIRM_NO}
                  </button>
                </div>
              </div>
            )}

            {view === 'sentence' && (
              <div className="school-selfservice-card__outcome">
                <p className="school-selfservice-card__sentence" role="status">
                  {sentence || 'Something went wrong here. Tell a grown-up.'}
                </p>
                <div className="school-selfservice-card__actions is-single">
                  <button
                    type="button"
                    ref={actionFocusRef}
                    className="school-selfservice-card__action is-primary"
                    data-testid="selfservice-done"
                    onClick={onExit}
                    disabled={busy}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
