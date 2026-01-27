import {
  createNoOpMediaAdapter,
  createNoOpAIGateway,
  createNoOpHomeAutomationGateway,
} from '#backend/src/0_system/registries/noops/index.mjs';

describe('NoOp Adapters', () => {
  describe('createNoOpMediaAdapter', () => {
    test('returns adapter with expected interface', () => {
      const adapter = createNoOpMediaAdapter();
      expect(adapter.sourceId).toBe('noop');
      expect(typeof adapter.list).toBe('function');
      expect(typeof adapter.getItem).toBe('function');
      expect(typeof adapter.search).toBe('function');
      expect(adapter.isAvailable()).toBe(false);
    });

    test('list returns empty array', async () => {
      const adapter = createNoOpMediaAdapter();
      expect(await adapter.list()).toEqual([]);
    });

    test('getItem returns null', async () => {
      const adapter = createNoOpMediaAdapter();
      expect(await adapter.getItem('any-id')).toBeNull();
    });
  });

  describe('createNoOpAIGateway', () => {
    test('returns gateway with expected interface', () => {
      const gateway = createNoOpAIGateway();
      expect(typeof gateway.chat).toBe('function');
      expect(gateway.isConfigured()).toBe(false);
    });

    test('chat throws error', async () => {
      const gateway = createNoOpAIGateway();
      await expect(gateway.chat({ messages: [] })).rejects.toThrow('AI provider not configured');
    });
  });

  describe('createNoOpHomeAutomationGateway', () => {
    test('returns gateway with expected interface', () => {
      const gateway = createNoOpHomeAutomationGateway();
      expect(typeof gateway.getState).toBe('function');
      expect(typeof gateway.callService).toBe('function');
      expect(gateway.isConnected()).toBe(false);
      expect(gateway.getProviderName()).toBe('noop');
    });

    test('getState returns null', async () => {
      const gateway = createNoOpHomeAutomationGateway();
      expect(await gateway.getState('any.entity')).toBeNull();
    });

    test('callService returns error result', async () => {
      const gateway = createNoOpHomeAutomationGateway();
      const result = await gateway.callService('domain', 'service', {});
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not configured');
    });
  });
});
