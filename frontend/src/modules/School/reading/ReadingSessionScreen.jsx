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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import PropTypes from 'prop-types';
import Player from '../../Player/Player.jsx';
import SurroundFrame from '../../Surround/SurroundFrame.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { useScreenOverlay } from '../../../screen-framework/overlays/ScreenOverlayProvider.jsx';
import { playScanCeremonyTone } from '../selfService/scanCeremonySound.js';
import { useReadingSession, DEFAULT_CONFIRM_MS } from './useReadingSession.js';
import { readingLog } from './readingLog.js';
import { bookCover } from './bookCovers.js';
import ReadingPips from './ReadingPips.jsx';
import StreakWall from './StreakWall.jsx';
import { useMediaClockState } from '../../../lib/Player/useMediaClock.js';
// SIDE-EFFECT IMPORT, AND IT IS LOAD-BEARING. `SurroundHost` is what imports
// `Surround/builtins.js`; `SurroundFrame` imports no registrations at all, so a
// direct mount must bring its own or every region resolves null and warns
// `surround.module.missing`. `Surround/builtins.js` is deliberately NOT imported
// — the definition below names only the reading module, and pulling the
// concert-hall chrome into a school bundle for nothing is the dependency this
// feature keeps out.
import './surround/registerReadingSurround.js';
import getLogger from '../../../lib/logging/Logger.js';
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

/**
 * The reading session's surround definition, INLINE. There is no content
 * sidecar to resolve it from: a reading session's chrome comes from its
 * SESSION — who scanned in, what they owe today — which is why this is a direct
 * `SurroundFrame` mount and not a `SurroundHost` one. See
 * `surround/registerReadingSurround.js` for the full argument.
 *
 * A LEFT RAIL, always up. `side` and `width` are read off the first `right`
 * entry and belong to the rail as a whole (`SurroundFrame.jsx`). Left because
 * this is attribution — the thing you check first, and the side a reader's eye
 * starts on. Always up because the rail's whole job is to keep saying, for the
 * length of the story, that this one counts; a banner that fades is a banner
 * that was decoration.
 */
const READING_SURROUND_DEFINITION = Object.freeze({
  regions: { right: { module: 'reading-credit', side: 'left', width: '18%' } },
});

/**
 * The smallest thing that can carry live state across the overlay boundary.
 *
 * `showOverlay` captures props ONCE and never hands them back, so the rail
 * cannot learn a new progress count through props — and re-calling
 * `showOverlay` to deliver one would remount the Player and restart the story.
 * Deliberately not a context either: the overlay renders outside this
 * component's tree.
 *
 * `set` always notifies — the widget only calls it with a freshly derived
 * snapshot, and an equality check here would duplicate the `useMemo` that
 * produced it. Copied in shape from `MediaLessonScreen`'s `createLessonStore`,
 * which solved this exact problem first.
 */
function createReadingStore(initial) {
  let snapshot = initial;
  const subscribers = new Set();
  return {
    get: () => snapshot,
    set: (next) => { snapshot = next; subscribers.forEach((fn) => fn()); },
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}

/** What the rail knows before the widget has published anything. */
const EMPTY_READING = Object.freeze({
  learnerId: null, learnerName: null, subject: null,
  title: null, image: null, contentId: null,
  count: null, target: null, progressLabel: null,
});

/**
 * What sits in the overlay slot: the surround frame, and the Player inside it.
 *
 * Every prop is STABLE for the life of the story — they are captured once by
 * `showOverlay` and never handed back. Everything that moves arrives through
 * `store`.
 *
 * TWO OBLIGATIONS A DIRECT MOUNT INHERITS, both supplied by `SurroundStage`
 * under the host and by nobody here:
 *
 *   1. THE CLOCK. `SurroundFrame` samples nothing; it takes position/duration/
 *      playing/seeking as props. So this runs `useMediaClockState` itself.
 *   2. THE REGISTRATIONS — see the side-effect import at the top of this file.
 *
 * @param {{get: Function, subscribe: Function}} props.store live session state.
 * @param {object} props.play the Player's `play` object — ONE object, built once
 *   per story. An inline literal here is the identity-churn shape that once
 *   opened 495 Plex transcode sessions.
 */
export function ReadingStage({ store, play, getMediaEl, onMediaRef, onPlaybackCompleted, clear, logger = null }) {
  const reading = useSyncExternalStore(store.subscribe, store.get);
  const contentId = play?.contentId ?? null;
  const log = useMemo(
    () => logger ?? getLogger().child({ app: 'school', component: 'reading-stage' }),
    [logger],
  );

  const { position, duration, playing, seeking } = useMediaClockState({
    getMediaEl, contentId, logger: log,
  });

  // Memoized on the moving parts only, so a 10 Hz clock tick never churns the
  // object the module memoizes against.
  const data = useMemo(
    () => ({ id: 'reading-session', definition: READING_SURROUND_DEFINITION, reading }),
    [reading],
  );

  return (
    <SurroundFrame
      active
      data={data}
      contentId={contentId}
      position={position}
      duration={duration}
      playing={playing}
      seeking={seeking}
      logger={log}
    >
      <Player
        play={play}
        onMediaRef={onMediaRef}
        onPlaybackCompleted={onPlaybackCompleted}
        clear={clear}
        /* THE FRAME OWNS THE CHROME. `SurroundHost` clones this prop onto the
           Player it wraps for every enriched item; a DIRECT `SurroundFrame`
           mount (see the header) has no host to do it, so the reading session
           was the one surrounded surface still drawing the Player's own
           progress bar, poster and title UNDER a rail that already says all
           three. It has to be passed here, not inferred: nothing inside Player
           can see that it is inside a frame. */
        forceShader="focused"
      />
    </SurroundFrame>
  );
}

ReadingStage.propTypes = {
  store: PropTypes.object.isRequired,
  play: PropTypes.object.isRequired,
  getMediaEl: PropTypes.func.isRequired,
  onMediaRef: PropTypes.func.isRequired,
  onPlaybackCompleted: PropTypes.func.isRequired,
  clear: PropTypes.func.isRequired,
  logger: PropTypes.object,
};

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
function RecentBook({ read }) {
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
        {/* THE REPEATS, ON THE COVER THEY BELONG TO. A book read three times
            that day is one cover wearing a 3 — the count and the day it counts
            for are now the same object, which is what the old shelf could not
            say (its date and its count came from different scopes). */}
        {read.times > 1
          ? <span className="reading-session__recent-times" data-testid="reading-recent-times">{read.times}</span>
          : null}
      </div>
      <span className="reading-session__recent-title">{read.title}</span>
    </li>
  );
}

/**
 * One day's shelf: the label, then that day's books.
 *
 * THE DAY IS THE PARTITION. The shelf used to be a flat list deduped across a
 * whole week, so a story read on three days appeared once, wearing the newest
 * date and a `x3` that counted the other two days it no longer showed.
 */
function RecentDay({ group, studyDay }) {
  const books = (group?.books ?? []).filter((b) => b?.title);
  if (books.length === 0) return null;
  return (
    <section className="reading-session__recent-day-group" data-testid="reading-recent-day">
      <h4 className="reading-session__recent-day">{recentDayLabel(group.studyDay, studyDay)}</h4>
      <ul className="reading-session__recent-list" data-count={books.length}>
        {books.map((read, index) => (
          <RecentBook key={`${read.contentId ?? read.title ?? 'book'}-${index}`} read={read} />
        ))}
      </ul>
    </section>
  );
}

function Recent({ days, studyDay }) {
  const groups = (Array.isArray(days) ? days : [])
    .filter((g) => Array.isArray(g?.books) && g.books.some((b) => b?.title));
  if (groups.length === 0) return null;
  return (
    <section className="reading-session__recent" data-testid="reading-recent" aria-label="Recent stories">
      <div className="reading-session__recent-days">
        {groups.map((group) => (
          <RecentDay key={group.studyDay} group={group} studyDay={studyDay} />
        ))}
      </div>
    </section>
  );
}

/** `2026-09-09T21:06:33Z` -> `2:06`. The clock time, never a duration. */
export function clockTime(iso) {
  const at = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(at)) return null;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(at)).replace(/\s*[AP]M$/i, '');
}

/**
 * One book on the day's receipt: its cover, and when it finished.
 *
 * CLOCK TIME, NOT DURATION. "18 min" turns a book into a quantity and invites
 * exactly the comparison this session refuses — the obligation is a count of
 * books, never of minutes, and a child who meets it by re-reading one short
 * story has met it. The clock time teaches something instead, and it is the
 * same number the rail was showing while the book played.
 */
function DoneBook({ book }) {
  const [cover, setCover] = useState(null);
  const contentId = book?.contentId ?? null;

  useEffect(() => {
    if (!contentId) return undefined;
    let live = true;
    bookCover(contentId).then((url) => { if (live && url) setCover(url); });
    return () => { live = false; };
  }, [contentId]);

  // Newest first, capped: a favourite read five times should say so without
  // becoming a column of numbers.
  const times = (Array.isArray(book?.at) ? book.at : []).map(clockTime).filter(Boolean).slice(0, 3);

  return (
    <li className="reading-session__done-book" data-testid="reading-done-book">
      <div className="reading-session__done-cover">
        {cover ? <img src={cover} alt="" /> : <div className="reading-session__recent-spine" aria-hidden="true" />}
      </div>
      <span className="reading-session__done-times">
        {times.join(' · ')}
        {book?.times > times.length ? ` +${book.times - times.length}` : ''}
      </span>
    </li>
  );
}

/** Exported for its own tests: the ceremony is driven by a playback callback,
 *  not by a socket event, so a screen-level test cannot reach it. */
export function Ceremony({ tier, name, learner, pick, summary }) {
  const day = tier === 'day';
  const todaysBooks = day
    ? ((summary?.recentDays ?? []).find((g) => g.studyDay === summary?.studyDay)?.books ?? [])
    : [];

  return (
    <div
      className={`reading-session__ceremony reading-session__ceremony--${tier}`}
      data-testid={day ? 'reading-celebrate' : 'reading-book-done'}
      data-tier={tier}
    >
      {day ? (
        <div className="reading-session__who">
          <ProfileAvatar id={learner?.id} name={name || learner?.id} size={256} />
        </div>
      ) : null}

      <h1 className={day ? 'reading-session__ask' : 'reading-session__book-done-headline'}>
        {day
          ? `Great reading${name ? `, ${name}` : ''}!`
          : (name ? `Nice reading, ${name}!` : 'Nice reading!')}
      </h1>

      {/* Tier `book` shows the ONE cover that just landed; tier `day` shows
          everything today, which is a different question. */}
      {!day && pick?.image
        ? <img className="reading-session__book-done-cover" src={pick.image} alt="" />
        : null}

      {day && todaysBooks.length > 0 ? (
        <ul className="reading-session__done-books" data-testid="reading-done-books">
          {todaysBooks.map((book, index) => (
            <DoneBook key={`${book.contentId ?? book.title ?? 'book'}-${index}`} book={book} />
          ))}
        </ul>
      ) : null}

      <ReadingPips
        count={summary?.count}
        target={summary?.target}
        label={summary?.progressLabel}
        className="reading-session__pips"
        testId={day ? 'reading-celebrate-count' : 'reading-book-done-count'}
      />

      {/* The close is now the ONLY moment a child sees today's square turn
          green — after this the screen winds down rather than returning to the
          shelf — so the wall belongs here as much as on the way in. */}
      {day ? (
        <StreakWall days={summary?.streak} studyDay={summary?.studyDay} className="reading-session__streak" />
      ) : null}
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

  // Live state for the rail, and the pick's own view of it. `readingSnapshotRef`
  // is what `onPlay` can see at commit time — `onPlay` is a stable callback and
  // must not close over session state that moves.
  const storeRef = useRef(null);
  if (storeRef.current === null) storeRef.current = createReadingStore(EMPTY_READING);
  const readingSnapshotRef = useRef(EMPTY_READING);

  const onPlay = useCallback((committed) => {
    // Dismiss first, and claim `high` priority: `showOverlay` REFUSES to
    // replace a mounted fullscreen overlay at default priority, so a lingering
    // art screensaver would otherwise swallow the book the child just picked —
    // the same order `ScreenActionHandler.handleMediaPlay` uses for a book
    // tapped with no session open.
    dismissOverlay();
    // The rail's first snapshot, from what the pick already knows. It is
    // published BEFORE the overlay mounts so the rail never paints a frame
    // without a face on it — the summary numbers arrive with the same object.
    storeRef.current.set({
      ...EMPTY_READING,
      ...readingSnapshotRef.current,
      contentId: committed.contentId,
      title: committed.title ?? readingSnapshotRef.current.title ?? null,
      image: committed.image ?? readingSnapshotRef.current.image ?? null,
    });
    showOverlay(ReadingStage, {
      store: storeRef.current,
      // ONE object per story. Rebuilding it inline on a re-render is the
      // identity-churn shape that once opened 495 Plex transcode sessions.
      play: { contentId: committed.contentId },
      getMediaEl: () => mediaRef.current,
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

  // THE RAIL'S FEED. Everything the rail shows lives in session state that moves
  // AFTER `showOverlay` captured its props, so it can only reach the overlay
  // through the store. Derived here (one place) and published on change.
  //
  // The summary is refetched on completion, so the pips tick over WITHOUT the
  // story restarting — which is the whole reason the store exists rather than a
  // second `showOverlay`.
  const readingSnapshot = useMemo(() => ({
    learnerId: session.learner?.id ?? null,
    learnerName: session.learner?.name ?? null,
    subject: session.summary?.subject ?? null,
    title: session.pick?.title ?? null,
    image: session.pick?.image ?? null,
    contentId: session.pick?.contentId ?? null,
    count: session.summary?.count ?? null,
    target: session.summary?.target ?? null,
    progressLabel: session.summary?.progressLabel ?? null,
  }), [session.learner, session.summary, session.pick]);

  readingSnapshotRef.current = readingSnapshot;
  useEffect(() => {
    // Only while a story is up: outside that window nothing is reading the
    // store, and writing to it would notify subscribers that do not exist.
    if (session.view !== 'playing') return;
    storeRef.current.set({ ...storeRef.current.get(), ...readingSnapshot });
  }, [readingSnapshot, session.view]);

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
          <ReadingPips
            count={summary?.count}
            target={summary?.target}
            label={summary?.progressLabel}
            className="reading-session__pips"
          />
          <Recent days={summary?.recentDays} studyDay={summary?.studyDay} />
          {/* J7, and only here: a streak wall is for lingering over, and this
              is the one screen a child lingers on. */}
          <StreakWall days={summary?.streak} studyDay={summary?.studyDay} className="reading-session__streak" />
        </div>
      ) : null}

      {/* THE CEREMONY, both tiers. They were two views that shared every
          element and differed only in WHICH books they show and how long they
          stay — which is a prop, not a screen. The state names survive because
          the hook's guards enumerate them.

          TIER `book` — one book landed, the day is not done. A beat, not a
          screen: the cover just finished, the pips with one more filled. It
          says "that one counted" and gets out of the way.

          TIER `day` — the day is done. This is the only moment a child sees
          what they actually did, so it carries today's covers with the clock
          time each one finished (J6) and the streak wall with today's square
          newly lit (J7). */}
      {view === 'book-done' || view === 'celebrating' ? (
        <Ceremony
          tier={view === 'celebrating' ? 'day' : 'book'}
          name={name}
          learner={learner}
          pick={pick}
          summary={summary}
        />
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
