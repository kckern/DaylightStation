// BluetoothRemoteDirectionSource — IRemoteDirectionSource over the garage
// box's per-remote feed.
//
// Input: `bt.remote.key` presses ({ address, key, state, … }) through the
// fitness host's `subscribeRemoteKeys`, resolved against the remote inventory
// (`loadControllers()`: input.yml `controllers:`) by remoteDirection.js.
// The same presses also reach the page as browser KeyboardEvents with no
// device identity; while subscribed, this adapter stops those copies at the
// window (capture phase) so nothing else acts on them.
import { IRemoteDirectionSource } from './IRemoteDirectionSource.js';
import { positionedRemotes, remoteBrowserKeys, resolveRemoteDirection } from './remoteDirection.js';

export class BluetoothRemoteDirectionSource extends IRemoteDirectionSource {
  #subscribeRemoteKeys;
  #loadControllers;
  #target;
  #log;

  constructor({ subscribeRemoteKeys, loadControllers, target = typeof window !== 'undefined' ? window : null, log = null }) {
    super();
    this.#subscribeRemoteKeys = subscribeRemoteKeys;
    this.#loadControllers = loadControllers;
    this.#target = target;
    this.#log = log;
  }

  subscribe(listener) {
    let stopped = false;
    let teardown = () => {};
    Promise.resolve().then(() => this.#loadControllers()).then((controllers) => {
      if (stopped) return;
      const remotes = positionedRemotes(controllers);
      if (!remotes.length) { listener({ type: 'ready', sources: [] }); return; }
      const keys = remoteBrowserKeys(controllers);
      const stopCopy = (event) => {
        if (!keys.has(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type === 'keydown' && !event.repeat) {
          this.#log?.sampled?.('remote_input.browser_copy_dropped', { key: event.key }, { maxPerMinute: 20, aggregate: true });
        }
      };
      this.#target?.addEventListener('keydown', stopCopy, true);
      this.#target?.addEventListener('keyup', stopCopy, true);
      const unsubscribe = this.#subscribeRemoteKeys((msg) => {
        const where = resolveRemoteDirection({ controllers, address: msg?.address, key: msg?.key });
        if (!where) {
          if (msg?.state === 'down') this.#log?.debug?.('remote_input.unresolved', { address: msg?.address || null, key: msg?.key || null });
          return;
        }
        listener({ type: 'press', sourceId: where.address, direction: where.direction, position: where.position, state: msg.state });
      });
      teardown = () => {
        unsubscribe?.();
        this.#target?.removeEventListener('keydown', stopCopy, true);
        this.#target?.removeEventListener('keyup', stopCopy, true);
      };
      listener({ type: 'ready', sources: remotes.map((r) => r.address) });
    }).catch((error) => {
      if (!stopped) this.#log?.warn?.('remote_input.inventory_failed', { error: error?.message });
    });
    return () => { stopped = true; teardown(); };
  }
}

export default BluetoothRemoteDirectionSource;
