/**
 * What the app needs from the records a **person** authored: the vehicle's
 * identity, its service history, its fill-ups, and its glove box.
 *
 * Deliberately separate from `IVehicleHistoryRepository`. Device history is
 * append-only, machine-written, and read-only to the app; these records are
 * hand-entered and fully mutable. Keeping them behind different ports (and in
 * different directories) means a history-format migration can never rewrite
 * something a person typed, and a mistyped odometer can never corrupt a
 * recording.
 *
 * @interface IVehicleRecordRepository
 * @module automotive/ports/IVehicleRecordRepository
 */
export class IVehicleRecordRepository {
  /** @returns {Promise<string[]>} vehicle ids with app-owned records */
  async listVehicleIds() {
    throw new Error('IVehicleRecordRepository.listVehicleIds must be implemented');
  }

  /**
   * Identity, VIN, purchase/sale — or null when the vehicle has no record yet.
   * @param {string} vehicleId
   * @returns {Promise<object|null>}
   */
  async readVehicle(vehicleId) {
    throw new Error('IVehicleRecordRepository.readVehicle must be implemented');
  }

  /** @param {string} vehicleId @param {object} vehicle @returns {Promise<object>} */
  async saveVehicle(vehicleId, vehicle) {
    throw new Error('IVehicleRecordRepository.saveVehicle must be implemented');
  }

  /** @param {string} vehicleId @returns {Promise<import('#domains/automotive/entities/ServiceRecord.mjs').ServiceRecord[]>} */
  async listServiceRecords(vehicleId) {
    throw new Error('IVehicleRecordRepository.listServiceRecords must be implemented');
  }

  /** @param {string} vehicleId @param {import('#domains/automotive/entities/ServiceRecord.mjs').ServiceRecord} record */
  async saveServiceRecord(vehicleId, record) {
    throw new Error('IVehicleRecordRepository.saveServiceRecord must be implemented');
  }

  /** @param {string} vehicleId @param {string} recordId */
  async deleteServiceRecord(vehicleId, recordId) {
    throw new Error('IVehicleRecordRepository.deleteServiceRecord must be implemented');
  }

  /** @param {string} vehicleId @returns {Promise<import('#domains/automotive/entities/FuelLog.mjs').FuelLog[]>} */
  async listFuelLogs(vehicleId) {
    throw new Error('IVehicleRecordRepository.listFuelLogs must be implemented');
  }

  /** @param {string} vehicleId @param {import('#domains/automotive/entities/FuelLog.mjs').FuelLog} log */
  async saveFuelLog(vehicleId, log) {
    throw new Error('IVehicleRecordRepository.saveFuelLog must be implemented');
  }

  /** @param {string} vehicleId @param {string} logId */
  async deleteFuelLog(vehicleId, logId) {
    throw new Error('IVehicleRecordRepository.deleteFuelLog must be implemented');
  }

  /** @param {string} vehicleId @returns {Promise<import('#domains/automotive/entities/Document.mjs').Document[]>} */
  async listDocuments(vehicleId) {
    throw new Error('IVehicleRecordRepository.listDocuments must be implemented');
  }

  /** @param {string} vehicleId @param {import('#domains/automotive/entities/Document.mjs').Document} document */
  async saveDocument(vehicleId, document) {
    throw new Error('IVehicleRecordRepository.saveDocument must be implemented');
  }
}
