/**
 * Tests for FitnessSyncer auth caching/refresh logic.
 */

import { jest } from '@jest/globals';

const mockUserSaveAuth = jest.fn();
const mockConfigService = {
  getHeadOfHousehold: jest.fn(() => 'kckern'),
  getUserAuth: jest.fn(),
  getSecret: jest.fn()
};
const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockAxiosPost = jest.fn();

const mockModules = () => {
  jest.unstable_mockModule('#backend/lib/config/index.mjs', () => ({ configService: mockConfigService }));
  jest.unstable_mockModule('#backend/lib/io.mjs', () => ({
    userSaveAuth: mockUserSaveAuth,
    userLoadFile: jest.fn(),
    userSaveFile: jest.fn(),
    loadFile: jest.fn(),
    saveFile: jest.fn()
  }));
  jest.unstable_mockModule('#backend/_legacy/lib/http.mjs', () => ({ default: { post: mockAxiosPost, get: jest.fn() } }));
  jest.unstable_mockModule('#backend/_legacy/lib/logging/logger.js', () => ({ createLogger: () => mockLogger }));
};

const clearEnv = () => {
  delete process.env.FITSYNC_ACCESS_TOKEN;
  delete process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT;
};

const loadFitsync = async () => {
  jest.resetModules();
  mockAxiosPost.mockReset();
  mockUserSaveAuth.mockReset();
  Object.values(mockLogger).forEach(fn => fn.mockClear());
  clearEnv();
  mockModules();
  const mod = await import('#backend/_legacy/lib/fitsync.mjs');
  return mod;
};

describe('fitsync auth caching', () => {
  beforeEach(() => {
    mockConfigService.getUserAuth.mockReset();
    mockConfigService.getSecret.mockReset();
  });

  it('refreshes and caches with expiry, merging auth fields', async () => {
    const { getAccessToken } = await loadFitsync();
     mockConfigService.getUserAuth.mockReturnValue({ refresh: 'old-refresh', client_id: 'cid', client_secret: 'csec', keep: 'keepme' });
     mockAxiosPost.mockResolvedValue({ data: { access_token: 'token-1', refresh_token: 'refresh-1', expires_in: 1200 } });

    const token = await getAccessToken();

      expect(token).toBe('token-1');
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(process.env.FITSYNC_ACCESS_TOKEN).toBe('token-1');
    expect(process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT).toBeDefined();
    expect(mockUserSaveAuth).toHaveBeenCalledWith('kckern', 'fitnesssyncer', expect.objectContaining({
      refresh: 'refresh-1',
      client_id: 'cid',
      client_secret: 'csec',
      keep: 'keepme'
    }));

    // Second call should reuse cached token without another refresh
    mockAxiosPost.mockClear();
    const token2 = await getAccessToken();
    expect(token2).toBe('token-1');
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('refreshes when env token is expired', async () => {
    const { getAccessToken } = await loadFitsync();
    process.env.FITSYNC_ACCESS_TOKEN = 'stale-token';
    process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT = '2000-01-01T00:00:00Z';
    mockConfigService.getUserAuth.mockReturnValue({ refresh: 'old-refresh' });
    mockConfigService.getSecret.mockImplementation(key => {
      if (key === 'FITSYNC_CLIENT_ID') return 'cid2';
      if (key === 'FITSYNC_CLIENT_SECRET') return 'csec2';
      return undefined;
    });
    mockAxiosPost.mockResolvedValue({ data: { access_token: 'token-2', refresh_token: 'refresh-2', expires_in: 3600 } });
    const token = await getAccessToken();

    expect(token).toBe('token-2');
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
  });

  it('clears cache/env on refresh failure', async () => {
    mockConfigService.getUserAuth.mockReturnValue({ refresh: 'old-refresh' });
    mockAxiosPost.mockRejectedValue(new Error('boom'));

    const { getAccessToken } = await loadFitsync();
    const token = await getAccessToken();

    expect(token).toBe(false);
    expect(process.env.FITSYNC_ACCESS_TOKEN).toBeUndefined();
    expect(process.env.FITSYNC_ACCESS_TOKEN_EXPIRES_AT).toBeUndefined();
  });
});
