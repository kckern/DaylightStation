// tests/isolated/application/auth/AuthService.needsSetup.test.mjs
import { jest } from '@jest/globals';
import { AuthService } from '#backend/src/3_applications/auth/AuthService.mjs';

describe('AuthService.needsSetup()', () => {
  function buildService({ profiles = new Map(), loginData = {} } = {}) {
    const dataService = {
      user: {
        read: jest.fn((path, username) => loginData[username] ?? null),
        write: jest.fn(),
      },
      system: { read: jest.fn(), write: jest.fn() },
      household: { read: jest.fn(), write: jest.fn() },
    };
    const configService = {
      getAllUserProfiles: jest.fn(() => profiles),
      getDefaultHouseholdId: jest.fn(() => 'default'),
    };
    return new AuthService({ dataService, configService, logger: { info: jest.fn() } });
  }

  test('returns true when no profiles exist', () => {
    const svc = buildService({ profiles: new Map() });
    expect(svc.needsSetup()).toBe(true);
  });

  test('returns true when profiles exist but none have password hashes', () => {
    const profiles = new Map([['kckern', { username: 'kckern', roles: ['sysadmin'] }]]);
    const svc = buildService({ profiles });
    expect(svc.needsSetup()).toBe(true);
  });

  test('returns false when at least one user has a password hash', () => {
    const profiles = new Map([['kckern', { username: 'kckern', roles: ['sysadmin'] }]]);
    const loginData = { kckern: { password_hash: '$2b$10$abc...' } };
    const svc = buildService({ profiles, loginData });
    expect(svc.needsSetup()).toBe(false);
  });
});
