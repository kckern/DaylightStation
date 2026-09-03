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
 *   open        PROMPT: avatar, name, today's count, recent books
 *   picking     CONFIRM: cover, title, a countdown you can change your mind in
 *   playing     READING: the Player owns the screen; this widget is out of it
 *   returning   completion is being saved; the launch face is not ready yet
 *   celebrating the read that met the target just landed
 *
 * ATTRIBUTION IS FROZEN AT PICK TIME AND NEVER RE-READ. `attributionRef` is
 * written once, when the countdown expires, and is what the completion POST
 * sends. Learner cards are refused after that point; the frozen identity is a
 * second guard against ever crediting a completion to the wrong child.
 *
 * ONE PICK IS ONE `pickId`. Minted at expiry, sent with the completion, and
 * the reading log dedups on it — so duplicate Player terminal notifications,
 * or a screen that remounts mid-book, credit one book rather than two.
 *
 * PLAYBACK-STARTED IS NOT COUNTDOWN-EXPIRED. They differ by however long the
 * content takes to load, and the gap between them is exactly the window in
 * which a stray tap misbehaves — so the backend is told about the FIRST FRAME,
 * from the media element itself, not about the timer running out.
 *
 * A COMPLETION IS PLAYER-SEMANTIC, NOT A DISMISSAL. Before a natural end advances
 * the queue or clears a single item, Player synchronously calls
 * `onPlaybackCompleted`; load failures, skips, back, and explicit clear do not.
 * Invariant 1: a read is credited only on completion, never on pick or play.
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
/** A cold kiosk can mount while the backend is still inside the wake call. */
const STARTING_HYDRATE_RETRY_MS = 1000;
/** Stop polling eventually; websocket replay remains available after this. */
const HYDRATE_RECOVERY_BUDGET_MS = 120_000;

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
 * @param {boolean} [opts.presentationObscured] - true while a fullscreen
 *   overlay covers the launch card; a covered face must never be ACKed.
 */
export function useReadingSession({
  location = 'livingroom',
  confirmMs = DEFAULT_CONFIRM_MS,
  onPlay = null,
  onCue = null,
  presentationObscured = false,
} = {}) {
  const [view, setView] = useState('idle');
  const [learner, setLearner] = useState(null);      // { id, name }
  const [summary, setSummary] = useState(null);      // count/target/recent
  const [pick, setPick] = useState(null);            // { contentId, title, image }
  const [notice, setNotice] = useState(null);        // { tone, title, detail }
  const [deadline, setDeadline] = useState(null);
  const [presentation, setPresentation] = useState(null);

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
  const lastProgressAt = useRef(0);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onCueRef = useRef(onCue);
  onCueRef.current = onCue;
  const noticeTimer = useRef(null);
  const celebrateTimer = useRef(null);
  const presentationRef = useRef(null);
  const versionRef = useRef({ serverEpoch: null, revision: 0 });
  const ackedPresentationRef = useRef(null);
  const ackInFlightRef = useRef(null);
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

  const rememberPresentation = useCallback((payload) => {
    if (!payload?.sessionId || !payload?.learnerId) return false;
    const revision = Number(payload.revision);
    const serverEpoch = payload.serverEpoch ?? null;
    const last = versionRef.current;
    if (serverEpoch && last.serverEpoch === serverEpoch
      && Number.isFinite(revision) && revision < last.revision) {
      readingLog.warn('presentation-stale', {
        learnerId: payload.learnerId, revision, currentRevision: last.revision,
      });
      return false;
    }
    if (serverEpoch) {
      versionRef.current = {
        serverEpoch,
        revision: Number.isFinite(revision) ? revision : 0,
      };
    }
    const next = {
      location: payload.location ?? location,
      learnerId: payload.learnerId,
      sessionId: payload.sessionId,
      presentationId: payload.presentationId ?? null,
      revision: Number.isFinite(revision) ? revision : null,
      serverEpoch,
      reason: payload.reason ?? 'replay',
    };
    presentationRef.current = next;
    setPresentation(next);
    return true;
  }, [location]);

  // This is the visibility proof. Receiving a websocket message is not proof
  // that React committed it, and committing under Player/screensaver is not
  // proof that the child can see it. Wait through two paint opportunities only
  // while the unobscured launch card is the rendered view.
  useEffect(() => {
    if (view !== 'open' || presentationObscured || !presentation) return undefined;
    const key = presentation.presentationId ?? `legacy:${presentation.sessionId}`;
    if (ackedPresentationRef.current === key || ackInFlightRef.current === key) return undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    let cancelled = false;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(async () => {
        if (cancelled || presentationRef.current !== presentation || viewRef.current !== 'open') return;
        ackInFlightRef.current = key;
        const body = presentation.presentationId
          ? {
              location: presentation.location,
              sessionId: presentation.sessionId,
              presentationId: presentation.presentationId,
              learnerId: presentation.learnerId,
              revision: presentation.revision,
              serverEpoch: presentation.serverEpoch,
            }
          : { location: presentation.location, sessionId: presentation.sessionId };
        const result = await schoolApi.acknowledgeReadingSession(body).catch?.(() => null);
        if (!cancelled && result?.ok) ackedPresentationRef.current = key;
        if (ackInFlightRef.current === key) ackInFlightRef.current = null;
        readingLog.session(result?.ok ? 'presentation-acknowledged' : 'presentation-ack-failed', {
          learnerId: presentation.learnerId,
          sessionId: presentation.sessionId,
          presentationId: presentation.presentationId,
          status: result?.status ?? 0,
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [presentation, presentationObscured, view]);

  /** Today's count, the target, and their recent reads. Never throws. */
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
      // The interceptor minted this at claim time. Falling back only preserves
      // compatibility with an older backend during a rolling restart.
      pickId: current.pickId ?? mintPickId(),
      sessionId: current.sessionId ?? null,
      studyDay: current.studyDay ?? null,
      location,
    };
    attributionRef.current = attribution;
    endedRef.current = false;
    startedRef.current = false;
    setDeadline(null);
    setView('playing');
    // `attributable` is EXPLICIT because a null `learnerId` serialises as an
    // ABSENT field in the log store, and an absent field is invisible to the
    // query you would write looking for this. A boolean that is present and
    // `false` is greppable; a missing key is not. This is the moment
    // attribution is frozen forever, so it is the moment worth being loud at.
    readingLog.pick('countdown-expired', {
      learnerId: attribution.learnerId, contentId: attribution.contentId, pickId: attribution.pickId,
      attributable: Boolean(attribution.learnerId),
    });
    if (!attribution.learnerId) {
      readingLog.error('committed-unattributable', {
        contentId: attribution.contentId, pickId: attribution.pickId,
        consequence: 'story will play and the read will be rejected at completion',
      });
    }
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
    setView('returning');
    let res = await schoolApi.readingRead({
      learnerId: attribution.learnerId,
      contentId: attribution.contentId,
      title: attribution.title,
      location: attribution.location,
      pickId: attribution.pickId,
      sessionId: attribution.sessionId,
    });
    if (!res.ok) {
      // A network loss leaves the outcome ambiguous: the server may have
      // appended before its response disappeared. Retry once, then ask the
      // idempotency key rather than risking a second visible celebration.
      const retry = res.status === 0 ? await schoolApi.readingRead({
        learnerId: attribution.learnerId, contentId: attribution.contentId, title: attribution.title,
        location: attribution.location, pickId: attribution.pickId, sessionId: attribution.sessionId,
      }) : res;
      if (retry.ok) res = retry;
      const status = attribution.studyDay
        ? await schoolApi.readingReadStatus({ learnerId: attribution.learnerId, studyDay: attribution.studyDay, pickId: attribution.pickId })
        : null;
      if (!res.ok && status?.ok && status.data?.recorded) res = { ok: true, status: 200, data: status.data };
    }
    if (!res.ok) {
      // §9: never claim a read that was not recorded. The child heard the
      // story, so this is not their failure — but the screen must not show a
      // count that did not move as though it had.
      readingLog.error('record-failed', { status: res.status, pickId: attribution.pickId });
      cue('error');
      say({ tone: 'error', title: "I couldn't save that one", detail: 'Tell a grown-up — the story still counts, it just needs writing down.' });
      setView('open');
      return;
    }
    if (res.data?.presentation) rememberPresentation({
      location: attribution.location,
      ...res.data.presentation,
    });
    const fresh = await loadSummary(attribution.learnerId);
    if (!mounted.current) return;
    if (fresh?.doneToday === true) {
      cue('success');
      setView('celebrating');
      clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => {
        if (mounted.current) setView('open');
      }, CELEBRATE_MS);
    } else {
      setView('open');
    }
  }, [cue, loadSummary, rememberPresentation, say]);

  const notePlaybackProgress = useCallback((media) => {
    const attribution = attributionRef.current;
    if (!attribution?.sessionId || !attribution.pickId || !media) return;
    const now = Date.now();
    if (now - lastProgressAt.current < 5000) return;
    lastProgressAt.current = now;
    schoolApi.readingProgress({
      location: attribution.location, sessionId: attribution.sessionId, pickId: attribution.pickId,
      positionSec: media.currentTime, durationSec: media.duration, paused: media.paused,
    }).catch?.(() => {});
  }, []);

  /**
   * The Player went away. If its natural-end callback never arrived, the story
   * did not finish — a load failure, a bail, a grown-up pressing back. Nothing
   * is credited, and the child lands back at the prompt rather than a dead screen.
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
      case 'session-present': {
        if (!rememberPresentation(payload)) return;
        const who = { id: payload.learnerId, name: null };
        learnerRef.current = who;
        setLearner(who);
        setSummary(null);
        say(null);
        // A return can arrive while Player or the completion ceremony still
        // owns the screen. Remember it now, but only the completion path may
        // reveal the launch card; the visibility effect will wait for that.
        if (payload.reason === 'return' && ['playing', 'returning', 'celebrating'].includes(viewRef.current)) return;
        pickRef.current = null;
        setPick(null);
        setDeadline(null);
        setView('open');
        loadSummary(payload.learnerId);
        readingLog.session('session-present', {
          learnerId: payload.learnerId,
          location: payload.location ?? location,
          presentationId: payload.presentationId ?? null,
          reason: payload.reason ?? null,
        });
        return;
      }
      case 'session-open': {
        if (payload.sessionId && !rememberPresentation(payload)) return;
        const who = { id: payload.learnerId, name: null };
        learnerRef.current = who;
        setLearner(who);
        setSummary(null);
        say(null);
        loadSummary(payload.learnerId);
        // A committed session-open is now only initial/prompt/reconnect. Card
        // taps cannot produce one during confirmation or playback.
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
        // THE LOUDEST SIGNAL THIS FEATURE HAS. A book arrived for a session
        // this screen never learned about. Snapshot hydration and rendered
        // presentation ACKs should make that impossible, but everything
        // downstream can still appear to work while attribution freezes null
        // and the read is lost. On 2026-08-28 that happened in the field and
        // the only trace was an ABSENT field on two info lines.
        //
        // The payload carries the authoritative learner — the interceptor reads
        // it straight off the session — so this also records the id we could
        // have used, which is what makes the gap self-evident in the log store.
        if (payload.learnerId && !learnerRef.current?.id) {
          const who = { id: payload.learnerId, name: null };
          learnerRef.current = who;
          setLearner(who);
          loadSummary(who.id);
        }
        if (!learnerRef.current?.id) {
          readingLog.error('pick-without-session', {
            contentId,
            payloadLearnerId: payload.learnerId ?? null,
            view: viewRef.current,
            consequence: 'attribution will be null; the read cannot be recorded',
          });
        }
        const previous = pickRef.current;
        const samePick = previous?.contentId === contentId && viewRef.current === 'picking';
        const next = samePick ? previous : { contentId, title: null, image: null, pickId: payload.pickId ?? null, sessionId: payload.sessionId ?? null, studyDay: payload.studyDay ?? null };
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
      case 'session-refused': {
        // D2 — a card tapped while unrelated content plays. No session opened
        // and nothing touched the TV; this notice is the ENTIRE feedback the
        // child gets, and it renders with no session behind it (see the widget's
        // idle branch). A reading session never seizes the TV from whoever is
        // already watching it — but it does have to say so.
        readingLog.session('session-refused', {
          learnerId: payload.learnerId ?? null, reason: payload.reason ?? null,
        });
        cue('warn');
        say({
          tone: 'warn',
          title: 'Something else is playing',
          detail: 'We can read when this is finished.',
        });
        return;
      }
      case 'session-switch-refused': {
        readingLog.session('session-switch-refused', {
          learnerId: payload.learnerId ?? null,
          currentLearnerId: payload.currentLearnerId ?? null,
          sessionId: payload.currentSessionId ?? null,
          state: payload.state ?? null,
          reason: payload.reason ?? null,
        });
        cue('warn');
        say({
          tone: 'warn',
          title: 'Finish this first',
          detail: 'Story Time is still in use.',
        });
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
  }, [commitPick, confirmMs, cue, loadBook, loadSummary, location, rememberPresentation, say]);

  useWebSocketSubscription(readingTopic(location), handle, [handle]);

  // Events are deliberately not a durable queue.  Hydrate after subscribing
  // so a cold TV or an auto-reloaded page cannot miss its only `session-open`.
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    const startedAt = Date.now();
    const retryWithinBudget = (reason) => {
      if (cancelled) return;
      if (Date.now() - startedAt >= HYDRATE_RECOVERY_BUDGET_MS) {
        readingLog.warn('session-hydration-timeout', { location, reason });
        return;
      }
      retryTimer = setTimeout(hydrate, STARTING_HYDRATE_RETRY_MS);
    };
    const hydrate = async () => {
      const result = await schoolApi.readingSession(location);
      if (cancelled) return;
      if (!result.ok) {
        retryWithinBudget('snapshot-unavailable');
        return;
      }
      const session = result.ok ? result.data?.session : null;
      if (!session) return;
      if (session.state === 'starting') {
        retryWithinBudget('session-starting');
        return;
      }
      if (session.pendingPresentation) {
        handle({ event: 'session-present', location, ...session.pendingPresentation });
        return;
      }
      handle({ event: 'session-open', ...session });
    };
    hydrate();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [handle, location]);

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
    notePlaybackProgress,
    notePlaybackDismissed,
    dismissNotice: () => say(null),
  };
}

export default useReadingSession;
