/** Application projection for recent-menu ordering. Persistence is injected. */
export class MenuMemoryService {
  #load;
  #save;
  constructor({ load, save }) { this.#load = load; this.#save = save; }
  getAll() { return this.#load() || {}; }
  record(assetId, timestamp) {
    const values = this.getAll();
    values[assetId] = timestamp;
    this.#save(values);
    return { [assetId]: timestamp };
  }
}
export default MenuMemoryService;
