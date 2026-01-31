/**
 * ConfigService Unit Tests - Household Path Resolution
 * @module tests/unit/suite/system/config/ConfigService.test
 */

import { ConfigService } from '#backend/src/0_system/config/ConfigService.mjs';

describe('ConfigService household paths', () => {
  describe('getHouseholdPath() with flat structure', () => {
    test('resolves flat structure paths', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {
          default: { _folderName: 'household', name: 'Default' },
          jones: { _folderName: 'household-jones', name: 'Jones' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdPath('', 'default')).toBe('/data/household');
      expect(service.getHouseholdPath('', 'jones')).toBe('/data/household-jones');
      expect(service.getHouseholdPath('apps/fitness', 'default')).toBe('/data/household/apps/fitness');
    });

    test('uses default household when householdId not provided', () => {
      const config = {
        system: { dataDir: '/data', defaultHouseholdId: 'default' },
        households: {
          default: { _folderName: 'household', name: 'Default' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdPath('apps/fitness')).toBe('/data/household/apps/fitness');
    });
  });

  describe('getHouseholdPath() error handling', () => {
    test('throws error for non-existent household', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {},
      };
      const service = new ConfigService(config);

      expect(() => service.getHouseholdPath('', 'nonexistent')).toThrow('Household not found: nonexistent');
    });

    test('throws error when default household does not exist', () => {
      const config = {
        system: { dataDir: '/data', defaultHouseholdId: 'missing' },
        households: {},
      };
      const service = new ConfigService(config);

      expect(() => service.getHouseholdPath('apps/fitness')).toThrow('Household not found: missing');
    });
  });

  describe('getHouseholdPath() fallback behavior', () => {
    test('uses householdId as folderName when _folderName not set', () => {
      const config = {
        system: { dataDir: '/data' },
        households: {
          myhouse: { name: 'My House' }, // No _folderName
        },
      };
      const service = new ConfigService(config);

      // Without _folderName, uses hid as folder name
      expect(service.getHouseholdPath('apps/fitness', 'myhouse')).toBe('/data/myhouse/apps/fitness');
    });
  });

  describe('householdExists()', () => {
    test('returns true for existing household', () => {
      const config = {
        system: {},
        households: { default: { name: 'Default' } },
      };
      const service = new ConfigService(config);

      expect(service.householdExists('default')).toBe(true);
    });

    test('returns false for non-existent household', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.householdExists('fake')).toBe(false);
    });

    test('returns false when households is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.householdExists('anything')).toBe(false);
    });
  });

  describe('getPrimaryHouseholdId()', () => {
    test('returns configured default household', () => {
      const config = {
        system: { defaultHouseholdId: 'jones' },
        households: { jones: { name: 'Jones' } },
      };
      const service = new ConfigService(config);

      expect(service.getPrimaryHouseholdId()).toBe('jones');
    });

    test('returns "default" when not configured', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.getPrimaryHouseholdId()).toBe('default');
    });
  });

  describe('getAllHouseholdIds()', () => {
    test('returns all household IDs', () => {
      const config = {
        system: {},
        households: {
          default: { name: 'Default' },
          jones: { name: 'Jones' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual(['default', 'jones']);
    });

    test('returns empty array when no households', () => {
      const config = {
        system: {},
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual([]);
    });

    test('returns empty array when households is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.getAllHouseholdIds()).toEqual([]);
    });
  });
});

describe('ConfigService system config', () => {
  describe('getSystemConfig()', () => {
    test('returns bot config for "bots"', () => {
      const config = {
        system: {},
        systemBots: {
          nutribot: { telegram: { bot_id: '123', webhook_path: '/nutribot' } },
          homebot: { telegram: { bot_id: '456', webhook_path: '/homebot' } },
        },
      };
      const service = new ConfigService(config);

      const bots = service.getSystemConfig('bots');
      expect(bots).toEqual({
        nutribot: { telegram: { bot_id: '123', webhook_path: '/nutribot' } },
        homebot: { telegram: { bot_id: '456', webhook_path: '/homebot' } },
      });
    });

    test('returns null for unknown config name', () => {
      const config = {
        system: {},
        systemBots: {},
      };
      const service = new ConfigService(config);

      expect(service.getSystemConfig('unknown')).toBeNull();
    });

    test('returns null when systemBots is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.getSystemConfig('bots')).toBeNull();
    });
  });

  describe('getSystemAuth()', () => {
    test('returns auth token for platform and key', () => {
      const config = {
        system: {},
        systemAuth: {
          telegram: {
            nutribot: 'token123',
            homebot: 'token456',
          },
          discord: {
            mybot: 'discordtoken',
          },
        },
      };
      const service = new ConfigService(config);

      expect(service.getSystemAuth('telegram', 'nutribot')).toBe('token123');
      expect(service.getSystemAuth('telegram', 'homebot')).toBe('token456');
      expect(service.getSystemAuth('discord', 'mybot')).toBe('discordtoken');
    });

    test('returns null for unknown platform', () => {
      const config = {
        system: {},
        systemAuth: {
          telegram: { nutribot: 'token123' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getSystemAuth('slack', 'nutribot')).toBeNull();
    });

    test('returns null for unknown key', () => {
      const config = {
        system: {},
        systemAuth: {
          telegram: { nutribot: 'token123' },
        },
      };
      const service = new ConfigService(config);

      expect(service.getSystemAuth('telegram', 'unknownbot')).toBeNull();
    });

    test('returns null when systemAuth is undefined', () => {
      const config = {
        system: {},
      };
      const service = new ConfigService(config);

      expect(service.getSystemAuth('telegram', 'nutribot')).toBeNull();
    });
  });

  describe('getHouseholdMessagingPlatform()', () => {
    test('returns first platform for household app', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {
          default: {
            integrations: {
              messaging: {
                nutribot: [{ platform: 'telegram' }],
                journalist: [{ platform: 'discord' }, { platform: 'telegram' }],
              },
            },
          },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform('default', 'nutribot')).toBe('telegram');
      expect(service.getHouseholdMessagingPlatform('default', 'journalist')).toBe('discord');
    });

    test('uses default household when householdId is null', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {
          default: {
            integrations: {
              messaging: {
                nutribot: [{ platform: 'telegram' }],
              },
            },
          },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform(null, 'nutribot')).toBe('telegram');
    });

    test('returns null for unknown app', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {
          default: {
            integrations: {
              messaging: {
                nutribot: [{ platform: 'telegram' }],
              },
            },
          },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform('default', 'unknownbot')).toBeNull();
    });

    test('returns null when messaging config is empty array', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {
          default: {
            integrations: {
              messaging: {
                nutribot: [],
              },
            },
          },
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform('default', 'nutribot')).toBeNull();
    });

    test('returns null when integrations is missing', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {
          default: {},
        },
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform('default', 'nutribot')).toBeNull();
    });

    test('returns null when household does not exist', () => {
      const config = {
        system: { defaultHouseholdId: 'default' },
        households: {},
      };
      const service = new ConfigService(config);

      expect(service.getHouseholdMessagingPlatform('nonexistent', 'nutribot')).toBeNull();
    });
  });
});
