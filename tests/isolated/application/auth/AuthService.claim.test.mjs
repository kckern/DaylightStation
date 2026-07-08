// tests/isolated/application/auth/AuthService.claim.test.mjs
import { vi } from 'vitest';
import { AuthService } from '#backend/src/3_applications/auth/AuthService.mjs';

describe('AuthService.claim()', () => {
  function buildService({ profiles = new Map(), loginData = {} } = {}) {
    const written = {};
    const dataService = {
      user: {
        read: vi.fn((path, username) => {
          if (path === 'profile') return profiles.get(username) ?? null;
          if (path === 'auth/login') return loginData[username] ?? null;
          return null;
        }),
        write: vi.fn((path, data, username) => { written[`${username}/${path}`] = data; }),
      },
      system: { read: vi.fn(), write: vi.fn() },
      household: { read: vi.fn(), write: vi.fn() },
    };
    const configService = {
      getAllUserProfiles: vi.fn(() => profiles),
      getDefaultHouseholdId: vi.fn(() => 'default'),
    };
    const svc = new AuthService({ dataService, configService, logger: { info: vi.fn() } });
    return { svc, dataService, written };
  }

  test('creates login credentials and returns user info for valid profile', async () => {
    const profiles = new Map([['user_1', { username: 'user_1', household_id: 'default', roles: ['sysadmin'] }]]);
    const { svc, dataService } = buildService({ profiles });

    const result = await svc.claim('user_1', 'mypassword');

    expect(result).toEqual({ username: 'user_1', householdId: 'default', roles: ['sysadmin'] });
    expect(dataService.user.write).toHaveBeenCalledWith(
      'auth/login',
      expect.objectContaining({ password_hash: expect.any(String) }),
      'user_1'
    );
  });

  test('returns null for non-existent username', async () => {
    const { svc } = buildService({ profiles: new Map() });
    const result = await svc.claim('nobody', 'pass');
    expect(result).toBeNull();
  });

  test('throws if setup is already complete (a user has a password)', async () => {
    const profiles = new Map([['user_1', { username: 'user_1', household_id: 'default', roles: ['sysadmin'] }]]);
    const loginData = { user_1: { password_hash: '$2b$10$existing' } };
    const { svc } = buildService({ profiles, loginData });

    await expect(svc.claim('user_1', 'newpass')).rejects.toThrow('Setup already complete');
  });
});
