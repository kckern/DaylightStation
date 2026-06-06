/**
 * useFitnessStateSync - generic debounced/throttled state push to a backend
 * fitness endpoint.
 *
 * Fire-and-forget: schedules a POST whenever the change-detection signature
 * changes while a session is active, throttled to avoid spamming the backend.
 * On session end (sessionActive true->false) it sends an immediate end-payload,
 * and on unmount it fires a best-effort sendBeacon. Shared by useZoneLedSync
 * and useEquipmentFanSync.
 *
 * @param {Object} o
 * @param {string} o.endpoint - API path, e.g. 'api/v1/fitness/equipment_fan'
 * @param {boolean} o.enabled
 * @param {boolean} o.sessionActive
 * @param {() => string} o.buildSignature - change-detection signature
 * @param {() => object} o.buildPayload - snapshot payload to POST
 * @param {() => object} [o.buildEndPayload] - payload on session-end/unmount
 * @param {number} [o.throttleMs=5000]
 * @param {number} [o.debounceMs=1000]
 */
import { useRef, useCallback, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';

export function useFitnessStateSync({
  endpoint,
  enabled = false,
  sessionActive = false,
  buildSignature,
  buildPayload,
  buildEndPayload,
  throttleMs = 5000,
  debounceMs = 1000
}) {
  const lastSigRef = useRef(null);
  const lastSentRef = useRef(0);
  const debounceRef = useRef(null);
  const wasActiveRef = useRef(false);
  const mountedRef = useRef(true);

  // Hold latest builders in refs so the effects below can keep honest, minimal
  // dependency arrays without capturing stale closures or re-registering every
  // render of the (frequently-rendering) FitnessContext.
  const buildPayloadRef = useRef(buildPayload);
  const buildEndPayloadRef = useRef(buildEndPayload);
  buildPayloadRef.current = buildPayload;
  buildEndPayloadRef.current = buildEndPayload;

  const post = useCallback((payload) => {
    try { DaylightAPI(endpoint, payload, 'POST').catch(() => {}); } catch (_) { /* never interrupt a workout */ }
  }, [endpoint]);

  // Compute the change-detection signature each render; the scheduling effect is
  // keyed off its VALUE, so it only re-runs when the signature actually changes.
  const signature = enabled ? (buildSignature?.() ?? '') : '';

  useEffect(() => {
    if (!enabled || !sessionActive) return;
    if (signature === lastSigRef.current) return;
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    const elapsed = Date.now() - lastSentRef.current;
    const remainingThrottle = Math.max(0, throttleMs - elapsed);
    const delay = remainingThrottle > 0 ? remainingThrottle : debounceMs;
    const sigAtSchedule = signature;
    debounceRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      lastSigRef.current = sigAtSchedule;
      lastSentRef.current = Date.now();
      debounceRef.current = null;
      post(buildPayloadRef.current?.() ?? {});
    }, delay);
  }, [enabled, sessionActive, signature, throttleMs, debounceMs, post]);

  // Session start/end transitions
  useEffect(() => {
    const was = wasActiveRef.current;
    wasActiveRef.current = sessionActive;
    if (was && !sessionActive && enabled) {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      lastSigRef.current = null;
      post(buildEndPayloadRef.current?.() ?? {});
    }
    if (!was && sessionActive) {
      lastSigRef.current = null;
      lastSentRef.current = 0;
    }
  }, [sessionActive, enabled, post]);

  // Unmount: best-effort beacon
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
      if (wasActiveRef.current && enabled && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        try {
          navigator.sendBeacon(
            `${window.location.origin}/${endpoint.replace(/^\//, '')}`,
            JSON.stringify(buildEndPayloadRef.current?.() ?? {})
          );
        } catch (_) { /* best effort */ }
      }
    };
  }, [enabled, endpoint]);
}

export default useFitnessStateSync;
