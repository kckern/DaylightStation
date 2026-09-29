import { buildCommandEnvelope } from '@shared-contracts/media/envelopes.mjs';
import { createPositionChannel } from '../session/positionChannel.js';

function defaultUuid() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* noop */ }
  return `browser-command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Remote controller for another browser. State stays Fleet-owned; commands
 * use the registered stable client route and never touch a hardware API. */
export function createBrowserSessionController({
  deviceId, callerDeviceId, fleetStore, correlator, randomUuid = defaultUuid,
}) {
  if (!String(deviceId).startsWith('browser:')) throw new Error('browser deviceId required');
  const targetControlClientId = deviceId.slice('browser:'.length);
  const snapshot = () => fleetStore.getEntry(deviceId)?.snapshot ?? null;
  const position = createPositionChannel();
  position.set(snapshot()?.position ?? 0);
  const detach = fleetStore.subscribeDevice(deviceId, entry => position.set(entry?.snapshot?.position ?? 0));

  const send = (command, params) => correlator.send({
    targetControlClientId,
    command: buildCommandEnvelope({
      commandId: randomUuid(), command, params,
      origin: { kind: 'device', id: callerDeviceId },
    }),
  });
  const transport = (action, value) => send('transport', {
    action, ...(value !== undefined ? { value } : {}),
  });
  const queue = (op, fields = {}) => send('queue', { op, ...fields });

  return {
    kind: 'remote-browser', id: deviceId,
    getSnapshot: snapshot,
    subscribe: fn => fleetStore.subscribeDevice(deviceId, entry => fn(entry?.snapshot ?? null)),
    position,
    transport: {
      play: () => transport('play'), pause: () => transport('pause'), stop: () => transport('stop'),
      seekAbs: seconds => transport('seekAbs', seconds), seekRel: delta => transport('seekRel', delta),
      skipNext: () => transport('skipNext'), skipPrev: () => transport('skipPrev'),
      restartCurrent: () => transport('seekAbs', 0),
    },
    queue: {
      playNow: (input, opts = {}) => queue('play-now', { contentId: input.contentId, clearRest: !!opts.clearRest }),
      playNext: input => queue('play-next', { contentId: input.contentId }),
      addUpNext: input => queue('add-up-next', { contentId: input.contentId }),
      add: input => queue('add', { contentId: input.contentId }),
      remove: queueItemId => queue('remove', { queueItemId }),
      jump: queueItemId => queue('jump', { queueItemId }),
      reorder: input => queue('reorder', input),
      clear: () => queue('clear'),
    },
    config: {
      setShuffle: value => send('config', { setting: 'shuffle', value }),
      setRepeat: value => send('config', { setting: 'repeat', value }),
      setShader: value => send('config', { setting: 'shader', value }),
      setVolume: value => send('config', { setting: 'volume', value }),
    },
    lifecycle: { reset() {}, adoptSnapshot() {} },
    portability: { snapshotForHandoff: () => null, receiveClaim() {} },
    get capabilities() {
      const item = snapshot()?.currentItem;
      return { seekable: Number.isFinite(item?.duration) && item.duration > 0, live: item?.isLive === true, reason: null, acked: true,
        speed: { available: false, reason: 'Playback speed is not supported remotely' } };
    },
    destroy: detach,
  };
}

export default createBrowserSessionController;
