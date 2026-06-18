/**
 * @interface IEmergencyLockRepository
 * Persists the single current emergency LockdownState (or null when unlocked).
 *
 * The application layer depends on this abstraction; a concrete adapter
 * (e.g. YamlEmergencyLockDatastore) implements the storage.
 */
export class IEmergencyLockRepository {
  /**
   * @returns {Promise<import('#domains/fitness/value-objects/LockdownState.mjs').LockdownState|null>}
   */
  async load() {
    throw new Error('IEmergencyLockRepository.load must be implemented');
  }

  /**
   * @param {import('#domains/fitness/value-objects/LockdownState.mjs').LockdownState} state
   * @returns {Promise<void>}
   */
  async save(state) {
    throw new Error('IEmergencyLockRepository.save must be implemented');
  }

  /**
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('IEmergencyLockRepository.clear must be implemented');
  }
}
