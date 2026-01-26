import { describe, it, expect } from '@jest/globals';
import { UserResolver } from '#backend/src/0_system/users/UserResolver.mjs';

describe('UserResolver', () => {
  const mockConfigService = {
    getDefaultHouseholdId: () => 'default',
    getHouseholdAppConfig: (hid, appName) => {
      if (appName === 'chatbots') {
        return {
          identity_mappings: {
            telegram: {
              '575596036': 'kckern',
              '123456789': 'kirk',
            },
            discord: {
              '987654321': 'kckern',
            },
          },
        };
      }
      return null;
    },
  };

  describe('resolveUser', () => {
    it('resolves telegram user to system user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('telegram', '575596036')).toBe('kckern');
      expect(resolver.resolveUser('telegram', '123456789')).toBe('kirk');
    });

    it('resolves discord user to system user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('discord', '987654321')).toBe('kckern');
    });

    it('returns null for unknown platform user', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('telegram', '999999999')).toBeNull();
    });

    it('returns null for unknown platform', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.resolveUser('slack', '575596036')).toBeNull();
    });

    it('accepts explicit household override', () => {
      const multiHouseholdConfig = {
        getDefaultHouseholdId: () => 'default',
        getHouseholdAppConfig: (hid, appName) => {
          if (appName === 'chatbots' && hid === 'other') {
            return {
              identity_mappings: {
                telegram: { '575596036': 'other_user' },
              },
            };
          }
          return null;
        },
      };

      const resolver = new UserResolver(multiHouseholdConfig);

      expect(resolver.resolveUser('telegram', '575596036', 'other')).toBe('other_user');
    });
  });

  describe('isKnownUser', () => {
    it('returns true for known users', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.isKnownUser('telegram', '575596036')).toBe(true);
    });

    it('returns false for unknown users', () => {
      const resolver = new UserResolver(mockConfigService);

      expect(resolver.isKnownUser('telegram', '999999999')).toBe(false);
    });
  });
});
