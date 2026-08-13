/**
 * The household's named places.
 *
 * Household-scoped rather than per-vehicle: home and school do not change when
 * the car does, and duplicating them per vehicle would guarantee they drift
 * apart.
 *
 * @interface IPlaceRepository
 * @module automotive/ports/IPlaceRepository
 */
export class IPlaceRepository {
  /** @returns {Promise<import('#domains/automotive/value-objects/Place.mjs').Place[]>} */
  async listPlaces() {
    throw new Error('IPlaceRepository.listPlaces must be implemented');
  }

  /**
   * Add or replace a place. This is the write behind the timeline's
   * "name this stop" action, which is how the registry grows.
   * @param {import('#domains/automotive/value-objects/Place.mjs').Place} place
   * @returns {Promise<import('#domains/automotive/value-objects/Place.mjs').Place>}
   */
  async savePlace(place) {
    throw new Error('IPlaceRepository.savePlace must be implemented');
  }

  /** @param {string} placeId @returns {Promise<boolean>} */
  async deletePlace(placeId) {
    throw new Error('IPlaceRepository.deletePlace must be implemented');
  }
}
