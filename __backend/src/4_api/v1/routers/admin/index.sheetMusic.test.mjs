// @vitest-environment node
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdminRouter } from './index.mjs';

const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
const baseServices = {
  logger,
  listManagementService: {},
  yamlConfigFileService: {},
  appsConfigService: {},
  schedulerAdminService: {},
  integrationsQueryService: {},
  householdAdminService: {},
  adminImageService: {},
  adminArtService: { listWorks() {}, patchWork() {} },
};
const sheetMusicAdminService = {
  library: async () => [{ id: 'files:docs/sheet-music/classical/a.musicxml' }],
  uploadFolders: async () => ['classical'],
  upload: async () => ({}),
  getLearn: async () => ({}),
  saveDraft: async () => ({}),
  approve: async () => ({}),
  revert: async () => ({}),
  draftImpact: async () => ({}),
  impact: async () => [],
  savePoster: async () => ({}),
};

function appWith(services) {
  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter(services));
  return app;
}

describe('createAdminRouter /sheet-music', () => {
  it('mounts the sheet music router when the service is given', async () => {
    const res = await request(appWith({ ...baseServices, sheetMusicAdminService })).get('/admin/sheet-music/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scores: [{ id: 'files:docs/sheet-music/classical/a.musicxml' }], folders: ['classical'], boundaryScorer: 'heuristic' });
  });

  it('leaves /sheet-music unmounted without the service', async () => {
    const res = await request(appWith(baseServices)).get('/admin/sheet-music/');
    expect(res.status).toBe(404);
  });
});
