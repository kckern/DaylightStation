/**
 * Port: is this really the recipient's phone? Checked on every `push.hello`
 * and every action press. The placeholder (NetworkTrustPushDeviceAuth) allows
 * all; device pairing replaces it without touching callers.
 */
export class IPushDeviceAuth {
  /** @returns {boolean} */
  allowHello(connectionId, message) { throw new Error('IPushDeviceAuth.allowHello must be implemented'); }
  /** @returns {boolean} */
  allowPress(press) { throw new Error('IPushDeviceAuth.allowPress must be implemented'); }
}
