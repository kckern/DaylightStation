/**
 * Calculator-family boundary for SchoolCalc.
 *
 * Implementations live in `1_adapters`. Application code deals only in
 * validated lesson bundles, neutral capability reports, artifacts, results,
 * and acknowledgements; wire packets and calculator file formats stay out.
 */
export class ISchoolCalcCodec {
  /** Stable adapter selector such as a calculator-family identifier. */
  get platformId() {
    throw new Error('ISchoolCalcCodec.platformId must be implemented');
  }

  /** @returns {object} neutral device capabilities and limits */
  describeCapabilities(rawInfo, rawState = null) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.describeCapabilities must be implemented');
  }

  /** @returns {Uint8Array} family-specific provisioned identity record */
  encodeDeviceIdentity(identity) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeDeviceIdentity must be implemented');
  }

  /** Cheap ownership check for a provisioned family identity record. */
  recognizesDeviceIdentity(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.recognizesDeviceIdentity must be implemented');
  }

  /** @returns {{deviceId: string, platformId: string}} neutral identity */
  decodeDeviceIdentity(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.decodeDeviceIdentity must be implemented');
  }

  /** @returns {Uint8Array} family-specific active learner roster */
  encodeLearnerRoster(roster) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeLearnerRoster must be implemented');
  }

  /** @returns {Uint8Array} family-specific offline learner-progress snapshot */
  encodeProgressProjection(progressProjection) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeProgressProjection must be implemented');
  }

  /**
   * @returns {string} family-specific opaque key for one current follow-up.
   * The application uses this only to re-resolve a key received from a low-
   * memory client; calculator representation remains inside the adapter.
   */
  projectFollowUpKey(action, learnerKey) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.projectFollowUpKey must be implemented');
  }

  /** @returns {object} neutral durable interaction request */
  decodeInteractionRequest(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.decodeInteractionRequest must be implemented');
  }

  /** @returns {Uint8Array} family-specific durable interaction response */
  encodeInteractionResponse(response) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeInteractionResponse must be implemented');
  }

  /** @returns {Uint8Array} family-specific offline Catalog record */
  encodeCatalog(catalogProjection) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeCatalog must be implemented');
  }

  /** @returns {{deviceId: string, requests: object[]}} neutral request batch */
  decodeDeliveryRequests(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.decodeDeliveryRequests must be implemented');
  }

  /** @returns {{compatible: boolean, reasons: string[]}} */
  supports(bundle, capabilities) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.supports must be implemented');
  }

  /** @returns {Promise<object>|object} immutable delivery artifact */
  compile(bundle, capabilities, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.compile must be implemented');
  }

  /** @returns {object} neutral SchoolCalc result submission */
  decodeResult(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.decodeResult must be implemented');
  }

  /** Cheap format ownership check used before attempting a full decode. */
  recognizesResult(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.recognizesResult must be implemented');
  }

  /** @returns {Array<Uint8Array|string>} exact queued result records */
  decodeResultQueue(record) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.decodeResultQueue must be implemented');
  }

  /** @returns {Uint8Array} family-specific acknowledgement bytes */
  encodeAcknowledgements(acknowledgements) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeAcknowledgements must be implemented');
  }

  /** @returns {Uint8Array} family-specific calculator commit manifest */
  encodeSyncManifest(syncPlan) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcCodec.encodeSyncManifest must be implemented');
  }
}

export default ISchoolCalcCodec;
