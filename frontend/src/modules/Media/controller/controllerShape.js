// frontend/src/modules/Media/controller/controllerShape.js
// The symmetry seam of the Media App: the local session and every peeked
// remote session present THIS interface, so transport/queue/config panels are
// written once and bound to either side (intent doc: "Conceptual subsystems").
// A conformance suite runs against both implementations.
//
// Snapshot tier vs position tier: `getSnapshot`/`subscribe` carry the durable
// SessionSnapshot (item, queue, state, config, discrete position). `position`
// is the hot tier — per-tick progress — so seek bars re-render at tick rate
// without invalidating every snapshot subscriber.
//
// Remote command methods return Promises that resolve on device ack (or
// reject on HTTP failure / ack timeout); local ones may return synchronously.

/**
 * @typedef {Object} SessionController
 * @property {'local'|'remote'} kind
 * @property {string} id                      clientId (local) or deviceId (remote)
 * @property {() => Object|null} getSnapshot  current SessionSnapshot
 * @property {(fn: Function) => Function} subscribe  snapshot changes → unsubscribe
 * @property {{ get: () => {seconds: number, ts: number}, subscribe: (fn: Function) => Function }} position
 * @property {{ play, pause, stop, seekAbs, seekRel, skipNext, skipPrev }} transport
 * @property {{ playNow, playNext, addUpNext, add, remove, reorder, jump, clear }} queue
 * @property {{ setShuffle, setRepeat, setShader, setVolume }} config
 * @property {{ reset, adoptSnapshot }} lifecycle
 * @property {{ snapshotForHandoff, receiveClaim }} portability   (local only)
 * @property {{ seekable: boolean, acked: boolean }} capabilities
 */

const TRANSPORT_METHODS = ['play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev'];
const QUEUE_METHODS = ['playNow', 'playNext', 'addUpNext', 'add', 'remove', 'reorder', 'jump', 'clear'];
const CONFIG_METHODS = ['setShuffle', 'setRepeat', 'setShader', 'setVolume'];
const LIFECYCLE_METHODS = ['reset', 'adoptSnapshot'];

/** Throws if `c` does not implement the controller interface. Used by the
 *  conformance suite and by useSessionController in dev. */
export function assertController(c) {
  if (!c || typeof c !== 'object') throw new Error('controller: not an object');
  if (c.kind !== 'local' && c.kind !== 'remote') throw new Error(`controller: bad kind ${c.kind}`);
  if (typeof c.id !== 'string' || !c.id) throw new Error('controller: missing id');
  if (typeof c.getSnapshot !== 'function') throw new Error('controller: missing getSnapshot');
  if (typeof c.subscribe !== 'function') throw new Error('controller: missing subscribe');
  if (!c.position || typeof c.position.get !== 'function' || typeof c.position.subscribe !== 'function') {
    throw new Error('controller: missing position tier');
  }
  for (const [group, methods] of [
    ['transport', TRANSPORT_METHODS],
    ['queue', QUEUE_METHODS],
    ['config', CONFIG_METHODS],
    ['lifecycle', LIFECYCLE_METHODS],
  ]) {
    if (!c[group]) throw new Error(`controller: missing ${group}`);
    for (const m of methods) {
      if (typeof c[group][m] !== 'function') throw new Error(`controller: missing ${group}.${m}`);
    }
  }
  if (!c.capabilities) throw new Error('controller: missing capabilities');
  return c;
}

export const CONTROLLER_METHOD_GROUPS = {
  transport: TRANSPORT_METHODS,
  queue: QUEUE_METHODS,
  config: CONFIG_METHODS,
  lifecycle: LIFECYCLE_METHODS,
};
