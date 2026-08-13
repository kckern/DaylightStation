/**
 * What the app needs from the relay-owned history tree.
 *
 * The write side of this tree belongs to `3_applications/hardware/automotiveRelay.mjs`
 * — it is append-only and device-driven. This port is **read-only by design**:
 * the app must never edit a recording, because a recording is evidence of what
 * the car did, and an app that can rewrite it is an app that can lose it.
 *
 * @interface IVehicleHistoryRepository
 * @module automotive/ports/IVehicleHistoryRepository
 */
export class IVehicleHistoryRepository {
  /**
   * Vehicle ids that have history on disk.
   * @returns {Promise<string[]>}
   */
  async listVehicleIds() {
    throw new Error('IVehicleHistoryRepository.listVehicleIds must be implemented');
  }

  /**
   * Trip descriptors for a window, ready for `stitchJourneys`.
   * @param {string} vehicleId
   * @param {{from?: Date, to?: Date, withFixes?: boolean}} [options]
   * @returns {Promise<import('#domains/automotive/services/JourneyStitchService.mjs').TripDescriptor[]>}
   */
  async listTripDescriptors(vehicleId, options) {
    throw new Error('IVehicleHistoryRepository.listTripDescriptors must be implemented');
  }

  /**
   * One full trip recording, samples included.
   * @param {string} vehicleId
   * @param {string} relPath  path relative to the vehicle's trips/ dir
   * @returns {Promise<object|null>}
   */
  async readTrip(vehicleId, relPath) {
    throw new Error('IVehicleHistoryRepository.readTrip must be implemented');
  }

  /**
   * Device events from the day logs — wifi-joined, harsh-motion, trip-dropped.
   * @param {string} vehicleId
   * @param {{from?: Date, to?: Date, events?: string[]}} [options]
   * @returns {Promise<Array<object>>}
   */
  async listEvents(vehicleId, options) {
    throw new Error('IVehicleHistoryRepository.listEvents must be implemented');
  }

  /**
   * The most recent snapshot the device reported — battery, fuel, DTCs.
   * @param {string} vehicleId
   * @returns {Promise<object|null>}
   */
  async readLatestSnapshot(vehicleId) {
    throw new Error('IVehicleHistoryRepository.readLatestSnapshot must be implemented');
  }
}
