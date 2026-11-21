import { isRemoteButtonMappingRepository } from './ports/IRemoteButtonMappingRepository.mjs';
import { normalizeRemoteAddress, normalizeRemoteButtons, normalizeRemotePositions } from '../../shared/remoteButtonActions.mjs';

/**
 * What each Bluetooth remote's buttons do on the garage fitness screen, per
 * remote by Bluetooth address: { remotes: { ADDRESS: { buttons: { keyName:
 * actionId }, positions: { up|down|left|right|center: actionId }, label,
 * updatedAt, updatedBy } } } (remoteButtonActions.mjs says which a remote
 * uses). A save replaces the map(s) it sends and keeps the other. Saves for
 * one household are serialized, so two quick saves never lose one another.
 */
const prefix = (tag, map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [`${tag}:${k}`, v]));

export class RemoteButtonService {
  #store; #clock; #logger; #queue = Promise.resolve();
  constructor({ repository, clock = { now: () => Date.now() }, logger = null }) {
    if (!isRemoteButtonMappingRepository(repository)) throw new Error('RemoteButtonService: an IRemoteButtonMappingRepository is required');
    this.#store = repository; this.#clock = clock; this.#logger = logger;
  }
  async get(householdId) {
    const doc = await this.#store.load(householdId);
    return { remotes: doc?.remotes ?? {} };
  }
  save(householdId, { address, buttons, positions, label = null, updatedBy = null }) {
    const addr = normalizeRemoteAddress(address);
    if (!addr) return Promise.reject(new TypeError('Invalid Bluetooth address'));
    if (buttons == null && positions == null) return Promise.reject(new TypeError('buttons or positions required'));
    let cleanButtons = null;
    let cleanPositions = null;
    try {
      if (buttons != null) cleanButtons = normalizeRemoteButtons(buttons);
      if (positions != null) cleanPositions = normalizeRemotePositions(positions);
    } catch (error) { return Promise.reject(error); }
    const run = this.#queue.catch(() => {}).then(async () => {
      const doc = (await this.#store.load(householdId)) ?? { remotes: {} };
      const prior = doc.remotes[addr] ?? {};
      const before = { ...prefix('key', prior.buttons), ...prefix('pos', prior.positions) };
      const entry = {
        buttons: cleanButtons ?? prior.buttons ?? {},
        positions: cleanPositions ?? prior.positions ?? {},
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : (doc.remotes[addr]?.label ?? null),
        updatedAt: new Date(this.#clock.now()).toISOString(),
        updatedBy: typeof updatedBy === 'string' && updatedBy ? updatedBy.slice(0, 64) : null,
      };
      const remotes = { ...doc.remotes, [addr]: entry };
      await this.#store.save(householdId, { remotes });
      const after = { ...prefix('key', entry.buttons), ...prefix('pos', entry.positions) };
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
      this.#logger?.info?.('fitness.remote-buttons.saved', {
        householdId, address: addr, buttons: Object.keys(entry.buttons).length, positions: Object.keys(entry.positions).length,
        changed: changed.join(','), updatedBy: entry.updatedBy,
      });
      return { remotes };
    });
    this.#queue = run;
    return run;
  }
}
export default RemoteButtonService;
