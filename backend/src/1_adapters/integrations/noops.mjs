/** Disabled/unconfigured capability adapters with explicit degradation contracts. */
export const createNoOpMediaAdapter = () => ({
  sourceId: 'noop',
  async list() { return []; },
  async getItem() { return null; },
  async search() { return []; },
  isAvailable() { return false; },
});

export const createNoOpAIGateway = () => ({
  async chat() { throw new Error('AI provider not configured'); },
  isConfigured() { return false; },
});

export const createNoOpHomeAutomationGateway = () => ({
  async getState() { return null; },
  async callService() { return { ok: false, error: 'Not configured' }; },
  async activateScene() { return { ok: false, error: 'Not configured' }; },
  isConnected() { return false; },
  getProviderName() { return 'noop'; },
});

export const createNoOpMessagingGateway = () => ({
  async sendMessage() { throw new Error('Messaging not configured'); },
  isConfigured() { return false; },
});

export const createNoOpFinanceAdapter = () => ({
  async getTransactions() { return []; },
  async getAccounts() { return []; },
  isConfigured() { return false; },
});

export const createNoOpNotificationService = () => ({
  send() { return []; },
});

export const createNoOpThumbnailDownloader = () => async () => undefined;
