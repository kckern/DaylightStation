/**
 * IScreenRegistryDatastore — port for the household screen registry
 * (#domains/media/screenRegistry: `{ screens, aliases }`).
 *
 * Owned by the application layer; implemented by a persistence adapter.
 */
export class IScreenRegistryDatastore {
  /** @param {string} [householdId] @returns {Promise<{screens:Object, aliases:Object}>} */
  async load(householdId) {
    throw new Error('IScreenRegistryDatastore.load must be implemented');
  }

  /** @param {{screens:Object, aliases:Object}} state @param {string} [householdId] @returns {Promise<void>} */
  async save(state, householdId) {
    throw new Error('IScreenRegistryDatastore.save must be implemented');
  }
}

export default IScreenRegistryDatastore;
