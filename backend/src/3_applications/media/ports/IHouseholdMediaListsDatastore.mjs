/**
 * IHouseholdMediaListsDatastore — port for the household's shared media lists:
 * favourites (items and collections, RQ-FIND-14) and ids removed from the
 * household list (RQ-FIND-15).
 *
 * Owned by the application layer; implemented by a persistence adapter.
 */
export class IHouseholdMediaListsDatastore {
  /**
   * @param {string} [householdId]
   * @returns {Promise<Array<{id:string, kind:'item'|'collection', title:string|null, thumbnail:string|null, type:string|null, addedAt:string}>>}
   */
  async loadFavourites(householdId) {
    throw new Error('IHouseholdMediaListsDatastore.loadFavourites must be implemented');
  }

  /** @returns {Promise<void>} */
  async saveFavourites(favourites, householdId) {
    throw new Error('IHouseholdMediaListsDatastore.saveFavourites must be implemented');
  }

  /**
   * @param {string} [householdId]
   * @returns {Promise<Object<string, {removedAt:string}>>}
   */
  async loadRemoved(householdId) {
    throw new Error('IHouseholdMediaListsDatastore.loadRemoved must be implemented');
  }

  /** @returns {Promise<void>} */
  async saveRemoved(removed, householdId) {
    throw new Error('IHouseholdMediaListsDatastore.saveRemoved must be implemented');
  }
}

export default IHouseholdMediaListsDatastore;
