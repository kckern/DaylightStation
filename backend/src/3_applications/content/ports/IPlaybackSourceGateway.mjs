/**
 * Provider-neutral boundary for opening an owned playback resource.
 *
 * Application code may only exchange normalized descriptors and opaque handles
 * through this port; source implementations retain provider IDs, file paths,
 * session IDs, and signed URLs.
 */
export class IPlaybackSourceGateway {
  async openDefault() { throw new Error('openDefault must be implemented'); }
  async describe() { throw new Error('describe must be implemented'); }
  async open() { throw new Error('open must be implemented'); }
  async inspect() { throw new Error('inspect must be implemented'); }
  async renew() { throw new Error('renew must be implemented'); }
  async close() { throw new Error('close must be implemented'); }
  async findOwned() { throw new Error('findOwned must be implemented'); }
}

export function assertPlaybackSourceGateway(gateway) {
  for (const method of ['openDefault', 'describe', 'open', 'inspect', 'renew', 'close', 'findOwned']) {
    if (typeof gateway?.[method] !== 'function') throw new Error(`Playback source gateway requires ${method}()`);
  }
  return gateway;
}

export default IPlaybackSourceGateway;
