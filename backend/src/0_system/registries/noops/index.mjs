/**
 * NoOp adapters for disabled/unconfigured capabilities.
 * Satisfy port interfaces with graceful degradation.
 */

export function createNoOpMediaAdapter() {
  return {
    sourceId: 'noop',

    async list() { return []; },
    async getItem() { return null; },
    async search() { return []; },

    isAvailable() { return false; },
  };
}

export function createNoOpAIGateway() {
  return {
    async chat() {
      throw new Error('AI provider not configured');
    },

    isConfigured() { return false; },
  };
}

export function createNoOpHomeAutomationGateway() {
  return {
    async getState() { return null; },

    async callService() {
      return { ok: false, error: 'Not configured' };
    },

    async activateScene() {
      return { ok: false, error: 'Not configured' };
    },

    isConnected() { return false; },
    getProviderName() { return 'noop'; },
  };
}

export function createNoOpMessagingGateway() {
  return {
    async sendMessage() {
      throw new Error('Messaging not configured');
    },

    isConfigured() { return false; },
  };
}

export function createNoOpFinanceAdapter() {
  return {
    async getTransactions() { return []; },
    async getAccounts() { return []; },

    isConfigured() { return false; },
  };
}
