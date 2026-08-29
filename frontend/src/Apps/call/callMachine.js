export const CALL_STATES = Object.freeze([
  'booting', 'idle', 'reserving', 'probing', 'waking', 'waiting_tv', 'negotiating',
  'verifying_media', 'connected', 'degraded', 'reconnecting', 'recovery_prompt',
  'occupied', 'ending', 'ended', 'failed',
]);
export const CALL_EVENTS = Object.freeze([
  'BOOT_READY', 'BOOT_FAILED', 'START', 'RESUME', 'RESERVED', 'BUSY', 'PROBE_TIMEOUT',
  'WAKE_OK', 'TV_READY', 'ANSWERED', 'MEDIA_HEALTH', 'ICE_INTERRUPTED', 'CONTROL_STATUS',
  'WAIT_TIMEOUT', 'SOFT_RECOVERY', 'HARD_RECOVERY', 'RETRY_MEDIA', 'RECOVERY_EXHAUSTED',
  'FAIL', 'CANCEL', 'ENDED', 'DISMISS', 'RETRY_CALL',
]);

const terminal = new Set(['ending', 'ended', 'failed']);

export const initialCallState = Object.freeze({
  value: 'booting', attemptId: null, callId: null, dispatchId: null, target: null,
  peerRevision: 0, retryCount: 0, recoveryCount: 0, hardRecoveryUsed: false,
  media: { audio: false, video: false }, controlConnected: true,
  reason: null, error: null, coldWake: false, session: null,
  deadlineAt: null,
});

export const ALLOWED_CALL_EVENTS = Object.freeze({
  booting: ['BOOT_READY', 'BOOT_FAILED'], idle: ['START', 'RESUME'],
  reserving: ['RESERVED', 'BUSY', 'FAIL', 'CANCEL'], probing: ['TV_READY', 'PROBE_TIMEOUT', 'CANCEL'],
  waking: ['WAKE_OK', 'FAIL', 'CANCEL'], waiting_tv: ['TV_READY', 'WAIT_TIMEOUT', 'FAIL', 'CANCEL'],
  negotiating: ['ANSWERED', 'ICE_INTERRUPTED', 'FAIL', 'CANCEL'],
  verifying_media: ['MEDIA_HEALTH', 'ICE_INTERRUPTED', 'FAIL', 'CANCEL'],
  connected: ['MEDIA_HEALTH', 'ICE_INTERRUPTED', 'CONTROL_STATUS', 'CANCEL'],
  degraded: ['MEDIA_HEALTH', 'ICE_INTERRUPTED', 'RETRY_MEDIA', 'CONTROL_STATUS', 'CANCEL'],
  reconnecting: ['MEDIA_HEALTH', 'RECOVERY_EXHAUSTED', 'FAIL', 'CANCEL'],
  recovery_prompt: ['SOFT_RECOVERY', 'HARD_RECOVERY', 'RETRY_CALL', 'CANCEL'],
  occupied: ['DISMISS', 'RETRY_CALL'], ending: ['ENDED'], ended: ['START'], failed: ['RETRY_CALL', 'DISMISS'],
});

export function callReducer(state, event) {
  if (!event || typeof event.type !== 'string') return state;
  if (event.attemptId && state.attemptId && event.attemptId !== state.attemptId) return state;
  if (!ALLOWED_CALL_EVENTS[state.value]?.includes(event.type)) return state;

  switch (event.type) {
    case 'BOOT_READY': return { ...initialCallState, value: 'idle' };
    case 'BOOT_FAILED': return { ...initialCallState, value: 'failed', error: event.error, reason: 'boot_failed' };
    case 'START': return { ...initialCallState, value: 'reserving', attemptId: event.attemptId, target: event.target };
    case 'RESUME': return { ...initialCallState, value: 'reserving', attemptId: event.attemptId, callId: event.callId, target: event.target };
    case 'RESERVED': return { ...state, value: 'probing', callId: event.session.callId,
      attemptId: event.session.attemptId || state.attemptId,
      dispatchId: event.session.dispatchId, session: event.session,
      deadlineAt: event.deadlineAt ?? null };
    case 'BUSY': return { ...state, value: 'occupied', reason: 'device_busy' };
    case 'PROBE_TIMEOUT': return { ...state, value: 'waking', deadlineAt: null };
    case 'WAKE_OK': return { ...state, value: 'waiting_tv', coldWake: !!event.coldWake,
      deadlineAt: event.deadlineAt ?? null };
    case 'TV_READY': return { ...state, value: 'negotiating', deadlineAt: state.session?.expiresAt ?? null };
    case 'ANSWERED': return { ...state, value: 'verifying_media', deadlineAt: event.deadlineAt ?? null };
    case 'MEDIA_HEALTH': {
      const media = { audio: !!event.audio, video: !!event.video };
      if (media.audio && media.video) return { ...state, value: 'connected', media, deadlineAt: null };
      if (media.audio || media.video) return { ...state, value: 'degraded', media, deadlineAt: null };
      return state.value === 'verifying_media' ? { ...state, value: 'recovery_prompt', media, reason: 'media_unverified', deadlineAt: null }
        : { ...state, value: 'reconnecting', media, reason: 'media_lost', deadlineAt: event.deadlineAt ?? null };
    }
    case 'ICE_INTERRUPTED': return { ...state, value: 'reconnecting', reason: event.reason || 'ice_interrupted',
      deadlineAt: event.deadlineAt ?? null };
    case 'CONTROL_STATUS': return { ...state, controlConnected: !!event.connected };
    case 'WAIT_TIMEOUT': return state.recoveryCount < 1
      ? { ...state, value: 'waking', recoveryCount: 1, reason: 'soft_recovery', deadlineAt: null }
      : { ...state, value: 'recovery_prompt', reason: 'tv_unavailable', deadlineAt: null };
    case 'SOFT_RECOVERY': return state.recoveryCount < 1
      ? { ...state, value: 'waking', recoveryCount: 1, reason: 'soft_recovery', deadlineAt: null } : state;
    case 'HARD_RECOVERY': return state.hardRecoveryUsed ? state : { ...state, value: 'waking', hardRecoveryUsed: true,
      recoveryCount: state.recoveryCount + 1, reason: 'hard_recovery', deadlineAt: null };
    case 'RETRY_MEDIA': return { ...state, value: 'reconnecting', retryCount: state.retryCount + 1 };
    case 'RECOVERY_EXHAUSTED': return { ...state, value: 'recovery_prompt', reason: 'recovery_exhausted', deadlineAt: null };
    case 'FAIL': return { ...state, value: 'failed', error: event.error,
      reason: event.reason || 'failed', session: null };
    case 'CANCEL': return { ...state, value: 'ending', reason: event.reason || 'cancelled', session: null, deadlineAt: null };
    case 'ENDED': return { ...initialCallState, value: 'ended', reason: state.reason };
    case 'DISMISS': return { ...initialCallState, value: 'idle' };
    case 'RETRY_CALL': return { ...initialCallState, value: 'idle' };
    default: return state;
  }
}

export function isAttemptActive(state, attemptId) {
  return state.attemptId === attemptId && !terminal.has(state.value);
}
