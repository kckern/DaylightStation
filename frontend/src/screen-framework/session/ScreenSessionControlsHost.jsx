// frontend/src/screen-framework/session/ScreenSessionControlsHost.jsx
//
// Binds the screen session controls (screenSessionControls.js) to a mounted
// screen: fills its React-side ports, registers the Player natural-end
// policy, answers `media:session-control` commands, persists the session for
// power-cut survival, and renders the on-screen surfaces (screen notes with
// Put it back, the next-episode countdown, the sleep fade).
import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { getActionBus } from '../input/ActionBus.js';
import { useScreenOverlay } from '../overlays/ScreenOverlayProvider.jsx';
import { ScreenPlayer } from '../publishers/ScreenPlayer.jsx';
import { useScopedRemoteControls } from '../input/useScopedRemoteControls.js';
import { useScreenVolume } from '../../lib/volume/ScreenVolumeContext.js';
import { getPlayerQueueOpRegistry } from '../../modules/Player/lib/queueOpRegistry.js';
import { setNaturalEndPolicy } from '../../modules/Player/lib/naturalEndPolicy.js';
import { getScreenItemActions } from '../actions/screenItemActions.js';
import { createContinuationResolver } from './continuationResolver.js';
import {
  loadPersistedSession, savePersistedSession, updatePersistedSpot, clearPersistedSession, POWER_RESTORE_DELAY_MS,
} from './sessionPersistence.js';
import { parseAutoplayParams, AUTOPLAY_ACTIONS } from '../../lib/parseAutoplayParams.js';
import getLogger from '../../lib/logging/Logger.js';
import { ScreenPlayerFeaturesHost } from './ScreenPlayerFeaturesHost.jsx';
import './ScreenSessionControls.css';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'ScreenSessionControlsHost' });
  return _logger;
}

const RESTORE_TIMEOUT_MS = 8_000;
const PERSIST_THROTTLE_MS = 2_000;
const SPOT_PERSIST_INTERVAL_MS = 5_000;
const NOTE_VISIBLE_MS = 10_000;

export function requestRestore(snapshot, { autoplay, reason }) {
  const bus = getActionBus();
  const requestId = `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (done) return; done = true; unsubscribe(); clearTimeout(timer); resolve(result); };
    const unsubscribe = bus.subscribe('media:restore-snapshot-result', (payload) => {
      if (payload?.requestId === requestId) finish({ ok: payload.ok === true, ...(payload.code ? { code: payload.code } : {}) });
    });
    const timer = setTimeout(() => finish({ ok: false, code: 'RESTORE_TIMEOUT' }), RESTORE_TIMEOUT_MS);
    bus.emit('media:restore-snapshot', { snapshot, autoplay: !!autoplay, reason, requestId });
  });
}

export function ScreenSessionControlsHost({ controls, source }) {
  const { setFade } = useScreenVolume();
  const setFadeRef = useRef(setFade);
  setFadeRef.current = setFade;
  const ownerId = controls?.ownerId ?? source?.ownerId ?? null;
  const resolveContinuation = useMemo(() => createContinuationResolver({ ownerId }), [ownerId]);

  // --- Ports ---------------------------------------------------------------
  useEffect(() => {
    if (!controls) return undefined;
    controls.setPorts({
      getSnapshot: () => source?.getBareSnapshot?.() ?? source?.getSnapshot?.() ?? null,
      stopPlayback: () => getPlayerQueueOpRegistry().dispatch({ op: 'stop' }),
      setFade: (value) => setFadeRef.current?.(value),
      restoreSnapshot: (snapshot, opts) => requestRestore(snapshot, opts),
      resolveContinuation,
      addAutoContinueBatch: async (items) => {
        const operationId = `auto-continue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const result = await getScreenItemActions(source).execute({
          kind: 'add', item: items[0], collectionItems: items, operationId, tappedAt: Date.now(), addedBy: items[0]?.addedBy ?? 'auto-continue',
        });
        return { ...(result ?? {}), operationId };
      },
    });
    // Only the Player this screen's session is bound to (overlay or nav-stack
    // owner) consults the policy; any other Player on the page keeps its own
    // end behaviour (B1: a school lesson Player must still reach its checkpoint).
    const unregister = setNaturalEndPolicy(
      (ctx, actions) => controls.naturalEndPolicy(ctx, actions),
      { isOwner: (instanceId) => !!instanceId && source?.getActionOwner?.()?.ownerInstanceId === instanceId },
    );
    logger().info('mounted', { ownerId });
    return () => { unregister(); logger().info('unmounted', { ownerId }); };
  }, [controls, source, resolveContinuation, ownerId]);

  // --- Commands ------------------------------------------------------------
  useEffect(() => {
    if (!controls) return undefined;
    const bus = getActionBus();
    const reply = (commandId, result) => {
      if (!commandId) return;
      if (result?.ok === false) bus.emit('command-handler-error', { commandId, code: result.code, error: result.error ?? result.code });
      else bus.emit('media:session-control-applied', { commandId });
    };
    const onSessionControl = async (payload = {}) => {
      const { kind, commandId } = payload;
      try {
        if (kind === 'config') reply(commandId, controls.applyConfig(payload.setting, payload.value));
        else if (kind === 'session') reply(commandId, await controls.handleSession(payload.action, payload.params ?? {}));
      } catch (error) {
        logger().warn('session-control.failed', { kind, commandId, error: error?.message });
        reply(commandId, { ok: false, code: 'SESSION_CONTROL_FAILED', error: error?.message });
      }
    };
    // Local input starting playback is "this screen" — a newer owner, so any
    // pending Put it back or countdown no longer applies.
    const onLocalPlayback = () => {
      controls.markLocalPlayback();
      if (ownerId) controls.stampOrigin({ kind: 'device', id: ownerId });
    };
    const interruptFor = (reason) => () => controls.interrupt(reason);
    const unsubs = [
      bus.subscribe('media:playback', interruptFor('media:playback')),
      bus.subscribe('media:seek-abs', interruptFor('media:seek-abs')),
      bus.subscribe('media:seek-rel', interruptFor('media:seek-rel')),
      bus.subscribe('media:queue-op', interruptFor('media:queue-op')),
      bus.subscribe('media:session-control', onSessionControl),
      bus.subscribe('media:play', onLocalPlayback),
      bus.subscribe('media:queue', onLocalPlayback),
    ];
    return () => unsubs.forEach((u) => u());
  }, [controls, ownerId]);

  // --- Observe the session: auto-continue refill + power-cut persistence ----
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!controls || !source || !ownerId) return undefined;
    const saved = loadPersistedSession(ownerId);
    // Anything that starts playback here after mount wins over yesterday's
    // session (B2): a URL autoplay, a dispatched load, local input.
    const urlAutoplay = typeof window !== 'undefined'
      && !!parseAutoplayParams(window.location?.search ?? '', AUTOPLAY_ACTIONS);
    let startedSinceMount = null;
    const bus = getActionBus();
    const startWatch = ['media:play', 'media:queue', 'media:queue-op', 'media:adopt-snapshot', 'media:handoff']
      .map((event) => bus.subscribe(event, () => { startedSinceMount ??= event; }));

    // A restored session that has not been resumed keeps its original save
    // time and is never offered again (B3).
    let restoredMark = null;
    // A restored session is "resumed" only when a person or remote acted on
    // it after the restore — never because the renderer briefly reported
    // `playing` while settling the paused adopt.
    let resumeIntent = false;
    const resumeWatch = ['media:playback', 'media:seek-abs', 'media:seek-rel', 'media:queue-op', 'media:play', 'media:queue']
      .map((event) => bus.subscribe(event, () => { if (restoredMark) resumeIntent = true; }));
    let lastWrite = 0;
    let pending = null;
    const writeFull = () => {
      lastWrite = Date.now();
      pending = null;
      const snapshot = source.getBareSnapshot?.();
      if (restoredMark && resumeIntent && snapshot?.state === 'playing') {
        logger().info('power-restore.resumed', { ownerId });
        restoredMark = null;
      }
      const outcome = savePersistedSession(ownerId, snapshot, controls.persistable(), restoredMark
        ? { restored: true, savedAt: restoredMark.savedAt } : {});
      if (outcome === 'cleared') logger().debug('persistence.cleared', { ownerId, state: snapshot?.state ?? null });
    };
    const persist = () => {
      if (!restoredRef.current) return; // never overwrite the record before it was offered back
      const now = Date.now();
      if (now - lastWrite >= PERSIST_THROTTLE_MS) writeFull();
      else if (!pending) pending = setTimeout(writeFull, PERSIST_THROTTLE_MS - (now - lastWrite));
    };
    const onChange = () => {
      try { controls.observeSnapshot(source.getBareSnapshot?.() ?? null); } catch (err) {
        logger().warn('observe-failed', { error: err?.message });
      }
      persist();
    };
    const unsubscribeSource = source.subscribe({ onChange, onStateTransition: onChange });
    const unsubscribeControls = controls.subscribe(persist);
    // The spot moves without any snapshot "change" — a power cut gives no
    // unload event — so the spot (only) is refreshed while playing.
    const spotTimer = setInterval(() => {
      if (!restoredRef.current) return;
      const snapshot = source.getBareSnapshot?.();
      if (restoredMark) { if (resumeIntent && snapshot?.state === 'playing') writeFull(); return; }
      if (snapshot?.state === 'playing') updatePersistedSpot(ownerId, snapshot);
    }, SPOT_PERSIST_INTERVAL_MS);

    // Power-cut survival (RQ-RELY-08): re-adopt the persisted session PAUSED,
    // never autoplaying — and only when nothing else is starting here.
    const restoreTimer = setTimeout(async () => {
      const candidate = saved?.snapshot;
      const current = source.getBareSnapshot?.();
      const skip = !candidate ? null
        : saved.restored ? 'already-offered-never-resumed'
          : urlAutoplay ? 'url-autoplay'
            : startedSinceMount ? `start-since-mount:${startedSinceMount}`
              : (source.getActionOwner?.() || current?.currentItem) ? 'playback-owner-present'
                : null;
      if (candidate && !skip) {
        const result = await requestRestore({ ...candidate, state: 'paused' }, { autoplay: false, reason: 'power-restore' });
        logger()[result.ok ? 'info' : 'warn']('power-restore', {
          ownerId, ok: result.ok, code: result.code ?? null, contentId: candidate.currentItem?.contentId ?? null,
          position: candidate.position ?? null, savedAt: saved.savedAt,
        });
        if (result.ok) {
          // Session modes belong to the session: they come back only with it (B5).
          if (saved.modes) controls.hydrate(saved.modes);
          restoredMark = { savedAt: saved.savedAt };
          savePersistedSession(ownerId, candidate, saved.modes, { restored: true, savedAt: saved.savedAt });
        }
      } else if (candidate) {
        logger().info('power-restore.skipped', { ownerId, reason: skip });
        if (skip === 'already-offered-never-resumed') clearPersistedSession(ownerId);
      }
      startWatch.forEach((u) => u());
      restoredRef.current = true;
      persist();
    }, POWER_RESTORE_DELAY_MS);

    return () => {
      clearTimeout(restoreTimer);
      clearInterval(spotTimer);
      if (pending) clearTimeout(pending);
      startWatch.forEach((u) => u());
      resumeWatch.forEach((u) => u());
      unsubscribeSource?.();
      unsubscribeControls?.();
    };
  }, [controls, source, ownerId]);

  if (!controls) return null;
  return (
    <>
      <ScreenSessionSurfaces controls={controls} />
      {controls.extension && <ScreenPlayerFeaturesHost features={controls.extension} source={source} />}
    </>
  );
}

// --- On-screen surfaces -----------------------------------------------------

function useControlsState(controls) {
  const cache = useRef(null);
  const subscribe = useCallback((fn) => controls.subscribe(() => { cache.current = null; fn(); }), [controls]);
  const getState = useCallback(() => {
    if (!cache.current) cache.current = controls.toPublished();
    return cache.current;
  }, [controls]);
  return useSyncExternalStore(subscribe, getState);
}

function useTick(active) {
  const [, setTick] = React.useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function ScreenSessionSurfaces({ controls }) {
  const state = useControlsState(controls);
  const now = Date.now();
  const latest = state.notes[0] ?? null;
  const noteVisible = !!latest && (now - Date.parse(latest.at) < NOTE_VISIBLE_MS || !!latest.putBack);
  const countdown = state.countdown;
  const fading = state.sleepTimer?.fading;
  const status = state.endOfQueueStatus;
  const statusVisible = !!status && now - Date.parse(status.at) < NOTE_VISIBLE_MS;
  // Re-render once a second only while something time-based is on screen.
  useTick(noteVisible || !!countdown || statusVisible || !!fading);

  const remaining = countdown ? Math.max(0, Math.ceil((Date.parse(countdown.endsAt) - now) / 1000)) : 0;

  // The countdown is announced ONCE when it starts and once when it is
  // cancelled; the ticking seconds are decoration for assistive tech.
  const countdownKey = countdown?.endsAt ?? null;
  const cancelledRef = useRef(false);
  const startSecondsRef = useRef(0);
  const [announcement, setAnnouncement] = React.useState('');
  const countdownTitle = countdown ? (countdown.next.title ?? countdown.next.contentId) : null;
  if (countdownKey && startSecondsRef.current === 0) startSecondsRef.current = remaining;
  useEffect(() => {
    if (countdownKey) {
      cancelledRef.current = false;
      setAnnouncement(`Next episode, ${countdownTitle}, starts in ${startSecondsRef.current} seconds. Back cancels.`);
      return;
    }
    startSecondsRef.current = 0;
    setAnnouncement(cancelledRef.current ? 'Next episode countdown cancelled' : '');
    cancelledRef.current = false;
  }, [countdownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelCountdown = () => { cancelledRef.current = true; controls.handleSession('cancel-countdown', {}); };

  return (
    <>
      <div className="screen-session-countdown-announce" role="status" aria-live="polite" data-testid="screen-next-countdown-announce"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {announcement}
      </div>
      {countdown && (
        <CountdownPrompt countdown={countdown} remaining={remaining} onCancel={cancelCountdown}
          onStartNow={() => controls.handleSession('start-next-now', {})} />
      )}
      <div className="screen-session-notes" aria-live="polite">
        {noteVisible && (
          <div className="screen-session-note" role="status" data-testid="screen-note" data-note-kind={latest.kind}>
            <span className="screen-session-note__label" data-testid="screen-note-label">
              {latest.label}{latest.count > 1 ? ` (${latest.count}×)` : ''}
            </span>
            {latest.putBack && (
              <OkButton className="screen-session-note__action" data-testid="screen-note-put-back" capture={latest.kind !== 'paused'}
                onClick={() => controls.handleSession('put-back', { noteId: latest.id })}>Put it back</OkButton>
            )}
          </div>
        )}
        {fading && (
          <div className="screen-session-note" role="status" data-testid="screen-sleep-fading">
            <span>Sleep timer — stopping</span>
            <OkButton className="screen-session-note__action" data-testid="screen-sleep-keep-playing"
              onClick={() => controls.handleSession('cancel-sleep-timer', {})}>Keep playing</OkButton>
          </div>
        )}
        {statusVisible && (
          <div className="screen-session-note" role="status" data-testid="screen-queue-status" data-status-code={status.code}>
            {status.code === 'NOTHING_SIMILAR' && 'Nothing similar left'}
            {status.code === 'SIMILAR_ADDED' && `Added automatically: ${status.title ?? `${status.count} more`}`}
            {status.code === 'STOPPED_AFTER_CURRENT' && 'Stopped after this one'}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * TV input is D-pad, OK and an unreliable Back (FKB swallows Esc). A
 * non-modal prompt button owns OK only while it is on screen: OK activates it,
 * arrows and everything else still reach the player. It carries focus styling
 * so a keyboard user can see it too.
 */
function OkButton({ children, onClick, capture = true, ...rest }) {
  const ref = useRef(null);
  // The Player itself is a fullscreen overlay on a screen; only another one
  // (menu, call, school quiz, screensaver) owns OK.
  const { fullscreenComponent } = useScreenOverlay();
  const otherOverlay = fullscreenComponent != null && fullscreenComponent !== ScreenPlayer;
  const overlayRef = useRef(otherOverlay); overlayRef.current = otherOverlay;
  useEffect(() => {
    if (!capture) return undefined;
    return getActionBus().capture(['select'], () => {
      const node = ref.current;
      if (!node) return false;
      // Another overlay owns the screen, or another control already holds
      // focus: OK is theirs, not this prompt's.
      if (overlayRef.current) return false;
      const active = document.activeElement;
      if (active && active !== document.body && !node.contains(active)) return false;
      logger().info('tv-prompt.ok', { prompt: rest['data-testid'] ?? null });
      node.click();
      return true;
    });
  }, [capture]); // eslint-disable-line react-hooks/exhaustive-deps
  return <button type="button" ref={ref} onClick={onClick} {...rest}>{children}</button>;
}

/** The next-episode countdown: modal for D-pad/OK; Cancel holds focus; Back cancels too. */
function CountdownPrompt({ countdown, remaining, onCancel, onStartNow }) {
  const rootRef = useRef(null);
  useScopedRemoteControls(rootRef, { onEscape: onCancel });
  return (
    <div ref={rootRef} className="screen-session-countdown" aria-live="off" data-testid="screen-next-countdown">
      <div className="screen-session-countdown__label">Next episode in <span aria-hidden="true" data-testid="screen-next-countdown-seconds">{remaining}</span></div>
      <div className="screen-session-countdown__title">{countdown.next.title ?? countdown.next.contentId}</div>
      <div className="screen-session-countdown__actions">
        <button type="button" autoFocus data-testid="screen-next-countdown-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" data-testid="screen-next-countdown-start" onClick={onStartNow}>Play now</button>
      </div>
    </div>
  );
}

export default ScreenSessionControlsHost;
