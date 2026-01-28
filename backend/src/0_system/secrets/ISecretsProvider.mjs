// backend/src/0_system/secrets/ISecretsProvider.mjs

/**
 * Interface for secrets storage backends.
 * Implementations: YamlSecretsProvider, EncryptedYamlProvider (future), VaultProvider (future)
 */
export class ISecretsProvider {
  // ─── System Secrets ─────────────────────────────────

  /**
   * Get a system-wide secret by key
   * @param {string} key - Secret key (e.g., 'OPENAI_API_KEY')
   * @returns {string|null}
   */
  getSecret(key) { throw new Error('Not implemented'); }

  /**
   * Set a system-wide secret
   * @param {string} key - Secret key
   * @param {string} value - Secret value
   */
  setSecret(key, value) { throw new Error('Not implemented'); }

  // ─── System Auth (bot tokens, platform credentials) ──

  /**
   * Get system-level auth (e.g., bot tokens)
   * @param {string} platform - Platform name (telegram, discord, etc.)
   * @param {string} key - Auth key within platform
   * @returns {string|null}
   */
  getSystemAuth(platform, key) { throw new Error('Not implemented'); }

  /**
   * Set system-level auth
   * @param {string} platform - Platform name
   * @param {string} key - Auth key
   * @param {string} value - Auth value
   */
  setSystemAuth(platform, key, value) { throw new Error('Not implemented'); }

  // ─── User Auth ──────────────────────────────────────

  /**
   * Get user-scoped auth credentials
   * @param {string} username - Username
   * @param {string} service - Service name (strava, google, etc.)
   * @returns {object|null} - Credentials object or null
   */
  getUserAuth(username, service) { throw new Error('Not implemented'); }

  /**
   * Set user-scoped auth credentials
   * @param {string} username - Username
   * @param {string} service - Service name
   * @param {object} value - Credentials object
   */
  setUserAuth(username, service, value) { throw new Error('Not implemented'); }

  // ─── Household Auth ─────────────────────────────────

  /**
   * Get household-scoped auth credentials
   * @param {string} householdId - Household ID
   * @param {string} service - Service name (plex, homeassistant, etc.)
   * @returns {object|null} - Credentials object or null
   */
  getHouseholdAuth(householdId, service) { throw new Error('Not implemented'); }

  /**
   * Set household-scoped auth credentials
   * @param {string} householdId - Household ID
   * @param {string} service - Service name
   * @param {object} value - Credentials object
   */
  setHouseholdAuth(householdId, service, value) { throw new Error('Not implemented'); }

  // ─── Lifecycle ──────────────────────────────────────

  /**
   * Initialize the provider - load secrets into memory
   * @returns {Promise<void>}
   */
  async initialize() { throw new Error('Not implemented'); }

  /**
   * Flush any pending writes (for providers with write buffering)
   * @returns {Promise<void>}
   */
  async flush() {}
}

export default ISecretsProvider;
