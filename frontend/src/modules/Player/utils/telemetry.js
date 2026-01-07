import { playbackLog } from '../lib/playbackLogger.js';

export const logResilienceEvent = (event, payload = {}, options = {}) => {
  const safeEvent = typeof event === 'string' && event.length ? event : 'unknown';
  playbackLog(`resilience.${safeEvent}`, payload || {}, options || {});
};

export const metrics = {
  stallCount: (payload = {}, options = {}) => playbackLog('metric.player_stall_total', payload || {}, options || {}),
  stallDurationMs: (payload = {}, options = {}) => playbackLog('metric.player_stall_duration_ms', payload || {}, options || {}),
  recoveryAttempt: (payload = {}, options = {}) => playbackLog('metric.player_recovery_total', payload || {}, options || {})
};
