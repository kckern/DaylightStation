/**
 * Port: which phone (DaylightStation Android app) can take a push for a user
 * right now, and when it last said hello.
 */
export class IPushDeviceRegistry {
  /** @param {{username:string, deviceId:string, connectionId:string, atMs:number}} hello */
  recordHello(hello) { throw new Error('IPushDeviceRegistry.recordHello must be implemented'); }
  /** @param {string} connectionId */
  forget(connectionId) { throw new Error('IPushDeviceRegistry.forget must be implemented'); }
  /** @returns {{deviceId:string, connectionId:string, lastSeenMs:number}|null} */
  currentFor(username) { throw new Error('IPushDeviceRegistry.currentFor must be implemented'); }
}
