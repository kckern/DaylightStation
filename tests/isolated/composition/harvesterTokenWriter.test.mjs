import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHarvesterServices } from '#composition/bootstrap.mjs';

const configService = {
  getSecret: () => null,
  getSystemAuth: () => null,
  getUserAuth: () => null,
  getTimezone: () => 'UTC',
  getMediaDir: () => '/tmp/media',
  getHouseholdPath: (p) => `/tmp/household/${p}`,
  getUserDir: (u) => `/tmp/users/${u}`,
  getHeadOfHousehold: () => 'alice',
  getAppConfig: () => ({}),
  getDataDir: () => '/tmp/data',
};
const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return logger; } };
const baseIo = { userLoadFile: vi.fn(), userSaveFile: vi.fn(), userSaveFileDirect: vi.fn() };

describe('createHarvesterServices token writer', () => {
  const saved = process.env.DAYLIGHT_TOKEN_WRITER;
  beforeEach(() => { process.env.DAYLIGHT_TOKEN_WRITER = 'true'; });
  afterEach(() => {
    if (saved === undefined) delete process.env.DAYLIGHT_TOKEN_WRITER;
    else process.env.DAYLIGHT_TOKEN_WRITER = saved;
  });

  it('allows refresh when the auth store can persist the rotated token', () => {
    const services = createHarvesterServices({
      io: { ...baseIo, userLoadAuth: vi.fn(), userSaveAuth: vi.fn() }, configService, logger,
    });
    expect(services.canRefreshTokens()).toBe(true);
  });

  it('refuses refresh when the auth store is read-only', () => {
    const services = createHarvesterServices({ io: baseIo, configService, logger });
    expect(services.canRefreshTokens()).toBe(false);
  });

  it('refuses refresh outside the container without the opt-in', () => {
    delete process.env.DAYLIGHT_TOKEN_WRITER;
    const services = createHarvesterServices({
      io: { ...baseIo, userLoadAuth: vi.fn(), userSaveAuth: vi.fn() }, configService, logger,
    });
    // This suite never runs inside the production container.
    expect(services.canRefreshTokens()).toBe(false);
  });
});
