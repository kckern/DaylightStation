/**
 * Idempotency boundary for result records. Identity is `{deviceId, sequence}`;
 * arrival route (QR, relay, or another transport) is recorded separately.
 */
export class ISchoolCalcResultLedger {
  /**
   * Atomically claim a record identity and digest.
   * @returns {Promise<{status: 'new'|'duplicate'|'conflict'|'resume', entry?: object}>}
   */
  async claimResult({ deviceId, sequence, recordDigest }) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcResultLedger.claimResult must be implemented');
  }

  /** Record one observation without changing result identity. */
  async recordArrival({ deviceId, sequence, recordDigest, transport, receivedAt }) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcResultLedger.recordArrival must be implemented');
  }

  /** Persist partial/final import progress for safe retry after interruption. */
  async saveImportState({ deviceId, sequence, state }) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcResultLedger.saveImportState must be implemented');
  }

  /** Sequences whose completed records are safe for repeated device ACK. */
  async listAcknowledgedSequences(deviceId) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolCalcResultLedger.listAcknowledgedSequences must be implemented');
  }
}

export default ISchoolCalcResultLedger;
