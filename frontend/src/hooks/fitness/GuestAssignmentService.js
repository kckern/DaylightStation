// Note: slugifyId removed - we now use explicit IDs
import { DeviceAssignmentLedger } from './DeviceAssignmentLedger.js';

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

    if (!session?.userManager) {
      return { ok: false, code: 'session-missing', message: 'User manager is not available.' };
    }

    const metadata = {
      ...value.metadata,
      baseUserName: value.baseUserName,
      profileId: value.profileId,
      zones: value.zones || value.metadata?.zones || null
    };

    session.userManager.assignGuest(key, value.name, metadata);
    // Use profileId from the assignment, which is now explicitly set
    const occupantId = metadata.profileId || value.profileId;
    this.#logEvent('ASSIGN_GUEST', {
      deviceId: key,
      occupantName: value.name,
      occupantId,
      baseUserName: value.baseUserName || null,
      hasZoneOverrides: Array.isArray(metadata.zones) && metadata.zones.length > 0
    });
    if (Array.isArray(metadata.zones) && metadata.zones.length > 0) {
      this.#logEvent('ZONE_OVERRIDE_APPLIED', {
        deviceId: key,
        occupantId,
        zones: metadata.zones
      });
    }
    return { ok: true, data: {} };
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

    session.userManager.assignGuest(key, null);
    this.#logEvent('CLEAR_GUEST', { deviceId: key });
    return { ok: true, data: {} };
  }

  snapshotLedger() {
    return this.ledger?.snapshot?.() || [];
  }
}
