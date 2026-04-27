/**
 * Side-effect handlers for trigger end-behaviors.
 *
 * The Player's queue includes a virtual `mediaType: 'trigger/side-effect'`
 * tail item when a trigger is loaded with an end-behavior. When playback
 * advances onto that item, the Player POSTs to /api/v1/trigger/side-effect,
 * which dispatches via this registry.
 *
 * @module applications/trigger/sideEffectHandlers
 */

export class UnknownSideEffectError extends Error {
  constructor(behavior) {
    super(`Unknown side-effect behavior: ${behavior}`);
    this.name = 'UnknownSideEffectError';
    this.behavior = behavior;
  }
}

export const sideEffectHandlers = {
  'tv-off': async ({ location }, { tvControlAdapter }) => {
    if (!tvControlAdapter) throw new Error('tvControlAdapter not configured');
    if (!location) throw new Error('tv-off requires location');
    return tvControlAdapter.turnOff(location);
  },

  clear: async ({ deviceId }, { deviceService }) => {
    if (!deviceService) throw new Error('deviceService not configured');
    if (!deviceId) throw new Error('clear requires deviceId');
    const device = deviceService.get(deviceId);
    if (!device) throw new Error(`Unknown device: ${deviceId}`);
    return device.clearContent();
  },
};

export async function dispatchSideEffect({ behavior, ...payload }, deps) {
  const handler = sideEffectHandlers[behavior];
  if (!handler) throw new UnknownSideEffectError(behavior);
  return handler(payload, deps);
}

export default { sideEffectHandlers, dispatchSideEffect, UnknownSideEffectError };
