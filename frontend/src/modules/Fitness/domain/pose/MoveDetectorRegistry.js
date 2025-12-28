/**
 * MoveDetectorRegistry - Registry for available move detectors
 * 
 * Allows plugins to register new move types and instantiate them by ID.
 */

class MoveDetectorRegistry {
  constructor() {
    this._detectors = new Map(); // Active instances
    this._factories = new Map(); // Registered factories
  }
  
  /**
   * Register a detector factory
   * @param {string} id - Unique detector ID
   * @param {Function} factory - Function that returns a new detector instance
   * @param {Object} metadata - Optional metadata (name, description)
   */
  registerFactory(id, factory, metadata = {}) {
    this._factories.set(id, { factory, metadata });
  }
  
  /**
   * Get list of available detector types
   */
  getAvailableDetectors() {
    return Array.from(this._factories.entries()).map(([id, { metadata }]) => ({
      id,
      name: metadata.name || id,
      description: metadata.description || '',
    }));
  }
  
  /**
   * Create a new detector instance
   * @param {string} id - Detector ID
   * @param {Object} options - Constructor options
   */
  createDetector(id, options = {}) {
    const entry = this._factories.get(id);
    if (!entry) {
      throw new Error(`Unknown detector type: ${id}`);
    }
    
    return entry.factory(options);
  }
  
  /**
   * Check if a detector type exists
   */
  hasDetector(id) {
    return this._factories.has(id);
  }
  
  /**
   * Clear all registries (mostly for testing)
   */
  clear() {
    this._factories.clear();
    this._detectors.clear();
  }
}

// Singleton instance
export const moveDetectorRegistry = new MoveDetectorRegistry();

export default moveDetectorRegistry;
