/**
 * IListStore - Port interface for list persistence
 *
 * Abstracts YAML file I/O for household config lists.
 * Implementations handle storage format, normalization, and serialization.
 */

export class IListStore {
  /**
   * Get overview of all list types with counts
   * @param {string} householdId
   * @returns {{ type: string, count: number, path: string }[]}
   */
  getOverview(householdId) {
    throw new Error('IListStore.getOverview must be implemented');
  }

  /**
   * List all lists of a specific type with summaries
   * @param {string} type - List type (menus, watchlists, programs)
   * @param {string} householdId
   * @returns {{ name: string, title: string, description: string, metadata: Object, itemCount: number }[]}
   */
  listByType(type, householdId) {
    throw new Error('IListStore.listByType must be implemented');
  }

  /**
   * Load and normalize a single list
   * @param {string} type - List type
   * @param {string} name - List name (kebab-case)
   * @param {string} householdId
   * @returns {{ title, description, image, metadata, sections }|null} Normalized list or null if not found
   */
  getList(type, name, householdId) {
    throw new Error('IListStore.getList must be implemented');
  }

  /**
   * Save a normalized list config back to storage
   * @param {string} type - List type
   * @param {string} name - List name (kebab-case)
   * @param {string} householdId
   * @param {{ title, description, image, metadata, sections }} listConfig - Normalized list config
   */
  saveList(type, name, householdId, listConfig) {
    throw new Error('IListStore.saveList must be implemented');
  }

  /**
   * Create a new empty list
   * @param {string} type - List type
   * @param {string} name - List name (kebab-case)
   * @param {string} householdId
   * @returns {boolean} true if created, false if already exists
   */
  createList(type, name, householdId) {
    throw new Error('IListStore.createList must be implemented');
  }

  /**
   * Delete a list
   * @param {string} type - List type
   * @param {string} name - List name (kebab-case)
   * @param {string} householdId
   * @returns {boolean} true if deleted, false if not found
   */
  deleteList(type, name, householdId) {
    throw new Error('IListStore.deleteList must be implemented');
  }
}

export default IListStore;
