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
import Icon from '../home/icons/Icon.jsx';
import { hasIcon } from '../home/icons/iconRegistry.js';
import { sizedPlexImage, ART_BOX } from '../plexImage.js';
import { schoolLog } from '../schoolLog.js';

const PRINT_QUESTION = 'Did it print?';
const CONFIRM_YES = 'Yes';
/**
 * The subject's own mark leads the card header, exactly as it leads a tile on
 * the subject wall and a segment on the Today board — one icon vocabulary for
 * one taxonomy. `Icon` draws NOTHING for a name it does not have, which would
 * leave the header opening on a gap wide enough to read as a broken image, so
 * an unmapped subject falls back to the school's own apple.
 */
const SUBJECT_FALLBACK_ICON = 'apple';
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
 * The lesson's own still, under the course cover.
 *
 * A DIFFERENT KIND OF IMAGE FROM THE POSTER, and resolved differently. The
 * poster travels as a course identity (`{kind:'course-poster', courseId}`) the
 * panel has to turn into a URL; a lesson still travels as `{kind:
 * 'lesson-thumbnail', path}` — already a path on this origin, minted through
 * the house's Plex image proxy by the media adapter. So there is nothing to
 * resolve here beyond asking Plex for it at the size the column draws it.
 *
 * Most of School's work has no still at all (a worksheet, a quiz bank), and the
 * key is ABSENT rather than empty in that case: nothing renders, and the poster
 * simply stands alone as it always did.
 */
function LessonStill({ lesson }) {
  const [failed, setFailed] = useState(false);
  const path = lesson?.artwork?.kind === 'lesson-thumbnail' ? lesson.artwork.path : null;
  useEffect(() => setFailed(false), [path]);
  if (!path || failed) return null;
  return (
    <img
      className="school-selfservice-card__still"
      src={sizedPlexImage(path, ...ART_BOX.launchStill)}
      alt={`${lesson.title ?? 'Lesson'} still`}
      onError={() => {
        setFailed(true);
        schoolLog.selfService('lesson-still.unresolved', { lessonId: lesson?.id ?? null });
      }}
    />
  );
}

/**
 * THE CARD'S HEADER — where this lesson comes from, spanning the whole card.
 *
 * Subject icon, subject, chevron, course. Nothing else. It used to be a
 * four-crumb trail (subject › course › module › lesson) tucked into the right
 * column above the title, which meant the lesson was named twice a line apart
 * and the module — the one crumb a child uses to place themselves in a course —
 * was buried mid-chain at eyebrow scale. The module now leads the right column
 * on its own line and the lesson is the H1, so the header keeps only the two
 * crumbs that are context rather than content: the same icon + subject + course
 * a thermal receipt prints across its top.
 *
 * The trail is FILTERED, not sliced: a card built from a course with no module,
 * or a future card carrying a fifth crumb, must still yield exactly these two.
 */
function CardHeader({ trail, subject, course }) {
  const subjectCrumb = trail.find((item) => item.kind === 'subject')
    ?? (subject?.label ? { kind: 'subject', id: subject.id, label: subject.label } : null);
  const courseCrumb = trail.find((item) => item.kind === 'course')
    ?? (course?.title ? { kind: 'course', id: course.id, label: course.title } : null);
  const crumbs = [subjectCrumb, courseCrumb].filter(Boolean);
  if (!crumbs.length) return null;
  const iconName = hasIcon(subjectCrumb?.id) ? subjectCrumb.id : SUBJECT_FALLBACK_ICON;
  return (
    <nav className="school-selfservice-card__crumbs" aria-label="Lesson context">
      <Icon name={iconName} className="school-selfservice-card__crumbs-icon" />
      <ol>
        {crumbs.map((item, index) => (
          <li key={`${item.kind}-${item.id ?? index}`}>
            {index > 0 && <span aria-hidden="true">›</span>}
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * WHERE THE LEARNER STANDS, NOT HOW MUCH IS BEHIND THEM.
 *
 * `completed` and `position` are both on the wire and they DIFFER: you are on
 * unit 2 with only unit 1 finished. A row read as "1 of 18" is true and useless
 * — it answers a question nobody asked while the child is looking for the unit
 * they are in. So `position` is what the numbers say when it is there, and
 * `measures` names what is being counted, because "Unit 2 of 18" and "13 of 23"
 * are the same sentence about different things.
 *
 * Every one of `measures`, `position` and `current` is OPTIONAL — the
 * curriculum path (worksheets, quiz banks) emits none of them and keeps the
 * original `completed of total` reading, which is the honest one for a row that
 * cannot say where you are standing.
 */
function progressReading(row, { completed, total }) {
  const raw = Number(row.position);
  const position = Number.isFinite(raw) && raw > 0 ? Math.min(total || raw, Math.round(raw)) : null;
  if (position === null) return { text: `${completed} of ${total}`, position: null };
  if (row.measures === 'unit') return { text: `Unit ${position} of ${total}`, position };
  return { text: `${position} of ${total}`, position };
}

function ProgressRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="school-selfservice-card__progress" aria-label="Course progress">
      {rows.map((row) => {
        const total = Math.max(0, Number(row.total) || 0);
        const completed = Math.min(total, Math.max(0, Number(row.completed) || 0));
        const { text, position } = progressReading(row, { completed, total });
        const completePct = total ? completed / total * 100 : 0;
        // The item being WORKED, drawn as its own segment beyond the finished
        // ones: `position` names it directly, and the curriculum path's
        // `inProgress` (a 0-or-1 segment count) says the same thing without
        // being able to name which. Neither invents a third rail concept.
        const underway = position !== null
          ? Math.max(0, position - completed)
          : Math.max(0, Number(row.inProgress) || 0);
        const underwayPct = total ? Math.min(100 - completePct, underway / total * 100) : 0;
        return (
          <div
            className={`school-selfservice-card__progress-row${row.current === true ? ' is-current' : ''}`}
            data-current={row.current === true ? 'true' : undefined}
            key={`${row.scope}-${row.label}`}
          >
            <div className="school-selfservice-card__progress-copy">
              <span>{row.label}</span>
              <span>{text}</span>
            </div>
            <div
              className="school-selfservice-card__progress-track"
              role="progressbar"
              aria-label={`${row.label}: ${text}`}
              aria-valuemin="0"
              aria-valuemax={total}
              // `valuenow` stays the count genuinely FINISHED — that is what a
              // progressbar's value means — while `valuetext` carries the
              // sentence the sighted reading gives, so the two never disagree
              // about which number is which.
              aria-valuenow={completed}
              aria-valuetext={text}
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

/**
 * WHAT THE BUTTON SHOWS, AND WHAT IT ANNOUNCES.
 *
 * Every action gets a mark. A row of two same-shaped word-buttons is read
 * left-to-right at arm's length; an icon is read before the words are, which is
 * the difference between a child finding the green one and a child reading both.
 *
 * The icon is keyed by the action's KIND — its identity on the wire, the same
 * field `/act` routes on — so a new kind is a one-line addition and an unknown
 * one still draws something rather than nothing.
 */
const ACTION_ICONS = Object.freeze({
  print: 'print',
  play: 'play',
  screen: 'kind-app',
  program: 'kind-app',
  companion: 'kind-audio',
  launch: 'forward',
  retry: 'restart',
  exit: 'back',
});
const ACTION_ICON_FALLBACK = 'forward';

/**
 * A PROGRAM NAMES ITS ROOM, NOT ITSELF.
 *
 * The domain labels a program action "Open <course title>" — which, under an H1
 * already reading the lesson name and beside a poster already reading the
 * course name, is the third time the child is told where they are and the first
 * time they are told nothing about what to do. Where the house knows the
 * program, the button says the thing the child physically does instead.
 *
 * Keyed by `target` (the programId), NOT by the label: labels are wording and
 * move; the programId is the launcher's stable `id`. A program with no entry
 * here keeps the domain's own label and the generic kind icon — a wrong verb
 * invented for an unknown program would be worse than a plain one.
 */
const PROGRAM_CTA = Object.freeze({
  'piano-course': { icon: 'piano', label: 'Learn at the piano' },
  'sentence-ladder': { icon: 'language', label: 'Practice sentences' },
  'language-reels': { icon: 'kind-video', label: 'Watch and listen' },
  'rubiks-cube': { icon: 'skills', label: 'Solve the cube' },
});

function actionPresentation(action) {
  const program = action.kind === 'program' ? PROGRAM_CTA[action.target] : null;
  return {
    label: program?.label ?? action.label,
    icon: program?.icon ?? ACTION_ICONS[action.kind] ?? ACTION_ICON_FALLBACK,
  };
}

function CardAction({ action, onAction, onExit, busy, inert = false, actionRef = null, subtitle = null }) {
  const role = action.role ?? (action.kind === 'exit' ? 'secondary' : 'primary');
  const { label, icon } = actionPresentation(action);
  // A short label is right on the glass — the lesson name is six inches above
  // it in display type — and wrong in the ear: tabbing to this button is the
  // whole context a screen-reader user gets, and "Learn at the piano" alone
  // never says which lesson opens. The visible words lead the accessible name
  // so the two still match for anyone driving this by voice.
  const named = subtitle && action.kind !== 'exit' && subtitle !== label
    ? `${label}: ${subtitle}` : null;
  return (
    <button
      type="button"
      ref={actionRef}
      className={`school-selfservice-card__action is-${role}`}
      data-kind={action.kind}
      data-testid={`selfservice-action-${action.kind}`}
      aria-label={named ?? undefined}
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
      <Icon name={icon} className="school-selfservice-card__action-icon" />
      <span className="school-selfservice-card__action-label">{label}</span>
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
        <strong>Teacher preview</strong>
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
  const lesson = taxonomy.lesson ?? null;
  const lessonTitle = lesson?.title ?? card?.title ?? 'Lesson';
  // Both optional, and ABSENT rather than empty when a lesson has neither — a
  // worksheet and a quiz bank never carry either, so this is the common case
  // and not a degraded one.
  const unitLabel = taxonomy.module?.title ?? null;
  const description = typeof lesson?.description === 'string' ? lesson.description : null;
  // Rendered as line elements, never as markup: the backend normalises the
  // breaks and caps the length, and a Plex synopsis is still somebody else's
  // text arriving on a kiosk.
  const descriptionLines = description
    ? description.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  const message = card?.presentation?.message ?? card?.sentence ?? null;

  // Each state swap keeps the same contextual shell, but moves keyboard focus
  // to the first decision in the new state. This prevents focus from falling
  // back to the document body when the tapped button is replaced.
  useEffect(() => {
    actionFocusRef.current?.focus();
  }, [view]);

  return (
    <section
      className={`school-selfservice-card${card?.bulk ? ' school-selfservice-card--bulk' : ''}`}
      data-testid="selfservice-card"
      data-status={card?.presentation?.status ?? 'ready'}
      data-preview={isPreview ? 'true' : undefined}
    >
      {isPreview && <PreviewBanner card={card} onExit={onExit} />}
      <div className="school-selfservice-card__shell">
        {/* ACROSS THE TOP, over the poster as well as the copy. Where this
            lesson comes from is one fact about the whole card, so it is drawn
            as one line spanning it, not as an eyebrow inside one column. */}
        <CardHeader trail={trail} subject={subject} course={taxonomy.course} />

        <aside className="school-selfservice-card__art">
          <CourseArtwork course={taxonomy.course} subject={subject} />
          <LessonStill lesson={lesson} />
        </aside>

        <div className="school-selfservice-card__content">
          <header className="school-selfservice-card__head">
            {learner && (
              <div className="school-selfservice-card__learner">
                <ProfileAvatar id={learnerAvatarId} name={learner.displayName ?? 'Student'} size={192} />
                <span>{learner.displayName ?? 'Student'}</span>
              </div>
            )}
            {/* The unit, on its own line and directly above the title it
                contains. It used to be the third crumb of a four-crumb trail,
                which is where a child looking for "which unit am I in" was
                least likely to find it. */}
            {unitLabel && <p className="school-selfservice-card__unit">{unitLabel}</p>}
            <h1 className="school-selfservice-card__title">{lessonTitle}</h1>
            {descriptionLines.length > 0 && (
              <div className="school-selfservice-card__description" data-testid="selfservice-lesson-description">
                {descriptionLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            )}
          </header>

          <ProgressRows rows={context?.progress} />

          <div className="school-selfservice-card__interaction" aria-busy={busy}>
            {view === 'card' && (
              <>
                {/* Bulk card: one line per printable subject. When `items` is
                    empty (nothing left to print today) there is nothing to
                    list — the all-done `message` below and the backend's
                    exit-only `actions` carry the whole message. */}
                {card?.bulk && card.items?.length > 0 && (
                  <ul className="school-selfservice-card__items" data-testid="selfservice-bulk-items">
                    {card.items.map((item, index) => (
                      <li key={`${item.subject}-${index}`} className="school-selfservice-card__item">
                        <span className="school-selfservice-card__item-subject">{item.subject}</span>
                        <span className="school-selfservice-card__item-title">{item.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
                      subtitle={lesson?.title ?? null}
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
