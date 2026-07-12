/**
 * Port: what the harvest use case needs from the JamCorder device.
 * @module applications/jamcorder/ports/IJamCorderSource
 */
export class IJamCorderSource {
  /** @returns {Promise<Array<{listPath:string, downloadPath:string}>>} */
  async listRecordings() { throw new Error('IJamCorderSource.listRecordings must be implemented'); }
  /** @param {{listPath:string, downloadPath:string}} ref @returns {Promise<Buffer>} */
  async download(_ref) { throw new Error('IJamCorderSource.download must be implemented'); }
}
export default IJamCorderSource;
