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
 * tapped with no session open. Two things come back off it:
 *   `onMediaRef` → the media element, whose `playing` and `ended` events are the
 *                  only honest witnesses to playback starting and finishing;
 *   `clear`      → the Player is done for ANY reason, which is not the same as
 *                  the story having finished, and must never be read as one.
 */
import { useCallback, useEffect, useRef } from 'react';
import Player from '../../Player/Player.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { useScreenOverlay } from '../../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import { playScanCeremonyTone } from '../selfService/scanCeremonySound.js';
import { useReadingSession, DEFAULT_CONFIRM_MS } from './useReadingSession.js';
import { readingLog } from './readingLog.js';
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

function Yesterday({ reads }) {
  if (!Array.isArray(reads) || reads.length === 0) return null;
  const named = reads.filter((r) => r?.title);
  if (named.length === 0) return null;
  return (
    <div className="reading-session__yesterday" data-testid="reading-yesterday">
      <span className="reading-session__yesterday-label">Yesterday you read</span>
      <ul className="reading-session__yesterday-list">
        {named.map((read, index) => (
          <li key={`${read.contentId ?? 'book'}-${index}`}>{read.title}</li>
        ))}
      </ul>
    </div>
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
  const { showOverlay, dismissOverlay } = useScreenOverlay();
  // The hook needs `onPlay`; `onPlay` needs the hook's callbacks. A ref breaks
  // the cycle without making either of them re-created on every render.
  const handlers = useRef({});
  const mediaRef = useRef(null);
  // STABLE identities, delegating to whatever `handlers` holds this render.
  // Listeners rebuilt per render could never be removed again — the element
  // outlives several renders, and `removeEventListener` matches by reference.
  const listeners = useRef({
    playing: () => handlers.current.notePlaybackStarted?.(),
    ended: () => handlers.current.notePlaybackCompleted?.(),
  });

  const detachMedia = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.removeEventListener('playing', listeners.current.playing);
    el.removeEventListener('ended', listeners.current.ended);
    mediaRef.current = null;
  }, []);

  const attachMedia = useCallback((el) => {
    if (!el || el === mediaRef.current) return;
    detachMedia();
    mediaRef.current = el;
    el.addEventListener('playing', listeners.current.playing);
    el.addEventListener('ended', listeners.current.ended);
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
      clear: () => {
        detachMedia();
        dismissOverlay();
        handlers.current.notePlaybackDismissed?.();
      },
    }, { chrome: 'media', priority: 'high' });
  }, [attachMedia, detachMedia, dismissOverlay, showOverlay]);

  const session = useReadingSession({ location, confirmMs, onPlay, onCue: cueTone });

  // Rebound every render so the listeners registered above always call the
  // freshest closures — the element outlives several renders of this component.
  handlers.current.notePlaybackDismissed = session.notePlaybackDismissed;
  handlers.current.notePlaybackStarted = session.notePlaybackStarted;
  handlers.current.notePlaybackCompleted = session.notePlaybackCompleted;

  useEffect(() => detachMedia, [detachMedia]);

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
          {summary?.progressLabel
            ? <p className="reading-session__count" data-testid="reading-count">{summary.progressLabel}</p>
            : null}
          <Yesterday reads={summary?.yesterday} />
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
    </div>
  );
}

export default ReadingSessionScreen;
