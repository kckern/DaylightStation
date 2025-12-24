/**
 * SessionLifecycle - Handles session start, end, and persistence
 * 
 * Extracted from FitnessSession as part of Phase 4 decomposition.
 * This module handles:
 * - Session ID generation
 * - Start/end timestamps
 * - Autosave timer management
 * - Tick timer management
 * - Session persistence to API
 * 
 * @see /docs/notes/fitness-architecture-review.md Phase 4
 */

import { formatSessionId } from './types.js';
import { DaylightAPI } from '../../lib/api.mjs';

/**
 * @typedef {Object} SessionLifecycleConfig
 * @property {number} [autosaveIntervalMs=15000] - Autosave interval
 * @property {number} [tickIntervalMs=5000] - Tick interval
 * @property {number} [emptySessionTimeoutMs=60000] - Time before auto-ending empty session
 */

/**
 * @typedef {Object} SessionState
 * @property {string|null} sessionId
 * @property {string|null} sessionTimestamp
 * @property {number|null} startTime
 * @property {number|null} endTime
 * @property {number|null} lastActivityTime
 * @property {boolean} isActive
 */

/**
 * SessionLifecycle class - manages session start/end/persistence
 */
export class SessionLifecycle {
  /**
   * @param {SessionLifecycleConfig} [config]
   */
  constructor(config = {}) {
    this._config = {
      autosaveIntervalMs: config.autosaveIntervalMs || 15000,
      tickIntervalMs: config.tickIntervalMs || 5000,
      emptySessionTimeoutMs: config.emptySessionTimeoutMs || 60000
    };

    // Session state
    this.sessionId = null;
    this.sessionTimestamp = null;
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null;
    
    // Timer state
    this._autosaveTimer = null;
    this._tickTimer = null;
    this._lastAutosaveAt = 0;
    this._saveTriggered = false;
    
    // Empty roster tracking (ghost session detection)
    this._emptyRosterStartTime = null;
    
    // Callbacks
    this._onTick = null;
    this._onAutosave = null;
    this._onSessionEnd = [];
    
    // Event log
    this.eventLog = [];
  }

  /**
   * Get current session state
   * @returns {SessionState}
   */
  getState() {
    return {
      sessionId: this.sessionId,
      sessionTimestamp: this.sessionTimestamp,
      startTime: this.startTime,
      endTime: this.endTime,
      lastActivityTime: this.lastActivityTime,
      isActive: this.sessionId !== null && this.endTime === null
    };
  }

  /**
   * Check if session is active
   * @returns {boolean}
   */
  isActive() {
    return this.sessionId !== null && this.endTime === null;
  }

  /**
   * Configure callbacks
   * @param {Object} callbacks
   * @param {Function} [callbacks.onTick] - Called on each tick
   * @param {Function} [callbacks.onAutosave] - Called on autosave
   */
  setCallbacks(callbacks = {}) {
    if (callbacks.onTick) this._onTick = callbacks.onTick;
    if (callbacks.onAutosave) this._onAutosave = callbacks.onAutosave;
  }

  /**
   * Register callback for session end
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  onSessionEnd(callback) {
    this._onSessionEnd.push(callback);
    return () => {
      const idx = this._onSessionEnd.indexOf(callback);
      if (idx !== -1) this._onSessionEnd.splice(idx, 1);
    };
  }

  /**
   * Start a new session
   * @returns {{ sessionId: string, startTime: number, isNew: boolean }}
   */
  start() {
    if (this.sessionId) {
      return { sessionId: this.sessionId, startTime: this.startTime, isNew: false };
    }

    const nowDate = new Date();
    const now = nowDate.getTime();
    
    this.sessionTimestamp = formatSessionId(nowDate);
    this.sessionId = `fs_${this.sessionTimestamp}`;
    this.startTime = now;
    this.lastActivityTime = now;
    this.endTime = null;
    this._lastAutosaveAt = 0;
    this._saveTriggered = false;
    this._emptyRosterStartTime = null;
    
    this._log('start', { sessionId: this.sessionId });
    
    this._startAutosaveTimer();
    this._startTickTimer();
    
    return { sessionId: this.sessionId, startTime: now, isNew: true };
  }

  /**
   * End the current session
   * @param {Object} [options]
   * @param {string} [options.reason='manual'] - Reason for ending
   * @returns {{ sessionId: string, endTime: number } | null}
   */
  end(options = {}) {
    if (!this.sessionId) return null;
    
    const { reason = 'manual' } = options;
    const now = Date.now();
    
    this.endTime = now;
    this._log('end', { sessionId: this.sessionId, reason });
    
    this._stopAutosaveTimer();
    this._stopTickTimer();
    
    const result = { sessionId: this.sessionId, endTime: now };
    
    // Notify listeners
    this._onSessionEnd.forEach(cb => {
      try {
        cb(result);
      } catch (err) {
        console.error('[SessionLifecycle] onSessionEnd callback error:', err);
      }
    });
    
    return result;
  }

  /**
   * Reset session state (for starting fresh)
   */
  reset() {
    this._stopAutosaveTimer();
    this._stopTickTimer();
    
    this.sessionId = null;
    this.sessionTimestamp = null;
    this.startTime = null;
    this.endTime = null;
    this.lastActivityTime = null;
    this._lastAutosaveAt = 0;
    this._saveTriggered = false;
    this._emptyRosterStartTime = null;
    this.eventLog = [];
  }

  /**
   * Record activity (updates lastActivityTime)
   */
  recordActivity() {
    this.lastActivityTime = Date.now();
  }

  /**
   * Check for empty roster timeout (ghost session detection)
   * @param {boolean} rosterEmpty - Whether roster is currently empty
   * @returns {boolean} True if session should be ended
   */
  checkEmptyRosterTimeout(rosterEmpty) {
    const now = Date.now();
    
    if (rosterEmpty) {
      if (this._emptyRosterStartTime === null) {
        this._emptyRosterStartTime = now;
      } else if (now - this._emptyRosterStartTime >= this._config.emptySessionTimeoutMs) {
        return true; // Should end session
      }
    } else {
      this._emptyRosterStartTime = null;
    }
    
    return false;
  }

  /**
   * Get duration in milliseconds
   * @returns {number}
   */
  getDurationMs() {
    if (!this.startTime) return 0;
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }

  /**
   * Get duration formatted as string
   * @returns {string}
   */
  getDurationFormatted() {
    const ms = this.getDurationMs();
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Persist session to API
   * @param {Object} payload - Session data to persist
   * @returns {Promise<Object>}
   */
  async persist(payload) {
    if (!this.sessionId) {
      throw new Error('Cannot persist: no active session');
    }

    try {
      const response = await DaylightAPI.post('/fitness/session', payload);
      this._saveTriggered = true;
      this._log('persist', { success: true });
      return response;
    } catch (err) {
      this._log('persist', { success: false, error: err.message });
      throw err;
    }
  }

  /**
   * Log an event
   * @param {string} type 
   * @param {Object} [data]
   */
  _log(type, data = {}) {
    this.eventLog.push({
      type,
      timestamp: Date.now(),
      ...data
    });
  }

  // Timer management

  _startAutosaveTimer() {
    this._stopAutosaveTimer();
    this._autosaveTimer = setInterval(() => {
      if (this._onAutosave && this.isActive()) {
        const now = Date.now();
        if (now - this._lastAutosaveAt >= this._config.autosaveIntervalMs) {
          this._lastAutosaveAt = now;
          this._onAutosave();
        }
      }
    }, this._config.autosaveIntervalMs);
  }

  _stopAutosaveTimer() {
    if (this._autosaveTimer) {
      clearInterval(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  _startTickTimer() {
    this._stopTickTimer();
    this._tickTimer = setInterval(() => {
      if (this._onTick && this.isActive()) {
        this._onTick(Date.now());
      }
    }, this._config.tickIntervalMs);
  }

  _stopTickTimer() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }
}

export default SessionLifecycle;
