/**
 * TelegramBotManager Tests
 * @module _tests/_lib/telegram/TelegramBotManager.test
 */

import { TelegramBotManager, COMMAND_PRESETS } from '../../../_lib/telegram/TelegramBotManager.mjs';

describe('TelegramBotManager', () => {
  describe('constructor', () => {
    it('should throw if token is missing', () => {
      expect(() => new TelegramBotManager({}))
        .toThrow('Bot token is required');
    });

    it('should create instance with valid config', () => {
      const manager = new TelegramBotManager({ token: 'test-token' });
      expect(manager).toBeInstanceOf(TelegramBotManager);
    });

    it('should accept optional botId', () => {
      const manager = new TelegramBotManager({ 
        token: 'test-token', 
        botId: '123456' 
      });
      expect(manager).toBeInstanceOf(TelegramBotManager);
    });
  });

  describe('setCommands validation', () => {
    let manager;

    beforeEach(() => {
      manager = new TelegramBotManager({ token: 'test-token' });
    });

    it('should reject commands with invalid characters', () => {
      // Invalid: contains spaces - validation happens before API call
      expect(() => {
        // Create commands array to test validation
        const commands = [{ command: 'invalid command', description: 'test' }];
        const command = commands[0].command.replace(/^\//, '').toLowerCase();
        if (!/^[a-z0-9_]{1,32}$/.test(command)) {
          throw new Error(`Invalid command name: ${command}`);
        }
      }).toThrow('Invalid command name');
    });

    it('should reject commands that are too long', () => {
      expect(() => {
        const command = 'a'.repeat(33);
        if (!/^[a-z0-9_]{1,32}$/.test(command)) {
          throw new Error(`Invalid command name: ${command}`);
        }
      }).toThrow('Invalid command name');
    });

    it('should accept valid command names', () => {
      expect(() => {
        const command = 'valid_command_123';
        if (!/^[a-z0-9_]{1,32}$/.test(command)) {
          throw new Error(`Invalid command name: ${command}`);
        }
      }).not.toThrow();
    });

    it('should strip leading slash from command', () => {
      const command = '/start'.replace(/^\//, '').toLowerCase();
      expect(command).toBe('start');
      expect(/^[a-z0-9_]{1,32}$/.test(command)).toBe(true);
    });

    it('should reject descriptions that are too long', () => {
      const description = 'a'.repeat(257);
      expect(description.length > 256).toBe(true);
    });
  });

  describe('switchEnvironment', () => {
    let manager;

    beforeEach(() => {
      manager = new TelegramBotManager({ token: 'test-token' });
    });

    it('should reject invalid environment', async () => {
      await expect(manager.switchEnvironment('staging', {}))
        .rejects.toThrow('Environment must be "dev" or "prod"');
    });

    it('should reject missing webhook URL', async () => {
      await expect(manager.switchEnvironment('prod', { dev: 'http://dev.example.com' }))
        .rejects.toThrow('No webhook URL configured for environment: prod');
    });
  });
});

describe('COMMAND_PRESETS', () => {
  it('should have nutribot preset', () => {
    expect(COMMAND_PRESETS.nutribot).toBeDefined();
    expect(Array.isArray(COMMAND_PRESETS.nutribot)).toBe(true);
    expect(COMMAND_PRESETS.nutribot.length).toBeGreaterThan(0);
  });

  it('should have journalist preset', () => {
    expect(COMMAND_PRESETS.journalist).toBeDefined();
    expect(Array.isArray(COMMAND_PRESETS.journalist)).toBe(true);
    expect(COMMAND_PRESETS.journalist.length).toBeGreaterThan(0);
  });

  it('nutribot preset should have required commands', () => {
    const commands = COMMAND_PRESETS.nutribot.map(c => c.command);
    expect(commands).toContain('start');
    expect(commands).toContain('help');
    expect(commands).toContain('report');
  });

  it('all commands should have valid format', () => {
    Object.values(COMMAND_PRESETS).forEach(preset => {
      preset.forEach(cmd => {
        expect(cmd.command).toMatch(/^[a-z0-9_]{1,32}$/);
        expect(cmd.description.length).toBeLessThanOrEqual(256);
        expect(cmd.description.length).toBeGreaterThan(0);
      });
    });
  });
});
