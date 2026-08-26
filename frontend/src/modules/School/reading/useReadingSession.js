/**
 * useReadingSession — the living-room reading screen's whole state machine,
 * driven by one WebSocket topic and four callbacks.
 *
 * Authority on behaviour: `docs/reference/school/reading-sessions.md`. This
 * hook is the screen half of it — the backend owns who is at the reader and
 * which taps it claims; the screen owns the countdown, the pick, and the two
 * moments the backend cannot see: playback STARTING and playback ENDING.
 *
 * FOUR VIEWS, AND ONE THAT ONLY APPEARS ON THE LAST BOOK:
 *   idle        no session — the widget renders nothing and the screen's own
 *               menu is untouched
 *   open        PROMPT: avatar, name, today's count, yesterday's books
 *   picking     CONFIRM: cover, title, a countdown you can change your mind in
 *   playing     READING: the Player owns the screen; this widget is out of it
 *   celebrating the read that met the target just landed
 *
 * ATTRIBUTION IS FROZEN AT PICK TIME AND NEVER RE-READ. `attributionRef` is
 * written once, when the countdown expires, and is what the completion POST
 * sends. Reading the learner back off the session at completion would credit
 * the story to whoever wandered past the reader while it played (D4) — a bug
 * that leaves no trace anywhere and is invisible until a report card is wrong.
 *
 * ONE PICK IS ONE `pickId`. Minted at expiry, sent with the completion, and
 * the reading log dedups on it — so a player that fires `ended` twice, or a
 * screen that remounts mid-book, credits one book rather than two.
 *
 * PLAYBACK-STARTED IS NOT COUNTDOWN-EXPIRED. They differ by however long the
 * content takes to load, and the gap between them is exactly the window in
 * which a stray tap misbehaves — so the backend is told about the FIRST FRAME,
 * from the media element itself, not about the timer running out.
 *
 * A COMPLETION IS `ended`, NOT A DISMISSAL. The Player calls `clear` for every
 * reason it stops — end of content, a load failure, a bail — and only the media
 * element's own `ended` event says the story was actually finished. Invariant 1:
 * a read is credited only on completion, never on pick and never on play.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocketSubscription } from '../../../hooks/useWebSocket.js';
import { schoolApi } from '../schoolApi.js';
import { readingLog } from './readingLog.js';

/** How long a child has to change their mind. Long enough to reach the shelf. */
export const DEFAULT_CONFIRM_MS = 6000;
/** How long "good reading!" stays up before the screen goes back to the prompt. */
const CELEBRATE_MS = 9000;
/** How long a refusal or a fault stays on screen. */
const NOTICE_MS = 7000;

export const readingTopic = (location) => `reading:${location}`;

/** One id per PICK, not per play attempt — see the header. */
function mintPickId() {
  try {
    if (globalThis.crypto?.randomUUID) return `pick_${globalThis.crypto.randomUUID()}`;
  } catch { /* fall through to the arithmetic one */ }
  return `pick_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A countdown on requestAnimationFrame rather than a fresh `setInterval`: this
 * draws a bar that a four-year-old watches shrink, and a 250 ms interval
 * visibly steps. It exposes `confirmRemainingMs` — the same shape
 * `LaunchCard.jsx` already reads for its print-confirm clock — and fires
 * `onExpire` exactly once, however many frames land on zero.
 *
 * `deadline` is an absolute epoch ms, so a frame the browser skipped (a
 * backgrounded WebView, a thermal stall on the Shield) cannot make the
 * countdown run long: the next frame to arrive reads the real remaining time.
 */
function useConfirmCountdown(deadline, onExpire) {
  const [remaining, setRemaining] = useState(null);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return undefined;
    }
    let frame = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left > 0) {
        frame = requestAnimationFrame(tick);
        return;
      }
      done = true;
      expireRef.current?.();
    };
    tick();
    return () => {
      done = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [deadline]);

  return remaining;
}

/**
 * @param {object} opts
 * @param {string} opts.location - the trigger location this screen belongs to
 *   (`livingroom`). One topic per reader, so a screen hears its own room only.
 * @param {number} [opts.confirmMs] - the change-your-mind window.
 * @param {(pick: object) => void} [opts.onPlay] - hand the committed pick to
 *   whoever mounts the player. Called ONCE per pick, at expiry.
 * @param {(tone: 'success'|'warn'|'error') => void} [opts.onCue] - the audible
 *   half of each acknowledgement. Optional: the screen must be legible without it.
 */
export function useReadingSession({
  location = 'livingroom',
  confirmMs = DEFAULT_CONFIRM_MS,
  onPlay = null,
  onCue = null,
} = {}) {
  const [view, setView] = useState('idle');
  const [learner, setLearner] = useState(null);      // { id, name }
  const [summary, setSummary] = useState(null);      // count/target/yesterday
  const [pick, setPick] = useState(null);            // { contentId, title, image }
  const [notice, setNotice] = useState(null);        // { tone, title, detail }
  const [deadline, setDeadline] = useState(null);

  // Refs mirror what the async paths need to read WITHOUT re-subscribing or
  // going stale inside a closure that outlives its render.
  const pickRef = useRef(null);
  const learnerRef = useRef(null);
  // `handle` reads the CURRENT view without DEPENDING on it — a dependency
  // would re-subscribe the socket every time the view changed.
  const viewRef = useRef(view);
  viewRef.current = view;
  const attributionRef = useRef(null);
  const endedRef = useRef(false);
  const startedRef = useRef(false);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  const noticeTimer = useRef(null);
  const celebrateTimer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(noticeTimer.current);
    clearTimeout(celebrateTimer.current);
  }, []);

  const cue = useCallback((tone) => {
    try { onCueRef.current?.(tone); } catch { /* a cue is never worth the screen */ }
  }, []);

  const say = useCallback((next) => {
    clearTimeout(noticeTimer.current);
    setNotice(next);
    if (!next) return;
    noticeTimer.current = setTimeout(() => {
      if (mounted.current) setNotice(null);
    }, NOTICE_MS);
  }, []);

  /** Today's count, the target, and what they read yesterday. Never throws. */
  const loadSummary = useCallback(async (learnerId) => {
    if (!learnerId) return null;
    const res = await schoolApi.readingSummary(learnerId);
    if (!res.ok || !res.data) {
      readingLog.warn('summary-failed', { learnerId, status: res.status });
      return null;
    }
    if (!mounted.current) return res.data;
    setSummary(res.data);
    if (res.data.displayName) {
      setLearner((prev) => (prev?.id === learnerId ? { ...prev, name: res.data.displayName } : prev));
    }
    readingLog.screen('summary-loaded', {
      learnerId, count: res.data.count, target: res.data.target, error: res.data.error,
    });
    return res.data;
  }, []);

  /** The cover and the title, so the confirm screen shows the BOOK, not an id. */
  const loadBook = useCallback(async (contentId) => {
    if (!contentId) return;
    try {
      const r = await fetch(`/api/v1/info/${encodeURIComponent(contentId)}`, { credentials: 'same-origin' });
      const data = r.ok ? await r.json() : null;
      if (!data || !mounted.current) return;
      // The pick may already have been swapped or committed — only decorate the
      // one this answer is actually about.
      if (pickRef.current?.contentId !== contentId) return;
      const decorated = {
        ...pickRef.current,
        title: data.title ?? null,
        image: data.image ?? data.thumbnail ?? data.imageUrl ?? null,
      };
      pickRef.current = decorated;
      setPick(decorated);
      // A title that lands AFTER the countdown expired still belongs on the
      // read: the reading log's row is what a parent reads back.
      if (attributionRef.current?.contentId === contentId && !attributionRef.current.title) {
        attributionRef.current = { ...attributionRef.current, title: decorated.title };
      }
      readingLog.screen('book-metadata', { contentId, title: decorated.title });
    } catch (err) {
      readingLog.warn('book-metadata-failed', { contentId, error: err?.message ?? String(err) });
    }
  }, []);

  /**
   * The countdown ran out: commit the pick. This is where attribution and the
   * `pickId` are frozen — everything downstream reads them, nothing rewrites them.
   */
  const commitPick = useCallback(() => {
    const current = pickRef.current;
    const who = learnerRef.current;
    if (!current?.contentId) return;
    const attribution = {
      learnerId: who?.id ?? null,
      contentId: current.contentId,
      title: current.title ?? null,
      pickId: mintPickId(),
      location,
    };
    attributionRef.current = attribution;
    endedRef.current = false;
    startedRef.current = false;
    setDeadline(null);
    setView('playing');
    readingLog.pick('countdown-expired', {
      learnerId: attribution.learnerId, contentId: attribution.contentId, pickId: attribution.pickId,
    });
    try {
      onPlayRef.current?.({ ...attribution, image: current.image ?? null });
    } catch (err) {
      readingLog.error('play-dispatch-failed', { contentId: attribution.contentId, error: err?.message ?? String(err) });
      say({ tone: 'error', title: "That one didn't work", detail: 'Try another book.' });
      setView('open');
    }
  }, [location, say]);

  const confirmRemainingMs = useConfirmCountdown(deadline, commitPick);

  /** The first frame. The backend cannot see it, and D5 depends on knowing. */
  const notePlaybackStarted = useCallback(async () => {
    if (startedRef.current) return;
    const attribution = attributionRef.current;
    if (!attribution) return;
    startedRef.current = true;
    readingLog.playback('playback-started', {
      learnerId: attribution.learnerId, contentId: attribution.contentId, pickId: attribution.pickId,
    });
    const res = await schoolApi.readingPlaying({
      location: attribution.location,
      learnerId: attribution.learnerId,
      contentId: attribution.contentId,
      pickId: attribution.pickId,
    });
    if (!res.ok) {
      // The story is playing either way. What is lost is the session's ability
      // to refuse a second book mid-story — worth a log line, not a banner at a
      // child who is listening to a book.
      readingLog.warn('playing-report-failed', { status: res.status, pickId: attribution.pickId });
    }
  }, []);

  /** The story finished. The ONLY moment a read is credited. */
  const notePlaybackCompleted = useCallback(async () => {
    if (endedRef.current) return;
    const attribution = attributionRef.current;
    if (!attribution) return;
    endedRef.current = true;
    readingLog.playback('playback-completed', {
      learnerId: attribution.learnerId, contentId: attribution.contentId, pickId: attribution.pickId,
    });
    setView('open');
    const res = await schoolApi.readingRead({
      learnerId: attribution.learnerId,
      contentId: attribution.contentId,
      title: attribution.title,
      location: attribution.location,
      pickId: attribution.pickId,
    });
    if (!res.ok) {
      // §9: never claim a read that was not recorded. The child heard the
      // story, so this is not their failure — but the screen must not show a
      // count that did not move as though it had.
      readingLog.error('record-failed', { status: res.status, pickId: attribution.pickId });
      cue('error');
      say({ tone: 'error', title: "I couldn't save that one", detail: 'Tell a grown-up — the story still counts, it just needs writing down.' });
      return;
    }
    const fresh = await loadSummary(attribution.learnerId);
    if (!mounted.current) return;
    if (fresh?.doneToday === true) {
      cue('success');
      setView('celebrating');
      clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => {
        if (mounted.current) setView('open');
      }, CELEBRATE_MS);
    }
  }, [cue, loadSummary, say]);

  /**
   * The Player went away. If `ended` never fired, the story did not finish —
   * a load failure, a bail, a grown-up pressing back. Nothing is credited, and
   * the child lands back at the prompt rather than on a dead screen.
   */
  const notePlaybackDismissed = useCallback(() => {
    if (endedRef.current) return;
    const attribution = attributionRef.current;
    readingLog.playback('playback-abandoned', {
      contentId: attribution?.contentId ?? null, pickId: attribution?.pickId ?? null,
    });
    setView((prev) => (prev === 'playing' ? (learnerRef.current ? 'open' : 'idle') : prev));
  }, []);

  const handle = useCallback((payload) => {
    switch (payload?.event) {
      case 'session-open': {
        const who = { id: payload.learnerId, name: null };
        learnerRef.current = who;
        setLearner(who);
        setSummary(null);
        say(null);
        loadSummary(payload.learnerId);
        // D4: a card tapped MID-STORY swaps the context only. The story keeps
        // playing and keeps the credit it was picked with, so the view does not
        // move and `attributionRef` is deliberately untouched.
        if (viewRef.current === 'playing') {
          readingLog.session('learner-swapped', { learnerId: payload.learnerId, during: 'playing' });
          return;
        }
        // D3: a different card during the countdown drops the pick — a pick
        // belongs to whoever made it. D7: the same tap cancels a teardown.
        pickRef.current = null;
        setPick(null);
        setDeadline(null);
        setView('open');
        readingLog.session('session-open', { learnerId: payload.learnerId, location: payload.location ?? location });
        return;
      }
      case 'session-close': {
        readingLog.session('session-close', { learnerId: payload.learnerId ?? null, reason: payload.reason ?? null });
        if (viewRef.current === 'playing') return;   // the story outlives the session
        learnerRef.current = null;
        pickRef.current = null;
        setLearner(null);
        setSummary(null);
        setPick(null);
        setDeadline(null);
        say(null);
        setView('idle');
        return;
      }
      case 'book-selected': {
        const contentId = payload.contentId ?? null;
        if (!contentId) return;
        const previous = pickRef.current;
        const samePick = previous?.contentId === contentId && viewRef.current === 'picking';
        const next = samePick ? previous : { contentId, title: null, image: null };
        pickRef.current = next;
        setPick(next);
        setView('picking');
        say(null);
        if (samePick) {
          // D10: the same book tapped twice is certainty, not indecision.
          // Confirm now and skip the rest of the countdown.
          readingLog.pick('confirmed-early', { contentId });
          cue('success');
          commitPick();
          return;
        }
        readingLog.pick(previous ? 'pick-changed' : 'book-selected', {
          contentId, from: previous?.contentId ?? null, learnerId: learnerRef.current?.id ?? null,
        });
        cue('success');
        setDeadline(Date.now() + confirmMs);
        loadBook(contentId);
        return;
      }
      case 'book-refused': {
        // D5, assignment mode: one story at a time.
        readingLog.pick('book-refused', { contentId: payload.contentId ?? null, reason: payload.reason ?? null });
        cue('warn');
        say({ tone: 'warn', title: 'Finish this one first', detail: "We'll pick the next book when this story ends." });
        return;
      }
      case 'book-unknown': {
        // D9: say so on screen. The backend still writes the observed-registry
        // entry and sends the push — this is only the child's half.
        readingLog.pick('book-unknown', { tagUid: payload.tagUid ?? null });
        cue('warn');
        say({ tone: 'warn', title: "I don't know that book yet", detail: 'Ask a grown-up to add it.' });
        return;
      }
      case 'session-error': {
        readingLog.error('session-error', { reason: payload.reason ?? null, learnerId: payload.learnerId ?? null });
        cue('warn');
        say({ tone: 'warn', title: "I can't check your reading list", detail: 'You can still pick a book.' });
        return;
      }
      default:
        // `session-update` and anything else on this topic: the screen owns its
        // own view state, and the session's mirror of it is not an instruction.
        readingLog.screen('event-ignored', { event: payload?.event ?? null });
    }
  }, [commitPick, confirmMs, cue, loadBook, loadSummary, location, say]);

  useWebSocketSubscription(readingTopic(location), handle, [handle]);

  return {
    view,
    learner,
    summary,
    pick,
    notice,
    confirmRemainingMs,
    confirmTotalMs: confirmRemainingMs === null ? null : confirmMs,
    notePlaybackStarted,
    notePlaybackCompleted,
    notePlaybackDismissed,
    dismissNotice: () => say(null),
  };
}

export default useReadingSession;
