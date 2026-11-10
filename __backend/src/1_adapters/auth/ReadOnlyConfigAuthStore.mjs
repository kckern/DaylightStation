/** Read-through fallback for runtimes without writable per-user auth storage. */
export class ReadOnlyConfigAuthStore {
  constructor({ configService, logger = console } = {}) {
    this.configService = configService;
    this.logger = logger;
  }

  /** Saves are dropped: a refresh through this store would lose the rotated token. */
  get writable() {
    return false;
  }

  async load(username, provider) {
    return this.configService?.getUserAuth?.(provider, username) || null;
  }

  async save(username, provider) {
    this.logger.warn?.('authStore.save.noop', { username, provider, reason: 'userSaveAuth not available' });
  }
}
