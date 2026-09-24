/**
 * SessionEntity - Represents a participant's session segment on a device.
 * 
 * A Session Entity is distinct from a User Profile:
 * - Profile: Identity (name, avatar, zones) - persists across sessions
 * - Entity: one stint — one occupant on one strap over a time span
 * 
 * When a device is reassigned (guest switch), a new entity is created.
 * This enables fresh ring counts and session start times for each occupant.
 * 
 * @see /docs/design/guest-switch-session-transition.md
 */

import getLogger from '../../lib/logging/Logger.js';

/**
 * Entity status values
 * @typedef {'active' | 'dropped' | 'transferred' | 'ended'} EntityStatus
 */

/**
 * Generate a unique entity ID
 * @param {number} timestamp - Creation timestamp
 * @returns {string} Unique entity ID
 */
const generateEntityId = (timestamp) => {
  const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
  const random = Math.random().toString(36).slice(2, 7);
  return `entity-${ts}-${random}`;
};

/**
 * SessionEntity class - tracks a single participant's session segment
 */
export class SessionEntity {
  /**
   * Create a new session entity
   * @param {Object} options
   * @param {string} options.profileId - Reference to user profile
   * @param {string} options.name - Display name
   * @param {string} options.deviceId - Heart rate device ID
   * @param {number} [options.startTime] - Session start timestamp (defaults to now)
   * @param {string} [options.entityId] - Explicit entity ID (auto-generated if not provided)
   */
  constructor({ profileId, name, deviceId, startTime, entityId, startTick }) {
    const now = Date.now();
    this.entityId = entityId || generateEntityId(startTime || now);
    this.profileId = profileId || null;
    this.name = name || 'Unknown';
    this.deviceId = deviceId ? String(deviceId) : null;
    this.startTime = Number.isFinite(startTime) ? startTime : now;
    this.endTime = null;
    this.status = 'active'; // active | dropped | transferred | ended
    
    // Timeline tick this stint began at (series index before pruning). A
    // correction moves this stint's data from here onward.
    this.startTick = Number.isFinite(startTick) ? startTick : null;
    // Why the stint closed: 'handover' | 'dropped' | 'session-end' | 'cleared'
    this.endReason = null;
    // Prior occupants, oldest first, when a correction relabelled this stint
    this.relabeledFrom = [];

    // Transfer metadata (set when entity is transferred to successor)
    this.transferredTo = null;
    this.transferReason = null;
  }

  /**
   * Check if entity is currently active
   * @returns {boolean}
   */
  get isActive() {
    return this.status === 'active';
  }

  /**
   * Get duration in milliseconds
   * @returns {number|null}
   */
  get durationMs() {
    if (!Number.isFinite(this.startTime)) return null;
    const end = this.endTime || Date.now();
    return Math.max(0, end - this.startTime);
  }

  /**
   * Get duration in seconds
   * @returns {number|null}
   */
  get durationSeconds() {
    const ms = this.durationMs;
    return ms != null ? Math.floor(ms / 1000) : null;
  }

  /**
   * End this entity (mark as dropped or ended)
   * @param {Object} options
   * @param {'dropped' | 'ended' | 'transferred'} [options.status='dropped'] - Final status
   * @param {number} [options.timestamp] - End timestamp
   * @param {string} [options.transferredTo] - Entity ID if transferred
   * @param {string} [options.reason] - Reason for ending
   */
  end({ status = 'dropped', timestamp, transferredTo, reason } = {}) {
    if (this.status !== 'active') {
      getLogger().warn('session.entity_end_inactive', { entityId: this.entityId, status: this.status });
      return;
    }
    
    this.endTime = Number.isFinite(timestamp) ? timestamp : Date.now();
    this.status = status;
    
    if (transferredTo) {
      this.transferredTo = transferredTo;
    }
    if (reason) {
      this.transferReason = reason;
      this.endReason = reason;
    }
  }


  /**
   * Relabel this stint in place (a correction: "this was actually X").
   * The stint stays open; the prior occupant is appended to relabeledFrom.
   * @param {{ profileId: string, name?: string }} next
   * @returns {SessionEntity}
   */
  relabel({ profileId, name } = {}) {
    if (!profileId || profileId === this.profileId) return this;
    if (this.profileId) this.relabeledFrom.push(this.profileId);
    this.profileId = profileId;
    if (name) this.name = name;
    return this;
  }

  /**
   * Get summary for serialization/display
   * @returns {Object}
   */
  get summary() {
    return {
      entityId: this.entityId,
      profileId: this.profileId,
      name: this.name,
      deviceId: this.deviceId,
      startTime: this.startTime,
      endTime: this.endTime,
      startTick: this.startTick,
      durationMs: this.durationMs,
      status: this.status,
      endReason: this.endReason,
      relabeledFrom: [...this.relabeledFrom],
      transferredTo: this.transferredTo || null,
      transferReason: this.transferReason || null
    };
  }

  /**
   * Serialize for persistence
   * @returns {Object}
   */
  toJSON() {
    return {
      entityId: this.entityId,
      profileId: this.profileId,
      name: this.name,
      deviceId: this.deviceId,
      startTime: this.startTime,
      endTime: this.endTime,
      startTick: this.startTick,
      status: this.status,
      endReason: this.endReason,
      relabeledFrom: [...this.relabeledFrom],
      transferredTo: this.transferredTo,
      transferReason: this.transferReason
    };
  }

  /**
   * Create entity from serialized data
   * @param {Object} data - Serialized entity data
   * @returns {SessionEntity}
   */
  static fromJSON(data) {
    if (!data) return null;

    const entity = new SessionEntity({
      entityId: data.entityId,
      profileId: data.profileId,
      name: data.name,
      deviceId: data.deviceId,
      startTime: data.startTime,
      startTick: data.startTick
    });

    entity.endTime = data.endTime || null;
    entity.status = data.status || 'active';
    entity.endReason = data.endReason || null;
    entity.relabeledFrom = Array.isArray(data.relabeledFrom) ? [...data.relabeledFrom] : [];
    entity.transferredTo = data.transferredTo || null;
    entity.transferReason = data.transferReason || null;

    return entity;
  }
}

/**
 * SessionEntityRegistry - manages all session entities for a FitnessSession
 */
export class SessionEntityRegistry {
  constructor() {
    this.entities = new Map(); // entityId -> SessionEntity
    this._deviceEntityMap = new Map(); // deviceId -> entityId (current active entity per device)
  }

  /**
   * Create a new session entity
   * @param {Object} options - SessionEntity constructor options
   * @returns {SessionEntity}
   */
  create(options) {
    const entity = new SessionEntity(options);
    this.entities.set(entity.entityId, entity);
    
    // Track as active entity for this device
    if (entity.deviceId) {
      this._deviceEntityMap.set(entity.deviceId, entity.entityId);
    }
    
    getLogger().debug('fitness.stint.created', {
      entityId: entity.entityId,
      profileId: entity.profileId,
      deviceId: entity.deviceId
    });
    
    return entity;
  }

  /**
   * Get entity by ID
   * @param {string} entityId
   * @returns {SessionEntity|null}
   */
  get(entityId) {
    return this.entities.get(entityId) || null;
  }

  /**
   * Get active entity for a device
   * @param {string} deviceId
   * @returns {SessionEntity|null}
   */
  getByDevice(deviceId) {
    const key = String(deviceId);
    const entityId = this._deviceEntityMap.get(key);
    if (!entityId) return null;
    return this.entities.get(entityId) || null;
  }

  /**
   * Get entity ID for a device
   * @param {string} deviceId
   * @returns {string|null}
   */
  getEntityIdForDevice(deviceId) {
    return this._deviceEntityMap.get(String(deviceId)) || null;
  }

  /**
   * Get all entities
   * @returns {SessionEntity[]}
   */
  getAll() {
    return Array.from(this.entities.values());
  }

  /**
   * Get all active entities
   * @returns {SessionEntity[]}
   */
  getActive() {
    return this.getAll().filter(e => e.status === 'active');
  }

  /**
   * Get all entities for a profile
   * @param {string} profileId
   * @returns {SessionEntity[]}
   */
  getByProfile(profileId) {
    return this.getAll().filter(e => e.profileId === profileId);
  }

  /**
   * End entity and clear device mapping
   * @param {string} entityId
   * @param {Object} options - Options passed to entity.end()
   */
  /**
   * Restore stints from a saved session (kiosk reload). A saved open stint
   * replaces the fresh one ensureStarted opened for the same strap, so a
   * correction after the reload still moves the whole stint.
   * @param {Array<Object>} saved - persisted `entities[]`
   * @returns {number} stints restored
   */
  restore(saved) {
    if (!Array.isArray(saved)) return 0;
    let count = 0;
    for (const data of saved) {
      const entity = SessionEntity.fromJSON(data);
      if (!entity?.entityId || this.entities.has(entity.entityId)) continue;
      if (entity.status === 'active' && entity.deviceId) {
        const freshId = this._deviceEntityMap.get(entity.deviceId);
        const fresh = freshId ? this.entities.get(freshId) : null;
        if (fresh && fresh.relabeledFrom.length === 0) this.entities.delete(freshId);
        this._deviceEntityMap.set(entity.deviceId, entity.entityId);
      }
      this.entities.set(entity.entityId, entity);
      count += 1;
    }
    return count;
  }

  /**
   * Relabel a stint in place (correction). Returns the entity or null.
   */
  relabel(entityId, { profileId, name } = {}) {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    return entity.relabel({ profileId, name });
  }

  endEntity(entityId, options = {}) {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    
    entity.end(options);
    
    // Clear device mapping if this was the active entity
    if (entity.deviceId && this._deviceEntityMap.get(entity.deviceId) === entityId) {
      this._deviceEntityMap.delete(entity.deviceId);
    }
    
    getLogger().debug('fitness.stint.ended', {
      entityId,
      status: entity.status,
      endReason: entity.endReason,
      durationMs: entity.durationMs
    });
  }

  /**
   * Set active entity for a device
   * @param {string} deviceId
   * @param {string} entityId
   */
  setDeviceEntity(deviceId, entityId) {
    this._deviceEntityMap.set(String(deviceId), entityId);
  }

  /**
   * Get snapshot of all entities for serialization
   * @returns {Object[]}
   */
  snapshot() {
    return this.getAll().map(e => e.summary);
  }

  /**
   * Reset registry (clears all entities)
   */
  reset() {
    this.entities.clear();
    this._deviceEntityMap.clear();
  }

  /**
   * Get size of registry
   * @returns {number}
   */
  get size() {
    return this.entities.size;
  }

  /**
   * Check if registry has entity
   * @param {string} entityId
   * @returns {boolean}
   */
  has(entityId) {
    return this.entities.has(entityId);
  }
}

export default SessionEntity;
