/**
 * MoveDetectorBase - Abstract base class for exercise move detectors
 * 
 * Provides common functionality for:
 * - History tracking (smoothing)
 * - Cooldown management
 * - State machine transitions
 * - Event emission
 */

export class MoveDetectorBase {
  /**
   * @param {string} id - Unique identifier for the detector
   * @param {string} name - Display name
   * @param {Object} options - Configuration options
   */
  constructor(id, name, options = {}) {
    this.id = id;
    this.name = name;
    this.description = options.description || '';
    
    this.config = {
      minConfidence: 0.7,
      smoothingFrames: 5,
      cooldownMs: 500,
      enableFeedback: true,
      ...options.config,
    };
    
    // State
    this.currentState = 'idle';
    this.confidence = 0;
    this.repCount = 0;
    
    // Internal
    this._poseHistory = [];
    this._lastEventTime = 0;
    this._isActive = false;
  }
  
  /**
   * Process incoming poses - override in subclass
   * @param {Pose[]} poses - Current frame poses
   * @returns {MoveEvent|null} - Event if detection occurred
   */
  processPoses(poses) {
    if (!this._isActive) return null;
    if (!poses || !poses.length) return null;
    
    // Add to history
    this._poseHistory.push({ poses, timestamp: Date.now() });
    if (this._poseHistory.length > this.config.smoothingFrames) {
      this._poseHistory.shift();
    }
    
    // Delegate to subclass implementation
    return this._detectMove(poses, this._poseHistory);
  }
  
  /**
   * Override this in subclass to implement detection logic
   * @param {Pose[]} currentPoses 
   * @param {Array} poseHistory 
   * @returns {MoveEvent|null}
   */
  _detectMove(currentPoses, poseHistory) {
    throw new Error('_detectMove must be implemented by subclass');
  }
  
  /**
   * Emit a move event (handles cooldown)
   * @param {string} type - Event type ('move_detected', 'rep_counted', etc.)
   * @param {Object} data - Event payload
   * @returns {MoveEvent|null}
   */
  _emitEvent(type, data) {
    const now = Date.now();
    
    // Only enforce cooldown for repetitive events like 'rep_counted'
    // State changes should usually happen immediately
    if (type === 'rep_counted' && now - this._lastEventTime < this.config.cooldownMs) {
      return null;
    }
    
    this._lastEventTime = now;
    
    return {
      type,
      detectorId: this.id,
      timestamp: now,
      data: {
        moveName: this.id,
        repCount: this.repCount,
        confidence: this.confidence,
        currentState: this.currentState,
        ...data,
      },
    };
  }
  
  /**
   * Transition state machine
   * @param {string} newState 
   * @returns {MoveEvent|null} State change event
   */
  _transitionTo(newState) {
    const oldState = this.currentState;
    if (oldState === newState) return null;
    
    this.currentState = newState;
    
    return this._emitEvent('state_change', {
      fromState: oldState,
      toState: newState,
    });
  }
  
  /**
   * Lifecycle: Called when detector is registered/activated
   */
  onActivate() {
    this._isActive = true;
    this.reset();
  }
  
  /**
   * Lifecycle: Called when detector is unregistered/deactivated
   */
  onDeactivate() {
    this._isActive = false;
  }
  
  /**
   * Reset internal state
   */
  reset() {
    this.currentState = 'idle';
    this.confidence = 0;
    this._poseHistory = [];
    this._lastEventTime = 0;
  }
  
  /**
   * Update configuration
   */
  updateConfig(partial) {
    this.config = { ...this.config, ...partial };
  }
  
  /**
   * Cleanup
   */
  dispose() {
    this.reset();
    this._isActive = false;
  }
}

export default MoveDetectorBase;
