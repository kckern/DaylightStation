// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';

const service = {
  getRoster: () => [], warmBanks: async () => {}, listBanks: () => [],
};

const LESSON_ADDRESS = 'main/sci/wc/wm/evap';
const LESSON_ROWS = [
  {
    address: LESSON_ADDRESS, surfaceId: 'paper-letter-mono', verdict: 'full',
    reasons: [], warnings: [], moduleVerdicts: [], contentDigest: 'c1', profileDigest: 'p1',
  },
  {
    address: LESSON_ADDRESS, surfaceId: 'screen-office', verdict: 'full',
    reasons: [], warnings: [], moduleVerdicts: [], contentDigest: 'c1', profileDigest: 'p2',
  },
];
const BANK_ROWS = [
  {
    address: 'bank:b1', surfaceId: 'paper-letter-mono', verdict: 'full',
    reasons: [], warnings: [], moduleVerdicts: null, contentDigest: 'c2', profileDigest: 'p1',
  },
];

const SCREEN_PROFILE = { surfaceId: 'screen-office', family: 'screen', capabilities: [] };
const BROWSER_PROFILE = { surfaceId: 'screen-browser', family: 'screen', capabilities: [] };

function fixture(overrides = {}) {
  const surfaceCertification = {
    lesson: vi.fn(async (address) => {
      if (address !== LESSON_ADDRESS) throw new Error(`lesson '${address}' was not found`);
      return LESSON_ROWS;
    }),
    bank: vi.fn(async (bankId) => {
      if (bankId !== 'b1') throw new Error(`bank '${bankId}' was not found`);
      return BANK_ROWS;
    }),
  };
  surfaceCertification.select = vi.fn(async ({ address, bankId, surfaceId }) => {
    const rows = address !== null ? await surfaceCertification.lesson(address) : await surfaceCertification.bank(bankId);
    return surfaceId === null ? rows : rows.filter((row) => row.surfaceId === surfaceId);
  });
  const registryProfiles = {
    'screen-office': SCREEN_PROFILE,
    'screen-browser': BROWSER_PROFILE,
  };
  const surfaceRegistry = {
    get: vi.fn((surfaceId) => registryProfiles[surfaceId]),
  };
  const screenConfigs = {
    office: { surfaceProfile: 'screen-office' },
    noprofile: { screen: 'noprofile' },
    ghost: { surfaceProfile: 'unknown-surface' },
  };
  const getScreenConfig = vi.fn(async (screenId) => screenConfigs[screenId] ?? null);
  const logger = { error: vi.fn(), warn: vi.fn() };

  const app = express();
  app.use(express.json());
  app.use('/api/v1/school', createSchoolRouter({
    schoolService: service,
    surfaceCertification,
    surfaceRegistry,
    getScreenConfig,
    logger,
    ...overrides,
  }));
  return {
    app, surfaceCertification, surfaceRegistry, getScreenConfig, logger,
  };
}

describe('School certification HTTP projection', () => {
  it('serves certification rows for a lesson address', async () => {
    const { app, surfaceCertification } = fixture();
    const response = await request(app)
      .get(`/api/v1/school/certification?address=${encodeURIComponent(LESSON_ADDRESS)}`)
      .expect(200);
    expect(response.body).toEqual(LESSON_ROWS);
    expect(surfaceCertification.lesson).toHaveBeenCalledWith(LESSON_ADDRESS);
  });

  it('filters certification rows by surface when requested', async () => {
    const { app } = fixture();
    const response = await request(app)
      .get(`/api/v1/school/certification?address=${encodeURIComponent(LESSON_ADDRESS)}&surface=screen-office`)
      .expect(200);
    expect(response.body).toEqual([LESSON_ROWS[1]]);
  });

  it('serves certification rows for a standalone bank', async () => {
    const { app, surfaceCertification } = fixture();
    const response = await request(app).get('/api/v1/school/certification?bank=b1').expect(200);
    expect(response.body).toEqual(BANK_ROWS);
    expect(surfaceCertification.bank).toHaveBeenCalledWith('b1');
  });

  it('400s when neither address nor bank is given', async () => {
    const { app } = fixture();
    await request(app).get('/api/v1/school/certification').expect(400);
  });

  it('400s when both address and bank are given', async () => {
    const { app } = fixture();
    await request(app)
      .get(`/api/v1/school/certification?address=${encodeURIComponent(LESSON_ADDRESS)}&bank=b1`)
      .expect(400);
  });

  it('400s on a malformed address shape', async () => {
    const { app } = fixture();
    await request(app).get('/api/v1/school/certification?address=not-five-segments').expect(400);
  });

  it('404s on an unknown lesson address', async () => {
    const { app } = fixture();
    await request(app).get('/api/v1/school/certification?address=main/sci/wc/wm/unknown').expect(404);
  });

  it('404s on an unknown bank', async () => {
    const { app } = fixture();
    await request(app).get('/api/v1/school/certification?bank=unknown-bank').expect(404);
  });

  it('503s with certification-unavailable when the dependency is not wired', async () => {
    const { app } = fixture({ surfaceCertification: null });
    const response = await request(app)
      .get(`/api/v1/school/certification?address=${encodeURIComponent(LESSON_ADDRESS)}`)
      .expect(503);
    expect(response.body).toEqual({ error: 'certification-unavailable' });
  });

  it('resolves a screen surface profile via screen config', async () => {
    const { app, getScreenConfig, surfaceRegistry } = fixture();
    const response = await request(app).get('/api/v1/school/surfaces/profile?screen=office').expect(200);
    expect(response.body).toEqual(SCREEN_PROFILE);
    expect(getScreenConfig).toHaveBeenCalledWith('office');
    expect(surfaceRegistry.get).toHaveBeenCalledWith('screen-office');
  });

  it('resolves the fixed browser profile when screen is "browser"', async () => {
    const { app, getScreenConfig } = fixture();
    const response = await request(app).get('/api/v1/school/surfaces/profile?screen=browser').expect(200);
    expect(response.body).toEqual(BROWSER_PROFILE);
    expect(getScreenConfig).not.toHaveBeenCalled();
  });

  it('resolves the fixed browser profile when screen is omitted', async () => {
    const { app, getScreenConfig } = fixture();
    const response = await request(app).get('/api/v1/school/surfaces/profile').expect(200);
    expect(response.body).toEqual(BROWSER_PROFILE);
    expect(getScreenConfig).not.toHaveBeenCalled();
  });

  it('404s fail-closed when the screen has no config', async () => {
    const { app, logger } = fixture();
    await request(app).get('/api/v1/school/surfaces/profile?screen=missing')
      .expect(404, { error: 'surface-profile-unresolved' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('404s fail-closed when the screen config has no surfaceProfile key', async () => {
    const { app, logger } = fixture();
    await request(app).get('/api/v1/school/surfaces/profile?screen=noprofile')
      .expect(404, { error: 'surface-profile-unresolved' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('404s fail-closed when the surfaceProfile id is unknown to the registry', async () => {
    const { app, logger } = fixture();
    await request(app).get('/api/v1/school/surfaces/profile?screen=ghost')
      .expect(404, { error: 'surface-profile-unresolved' });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('404s when surfaceRegistry is not wired at all, never synthesizing a default', async () => {
    const { app } = fixture({ surfaceRegistry: null });
    await request(app).get('/api/v1/school/surfaces/profile')
      .expect(404, { error: 'surface-profile-unresolved' });
  });

  it('404s when getScreenConfig is not wired and a non-browser screen is requested', async () => {
    const { app } = fixture({ getScreenConfig: null });
    await request(app).get('/api/v1/school/surfaces/profile?screen=office')
      .expect(404, { error: 'surface-profile-unresolved' });
  });
});
