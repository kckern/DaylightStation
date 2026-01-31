import { jest } from '@jest/globals';
import { HouseholdAdapters } from '#backend/src/0_system/registries/HouseholdAdapters.mjs';

describe('HouseholdAdapters', () => {
  describe('get()', () => {
    test('returns adapter for capability without app', () => {
      const mockPlexAdapter = { name: 'plex' };
      const adapters = new HouseholdAdapters({
        adapters: {
          media: { plex: mockPlexAdapter }
        },
        appRouting: {},
        defaults: { media: 'plex' }
      });

      expect(adapters.get('media')).toBe(mockPlexAdapter);
    });

    test('returns app-specific adapter when app routing exists', () => {
      const mockOpenAI = { name: 'openai' };
      const mockAnthropic = { name: 'anthropic' };
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: mockOpenAI, anthropic: mockAnthropic }
        },
        appRouting: {
          ai: { nutribot: 'openai', journalist: 'anthropic' }
        },
        defaults: { ai: 'openai' }
      });

      expect(adapters.get('ai', 'nutribot')).toBe(mockOpenAI);
      expect(adapters.get('ai', 'journalist')).toBe(mockAnthropic);
    });

    test('returns default adapter when app not in routing', () => {
      const mockOpenAI = { name: 'openai' };
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: mockOpenAI }
        },
        appRouting: {},
        defaults: { ai: 'openai' }
      });

      expect(adapters.get('ai', 'unknown-app')).toBe(mockOpenAI);
    });

    test('returns NoOp for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      const result = adapters.get('finance');
      expect(result.isConfigured()).toBe(false);
    });
  });

  describe('has()', () => {
    test('returns true for configured capability', () => {
      const mockAdapter = { isConfigured: () => true };
      const adapters = new HouseholdAdapters({
        adapters: { media: { plex: mockAdapter } },
        appRouting: {},
        defaults: { media: 'plex' }
      });

      expect(adapters.has('media')).toBe(true);
    });

    test('returns false for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      expect(adapters.has('finance')).toBe(false);
    });
  });

  describe('providers()', () => {
    test('lists all providers for a capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {
          ai: { openai: {}, anthropic: {} }
        },
        appRouting: {},
        defaults: { ai: 'openai' }
      });

      expect(adapters.providers('ai')).toEqual(['openai', 'anthropic']);
    });

    test('returns empty array for unconfigured capability', () => {
      const adapters = new HouseholdAdapters({
        adapters: {},
        appRouting: {},
        defaults: {}
      });

      expect(adapters.providers('finance')).toEqual([]);
    });
  });
});
