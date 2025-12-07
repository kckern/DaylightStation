import { slugifyId } from './types.js';

const normalizeDeviceId = (deviceId) => {
  if (deviceId === undefined || deviceId === null) return null;
  const normalized = String(deviceId).trim();
  return normalized || null;
};

const cloneAssignment = (assignment) => {
  if (!assignment || typeof assignment !== 'object') {
    return {};
  }
  return { ...assignment };
};

export class DeviceAssignmentLedger {
  constructor({ eventJournal = null } = {}) {
    this.entries = new Map();
    this._signature = null;
    this.eventJournal = eventJournal || null;
  }

  setEventJournal(journal) {
    this.eventJournal = journal || null;
  }

  upsert(entry = {}) {
    const deviceId = normalizeDeviceId(entry.deviceId);
    if (!deviceId) return null;

    const record = {
      deviceId,
      occupantSlug: entry.occupantSlug || null,
      occupantName: entry.occupantName || null,
      occupantType: entry.occupantType || 'guest',
      displacedSlug: entry.displacedSlug || null,
      overridesHash: entry.overridesHash || null,
      metadata: cloneAssignment(entry.metadata),
      updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now()
    };

    this.entries.set(deviceId, record);
    this._signature = null;
    this.#emitEvent('LEDGER_UPSERT', record);
    return record;
  }

  remove(deviceId) {
    const key = normalizeDeviceId(deviceId);
    if (!key) return null;
    const removed = this.entries.get(key) || null;
    if (this.entries.delete(key)) {
      this._signature = null;
      this.#emitEvent('LEDGER_REMOVE', removed);
    }
    return removed;
  }

  get(deviceId) {
    const key = normalizeDeviceId(deviceId);
    if (!key) return null;
    return this.entries.get(key) || null;
  }

  snapshot() {
    return Array.from(this.entries.values());
  }

  syncFromAssignments(rawAssignments) {
    const incomingMap = this.#buildMapFromAssignments(rawAssignments);
    const signature = this.#computeSignature(incomingMap);
    if (signature === this._signature) {
      return false;
    }
    this.entries = incomingMap;
    this._signature = signature;
    this.#emitEvent('LEDGER_SYNC', { count: this.entries.size });
    return true;
  }

  // Backward compatibility shim
  syncFromGuestAssignments(rawAssignments) {
    return this.syncFromAssignments(rawAssignments);
  }

  #emitEvent(type, payload, options = {}) {
    if (!this.eventJournal || !type) return;
    const data = payload && typeof payload === 'object'
      ? { ...payload }
      : payload;
    try {
      this.eventJournal.log(type, data, options);
    } catch (_) {
      // swallow logging errors
    }
  }

  #buildMapFromAssignments(rawAssignments) {
    const map = new Map();
    if (!rawAssignments) {
      return map;
    }

    const pushEntry = (deviceId, assignment) => {
      const key = normalizeDeviceId(deviceId);
      if (!key) return;
      const normalized = this.#normalizeGuestAssignment(key, assignment);
      map.set(key, normalized);
    };

    if (rawAssignments instanceof Map) {
      rawAssignments.forEach((assignment, deviceId) => {
        pushEntry(deviceId, assignment);
      });
      return map;
    }

    if (Array.isArray(rawAssignments)) {
      rawAssignments.forEach((assignment) => {
        if (!assignment) return;
        const deviceId = assignment.deviceId
          ?? assignment.device_id
          ?? assignment.deviceID
          ?? assignment.device_id_str;
        pushEntry(deviceId, assignment);
      });
      return map;
    }

    if (typeof rawAssignments === 'object') {
      Object.entries(rawAssignments).forEach(([deviceId, assignment]) => {
        pushEntry(deviceId, assignment);
      });
    }

    return map;
  }

  #normalizeGuestAssignment(deviceId, assignment) {
    const nameSource = typeof assignment === 'string'
      ? assignment
      : assignment?.occupantName || assignment?.name || assignment?.guestName;
    const occupantName = (typeof nameSource === 'string' && nameSource.trim()) ? nameSource.trim() : 'Guest';
    const occupantSlug = slugifyId(occupantName);
    const baseUserName = typeof assignment?.baseUserName === 'string' ? assignment.baseUserName : null;
    const displacedSlug = baseUserName ? slugifyId(baseUserName) : null;
    const overridesHash = Array.isArray(assignment?.zones) ? JSON.stringify(assignment.zones) : null;
    const occupantType = assignment?.occupantType || assignment?.metadata?.occupantType || 'guest';
    const timestamp = Number.isFinite(assignment?.updatedAt)
      ? assignment.updatedAt
      : (Number.isFinite(assignment?.timestamp) ? assignment.timestamp : 0);

    return {
      deviceId,
      occupantSlug,
      occupantName,
      occupantType,
      displacedSlug,
      overridesHash,
      metadata: cloneAssignment(assignment),
      updatedAt: timestamp
    };
  }

  #computeSignature(map) {
    const ordered = Array.from(map.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
    return JSON.stringify(ordered);
  }
}
