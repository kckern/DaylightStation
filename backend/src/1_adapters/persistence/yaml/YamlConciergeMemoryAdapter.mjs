const AGENT_ID = 'concierge';
const USER_ID = 'household';

/**
 * Household-scoped get/set/merge over an underlying working-memory adapter.
 * Implements IConciergeMemory.
 *
 * The underlying adapter is expected to return a state object exposing either
 * `.get(key) / .set(key, value)` (existing WorkingMemoryState) or a `.data`
 * map; this class normalises over both.
 */
export class YamlConciergeMemoryAdapter {
  #wm;

  constructor({ workingMemory }) {
    if (!workingMemory) throw new Error('YamlConciergeMemoryAdapter: workingMemory required');
    this.#wm = workingMemory;
  }

  async #loadAll() {
    return this.#wm.load(AGENT_ID, USER_ID);
  }

  async #save(state) {
    return this.#wm.save(AGENT_ID, USER_ID, state);
  }

  #read(state, key) {
    if (state && typeof state.get === 'function') return state.get(key);
    if (state && state.data && typeof state.data === 'object') return state.data[key];
    return undefined;
  }

  #write(state, key, value) {
    if (state && typeof state.set === 'function') {
      state.set(key, value);
      return;
    }
    if (!state.data || typeof state.data !== 'object') state.data = {};
    state.data[key] = value;
  }

  async get(key) {
    const state = await this.#loadAll();
    const v = this.#read(state, key);
    return v === undefined ? null : v;
  }

  async set(key, value) {
    const state = await this.#loadAll();
    this.#write(state, key, value);
    await this.#save(state);
  }

  async merge(key, partial) {
    const state = await this.#loadAll();
    const current = this.#read(state, key);
    const next = (current && typeof current === 'object' && !Array.isArray(current))
      ? { ...current, ...partial }
      : partial;
    this.#write(state, key, next);
    await this.#save(state);
  }

  /**
   * Remove a key. Returns true if the key existed and was removed,
   * false if the key was already absent. Idempotent: calling twice on
   * a present key returns true then false; never throws on missing.
   */
  async delete(key) {
    const state = await this.#loadAll();
    const current = this.#read(state, key);
    if (current === undefined) return false;
    if (state && typeof state.remove === 'function') {
      state.remove(key);
    } else if (state?.data && typeof state.data === 'object') {
      delete state.data[key];
    } else {
      return false;
    }
    await this.#save(state);
    return true;
  }
}

export default YamlConciergeMemoryAdapter;
