/**
 * ReadingSessionScreen — the `school-reading` widget on the living-room TV.
 *
 * Authority on behaviour: `docs/reference/school/reading-sessions.md`.
 * The state lives in `useReadingSession`; this file is what a four-year-old
 * who cannot read sees, plus the one piece of plumbing the hook must not own —
 * mounting the Player.
 *
 * IT RENDERS NOTHING UNLESS A CHILD IS STANDING THERE. `idle` returns null, so
 * the living-room screen's own menu and screensaver are untouched by this
 * widget existing. And `playing` returns null too: once the story is up, the
 * Player owns the screen and the widget's job is to be out of the way.
 *
 * A READING SESSION NEVER SEIZES THE TV (invariant 6). Nothing here mounts a
 * player on its own initiative — only a pick that the child made and then did
 * not change their mind about for the length of the countdown. Content that was
 * already playing is refused by the backend before it ever reaches this screen.
 *
 * THE PLAYER IS MOUNTED HERE, NOT IN THE HOOK, because it needs the screen
 * framework's overlay slot — the same one `ScreenActionHandler` uses for a book
 * tapped with no session open. Three things come back off it:
 *   `onMediaRef` → the media element, whose `playing` and `timeupdate` events
 *                  witness playback starting and sampled progress;
 *   `onPlaybackCompleted` → Player's semantic natural-end notification, the
 *                  only honest witness to playback finishing;
 *   `clear`      → the Player is done for ANY reason, which is not the same as
 *                  the story having finished, and must never be read as one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Player from '../../Player/Player.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { useScreenOverlay } from '../../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import { playScanCeremonyTone } from '../selfService/scanCeremonySound.js';
import { useReadingSession, DEFAULT_CONFIRM_MS } from './useReadingSession.js';
import { readingLog } from './readingLog.js';
import { bookCover } from './bookCovers.js';
import './ReadingSessionScreen.scss';

/**
 * The audible half of each acknowledgement, on the same synthesized oscillator
 * the scan ceremony uses (no asset to fail to fetch, routed through the screen
 * framework's software volume master). It NEVER throws and it is never the only
 * acknowledgement — everything it says is also on the screen.
 *
 * UNVERIFIED ON THIS DEVICE. Book taps already start audible playback on this TV
 * with no user gesture, so there is no autoplay gate for the CONTENT — but
 * whether a short programmatic tone behaves like the Player's media element on
 * this WebView is a separate claim, and it has not been checked on the hardware.
 * `playScanCeremonyTone` logs its own failure, so the log store will answer it.
 */
function cueTone(tone) {
  playScanCeremonyTone(tone);
}

function recentDayLabel(studyDay, currentStudyDay) {
  if (!studyDay) return '';
  if (studyDay === currentStudyDay) return 'Today';
  const current = Date.parse(`${currentStudyDay}T00:00:00Z`);
  const day = Date.parse(`${studyDay}T00:00:00Z`);
  if (Number.isFinite(current) && current - day === 86_400_000) return 'Yesterday';
  if (!Number.isFinite(day)) return studyDay;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(day));
}

/**
 * One book on the Recent shelf: its cover, its title, and when it was read.
 *
 * The cover is the point. A child who cannot read picks a book off a shelf by
 * its picture, and this row of text-only titles was asking them to do the one
 * thing they cannot do — while the household already had every cover on file.
 *
 * The cover arrives asynchronously and the card must not move when it does, so
 * the frame holds a fixed book-shaped box from the first paint and the spine
 * placeholder occupies it until the image lands. A shelf that reflows under a
 * child's finger is worse than one that is briefly plain.
 */
function RecentBook({ read, studyDay }) {
  const [cover, setCover] = useState(null);
  const contentId = read?.contentId ?? null;

  useEffect(() => {
    if (!contentId) return undefined;
    let live = true;
    bookCover(contentId).then((url) => { if (live && url) setCover(url); });
    return () => { live = false; };
  }, [contentId]);

  return (
    <li className="reading-session__recent-card" data-testid="reading-recent-card">
      <div className="reading-session__recent-cover">
        {cover
          ? <img src={cover} alt="" loading="lazy" />
          /* No alt text and aria-hidden: the title below already names the
             book, so an alt here would make a screen reader say it twice. */
          : <div className="reading-session__recent-spine" aria-hidden="true" />}
      </div>
      <span className="reading-session__recent-title">{read.title}</span>
      <span className="reading-session__recent-day">
        {recentDayLabel(read.studyDay, studyDay)}
        {/* The repeats the shelf deduped away, given back as a fact. A book read
            once says nothing extra — only a favourite earns the badge. */}
        {read.times > 1
          ? <span className="reading-session__recent-times">{`×${read.times}`}</span>
          : null}
      </span>
    </li>
  );
}

/**
 * The obligation, as something you can COUNT rather than read.
 *
 * "1 of 2 stories" is a sentence, and the child it is aimed at cannot read a
 * sentence. One pip per story owed, filled as each is finished, says the same
 * thing in the one notation a four-year-old already has — and says it from
 * across a room, which the text never did either.
 *
 * The label survives as the accessible name, so a screen reader and a passing
 * adult still get the words; it is simply no longer the thing on screen.
 *
 * Falls back to the plain label whenever the numbers cannot carry it: an
 * unreadable obligation (`target` null), or a target so large that pips would
 * become a smear of dots nobody can count at a glance.
 */
const MAX_PIPS = 8;

function Progress({ count, target, label }) {
  const owed = Number.isFinite(target) ? target : null;
  const done = Number.isFinite(count) ? count : 0;
  if (owed === null || owed < 1 || owed > MAX_PIPS) {
    return label ? <p className="reading-session__count" data-testid="reading-count">{label}</p> : null;
  }
  return (
    <div
      className="reading-session__pips"
      data-testid="reading-count"
      role="img"
      aria-label={label || `${done} of ${owed} stories`}
    >
      {Array.from({ length: owed }, (_, i) => (
        <span
          key={i}
          className={`reading-session__pip${i < done ? ' reading-session__pip--done' : ''}`}
        />
      ))}
      {/* Past the target is worth seeing: a child who read a third story on a
          two-story day has done something, and a row of full pips hides it. */}
      {done > owed ? <span className="reading-session__pip-extra">{`+${done - owed}`}</span> : null}
    </div>
  );
}

function Recent({ reads, studyDay }) {
  if (!Array.isArray(reads) || reads.length === 0) return null;
  const named = reads.filter((r) => r?.title);
  if (named.length === 0) return null;
  return (
    <section className="reading-session__recent" data-testid="reading-recent" aria-label="Recent stories">
      <h3 className="reading-session__recent-label">Recent</h3>
      <ul className="reading-session__recent-list" data-count={named.length}>
        {named.map((read, index) => (
          <RecentBook
            key={`${read.pickId ?? read.contentId ?? 'book'}-${read.at ?? index}`}
            read={read}
            studyDay={studyDay}
          />
        ))}
      </ul>
    </section>
  );
}

function Notice({ notice }) {
  if (!notice) return null;
  return (
    <div className={`reading-session__notice reading-session__notice--${notice.tone}`} role="status" data-testid="reading-notice">
      <strong>{notice.title}</strong>
      {notice.detail ? <span>{notice.detail}</span> : null}
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} [props.location] - the reader whose topic this screen listens
 *   to. Comes off the screen's own widget config (`living-room.yml`).
 * @param {number} [props.confirmMs] - the change-your-mind window.
 */
export function ReadingSessionScreen({ location = 'livingroom', confirmMs = DEFAULT_CONFIRM_MS } = {}) {
  const { showOverlay, dismissOverlay, hasOverlay } = useScreenOverlay();
  // The hook needs `onPlay`; `onPlay` needs the hook's callbacks. A ref breaks
  // the cycle without making either of them re-created on every render.
  const handlers = useRef({});
  const mediaRef = useRef(null);
  // STABLE identities, delegating to whatever `handlers` holds this render.
  // Listeners rebuilt per render could never be removed again — the element
  // outlives several renders, and `removeEventListener` matches by reference.
  const listeners = useRef({
    playing: () => handlers.current.notePlaybackStarted?.(),
    timeupdate: (event) => handlers.current.notePlaybackProgress?.(event.currentTarget),
  });

  // LOGGED because these listeners witness playback starting and sampled
  // progress. Completion no longer depends on their attachment: Player owns
  // natural-end semantics and calls the callback below before advance/clear.
  // `reason` distinguishes an ordinary swap from a teardown.
  const detachMedia = useCallback((reason = 'swap') => {
    const el = mediaRef.current;
    if (!el) return;
    el.removeEventListener('playing', listeners.current.playing);
    el.removeEventListener('timeupdate', listeners.current.timeupdate);
    mediaRef.current = null;
    readingLog.playback('media-detached', { reason });
  }, []);

  const attachMedia = useCallback((el) => {
    if (!el || el === mediaRef.current) return;
    detachMedia();
    mediaRef.current = el;
    el.addEventListener('playing', listeners.current.playing);
    el.addEventListener('timeupdate', listeners.current.timeupdate);
    readingLog.playback('media-attached', { tag: el.tagName?.toLowerCase?.() ?? null });
  }, [detachMedia]);

  const onPlay = useCallback((committed) => {
    // Dismiss first, and claim `high` priority: `showOverlay` REFUSES to
    // replace a mounted fullscreen overlay at default priority, so a lingering
    // art screensaver would otherwise swallow the book the child just picked —
    // the same order `ScreenActionHandler.handleMediaPlay` uses for a book
    // tapped with no session open.
    dismissOverlay();
    showOverlay(Player, {
      play: { contentId: committed.contentId },
      onMediaRef: attachMedia,
      onPlaybackCompleted: () => handlers.current.notePlaybackCompleted?.(),
      clear: () => {
        // The Player is done for SOME reason — end of content, a load failure,
        // a bail, a queue running out. Logged on arrival because `clear` and
        // Player's semantic completion callback are the two terminal signals, and
        // on 2026-08-28 NEITHER of them fired: without a line here there is no
        // way to tell "clear never came" from "clear came and did nothing".
        // NOT named `ended` — an earlier version was, and it measured the wrong
        // thing entirely: nothing detaches the media before `clear` on a normal
        // completed story, so it read `false` after a full playthrough and would
        // have pointed the next investigation away from the truth. This says
        // only what it can see — whether the element was already let go.
        readingLog.playback('player-cleared', { mediaAlreadyDetached: mediaRef.current === null });
        detachMedia('player-cleared');
        dismissOverlay();
        handlers.current.notePlaybackDismissed?.();
      },
    }, { chrome: 'media', priority: 'high' });
  }, [attachMedia, detachMedia, dismissOverlay, showOverlay]);

  const session = useReadingSession({
    location, confirmMs, onPlay, onCue: cueTone,
    presentationObscured: hasOverlay,
  });

  // Rebound every render so the media listeners and Player completion callback
  // always call the freshest closures.
  handlers.current.notePlaybackDismissed = session.notePlaybackDismissed;
  handlers.current.notePlaybackStarted = session.notePlaybackStarted;
  handlers.current.notePlaybackCompleted = session.notePlaybackCompleted;
  handlers.current.notePlaybackProgress = session.notePlaybackProgress;

  // Named, so an unmount mid-story is distinguishable in the log store from an
  // ordinary element swap. A widget that unmounts while a story is playing has
  // silently thrown away the completion, and that is worth being able to see.
  useEffect(() => () => detachMedia('unmount'), [detachMedia]);

  // The living-room screen runs the ArtMode screensaver with `showOnLoad`, and
  // a screensaver is a FULLSCREEN OVERLAY — it suppresses itself for active
  // content and for a mounted overlay, and a reading session is neither. This
  // widget renders into the layout underneath it, so without this the child
  // taps their card and keeps looking at a framed painting.
  //
  // Once, on the way OUT of `idle`. Not per event: the overlay slot is shared,
  // and a widget that dismissed on every payload would fight anything a later
  // screen legitimately mounts mid-session.
  const wasIdle = useRef(true);
  useEffect(() => {
    if (session.view !== 'idle' && wasIdle.current) {
      dismissOverlay();
      readingLog.screen('screensaver-cleared', { view: session.view });
    }
    wasIdle.current = session.view === 'idle';
  }, [session.view, dismissOverlay]);

  // The reading widget deliberately renders nothing while Player owns the
  // screen, so an inline refusal would be invisible in the exact mid-story
  // case it exists for. Toast mode stacks above Player without replacing or
  // pausing it; `hasOverlay` intentionally excludes toasts.
  useEffect(() => {
    if (session.view !== 'playing' || !session.notice) return;
    showOverlay(Notice, { notice: session.notice }, { mode: 'toast', timeout: 7000 });
  }, [session.notice, session.view, showOverlay]);

  const { view, learner, summary, pick, notice, confirmRemainingMs, confirmTotalMs } = session;

  // The whole screen belongs to the menu when nobody is standing at the reader,
  // and to the Player once a story is up.
  //
  // ONE EXCEPTION, AND IT IS THE POINT OF D2: a card REFUSED because unrelated
  // content is playing opens no session, so `view` never leaves `idle` — and
  // without this branch the child would tap, be refused, and see nothing at
  // all. The notice renders alone, over whatever is playing, and takes itself
  // away again; nothing else about the screen moves, because the whole promise
  // of the refusal is that the movie keeps playing.
  if (view === 'idle') {
    if (!notice) return null;
    return (
      <div className="reading-session reading-session--idle" data-testid="reading-session" data-view="idle">
        <Notice notice={notice} />
      </div>
    );
  }
  if (view === 'playing') return null;

  const name = learner?.name || null;
  const elapsed = (confirmRemainingMs !== null && confirmTotalMs > 0)
    ? Math.min(1, Math.max(0, 1 - confirmRemainingMs / confirmTotalMs))
    : 0;

  return (
    <div className={`reading-session reading-session--${view}`} data-testid="reading-session" data-view={view}>
      <Notice notice={notice} />

      {view === 'picking' && pick ? (
        <div className="reading-session__pick" data-testid="reading-pick">
          <div className="reading-session__cover">
            {pick.image
              ? <img src={pick.image} alt={pick.title || 'The book you picked'} />
              : <div className="reading-session__cover-blank" aria-hidden="true" />}
          </div>
          <h1 className="reading-session__title">{pick.title || 'Getting your book…'}</h1>
          <div
            className="reading-session__countdown"
            data-testid="reading-countdown"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(elapsed * 100)}
          >
            <div className="reading-session__countdown-fill" style={{ transform: `scaleX(${1 - elapsed})` }} />
          </div>
          <p className="reading-session__hint">Tap another book to change your mind</p>
        </div>
      ) : null}

      {view === 'open' ? (
        <div className="reading-session__prompt" data-testid="reading-prompt">
          <div className="reading-session__who">
            <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
            {name ? <h2 className="reading-session__name">{name}</h2> : null}
          </div>
          <h1 className="reading-session__ask">What do you want to read today?</h1>
          <Progress count={summary?.count} target={summary?.target} label={summary?.progressLabel} />
          <Recent reads={summary?.recent} studyDay={summary?.studyDay} />
        </div>
      ) : null}

      {view === 'celebrating' ? (
        <div className="reading-session__celebrate" data-testid="reading-celebrate">
          <div className="reading-session__who">
            <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
          </div>
          <h1 className="reading-session__ask">Great reading{name ? `, ${name}` : ''}!</h1>
          {summary?.progressLabel ? <p className="reading-session__count">{summary.progressLabel}</p> : null}
        </div>
      ) : null}

      {view === 'returning' ? (
        <div className="reading-session__returning" data-testid="reading-returning">
          <div className="reading-session__who">
            <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
          </div>
          <h1 className="reading-session__ask">Finishing up…</h1>
        </div>
      ) : null}
    </div>
  );
}

export default ReadingSessionScreen;
