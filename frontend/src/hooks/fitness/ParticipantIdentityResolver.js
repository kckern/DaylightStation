/**
 * ParticipantIdentityResolver - Single source of truth for participant ID resolution
 * 
 * This service centralizes ID resolution to prevent mismatches between:
 * - Timeline series keys (used when recording data)
 * - Roster profileId (used when rendering chart)
 * - Ledger occupantId (used in assignment persistence)
 * 
 * @see /docs/reviews/guest-assignment-service-audit.md - Issue #3
 */

import getLogger from '../../lib/logging/Logger.js';

/**
 * @typedef {Object} ResolvedIdentity
 * @property {string} id - The canonical ID to use
 * @property {'ledger' | 'user' | 'device'} source - Where the ID came from
 * @property {string|null} name - Display name if available
 */

export class ParticipantIdentityResolver {
  /**
   * @param {Object} config
   * @param {Object} config.userManager - UserManager instance
   * @param {Object} config.ledger - DeviceAssignmentLedger instance
   */
  constructor({ userManager, ledger } = {}) {
    this.userManager = userManager;
    this.ledger = ledger;
  }

  /**
   * Configure external dependencies
   * @param {Object} config
   */
  configure({ userManager, ledger }) {
    if (userManager !== undefined) this.userManager = userManager;
    if (ledger !== undefined) this.ledger = ledger;
  }

  /**
   * Resolve canonical ID for a participant by device ID
   * Priority order: ledger.metadata.profileId → user.id → deviceId
   * 
   * @param {string} deviceId - Device ID
   * @returns {ResolvedIdentity | null}
   */
  resolveByDevice(deviceId) {
    if (deviceId == null) return null;
    const deviceIdStr = String(deviceId);

    // Priority 1: Ledger has explicit profileId
    const ledgerEntry = this.ledger?.get?.(deviceIdStr);
    if (ledgerEntry?.metadata?.profileId) {
      return {
        id: ledgerEntry.metadata.profileId,
        source: 'ledger',
        name: ledgerEntry.occupantName || ledgerEntry.metadata?.name || null
      };
    }

    // Priority 2: User has explicit ID
    const user = this.userManager?.resolveUserForDevice?.(deviceIdStr);
    if (user?.id) {
      return {
        id: user.id,
        source: 'user',
        name: user.name || null
      };
    }

    // Priority 3: Fall back to device ID (warning case)
    return {
      id: deviceIdStr,
      source: 'device',
      name: null
    };
  }

  /**
   * Resolve canonical ID from a roster entry
   * Used by chart helpers to ensure consistent lookup
   * 
   * @param {Object} rosterEntry - Roster entry with id/profileId/name/hrDeviceId
   * @returns {ResolvedIdentity | null}
   */
  resolveFromRosterEntry(rosterEntry) {
    if (!rosterEntry) return null;

    // Prefer explicit canonical ID from roster
    const canonicalId = rosterEntry.id || rosterEntry.profileId;
    if (canonicalId) {
      return {
        id: canonicalId,
        source: 'user',
        name: rosterEntry.name || rosterEntry.displayLabel || null
      };
    }

    // Fall back to device-based resolution
    if (rosterEntry.hrDeviceId) {
      const resolved = this.resolveByDevice(rosterEntry.hrDeviceId);
      if (resolved) {
        // Log fallback usage for debugging
        getLogger().warn('identity_resolver.roster_entry_id_fallback', {
          name: rosterEntry.name,
          hrDeviceId: rosterEntry.hrDeviceId,
          resolvedId: resolved.id,
          resolvedSource: resolved.source
        });
        return resolved;
      }
    }

    if (rosterEntry.name) {
      getLogger().warn('identity_resolver.name_id_fallback', {
        name: rosterEntry.name
      });
      return {
        id: rosterEntry.name,
        source: 'device', // Treat as fallback
        name: rosterEntry.name
      };
    }

    return null;
  }

  /**
   * Get the timeline series key for a participant and metric
   * 
   * @param {string} deviceId - Device ID
   * @param {string} metric - Metric name (e.g., 'heart_rate', 'coins_total')
   * @returns {string | null}
   */
  getSeriesKey(deviceId, metric) {
    const resolved = this.resolveByDevice(deviceId);
    if (!resolved) return null;
    if (resolved.source === 'device') {
      getLogger().warn('identity_resolver.series_key_device_fallback', {
        deviceId: String(deviceId),
        metric,
        resolvedId: resolved.id
      });
      return null;
    }
    return `user:${resolved.id}:${metric}`;
  }

  /**
   * Validate that IDs are consistent between user and ledger
   * Used for telemetry/debugging
   * 
   * @param {string} deviceId - Device ID
   * @returns {{ consistent: boolean, userId: string|null, ledgerId: string|null, deviceId: string }}
   */
  validateConsistency(deviceId) {
    if (deviceId == null) {
      return { consistent: true, userId: null, ledgerId: null, deviceId: null };
    }
    const deviceIdStr = String(deviceId);

    const ledgerEntry = this.ledger?.get?.(deviceIdStr);
    const ledgerId = ledgerEntry?.metadata?.profileId || ledgerEntry?.occupantId || null;

    const user = this.userManager?.resolveUserForDevice?.(deviceIdStr);
    const userId = user?.id || null;

    // Both null = consistent (no assignment)
    // Both same = consistent
    // Both different = inconsistent
    const consistent = !ledgerId || !userId || ledgerId === userId;

    return {
      consistent,
      userId,
      ledgerId,
      deviceId: deviceIdStr
    };
  }

  /**
   * Log ID mismatch for telemetry
   * 
   * @param {string} deviceId
   * @param {Object} [eventJournal] - Optional event journal for persistent logging
   */
  logMismatchIfFound(deviceId, eventJournal = null) {
    const validation = this.validateConsistency(deviceId);
    if (!validation.consistent) {
      console.error('[ParticipantIdentityResolver] ID MISMATCH:', validation);
      if (eventJournal?.log) {
        eventJournal.log('ID_MISMATCH', validation, { severity: 'error' });
      }
    }
    return validation;
  }
}

// Singleton for global access (optional)
let _globalResolver = null;

/**
 * Get or create global resolver instance
 * @param {Object} [config] - Optional config to update
 * @returns {ParticipantIdentityResolver}
 */
export const getParticipantIdentityResolver = (config) => {
  if (!_globalResolver) {
    _globalResolver = new ParticipantIdentityResolver(config || {});
  } else if (config) {
    _globalResolver.configure(config);
  }
  return _globalResolver;
};

/**
 * Reset global resolver (for testing)
 */
export const resetParticipantIdentityResolver = () => {
  _globalResolver = null;
};
