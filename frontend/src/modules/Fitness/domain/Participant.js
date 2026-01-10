/**
 * Participant Domain Entity
 * 
 * This module defines the Participant domain model - the canonical representation
 * of "a person participating in a fitness session with a heart rate monitor."
 * 
 * IMPORTANT: This is DISTINCT from a Device. A Participant represents a person,
 * while a Device represents hardware (ANT+ sensor). The relationship is:
 * - A Participant MAY have an associated device (hrDeviceId)
 * - A Participant can exist without an active device (grace period, virtual)
 * - A Device can broadcast without being assigned to a Participant (unclaimed)
 * 
 * UI components should operate on Participants, not Devices.
 * See: docs/ops/fix-fitness-user-consistency.md
 * 
 * @module Fitness/domain/Participant
 */

/**
 * @typedef {Object} Participant
 * @property {string} id - Canonical participant ID (from config or generated)
 * @property {string} name - Display name (e.g., "KC", "Felix")
 * @property {string} displayLabel - Resolved label for UI display (may differ for guests)
 * @property {string|null} profileId - Avatar/profile lookup ID
 * @property {string|null} deviceId - Associated HR device ID (may be null during grace period)
 * @property {number|null} heartRate - Current heart rate reading (bpm)
 * @property {boolean} isActive - Whether participant is currently broadcasting
 * @property {string|null} zoneId - Current zone ID ('cool', 'warm', 'hot', 'fire')
 * @property {string|null} zoneColor - CSS color for current zone
 * @property {number|null} zoneProgress - Progress within current zone (0-1)
 * @property {boolean} isGuest - Whether this is a guest assignment
 * @property {number|null} timestamp - Last device reading timestamp
 * @property {number|null} lastSeen - Last seen timestamp for activity tracking
 * @property {Object|null} metadata - Additional context (transfer info, entity refs, etc.)
 */

/**
 * @typedef {Object} Device
 * @property {string} deviceId - Unique device identifier
 * @property {string} type - Device type ('heart_rate', 'cadence', 'power', etc.)
 * @property {number|null} heartRate - Current reading (for HR devices)
 * @property {number} timestamp - Last reading timestamp
 * @property {number} lastSeen - Last seen timestamp
 * @property {boolean} isActive - Whether device is actively broadcasting
 * @property {string|null} name - Assigned name (if any)
 */

/**
 * Validate that an object conforms to the Participant shape.
 * Useful for debugging and ensuring type safety at boundaries.
 * 
 * @param {any} obj - Object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateParticipant = (obj) => {
  const errors = [];
  
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['Participant must be an object'] };
  }
  
  // Required fields
  if (typeof obj.id !== 'string' || !obj.id) {
    errors.push('id must be a non-empty string');
  }
  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('name must be a non-empty string');
  }
  if (typeof obj.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }
  
  // Optional but typed fields
  if (obj.heartRate !== null && typeof obj.heartRate !== 'number') {
    errors.push('heartRate must be a number or null');
  }
  if (obj.zoneId !== null && typeof obj.zoneId !== 'string') {
    errors.push('zoneId must be a string or null');
  }
  
  return { valid: errors.length === 0, errors };
};

/**
 * Create an empty/placeholder Participant (useful for loading states).
 * @returns {Participant}
 */
export const createEmptyParticipant = () => ({
  id: '',
  name: '',
  displayLabel: '',
  profileId: null,
  deviceId: null,
  heartRate: null,
  isActive: false,
  zoneId: null,
  zoneColor: null,
  zoneProgress: null,
  isGuest: false,
  timestamp: null,
  lastSeen: null,
  metadata: null
});

export default {
  validateParticipant,
  createEmptyParticipant
};
