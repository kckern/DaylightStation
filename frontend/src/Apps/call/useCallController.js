import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { callReducer, initialCallState, isAttemptActive } from './callMachine.js';
import { useCallSignaling } from '../../modules/Input/hooks/useCallSignaling.js';
import { useMediaHealth } from '../../modules/Input/hooks/useMediaHealth.js';

const randomId = prefix => `${prefix}-${crypto.randomUUID()}`;

// Setup budgets. A cold wake is a Shield booting; the others are a page that
// is already up and only has to answer.
const WAIT_TIMEOUT_MS = 45_000;
const COLD_WAIT_TIMEOUT_MS = 75_000;
const NEGOTIATE_TIMEOUT_MS = 20_000;

export function useCallController({ peer, mediaStatus, retryLocalMedia, remoteVideoRef }) {
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const stateRef = useRef(state); stateRef.current = state;
  const abortRef = useRef(null);
  const timersRef = useRef(new Set());
  const loggerRef = useRef(getLogger().child({ component: 'CallController' }));
  const iceRungRef = useRef(0);
  const ladderRef = useRef(null); // attemptId whose recovery ladder is in flight
  const retryMediaRef = useRef(null);
  const peerConnectionRef = peer.pcRef;
  const previousStateRef = useRef(null);
  // `peer` is a fresh object whenever useWebRTCPeer's state moves (remote
  // stream attached, connection state changed). Anything that tears work
  // down must read it through a ref: a callback keyed on `peer` identity
  // re-ran the unmount cleanup in the middle of building the offer, which
  // closed the half-built peer connection and cleared every timer.
  const peerRef = useRef(peer); peerRef.current = peer;

  useEffect(() => {
    const previousState = previousStateRef.current;
    if (previousState === state.value) return;
    loggerRef.current.info('call.state.transition', {
      callId: state.callId, attemptId: state.attemptId, dispatchId: state.dispatchId,
      deviceId: state.target?.id, state: state.value, previousState,
      peerRevision: state.peerRevision, recoveryRung: state.reason,
    });
    previousStateRef.current = state.value;
  }, [state]);

  const clearWork = useCallback(() => {
    abortRef.current?.abort(); abortRef.current = null;
    timersRef.current.forEach(clearTimeout); timersRef.current.clear();
    iceRungRef.current = 0; ladderRef.current = null;
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
    const attemptId = randomId('attempt');
    dispatch({ type: 'START', attemptId, target });
  }, [clearWork]);
  const resume = useCallback((target, callId) => {
    clearWork();
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
        dispatch({ type: 'RESERVED', attemptId, session });
      } catch (error) {
        if (controller.signal.aborted || !isAttemptActive(stateRef.current, attemptId)) return;
        if (error.status === 409) dispatch({ type: 'BUSY', attemptId });
        // Home Line asks nobody to sign in. The only refusal left is reaching
        // it from off the house network, so the copy names that, not an account.
        else if (error.status === 401) dispatch({ type: 'FAIL', attemptId, reason: 'off_network', error: 'Home Line only works on the home network or over the VPN.' });
        else if (error.status === 403) dispatch({ type: 'FAIL', attemptId, reason: 'call_forbidden', error: 'This device is not allowed to place a Home Line call.' });
        else dispatch({ type: 'FAIL', attemptId, error: error.message, reason: 'reservation_failed' });
      }
    };
    void run();
    return () => controller.abort();
  }, [state.attemptId, state.callId, state.target, state.value]);

  const onSignalEvent = useCallback(event => {
    const attemptId = stateRef.current.attemptId;
    if (!attemptId) return;
    if (event.type === 'tv-ready') dispatch({ type: 'TV_READY', attemptId });
    else if (event.type === 'answered') dispatch({ type: 'ANSWERED', attemptId });
    else if (event.type === 'hangup') dispatch({ type: 'CANCEL', attemptId, reason: 'remote_hangup' });
    else if (event.type === 'control-status') dispatch({ type: 'CONTROL_STATUS', attemptId, connected: event.connected });
    else if (event.type === 'error') dispatch({ type: 'FAIL', attemptId, error: event.error.message, reason: 'signaling_failed' });
  }, []);
  const signaling = useCallSignaling({ role: 'phone', session: state.session, peer, onEvent: onSignalEvent });

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
          ? await DaylightAPI(`api/v1/homeline/calls/${state.callId}/recover`, { level: recovery }, 'POST', { signal: controller.signal })
          : await DaylightAPI(`api/v1/homeline/calls/${state.callId}/wake`, {}, 'POST', { signal: controller.signal });
        if (isAttemptActive(stateRef.current, attemptId)) dispatch({ type: 'WAKE_OK', attemptId, coldWake: result.coldWake });
      } catch (error) {
        if (!controller.signal.aborted && isAttemptActive(stateRef.current, attemptId)) {
          dispatch({ type: 'FAIL', attemptId, error: error.message, reason: 'wake_failed' });
        }
      }
    };
    void run(); return () => controller.abort();
  }, [state.attemptId, state.callId, state.reason, state.value]);

  useEffect(() => {
    if (state.value !== 'waiting_tv') return undefined;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const timer = later(() => dispatch({ type: 'WAIT_TIMEOUT', attemptId }), state.coldWake ? COLD_WAIT_TIMEOUT_MS : WAIT_TIMEOUT_MS);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }, [later, state.attemptId, state.coldWake, state.value]);

  // `negotiating` used to be the one setup state with no clock on it: an offer
  // that never got an answer read "Connecting securely…" until the caller hung
  // up, and the record then blamed the caller. The warn line carries what the
  // peer was doing at the moment the budget ran out.
  useEffect(() => {
    if (state.value !== 'negotiating') return undefined;
    // Depend on fields, not the state object: a control-socket flap must not
    // restart this clock.
    const { attemptId, callId, peerRevision, recoveryCount } = stateRef.current;
    const timers = timersRef.current;
    const timer = later(() => {
      loggerRef.current.warn('call.negotiate.timeout', {
        callId, attemptId, peerRevision, recoveryCount,
        connectionState: peerConnectionRef.current?.connectionState ?? null,
      });
      dispatch({ type: 'NEGOTIATE_TIMEOUT', attemptId });
    }, NEGOTIATE_TIMEOUT_MS);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }, [later, peerConnectionRef, state.attemptId, state.value]);

  const health = useMediaHealth(peer, ['verifying_media', 'connected', 'degraded', 'reconnecting'].includes(state.value), remoteVideoRef);
  const verifiedSentRef = useRef(null);
  useEffect(() => {
    if (!health.verified || !state.attemptId) return;
    dispatch({ type: 'MEDIA_HEALTH', attemptId: state.attemptId, audio: health.audio, video: health.video });
    // One report per verified result per attempt and peer revision. The
    // monitor re-polls every 2s; re-sending on every poll was 30 signals a
    // minute for the server to log and nothing for it to learn.
    const key = `${state.attemptId}:${state.peerRevision}:${health.audio}:${health.video}`;
    if (!(health.audio || health.video) || verifiedSentRef.current === key) return;
    verifiedSentRef.current = key;
    signaling.send('media-verified', { audio: health.audio, video: health.video });
  }, [health, signaling, state.attemptId, state.peerRevision]);

  useEffect(() => {
    if (!state.attemptId || !['connected', 'degraded', 'verifying_media', 'reconnecting'].includes(state.value)) return undefined;
    if (peer.connectionState === 'connected') { iceRungRef.current = 0; ladderRef.current = null; return undefined; }
    if (peer.connectionState !== 'disconnected' && peer.connectionState !== 'failed') return undefined;
    // ICE_INTERRUPTED re-runs this effect with the peer still down. The ladder
    // it started is climbing on its own timers; do not start a second one.
    if (ladderRef.current === state.attemptId) return undefined;
    const attemptId = state.attemptId;
    const timers = timersRef.current;
    const grace = later(async () => {
      if (!isAttemptActive(stateRef.current, attemptId)) return;
      ladderRef.current = attemptId;
      dispatch({ type: 'ICE_INTERRUPTED', attemptId });
      try {
        const liveConnection = () => peerConnectionRef.current?.connectionState;
        const rebuildWithDeadline = async () => {
          iceRungRef.current = 2;
          await signaling.rebuild();
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
    return () => { clearTimeout(grace); timers.delete(grace); };
  }, [later, peer.connectionState, peerConnectionRef, signaling, state.attemptId, state.value]);

  const end = useCallback(reason => {
    signaling.send('hangup', { reason });
    dispatch({ type: 'CANCEL', attemptId: stateRef.current.attemptId, reason });
  }, [signaling]);
  const retryMedia = useCallback(async () => {
    if (retryMediaRef.current) return retryMediaRef.current;
    const attemptId = stateRef.current.attemptId;
    const run = (async () => {
      dispatch({ type: 'RETRY_MEDIA', attemptId });
      await retryLocalMedia?.();
      const peerRevision = await signaling.rebuild();
      dispatch({ type: 'PEER_REBUILT', attemptId, peerRevision });
      later(() => {
        if (isAttemptActive(stateRef.current, attemptId)) dispatch({ type: 'RECOVERY_EXHAUSTED', attemptId });
      }, 15_000);
    })();
    retryMediaRef.current = run;
    try { await run; } finally { retryMediaRef.current = null; }
  }, [later, retryLocalMedia, signaling]);
  useEffect(() => {
    if (state.value !== 'ending') return;
    const { callId, attemptId, reason } = state;
    clearWork(); sessionStorage.removeItem('homeline.activeCall');
    void (callId ? DaylightAPI(`api/v1/homeline/calls/${callId}/end`, { reason }, 'POST').catch(error =>
      loggerRef.current.warn('call.end.failed', { callId, reason: error.message })) : Promise.resolve())
      .finally(() => dispatch({ type: 'ENDED', attemptId }));
  }, [clearWork, state]);
  // Unmount only. `clearWork` is identity-stable, so this never re-fires.
  useEffect(() => () => clearWork(), [clearWork]);

  return useMemo(() => ({ state, start, resume, end, retryMedia, dispatch, sendMuteState: payload => signaling.send('mute-state', payload) }),
    [end, resume, retryMedia, signaling, start, state]);
}
