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
import { sizedPlexImage, ART_BOX } from '../plexImage.js';
import { schoolLog } from '../schoolLog.js';

const PRINT_QUESTION = 'Did it print?';
const CONFIRM_YES = 'Yes';
/**
 * Said under the question while the clock runs. The screen moving on by itself
 * is only reassuring if the child was told it would — otherwise it reads as
 * the panel losing their work.
 */
const PRINT_AUTO_HINT = 'This closes by itself.';
const CONFIRM_NO = 'No';
const SYNTHESISED_EXIT = 'Close';

/**
 * WHERE A COURSE'S ARTWORK ACTUALLY LIVES.
 *
 * A course id is either a curriculum shelf id (`fractions`) whose `poster.jpg`
 * ships inside the published package, or a `plex:<ratingKey>` id for a course
 * whose cover only ever existed in Plex — the piano course being the one a
 * child meets daily. The curriculum route can only serve the first kind, so a
 * `plex:` id asked of it returns nothing.
 *
 * That nothing used to be answered with a generated hue-gradient bearing the
 * raw course id, at HTTP 200, which is how a child came to be shown an invented
 * poster in place of Hoffman Academy. Both halves of that are fixed: the route
 * 404s instead of fabricating (see school.selfservice.mjs), and a `plex:` id is
 * resolved HERE, against the same image proxy every other surface in the house
 * already draws Plex artwork through — `MaterialGrid` next door, `VideoPlayer`
 * for its title cards. `sizedPlexImage` then asks Plex for it at the size the
 * card actually draws it, exactly as the materials grid does.
 */
const PLEX_ID = /^plex:(\d+)$/;

function posterSrc(courseId) {
  const plex = PLEX_ID.exec(String(courseId));
  if (plex) {
    return sizedPlexImage(`/api/v1/proxy/plex/library/metadata/${plex[1]}/thumb`, ...ART_BOX.launchPoster);
  }
  return `/api/v1/school/self-service/curriculum/${encodeURIComponent(courseId)}/poster.jpg`;
}

function CourseArtwork({ course, subject }) {
  const [failed, setFailed] = useState(false);
  const artworkCourseId = course?.artwork?.kind === 'course-poster'
    ? course.artwork.courseId : course?.id;
  useEffect(() => setFailed(false), [artworkCourseId]);
  const label = course?.title ?? subject?.label ?? 'School';
  // A blank, calm placeholder — never an invented one. The mark is decorative
  // and the label carries the meaning, so a course with no cover reads as a
  // course with no cover.
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
      src={posterSrc(artworkCourseId)}
      alt={`${label} cover`}
      // Worth a line in the log store: artwork silently going missing on the
      // panel is precisely what nobody could see before, and a course that
      // never resolves a cover is a content or wiring fault, not a child's.
      onError={() => {
        setFailed(true);
        schoolLog.selfService('poster.unresolved', { courseId: artworkCourseId });
      }}
    />
  );
}

/**
 * Where this lesson sits: subject › course › module › lesson.
 *
 * CONTEXT, NOT CONTENT. It sits above the title as an eyebrow and is set small,
 * quiet and left-aligned against it — a child reading the card at arm's length
 * should land on the lesson name, then be able to look up and see where it came
 * from. It used to be centred above the card while everything else was
 * left-aligned, at nearly the weight of the heading, so it read as a second
 * headline competing with the first.
 *
 * It is also the ONLY place the course and module are named. A separate
 * "course · module" line under the title said the same words a second time,
 * and a subject eyebrow said the first crumb a third; both are gone.
 */
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

function CardAction({ action, onAction, onExit, busy, inert = false, actionRef = null }) {
  const role = action.role ?? (action.kind === 'exit' ? 'secondary' : 'primary');
  return (
    <button
      type="button"
      ref={actionRef}
      className={`school-selfservice-card__action is-${role}`}
      data-kind={action.kind}
      data-testid={`selfservice-action-${action.kind}`}
      // Belt AND braces. `disabled` is what a grown-up sees and what stops a
      // tap; the guard is what stops a synthetic click, a stray Enter on a
      // focused button, or a future prop that forgets to pass `disabled`
      // through. Neither alone is worth a printer waking up on a preview.
      onClick={() => {
        if (inert) return;
        return action.kind === 'exit' ? onExit() : onAction(action);
      }}
      disabled={busy || inert}
      aria-disabled={inert || undefined}
    >
      {action.label}
    </button>
  );
}

/**
 * The preview band.
 *
 * A grown-up may open this card on the Portal itself — the same 1280×800 glass
 * a child stands in front of all day — so "this is not live" has to be
 * unmissable at a glance and from across the room, not a subtitle. It sits
 * ABOVE the card rather than inside it, in the chrome, because it is not part
 * of what the child would have seen.
 *
 * It also carries the ONLY live control on the screen. Every button inside the
 * card is disabled, including the card's own exit, so the way out has to live
 * somewhere that is unambiguously not the card.
 */
function PreviewBanner({ card, onExit }) {
  const learner = card?.context?.learner?.displayName ?? card?.learner ?? null;
  const subject = card?.context?.taxonomy?.subject?.label ?? card?.subject ?? null;
  const scope = [learner, subject].filter(Boolean).join(' · ');
  return (
    <div className="school-selfservice-card__preview" data-testid="selfservice-preview-banner">
      <div className="school-selfservice-card__preview-copy">
        <strong>Preview</strong>
        <span>Nothing here is live — no work opens, nothing prints.</span>
        {scope && <span className="school-selfservice-card__preview-scope">{scope}</span>}
      </div>
      <button
        type="button"
        className="school-selfservice-card__preview-leave"
        data-testid="selfservice-preview-leave"
        onClick={onExit}
      >
        Leave preview
      </button>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.card - `/resolve` contextual card (v2, with v1 fallback).
 * @param {'card'|'confirm'|'sentence'} props.view
 * @param {number|null} [props.confirmRemainingMs] - ms left in the "Did it
 *   print?" window, or `null` when there is no clock (a deployment that
 *   disabled it, or any view other than the confirm). `useSelfService` owns
 *   the countdown and the resolution; this component only draws it.
 * @param {number|null} [props.confirmTotalMs] - the full window, so the fill
 *   is a FRACTION rather than this component owning a duration of its own —
 *   two places believing different things about how long a child has is
 *   exactly the drift worth designing out.
 * @param {boolean} [props.preview] - a grown-up is looking at this card from a
 *   deep link rather than a child having typed a code. The card is drawn
 *   exactly as the panel would draw it — that is the point — but every action
 *   on it is disabled, and a band above it says so. The card itself also
 *   arrives marked (`card.preview`), so either source turns the mode on and a
 *   caller cannot accidentally render a preview card live.
 */
export default function LaunchCard({
  card,
  view = 'card',
  sentence = null,
  busy = false,
  preview = false,
  confirmRemainingMs = null,
  confirmTotalMs = null,
  onAction,
  onConfirm,
  onExit,
}) {
  const isPreview = preview === true || card?.preview === true;
  const actionFocusRef = useRef(null);
  // 0 → 1 as the window runs out; `null` when there is nothing to draw. A
  // total of 0 (or missing) yields null rather than a division by zero.
  const confirmElapsed = (view === 'confirm' && confirmRemainingMs !== null && confirmTotalMs > 0)
    ? Math.min(1, Math.max(0, 1 - confirmRemainingMs / confirmTotalMs))
    : null;
  const actions = Array.isArray(card?.actions) ? card.actions : [];
  const hasExit = actions.some((action) => action.kind === 'exit');
  const context = card?.context ?? null;
  const taxonomy = context?.taxonomy ?? {};
  const learner = context?.learner ?? null;
  const learnerAvatarId = learner?.avatar?.kind === 'learner'
    ? learner.avatar.id : learner?.id;
  const trail = Array.isArray(context?.trail) ? context.trail : [];
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
      data-preview={isPreview ? 'true' : undefined}
    >
      {isPreview && <PreviewBanner card={card} onExit={onExit} />}
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
            <ContextTrail trail={trail} />
            {/* The trail already opens with the subject. This line is the
                degraded path's stand-in for it — a v1 card carries a subject
                but no taxonomy to build a trail from — so the two are
                alternatives, never both. */}
            {!trail.length && subject?.label && (
              <p className="school-selfservice-card__subject">{subject.label}</p>
            )}
            <h1 className="school-selfservice-card__title">{lessonTitle}</h1>
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
                      // In a preview EVERY action is dead, the card's own exit
                      // included: the way out is the band above, which is
                      // unambiguously not part of what a child would see.
                      inert={isPreview || action.inert === true}
                    />
                  ))}
                  {/* A preview never synthesises an exit — the band carries it,
                      and a second "Close" inside the card would be the one
                      live-looking button on a dead card. */}
                  {!hasExit && !isPreview && (
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
                    data-countdown={confirmElapsed === null ? undefined : 'running'}
                    onClick={() => onConfirm(true)}
                    disabled={busy}
                  >
                    {/*
                      The clock, drawn INSIDE the Yes button rather than beside
                      it: the thing filling up is the thing that will happen,
                      which is the whole message. Purely decorative — the
                      button's own label is what a screen reader announces, and
                      `useSelfService` owns the actual resolution, so a fill
                      that fails to paint (a WebView that drops the transform)
                      changes nothing about when the panel moves on.
                    */}
                    {confirmElapsed !== null && (
                      <span
                        className="school-selfservice-card__action-fill"
                        style={{ transform: `scaleX(${confirmElapsed})` }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="school-selfservice-card__action-label">{CONFIRM_YES}</span>
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
                {confirmElapsed !== null && (
                  <p className="school-selfservice-card__confirm-hint">{PRINT_AUTO_HINT}</p>
                )}
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
