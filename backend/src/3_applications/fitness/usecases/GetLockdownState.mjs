export class GetLockdownState {
  #repo;
  constructor({ repo } = {}) {
    if (!repo) throw new Error('GetLockdownState: repo required');
    this.#repo = repo;
  }
  async execute({ now } = {}) {
    const s = await this.#repo.load();
    if (!s) return null;
    if (!s.isActive(now)) { await this.#repo.clear(); return null; }
    return s;
  }
}
