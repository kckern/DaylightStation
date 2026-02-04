// Note: slugifyId removed - we now use explicit IDs
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';
import getLogger from '../../lib/logging/Logger.js';

/**
 * Phase 4: Grace period for session transfers.
 * If a participant has been active for less than this duration when replaced,
 * their session data (coins, start time, timeline) is transferred to the new participant.
 * 
 * @see /docs/design/guest-switch-session-transition.md
 */
const GRACE_PERIOD_MS = 60 * 1000; // 1 minute

export const validateGuestAssignmentPayload = (rawInput) => {
  const errors = [];
  const payload = typeof rawInput === 'string'
    ? { name: rawInput }
    : (rawInput && typeof rawInput === 'object' ? { ...rawInput } : {});

  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : 'Guest';

  if (!payload || typeof payload !== 'object') {
    errors.push('Assignment payload must be an object or string.');
  }

  if (!name) {
    errors.push('Assignment requires a name.');
  }

  const zones = Array.isArray(payload.zones) ? payload.zones : null;
  const baseUserName = typeof payload.baseUserName === 'string' && payload.baseUserName.trim()
    ? payload.baseUserName.trim()
    : null;
  const profileId = payload.profileId != null ? String(payload.profileId) : null;

  return {
    ok: errors.length === 0,
    errors,
    value: {
      name: name || 'Guest',
      zones,
      baseUserName,
      profileId,
      metadata: payload
    }
  };
};

export class GuestAssignmentService {
  constructor({ session, ledger } = {}) {
    this.session = session;
    this.ledger = ledger instanceof DeviceAssignmentLedger ? ledger : ledger || null;
  }

  #logEvent(type, data, options = {}) {
    const journal = this.session?.eventJournal || this.ledger?.eventJournal || null;
    if (!journal || !type) return;
    try {
      journal.log(type, data, options);
    } catch (_) {
      // ignore logging errors
    }
  }

  assignGuest(deviceId, assignment) {
    if (deviceId == null) {
      return { ok: false, code: 'invalid-device', message: 'Device id is required.' };
    }

    if (assignment == null) {
      return this.clearGuest(deviceId);
    }

    const validation = validateGuestAssignmentPayload(assignment);
    if (!validation.ok) {
      return { ok: false, code: 'invalid-payload', message: validation.errors.join(' ') };
    }

    const { value } = validation;
    const key = String(deviceId);
    const session = this.session;
    const now = Date.now();

    if (!session?.userManager) {
      return { ok: false, code: 'session-missing', message: 'User manager is not available.' };
    }

    // Validate one-device-per-user constraint
    const newProfileId = value.profileId || value.metadata?.profileId;
    const allowMultiAssign = value.allowWhileAssigned || value.metadata?.allowWhileAssigned;

    if (newProfileId && this.ledger && !allowMultiAssign) {
      for (const [existingDeviceId, entry] of this.ledger.entries.entries()) {
        if (existingDeviceId === key) continue; // Skip current device (update scenario)

        const existingProfileId = entry?.metadata?.profileId || entry?.occupantId;
        const existingAllowMulti = entry?.allowWhileAssigned || entry?.metadata?.allowWhileAssigned;

        if (existingProfileId === newProfileId && !existingAllowMulti) {
          return {
            ok: false,
            code: 'user-already-assigned',
            message: `User ${value.name || newProfileId} is already assigned to device ${existingDeviceId}`
          };
        }
      }
    }

    // Check for previous assignment on this device (Issue #4 remediation)
    // Log GUEST_REPLACED event when a different guest takes over
    const previousEntry = this.ledger?.get?.(key);
    const previousOccupantId = previousEntry?.metadata?.profileId || previousEntry?.occupantId;
    const previousEntityId = previousEntry?.entityId || null;
    const newOccupantId = value.profileId || `guest-${now}`;
    
    // Phase 4: Grace Period Transfer Logic
    // If previous assignment was active for less than GRACE_PERIOD_MS, transfer data to new participant
    // This works for both entity-to-entity transfers AND user-to-entity transfers
    let isGracePeriodTransfer = false;
    let transferredFromEntity = null;
    let transferFromUserId = null; // For user-to-entity transfers (original user has no entity)
    
    if (previousEntry && previousOccupantId && previousOccupantId !== newOccupantId) {
      const previousStartTime = previousEntry.updatedAt || previousEntry.metadata?.startTime || 0;
      const previousDuration = previousStartTime > 0 ? (now - previousStartTime) : Infinity;
      
      // Grace period applies if: duration < 1 min AND (has entity OR is original user)
      const hasTransferableSource = previousEntityId != null || previousOccupantId != null;
      isGracePeriodTransfer = previousDuration < GRACE_PERIOD_MS && hasTransferableSource;
      
      if (isGracePeriodTransfer) {
        // Grace period transfer: brief session gets merged into successor
        this.#logEvent('GRACE_PERIOD_TRANSFER', {
          deviceId: key,
          previousOccupantId,
          previousOccupantName: previousEntry.occupantName || previousEntry.metadata?.name,
          previousEntityId,
          previousDurationMs: previousDuration,
          newOccupantId,
          newOccupantName: value.name,
          transferType: previousEntityId ? 'entity-to-entity' : 'user-to-entity'
        });
        console.log('[GuestAssignmentService] Grace period transfer (< 1 min):', {
          deviceId: key,
          previous: previousEntry.occupantName,
          new: value.name,
          duration: `${Math.round(previousDuration / 1000)}s`,
          type: previousEntityId ? 'entity-to-entity' : 'user-to-entity'
        });
        
        if (previousEntityId) {
          transferredFromEntity = previousEntityId;
        } else {
          // Original user (no entity) - transfer from userId accumulator
          transferFromUserId = previousOccupantId;
        }
      } else {
        // Normal replacement: previous session exceeded grace period
        this.#logEvent('GUEST_REPLACED', {
          deviceId: key,
          previousOccupantId,
          previousOccupantName: previousEntry.occupantName || previousEntry.metadata?.name,
          previousEntityId,
          previousDurationMs: previousDuration,
          newOccupantId,
          newOccupantName: value.name
        });
        getLogger().warn('guest_assignment.guest_replaced', {
          deviceId: key,
          previous: previousEntry.occupantName,
          new: value.name,
          duration: `${Math.round(previousDuration / 1000)}s`
        });
        
        // End the previous entity as dropped (exceeded grace period)
        if (previousEntityId && session.endSessionEntity) {
          session.endSessionEntity(previousEntityId, {
            status: 'dropped',
            timestamp: now,
            reason: 'guest_replaced'
          });
        }
      }
    }

    // Create a new session entity for this assignment
    let entityId = null;
    
    getLogger().warn('guest_assignment.assignment_start', {
      deviceId: key,
      newOccupant: { id: newOccupantId, name: value.name },
      previousOccupant: { id: previousOccupantId, entityId: previousEntityId },
      isGracePeriodTransfer,
      transferFromUserId,
      hasCreateSessionEntity: !!session.createSessionEntity,
      hasTreasureBox: !!session.treasureBox,
      previousUserAccumulator: session.treasureBox ? session.treasureBox.perUser.get(previousOccupantId) : null
    });
    
    // For grace period user-to-guest transfer (< 1 min), DON'T create entity
    // The guest takes over the original user's identity completely
    // Data flows through user:newOccupantId series (which gets backfilled with original user's data)
    const skipEntityCreation = isGracePeriodTransfer && transferFromUserId && !transferredFromEntity;
    
    if (session.createSessionEntity && !skipEntityCreation) {
      // Phase 4: If grace period transfer, inherit start time from previous entity
      let inheritedStartTime = now;
      if (isGracePeriodTransfer && transferredFromEntity) {
        const previousEntity = session.entityRegistry?.get?.(transferredFromEntity);
        if (previousEntity?.startTime) {
          inheritedStartTime = previousEntity.startTime;
        }
      }
      
      const entity = session.createSessionEntity({
        profileId: newOccupantId,
        name: value.name,
        deviceId: key,
        startTime: inheritedStartTime
      });
      entityId = entity?.entityId || null;
      
    }

    // Phase 4/5: Execute transfer if within grace period
    if (isGracePeriodTransfer) {
      if (transferredFromEntity && entityId) {
        // Entity-to-entity transfer
        const transferResult = session.transferSessionEntity?.(transferredFromEntity, entityId);
        if (transferResult?.ok) {
          console.log('[GuestAssignmentService] Entity transfer complete:', {
            from: transferredFromEntity,
            to: entityId,
            coinsTransferred: transferResult.coinsTransferred,
            seriesTransferred: transferResult.seriesTransferred?.length || 0
          });
        }
      } else if (transferFromUserId) {
        // User-to-guest transfer (Jin takes over Soren's series directly)
        getLogger().warn('guest_assignment.user_series_transfer_start', { fromUserId: transferFromUserId, toUserId: newOccupantId });

        // Orchestrate full transfer via session (Phase 4/5)
        const transferResult = session.transferUserSeries?.(transferFromUserId, newOccupantId);
        
        if (transferResult?.ok) {
          console.log('[GuestAssignmentService] User series transfer complete:', {
            from: transferFromUserId,
            to: newOccupantId,
            coinsTransferred: transferResult.coinsTransferred,
            seriesTransferred: transferResult.seriesTransferred
          });
        }
      }
    }

    // Build metadata for the new assignment
    const metadata = {
      ...value.metadata,
      baseUserName: value.baseUserName || value.metadata?.baseUserName || null,  // FIXED: Preserve original owner
      profileId: newOccupantId,
      occupantId: newOccupantId,
      occupantName: value.name,
      entityId: entityId
    };

    // Log warning if no profileId was provided (Issue #3 remediation)
    if (!value.profileId) {
      getLogger().warn('guest_assignment.missing_profile_id', {
        deviceId: key,
        name: value.name,
        generatedId: metadata.profileId
      });
    }

    session.userManager.assignGuest(key, value.name, metadata);
    
    // Use profileId from the assignment, which is now explicitly set
    const occupantId = metadata.profileId;
    this.#logEvent('ASSIGN_GUEST', {
      deviceId: key,
      occupantName: value.name,
      occupantId,
      entityId,
      baseUserName: value.baseUserName || null,
      hasZoneOverrides: Array.isArray(metadata.zones) && metadata.zones.length > 0
    });
    if (Array.isArray(metadata.zones) && metadata.zones.length > 0) {
      this.#logEvent('ZONE_OVERRIDE_APPLIED', {
        deviceId: key,
        occupantId,
        entityId,
        zones: metadata.zones
      });
    }
    return { ok: true, data: { entityId } };
  }

  clearGuest(deviceId) {
    if (deviceId == null) {
      return { ok: false, code: 'invalid-device', message: 'Device id is required.' };
    }

    const key = String(deviceId);
    const session = this.session;
    if (!session?.userManager) {
      return { ok: false, code: 'session-missing', message: 'User manager is not available.' };
    }

    // End the entity for this device if it exists
    const previousEntry = this.ledger?.get?.(key);
    const previousEntityId = previousEntry?.entityId || null;
    if (previousEntityId && session.endSessionEntity) {
      session.endSessionEntity(previousEntityId, {
        status: 'ended',
        timestamp: Date.now(),
        reason: 'guest_cleared'
      });
    }

    session.userManager.assignGuest(key, null);
    this.#logEvent('CLEAR_GUEST', { deviceId: key, entityId: previousEntityId });
    return { ok: true, data: { clearedEntityId: previousEntityId } };
  }

  snapshotLedger() {
    return this.ledger?.snapshot?.() || [];
  }
}
