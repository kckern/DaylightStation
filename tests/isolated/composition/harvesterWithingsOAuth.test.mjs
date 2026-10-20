import { describe, it, expect, vi } from 'vitest';
import { createHarvesterServices } from '#composition/bootstrap.mjs';
import { WithingsOAuth } from '#adapters/harvester/fitness/WithingsOAuth.mjs';

const makeConfig = (auth = {}) => ({
  getSecret: () => null,
  getSystemAuth: (service, key) => (service === 'withings' ? auth[key] ?? null : null),
  getUserAuth: () => null,
  getTimezone: () => 'UTC',
  getMediaDir: () => '/tmp/media',
  getHouseholdPath: (p) => `/tmp/household/${p}`,
  getUserDir: (u) => `/tmp/users/${u}`,
  getHeadOfHousehold: () => 'alice',
  getAppConfig: () => ({}),
  getDataDir: () => '/tmp/data',
});
const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
const io = { userLoadFile: vi.fn(), userSaveFile: vi.fn(), userSaveFileDirect: vi.fn(), userLoadAuth: vi.fn(), userSaveAuth: vi.fn() };
const httpClient = { get: vi.fn(), post: vi.fn() };

describe('createHarvesterServices withingsOAuth', () => {
  it('builds a WithingsOAuth from the Withings client credentials', () => {
    const services = createHarvesterServices({
      io, httpClient, logger, configService: makeConfig({ client_id: 'cid', client_secret: 'sec' }),
    });
    expect(services.withingsOAuth).toBeInstanceOf(WithingsOAuth);
    const url = new URL(services.withingsOAuth.authorizeUrl({ redirectUri: 'https://example.test/cb', state: 's' }));
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  it('is null without client credentials', () => {
    const services = createHarvesterServices({ io, httpClient, logger, configService: makeConfig({ client_id: 'cid' }) });
    expect(services.withingsOAuth).toBeNull();
  });

  it('is null without an httpClient', () => {
    const services = createHarvesterServices({ io, logger, configService: makeConfig({ client_id: 'cid', client_secret: 'sec' }) });
    expect(services.withingsOAuth).toBeNull();
  });
});
