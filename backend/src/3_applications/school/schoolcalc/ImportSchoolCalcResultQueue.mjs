import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

/** Decode a family-owned durable queue, then feed every exact record to the common importer. */
export class ImportSchoolCalcResultQueue {
  #devices; #codecs; #importResult;

  constructor({ devices, codecs, importResult } = {}) {
    if (!devices || !codecs || !importResult) {
      throw new Error('ImportSchoolCalcResultQueue requires devices, codecs, and importResult');
    }
    this.#devices = devices;
    this.#codecs = codecs;
    this.#importResult = importResult;
  }

  async execute({ deviceId, record } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const codec = this.#codecs.get(device.platformId);
    const records = codec.decodeResultQueue(record);
    if (!Array.isArray(records)) throw new Error(`SchoolCalc codec '${device.platformId}' returned an invalid result queue`);

    // Decode and bind the entire batch to the endpoint before invoking the
    // common importer. Importing is intentionally sequential, but it is not a
    // database transaction: a late identity failure would otherwise leave
    // earlier foreign records claimed, graded, or acknowledged. This
    // preflight makes cross-device rejection atomic with respect to every
    // application side effect.
    for (const queuedRecord of records) {
      const decoded = codec.decodeResult(queuedRecord);
      if (!decoded || decoded.deviceId !== deviceId) {
        throw new ValidationError('SchoolCalc queued result device identity does not match endpoint');
      }
    }

    const outcomes = [];
    for (const queuedRecord of records) {
      // Sequential import keeps the device-global order observable. A failure
      // can safely stop the batch because earlier claims are idempotent.
      // eslint-disable-next-line no-await-in-loop
      const outcome = await this.#importResult.execute({ record: queuedRecord, transport: 'relay' });
      // Retain a fail-closed postcondition in case a registry/importer is
      // miswired differently from the endpoint-selected codec.
      if (outcome.deviceId !== deviceId) {
        throw new Error('SchoolCalc result importer violated the preflight device identity');
      }
      outcomes.push(outcome);
    }
    return {
      deviceId,
      total: outcomes.length,
      accepted: outcomes.filter((entry) => entry.status === 'accepted').length,
      duplicate: outcomes.filter((entry) => entry.status === 'duplicate').length,
      conflicts: outcomes.filter((entry) => entry.status === 'conflict').length,
      outcomes,
    };
  }
}

export default ImportSchoolCalcResultQueue;
