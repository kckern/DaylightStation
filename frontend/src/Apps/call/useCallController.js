import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { callReducer, initialCallState, isAttemptActive } from './callMachine.js';
import { useCallSignaling } from '../../modules/Input/hooks/useCallSignaling.js';
import { useMediaHealth } from '../../modules/Input/hooks/useMediaHealth.js';

const randomId = prefix => `${prefix}-${crypto.randomUUID()}`;

export function useCallController({ peer, mediaStatus, retryLocalMedia, remoteVideoRef }) {
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const stateRef = useRef(state); stateRef.current = state;
  const abortRef = useRef(null);
  const timersRef = useRef(new Set());
  const loggerRef = useRef(getLogger().child({ component: 'CallController' }));
  const iceRungRef = useRef(0);
  const iceLadderRunningRef = useRef(false);
  const peerConnectionRef = peer.pcRef;
  const peerRef = useRef(peer);
  peerRef.current = peer;
  const previousStateRef = useRef(null);
  const previousHealthRef = useRef(null);
  const attemptStartedAtRef = useRef(null);

  useEffect(() => {
    const previousState = previousStateRef.current;
    if (previousState === state.value) return;
    loggerRef.current.info('call.state.transition', {
      callId: state.callId, attemptId: state.attemptId, dispatchId: state.dispatchId,
      deviceId: state.target?.id, state: state.value, previousState,
      phonePeerId: state.session?.peerId, peerRevision: state.peerRevision,
      recoveryRung: state.reason,
      reason: state.reason,
      elapsedMs: attemptStartedAtRef.current == null ? null : Date.now() - attemptStartedAtRef.current,
      outcome: state.value === 'failed' ? 'failed' : state.value === 'ended' ? 'ended' : undefined,
    });
    previousStateRef.current = state.value;
  }, [state]);

  const clearWork = useCallback(() => {
    abortRef.current?.abort(); abortRef.current = null;
    timersRef.current.forEach(clearTimeout); timersRef.current.clear();
    iceRungRef.current = 0;
    iceLadderRunningRef.current = false;
    peerRef.current.reset();
  }, []);
  const later = useCallback((fn, ms) => {
    const timer = setTimeout(() => { timersRef.current.delete(timer); fn(); }, ms);
    timersRef.current.add(timer); return timer;
  }, []);

  useEffect(() => {
    if (state.value !== 'booting') return;
    if (mediaStatus === 'ready') dispatch({ type: 'BOOT_READY' });
    else if (mediaStatus === 'failed') dispatch({ type: 'BOOT_FAILED', error: 'Camera and microphone are unavailable.' });
  }, [mediaStatus, state.value]);

  const start = useCallback(target => {
    clearWork();
    attemptStartedAtRef.current = Date.now();
    const attemptId = randomId('attempt');
    dispatch({ type: 'START', attemptId, target });
  }, [clearWork]);
  const resume = useCallback((target, callId) => {
    clearWork();
    attemptStartedAtRef.current = Date.now();
    dispatch({ type: 'RESUME', attemptId: randomId('attempt'), target, callId });
  }, [clearWork]);

  useEffect(() => {
    if (state.value !== 'reserving' || !state.attemptId) return undefined;
    const attemptId = state.attemptId;
    const controller = new AbortController(); abortRef.current = controller;
    const run = async () => {
      try {
        let response;
        if (state.callId) response = await DaylightAPI(`api/v1/homeline/calls/${state.callId}/resume`, {}, 'POST', { signal: controller.signal });
        else response = await DaylightAPI('api/v1/homeline/calls', {
          deviceId: state.target.id, attemptId, phonePeerId: randomId('phone'),
        }, 'POST', { signal: controller.signal });
        if (!isAttemptActive(stateRef.current, attemptId)) return;
        const session = { ...response, peerId: response.phonePeerId || stateRef.current.session?.peerId,
          credential: response.phoneCredential, peerRevision: 0 };
        if (!session.peerId) session.peerId = state.callId ? stateRef.current.session?.peerId : null;
        // POST /calls already knows the peer id; preserve the one sent locally when response omits it.
        if (!session.peerId) session.peerId = response.phonePeerId || `phone-${attemptId}`;
        sessionStorage.setItem('homeline.activeCall', JSON.stringify({ callId: response.callId, deviceId: state.target.id }));
        dispatch({ type: 'RESERVED', attemptId, session, deadlineAt: Date.now() + 2_000 });
      } catch (error) {
        if (controller.signal.aborted || !isAttemptActive(stateRef.current, attemptId)) return;
        if (error.status === 409) dispatch({ type: 'BUSY', attemptId });
        else dispatch({ type: 'FAIL', attemptId,
          error: error.status === 401 ? 'Sign in to place a Home Line call.'
            : error.status === 403 ? 'Your account does not have permission to place Home Line calls.' : error.message,
          reason: error.status === 401 ? 'auth_required' : error.status === 403 ? 'call_forbidden' : 'reservation_failed' });
      }
    };
    void run();
    return () => controller.abort();
  }, [state.attemptId, state.callId, state.target, state.value]);

  const onSignalEvent = useCallback(event => {
    const attemptId = stateRef.current.attemptId;
    if (!attemptId) return;
    if (event.type === 'tv-ready') dispatch({ type: 'TV_READY', attemptId });
    else if (event.type === 'answered') dispatch({ type: 'ANSWERED', attemptId, deadlineAt: Date.now() + 8_000 });
    else if (event.type === 'hangup') dispatch({ type: 'CANCEL', attemptId, reason: 'remote_hangup' });
    else if (event.type === 'control-status') dispatch({ type: 'CONTROL_STATUS', attemptId, connected: event.connected });
    else if (event.type === 'error') dispatch({ type: 'FAIL', attemptId, error: event.error.message, reason: 'signaling_failed' });
  }, []);
  const signaling = useCallSignaling({ role: 'phone', session: state.session, peer, onEvent: onSignalEvent });
  const activeAttemptId = state.attemptId;
  const activeCallId = state.callId;
  const activeDispatchId = state.dispatchId;
  const activeTargetId = state.target?.id;
  const activePhonePeerId = state.session?.peerId;
  const activeStateValue = state.value;
  const activePeerRevision = state.peerRevision;

  useEffect(() => {
    if (state.value !== 'probing') return undefined;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const timer = later(() => dispatch({ type: 'PROBE_TIMEOUT', attemptId }), 2_000);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }, [later, state.attemptId, state.value]);

  useEffect(() => {
    if (state.value !== 'waking') return undefined;
    const attemptId = state.attemptId;
    const controller = new AbortController(); abortRef.current = controller;
    const run = async () => {
      try {
        const recovery = state.reason === 'soft_recovery' ? 'soft' : state.reason === 'hard_recovery' ? 'hard' : null;
        const result = recovery
          ? await DaylightAPI(`api/v1/homeline/calls/${state.callId}/recover`, {
            level: recovery, ...(recovery === 'hard' ? { confirmed: true } : {}),
          }, 'POST', { signal: controller.signal })
          : await DaylightAPI(`api/v1/homeline/calls/${state.callId}/wake`, {}, 'POST', { signal: controller.signal });
        if (isAttemptActive(stateRef.current, attemptId)) dispatch({ type: 'WAKE_OK', attemptId,
          coldWake: result.coldWake, deadlineAt: Date.now() + (result.coldWake ? 75_000 : 45_000) });
      } catch (error) {
        if (!controller.signal.aborted && isAttemptActive(stateRef.current, attemptId)) {
          dispatch({ type: state.reason === 'soft_recovery' || state.reason === 'hard_recovery'
            ? 'RECOVERY_EXHAUSTED' : 'WAKE_FAILED', attemptId, error: error.message,
          reason: state.reason === 'soft_recovery' || state.reason === 'hard_recovery'
            ? 'recovery_failed' : 'wake_failed' });
        }
      }
    };
    void run(); return () => controller.abort();
  }, [state.attemptId, state.callId, state.reason, state.value]);

  useEffect(() => {
    if (state.value !== 'waiting_tv') return undefined;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const timer = later(() => dispatch({ type: 'WAIT_TIMEOUT', attemptId }), state.coldWake ? 75_000 : 45_000);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }, [later, state.attemptId, state.coldWake, state.value]);

  const health = useMediaHealth(peer, ['verifying_media', 'connected', 'degraded', 'reconnecting'].includes(state.value), remoteVideoRef);
  useEffect(() => {
    if (!health.verified || !activeAttemptId) return;
    const healthKey = `${health.audio}:${health.video}`;
    if (previousHealthRef.current !== healthKey) {
      loggerRef.current.info('call.media-health.changed', {
        callId: activeCallId, attemptId: activeAttemptId, dispatchId: activeDispatchId,
        deviceId: activeTargetId, phonePeerId: activePhonePeerId,
        state: activeStateValue, peerRevision: activePeerRevision,
        outcome: health.audio && health.video ? 'healthy' : health.audio ? 'audio_only' : health.video ? 'video_only' : 'unhealthy',
      });
      previousHealthRef.current = healthKey;
    }
    dispatch({ type: 'MEDIA_HEALTH', attemptId: activeAttemptId, audio: health.audio, video: health.video });
    if (health.audio || health.video) signaling.send('media-verified', { audio: health.audio, video: health.video });
  }, [activeAttemptId, activeCallId, activeDispatchId, activePeerRevision,
    activePhonePeerId, activeStateValue, activeTargetId, health, signaling]);

  useEffect(() => {
    if (!state.attemptId || !['connected', 'degraded', 'verifying_media', 'reconnecting'].includes(state.value)) return undefined;
    if (peer.connectionState === 'connected') {
      iceRungRef.current = 0; iceLadderRunningRef.current = false; return undefined;
    }
    if (peer.connectionState !== 'disconnected' && peer.connectionState !== 'failed') return undefined;
    if (iceLadderRunningRef.current) return undefined;
    iceLadderRunningRef.current = true;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const grace = later(async () => {
      if (!isAttemptActive(stateRef.current, attemptId)) return;
      dispatch({ type: 'ICE_INTERRUPTED', attemptId, deadlineAt: Date.now() + 10_000 });
      try {
        const liveConnection = () => peerConnectionRef.current?.connectionState;
        const rebuildWithDeadline = async () => {
          iceRungRef.current = 2;
          const peerRevision = await signaling.rebuild();
          if (Number.isInteger(peerRevision) && isAttemptActive(stateRef.current, attemptId)) {
            dispatch({ type: 'PEER_REVISION', attemptId, peerRevision });
          }
          later(() => {
            if (liveConnection() !== 'connected' && isAttemptActive(stateRef.current, attemptId)) {
              dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId });
            }
          }, 15_000);
        };
        if (iceRungRef.current === 0) {
          iceRungRef.current = 1; await signaling.restartIce();
          later(() => {
            if (liveConnection() !== 'connected' && isAttemptActive(stateRef.current, attemptId)) void rebuildWithDeadline();
          }, 10_000);
        } else if (iceRungRef.current === 1) await rebuildWithDeadline();
        else dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId });
      } catch (error) { dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId, error: error.message }); }
    }, peer.connectionState === 'disconnected' ? 5_000 : 0);
    return () => {
      const wasPending = timers.delete(grace);
      clearTimeout(grace);
      if (wasPending) iceLadderRunningRef.current = false;
    };
  }, [later, peer.connectionState, peerConnectionRef, signaling, state.attemptId, state.value]);

  const end = useCallback(reason => {
    // Best-effort and ephemeral: notify the TV before clearing the authorized
    // session and revoking both credentials through the lease end endpoint.
    signaling.send('hangup', { reason });
    dispatch({ type: 'CANCEL', attemptId: stateRef.current.attemptId, reason });
  }, [signaling]);
  const retryMedia = useCallback(async () => {
    const attemptId = stateRef.current.attemptId;
    if (!attemptId || stateRef.current.value !== 'degraded' || iceLadderRunningRef.current) return;
    iceLadderRunningRef.current = true;
    dispatch({ type: 'RETRY_MEDIA', attemptId });
    try {
      await retryLocalMedia?.();
      if (!isAttemptActive(stateRef.current, attemptId)) return;
      signaling.send('media-retry');
      const peerRevision = await signaling.rebuild();
      if (Number.isInteger(peerRevision) && isAttemptActive(stateRef.current, attemptId)) {
        dispatch({ type: 'PEER_REVISION', attemptId, peerRevision });
      }
      later(() => {
        iceLadderRunningRef.current = false;
        if (peerConnectionRef.current?.connectionState !== 'connected'
          && isAttemptActive(stateRef.current, attemptId)) {
          dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId });
        }
      }, 15_000);
    } catch (error) {
      iceLadderRunningRef.current = false;
      if (isAttemptActive(stateRef.current, attemptId)) {
        dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId, error: error.message });
      }
    }
  }, [later, peerConnectionRef, retryLocalMedia, signaling]);
  useEffect(() => {
    if (state.value !== 'ending') return;
    const { callId, attemptId, reason } = state;
    clearWork(); sessionStorage.removeItem('homeline.activeCall');
    void (callId ? DaylightAPI(`api/v1/homeline/calls/${callId}/end`, { reason }, 'POST').catch(error =>
      loggerRef.current.warn('call.end.failed', { callId, reason: error.message })) : Promise.resolve())
      .finally(() => dispatch({ type: 'ENDED', attemptId }));
  }, [clearWork, state]);
  useEffect(() => {
    if (state.value !== 'failed') return;
    const { callId, reason } = state;
    clearWork();
    sessionStorage.removeItem('homeline.activeCall');
    if (callId) void DaylightAPI(`api/v1/homeline/calls/${callId}/end`, { reason }, 'POST')
      .catch(error => loggerRef.current.warn('call.failed-teardown.failed', { callId, reason: error.message }));
  }, [clearWork, state]);
  useEffect(() => () => clearWork(), [clearWork]);

  return useMemo(() => ({ state, start, resume, end, retryMedia, dispatch,
    sendMuteState: payload => signaling.send('mute-state', payload) }),
    [end, resume, retryMedia, signaling, start, state]);
}
