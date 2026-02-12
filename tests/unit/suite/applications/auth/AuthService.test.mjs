// tests/unit/suite/applications/auth/AuthService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AuthService } from '#apps/auth/AuthService.mjs';

describe('AuthService', () => {
  let service;
  let mockDataService;
  let mockConfigService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn(),
        resolvePath: jest.fn().mockReturnValue('/data/users/test/auth/login.yml')
      },
      system: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn()
      },
      household: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn()
      }
    };
    mockConfigService = {
      getHouseholdUsers: jest.fn().mockReturnValue([]),
      getAllUserProfiles: jest.fn().mockReturnValue(new Map()),
      getDefaultHouseholdId: jest.fn().mockReturnValue('default')
    };

    service = new AuthService({
      dataService: mockDataService,
      configService: mockConfigService,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    });
  });

  describe('needsSetup', () => {
    it('returns true when no users have login.yml', () => {
      mockConfigService.getAllUserProfiles.mockReturnValue(new Map());
      expect(service.needsSetup()).toBe(true);
    });

    it('returns false when a user has a password_hash', () => {
      mockConfigService.getAllUserProfiles.mockReturnValue(
        new Map([['kckern', { username: 'kckern' }]])
      );
      mockDataService.user.read.mockReturnValue({ password_hash: '$2b$12$...' });
      expect(service.needsSetup()).toBe(false);
    });
  });

  describe('setup', () => {
    it('creates user profile, login.yml, household config, and auth config', async () => {
      const result = await service.setup({
        username: 'admin',
        password: 'test-password',
        householdName: 'Test Family'
      });

      // User profile written
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({
          username: 'admin',
          roles: ['sysadmin'],
          type: 'owner',
          household_id: 'default'
        }),
        'admin'
      );

      // Login written with bcrypt hash
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          password_hash: expect.stringMatching(/^\$2[aby]\$/),
          invite_token: null,
          invited_by: null
        }),
        'admin'
      );

      // Household config written
      expect(mockDataService.household.write).toHaveBeenCalledWith(
        'config/household',
        expect.objectContaining({
          name: 'Test Family',
          head: 'admin',
          users: ['admin']
        })
      );

      // Auth config written
      expect(mockDataService.system.write).toHaveBeenCalledWith(
        'config/auth',
        expect.objectContaining({
          roles: expect.any(Object),
          jwt: expect.objectContaining({ secret: expect.any(String) })
        })
      );

      expect(result).toHaveProperty('username', 'admin');
      expect(result).toHaveProperty('roles', ['sysadmin']);
      expect(result).toHaveProperty('householdId', 'default');
    });
  });

  describe('login', () => {
    it('returns user data when credentials are valid', async () => {
      // Pre-hash a known password
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.default.hash('correct-password', 4);

      mockDataService.user.read
        .mockReturnValueOnce({ username: 'kckern', household_id: 'default', roles: ['sysadmin'] }) // profile
        .mockReturnValueOnce({ password_hash: hash }); // login

      const result = await service.login('kckern', 'correct-password');
      expect(result).toHaveProperty('username', 'kckern');
      expect(result).toHaveProperty('roles', ['sysadmin']);
    });

    it('returns null for wrong password', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.default.hash('correct-password', 4);

      mockDataService.user.read
        .mockReturnValueOnce({ username: 'kckern', household_id: 'default', roles: ['sysadmin'] })
        .mockReturnValueOnce({ password_hash: hash });

      const result = await service.login('kckern', 'wrong-password');
      expect(result).toBeNull();
    });

    it('returns null for nonexistent user', async () => {
      mockDataService.user.read.mockReturnValue(null);
      const result = await service.login('nobody', 'password');
      expect(result).toBeNull();
    });
  });

  describe('generateInvite', () => {
    it('generates a token and writes login.yml', async () => {
      mockDataService.user.read.mockReturnValue({ username: 'elizabeth' });
      const result = await service.generateInvite('elizabeth', 'kckern');
      expect(result).toHaveProperty('token');
      expect(result.token).toHaveLength(64);
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          invite_token: result.token,
          invited_by: 'kckern'
        }),
        'elizabeth'
      );
    });

    it('throws if user profile does not exist', async () => {
      mockDataService.user.read.mockReturnValue(null);
      await expect(service.generateInvite('nobody', 'kckern'))
        .rejects.toThrow();
    });
  });

  describe('acceptInvite', () => {
    it('sets password and clears invite token', async () => {
      // We need to mock the token lookup — implementation will scan users
      mockConfigService.getAllUserProfiles.mockReturnValue(
        new Map([['elizabeth', { username: 'elizabeth', household_id: 'default', roles: ['member'] }]])
      );
      // When scanning, read login.yml for elizabeth
      mockDataService.user.read.mockImplementation((path, username) => {
        if (path === 'auth/login' && username === 'elizabeth') {
          return { invite_token: 'abc123', password_hash: null, invited_by: 'kckern' };
        }
        if (path === 'profile' && username === 'elizabeth') {
          return { username: 'elizabeth', household_id: 'default', roles: ['member'], display_name: 'Liz' };
        }
        return null;
      });

      const result = await service.acceptInvite('abc123', {
        password: 'new-password',
        displayName: 'Elizabeth'
      });

      expect(result).toHaveProperty('username', 'elizabeth');
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          password_hash: expect.stringMatching(/^\$2[aby]\$/),
          invite_token: null
        }),
        'elizabeth'
      );
    });
  });
});
