// IRemoteDirectionSource — the port a game uses for handheld remotes.
//
// A source reports presses as where the rider pressed, never as a device key:
//
//   { type: 'ready', sources: [sourceId, …] }            the remotes it reads
//   { type: 'press', sourceId, direction, position, state }
//
// `direction` is the rider's direction: 'front' / 'rear' (toward the front or
// rear of the equipment, when the remote's mounting says so), else the ring
// position itself: 'up' | 'down' | 'left' | 'right' | 'center'. `position` is
// always the ring position. `state` is 'down' | 'up' | 'repeat'. `sourceId`
// tells two remotes apart (opaque to the consumer).
//
// While a listener is subscribed the source also keeps its remotes' presses
// from reaching the page by any other route, so the consumer is the only one
// that hears them. Which layer may act on a remote at all is decided by
// remoteButtonHolds.js, not by the source.

/** @interface IRemoteDirectionSource */
export class IRemoteDirectionSource {
  /**
   * @param {(event: object) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    throw new Error('IRemoteDirectionSource.subscribe must be implemented');
  }
}

export function isRemoteDirectionSource(obj) {
  return !!obj && typeof obj.subscribe === 'function';
}
