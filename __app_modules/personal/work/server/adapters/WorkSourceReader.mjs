import { assertWorkUser } from '../domain/workState.mjs';
const validate = (username, provider) => {
  assertWorkUser(username);
  if (!['todoist', 'clickup'].includes(provider)) throw new TypeError('Invalid Work source');
};
/** Collector source facts and persisted attempt health remain separate projections. */
export class WorkSourceReader {
  #current;
  #history;
  #health;
  constructor({
    readCurrent,
    readHistory,
    readHealth = async () => null
  }) {
    this.#current = readCurrent;
    this.#history = readHistory;
    this.#health = readHealth;
  }
  async current(username, provider) {
    validate(username, provider);
    const snapshot = structuredClone(await this.#current(username, provider));
    if (!snapshot) return snapshot;
    const unavailable = reason => ({
      ...snapshot,
      coverage: {
        ...snapshot.coverage,
        complete: false,
        reason
      }
    });
    let health;
    try {
      health = await this.#health(username, provider);
    } catch {
      return unavailable('source_health_unavailable');
    }
    if (health == null) return snapshot;
    if (health.schema !== 'work-source-health/v1' || health.provider !== provider || !Number.isFinite(health.observedAt) || typeof health.complete !== 'boolean') return unavailable('source_health_invalid');
    if (health.observedAt < snapshot.observedAt) return snapshot;
    if (health.accountId !== snapshot.accountId) return unavailable('source_account_changed');
    return health.complete ? snapshot : unavailable(health.reason ?? 'latest_source_read_failed');
  }
  history(username, provider) {
    validate(username, provider);
    return this.#history(username, provider);
  }
}
