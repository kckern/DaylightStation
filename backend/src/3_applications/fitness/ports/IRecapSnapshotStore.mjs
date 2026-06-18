/**
 * @interface IRecapSnapshotStore
 * Read and clean up the raw webcam capture frames recorded during a session.
 */
export class IRecapSnapshotStore {
  /**
   * @param {string} _sessionId
   * @param {string} [_householdId]
   * @returns {Promise<Array<{index:number, filename:string, timestamp:number, absolutePath:string}>>}
   */
  async listCaptures(_sessionId, _householdId) {
    throw new Error('IRecapSnapshotStore.listCaptures must be implemented');
  }

  /**
   * @param {string} _absolutePath
   * @param {string} [_householdId]
   * @returns {Promise<Buffer>}
   */
  async readCapture(_absolutePath, _householdId) {
    throw new Error('IRecapSnapshotStore.readCapture must be implemented');
  }

  /**
   * @param {string} _sessionId
   * @param {string} _householdId
   * @param {{archive:boolean}} _opts
   * @returns {Promise<void>}
   */
  async cleanup(_sessionId, _householdId, _opts) {
    throw new Error('IRecapSnapshotStore.cleanup must be implemented');
  }
}

export function isRecapSnapshotStore(obj) {
  return obj &&
    typeof obj.listCaptures === 'function' &&
    typeof obj.readCapture === 'function' &&
    typeof obj.cleanup === 'function';
}
