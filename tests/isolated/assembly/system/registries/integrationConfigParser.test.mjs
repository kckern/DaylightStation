import { jest } from '@jest/globals';
import {
  PROVIDER_CAPABILITY_MAP,
  CAPABILITY_KEYS,
  parseIntegrationsConfig,
  parseAppRouting,
} from '#backend/src/0_system/registries/integrationConfigParser.mjs';

describe('integrationConfigParser', () => {
  describe('PROVIDER_CAPABILITY_MAP', () => {
    test('maps plex to media', () => {
      expect(PROVIDER_CAPABILITY_MAP.plex).toBe('media');
    });

    test('maps homeassistant to home_automation', () => {
      expect(PROVIDER_CAPABILITY_MAP.homeassistant).toBe('home_automation');
    });

    test('maps openai to ai', () => {
      expect(PROVIDER_CAPABILITY_MAP.openai).toBe('ai');
    });

    test('maps telegram to messaging', () => {
      expect(PROVIDER_CAPABILITY_MAP.telegram).toBe('messaging');
    });

    test('maps buxfer to finance', () => {
      expect(PROVIDER_CAPABILITY_MAP.buxfer).toBe('finance');
    });
  });

  describe('parseIntegrationsConfig()', () => {
    test('separates service entries from capability entries', () => {
      const config = {
        plex: { port: 32400, protocol: 'dash' },
        homeassistant: { port: 8123 },
        ai: {
          nutribot: [{ provider: 'openai' }],
          journalist: [{ provider: 'anthropic' }],
        },
        messaging: {
          nutribot: [{ platform: 'telegram' }],
        },
      };

      const result = parseIntegrationsConfig(config);

      expect(result.services).toEqual({
        plex: { port: 32400, protocol: 'dash' },
        homeassistant: { port: 8123 },
      });
      expect(result.appRouting).toEqual({
        ai: { nutribot: 'openai', journalist: 'anthropic' },
        messaging: { nutribot: 'telegram' },
      });
    });

    test('handles empty config', () => {
      const result = parseIntegrationsConfig({});

      expect(result.services).toEqual({});
      expect(result.appRouting).toEqual({});
    });

    test('ignores unknown keys', () => {
      const config = {
        plex: { port: 32400 },
        unknown_service: { foo: 'bar' },
      };

      const result = parseIntegrationsConfig(config);

      expect(result.services).toEqual({ plex: { port: 32400 } });
      expect(result.unknownKeys).toContain('unknown_service');
    });
  });

  describe('parseAppRouting()', () => {
    test('extracts provider from array format', () => {
      const capabilityConfig = {
        nutribot: [{ provider: 'openai' }],
        journalist: [{ provider: 'anthropic' }],
      };

      const result = parseAppRouting(capabilityConfig);

      expect(result).toEqual({
        nutribot: 'openai',
        journalist: 'anthropic',
      });
    });

    test('handles platform key for messaging', () => {
      const capabilityConfig = {
        nutribot: [{ platform: 'telegram' }],
      };

      const result = parseAppRouting(capabilityConfig);

      expect(result).toEqual({ nutribot: 'telegram' });
    });

    test('handles empty config', () => {
      expect(parseAppRouting({})).toEqual({});
      expect(parseAppRouting(null)).toEqual({});
      expect(parseAppRouting(undefined)).toEqual({});
    });
  });
});
