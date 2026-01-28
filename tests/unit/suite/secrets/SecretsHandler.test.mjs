// tests/unit/suite/secrets/SecretsHandler.test.mjs

import { jest } from '@jest/globals';
import { SecretsHandler } from '#backend/src/0_system/secrets/SecretsHandler.mjs';

describe('SecretsHandler', () => {
  let mockProvider;
  let handler;

  beforeEach(() => {
    mockProvider = {
      initialize: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
      getSecret: jest.fn(),
      setSecret: jest.fn(),
      getSystemAuth: jest.fn(),
      setSystemAuth: jest.fn(),
      getUserAuth: jest.fn(),
      setUserAuth: jest.fn(),
      getHouseholdAuth: jest.fn(),
      setHouseholdAuth: jest.fn(),
    };
    handler = new SecretsHandler(mockProvider);
  });

  describe('constructor', () => {
    test('throws if provider not provided', () => {
      expect(() => new SecretsHandler()).toThrow('requires a provider');
      expect(() => new SecretsHandler(null)).toThrow('requires a provider');
    });

    test('accepts valid provider', () => {
      expect(handler).toBeInstanceOf(SecretsHandler);
    });
  });

  describe('initialize', () => {
    test('calls provider.initialize()', async () => {
      await handler.initialize();
      expect(mockProvider.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSecret / setSecret', () => {
    test('delegates getSecret to provider', () => {
      mockProvider.getSecret.mockReturnValue('secret-value');

      const result = handler.getSecret('MY_KEY');

      expect(mockProvider.getSecret).toHaveBeenCalledWith('MY_KEY');
      expect(result).toBe('secret-value');
    });

    test('delegates setSecret to provider', () => {
      handler.setSecret('MY_KEY', 'new-value');

      expect(mockProvider.setSecret).toHaveBeenCalledWith('MY_KEY', 'new-value');
    });
  });

  describe('getSystemAuth / setSystemAuth', () => {
    test('delegates getSystemAuth to provider', () => {
      mockProvider.getSystemAuth.mockReturnValue('bot-token');

      const result = handler.getSystemAuth('telegram', 'BOT_TOKEN');

      expect(mockProvider.getSystemAuth).toHaveBeenCalledWith('telegram', 'BOT_TOKEN');
      expect(result).toBe('bot-token');
    });

    test('delegates setSystemAuth to provider', () => {
      handler.setSystemAuth('telegram', 'BOT_TOKEN', 'new-token');

      expect(mockProvider.setSystemAuth).toHaveBeenCalledWith('telegram', 'BOT_TOKEN', 'new-token');
    });
  });

  describe('getUserAuth / setUserAuth', () => {
    test('delegates getUserAuth to provider', () => {
      mockProvider.getUserAuth.mockReturnValue({ token: 'user-token' });

      const result = handler.getUserAuth('alice', 'strava');

      expect(mockProvider.getUserAuth).toHaveBeenCalledWith('alice', 'strava');
      expect(result).toEqual({ token: 'user-token' });
    });

    test('delegates setUserAuth to provider', () => {
      handler.setUserAuth('alice', 'strava', { token: 'new-token' });

      expect(mockProvider.setUserAuth).toHaveBeenCalledWith('alice', 'strava', { token: 'new-token' });
    });
  });

  describe('getHouseholdAuth / setHouseholdAuth', () => {
    test('delegates getHouseholdAuth to provider', () => {
      mockProvider.getHouseholdAuth.mockReturnValue({ token: 'plex-token' });

      const result = handler.getHouseholdAuth('default', 'plex');

      expect(mockProvider.getHouseholdAuth).toHaveBeenCalledWith('default', 'plex');
      expect(result).toEqual({ token: 'plex-token' });
    });

    test('delegates setHouseholdAuth to provider', () => {
      handler.setHouseholdAuth('default', 'plex', { token: 'new-token' });

      expect(mockProvider.setHouseholdAuth).toHaveBeenCalledWith('default', 'plex', { token: 'new-token' });
    });
  });

  describe('flush', () => {
    test('calls provider.flush()', async () => {
      await handler.flush();
      expect(mockProvider.flush).toHaveBeenCalledTimes(1);
    });
  });
});
