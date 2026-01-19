/**
 * useZoneLedSync - Ambient LED Zone Synchronization Hook
 * 
 * Syncs participant heart rate zones with Home Assistant LED scenes
 * via the backend /fitness/zone_led endpoint.
 * 
 * Features:
 * - Throttled updates (default 5s) to avoid spamming backend
 * - Debounced zone changes (1s) for stability
 * - Automatic session-end LED-off
 * - Graceful degradation on errors
 */

import { useRef, useCallback, useEffect } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import { getLogger } from '../../lib/logging/Logger.js';

const THROTTLE_MS = 5000; // Minimum interval between LED updates
const DEBOUNCE_MS = 1000; // Wait for zone stability before sending

/**
 * Build a signature string for zone state comparison
 * @param {Array} roster - Participant roster with zoneId and isActive
 * @returns {string} Signature for comparison
 */
function buildZoneSignature(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return 'empty';
  
  const normalized = roster
    .filter(p => p && p.isActive !== false)
    .map(p => p.zoneId || 'unknown')
    .sort()
    .join(',');
  
  return normalized || 'empty';
}

/**
 * Hook to sync participant zones with ambient LED scenes
 * 
 * @param {Object} options
 * @param {Array} options.participantRoster - Array of {zoneId, isActive} objects
 * @param {boolean} options.sessionActive - Whether a fitness session is currently active
 * @param {boolean} options.enabled - Whether the feature is enabled (from config)
 * @param {string} options.householdId - Household ID for multi-household support
 */
export function useZoneLedSync({
  participantRoster = [],
  sessionActive = false,
  enabled = false,
  householdId = null
}) {
  // Debug logging on every render
 

  // Refs for throttling and debouncing
  const lastSentSignatureRef = useRef(null);
  const lastSentTimeRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const pendingUpdateRef = useRef(null);
  const wasSessionActiveRef = useRef(false);
  const mountedRef = useRef(true);

  /**
   * Send zone update to backend
   */
  const sendZoneUpdate = useCallback(async (zones, sessionEnded = false) => {
    if (!mountedRef.current) return;
    if (!enabled && !sessionEnded) return;
    
    try {
      const payload = {
        zones: zones.map(z => ({
          zoneId: z.zoneId || null,
          isActive: z.isActive !== false
        })),
        sessionEnded,
        householdId,
        timestamp: Date.now()
      };
      
      // Log zone LED activation (sampled to reduce volume)
      const activeZones = payload.zones.filter(z => z.isActive && z.zoneId);
      getLogger().sampled('fitness.zone_led.activated', {
        zoneCount: activeZones.length,
        zoneIds: activeZones.map(z => z.zoneId),
        sessionEnded,
        householdId
      }, { maxPerMinute: 20 });

      // Fire and forget - don't block on response
      DaylightAPI('api/fitness/zone_led', payload, 'POST').catch(err => {
        // Silent failure - LED sync should never interrupt workout
        console.debug('[ZoneLED] Update failed (non-blocking):', err.message);
      });
      
    } catch (err) {
      // Catch synchronous errors in payload building
      console.debug('[ZoneLED] Failed to build update:', err.message);
    }
  }, [enabled, householdId]);

  /**
   * Schedule a throttled/debounced zone update
   */
  const scheduleUpdate = useCallback((roster, force = false) => {
    if (!enabled) return;
    
    const signature = buildZoneSignature(roster);
    const now = Date.now();
    
    // Skip if signature unchanged (unless forced)
    if (!force && signature === lastSentSignatureRef.current) {
      return;
    }
    
    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    
    // Store pending update
    pendingUpdateRef.current = { roster, signature };
    
    // Calculate time until next allowed send
    const elapsed = now - lastSentTimeRef.current;
    const remainingThrottle = Math.max(0, THROTTLE_MS - elapsed);
    
    // If we're within throttle window, debounce; otherwise send after short debounce
    const delay = remainingThrottle > 0 ? remainingThrottle : DEBOUNCE_MS;
    
    debounceTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      
      const pending = pendingUpdateRef.current;
      if (!pending) return;
      
      // Update tracking state
      lastSentSignatureRef.current = pending.signature;
      lastSentTimeRef.current = Date.now();
      pendingUpdateRef.current = null;
      
      // Send the update
      sendZoneUpdate(pending.roster, false);
      
    }, delay);
    
  }, [enabled, sendZoneUpdate]);

  /**
   * Effect: Track roster changes and schedule updates
   */
  useEffect(() => {
    if (!enabled || !sessionActive) return;
    
    scheduleUpdate(participantRoster);
    
  }, [enabled, sessionActive, participantRoster, scheduleUpdate]);

  /**
   * Effect: Handle session start/end transitions
   */
  useEffect(() => {
    const wasActive = wasSessionActiveRef.current;
    wasSessionActiveRef.current = sessionActive;
    
    // Session just ended - send immediate LED-off
    if (wasActive && !sessionActive && enabled) {
      // Clear any pending updates
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingUpdateRef.current = null;
      lastSentSignatureRef.current = null;
      
      // Send session-end immediately (bypasses throttle on backend)
      sendZoneUpdate([], true);
    }
    
    // Session just started - reset state
    if (!wasActive && sessionActive) {
      lastSentSignatureRef.current = null;
      lastSentTimeRef.current = 0;
    }
    
  }, [sessionActive, enabled, sendZoneUpdate]);

  /**
   * Effect: Cleanup on unmount
   */
  useEffect(() => {
    mountedRef.current = true;
    
    return () => {
      mountedRef.current = false;
      
      // Clear pending timers
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      
      // If session was active on unmount, send LED-off
      if (wasSessionActiveRef.current && enabled) {
        // Use a direct fetch since refs may be stale
        try {
          const payload = {
            zones: [],
            sessionEnded: true,
            householdId,
            timestamp: Date.now()
          };
          // Beacon API for reliability during page unload
          if (navigator.sendBeacon) {
            navigator.sendBeacon(
              `${window.location.origin}/api/fitness/zone_led`,
              JSON.stringify(payload)
            );
          }
        } catch (_) {
          // Best effort - silent failure
        }
      }
    };
  }, [enabled, householdId]);

  // No return value needed - this hook is fire-and-forget
}

export default useZoneLedSync;
