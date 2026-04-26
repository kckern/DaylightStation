// backend/src/0_system/secrets/SecretsHandler.mjs

/**
 * SecretsHandler - Orchestration layer for secrets access.
 *
 * Delegates to an ISecretsProvider implementation.
 * Provides a stable interface for ConfigService regardless of backend.
 */
export class SecretsHandler {
  #provider;

  /**
   * @param {import('./ISecretsProvider.mjs').ISecretsProvider} provider
   */
  constructor(provider) {
    if (!provider) {
      throw new Error('SecretsHandler requires a provider');
    }
    this.#provider = provider;
  }

  /**
   * Initialize the underlying provider
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.#provider.initialize();
  }

  // ─── System Secrets ─────────────────────────────────

  getSecret(key) {
    return this.#provider.getSecret(key);
  }

  setSecret(key, value) {
    return this.#provider.setSecret(key, value);
  }

  // ─── System Auth ────────────────────────────────────

  getSystemAuth(platform, key) {
    return this.#provider.getSystemAuth(platform, key);
  }

  setSystemAuth(platform, key, value) {
    return this.#provider.setSystemAuth(platform, key, value);
  }

  // ─── User Auth ──────────────────────────────────────

  getUserAuth(username, service) {
    return this.#provider.getUserAuth(username, service);
  }

  setUserAuth(username, service, value) {
    return this.#provider.setUserAuth(username, service, value);
  }

  // ─── Household Auth ─────────────────────────────────

  getHouseholdAuth(householdId, service) {
    return this.#provider.getHouseholdAuth(householdId, service);
  }

  setHouseholdAuth(householdId, service, value) {
    return this.#provider.setHouseholdAuth(householdId, service, value);
  }

  // ─── Lifecycle ──────────────────────────────────────

  async flush() {
    await this.#provider.flush();
  }
}

export default SecretsHandler;
