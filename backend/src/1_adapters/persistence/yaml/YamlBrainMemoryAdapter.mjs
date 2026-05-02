const AGENT_ID = 'brain';
const USER_ID = 'household';

/**
 * Household-scoped get/set/merge over an underlying working-memory adapter.
 * Implements IBrainMemory.
 *
 * The underlying adapter is expected to return a state object exposing either
 * `.get(key) / .set(key, value)` (existing WorkingMemoryState) or a `.data`
 * map; this class normalises over both.
 */
export class YamlBrainMemoryAdapter {
  #wm;

  constructor({ workingMemory }) {
    if (!workingMemory) throw new Error('YamlBrainMemoryAdapter: workingMemory required');
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
}

export default YamlBrainMemoryAdapter;
