import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSchoolCalc,
  createSchoolCalcIngressAuthenticator,
  schoolCalcConfigurationView,
} from '#composition/modules/schoolCalc.mjs';
import { createSchoolCatalog } from '#composition/modules/schoolCatalog.mjs';
import { decodeTi86Envelope, decodeTi86LearnerRoster } from '#adapters/schoolcalc/ti86/index.mjs';
import { SchoolCalcRelayCredentialVerifier } from '#adapters/schoolcalc/SchoolCalcRelayCredentialVerifier.mjs';

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);
const ACTION_KEY = 'school-action-key-'.repeat(3);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true, force: true,
  })));
});

async function harness({ enabled = true, ingress = true, auth = true, actionKey = true } = {}) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'schoolcalc-composition-'));
  temporaryDirectories.push(dataDirectory);
  const schoolcalc = enabled ? {
    enabled: true,
    state: { root: 'runtime/schoolcalc' },
    ...(ingress ? { ingress: { relay_ids: ['ticalc-relay-01'] } } : {}),
  } : null;
  const catalog = {
    content: {
      root: 'content/school/learning-catalog',
      catalog_directories: ['mounted/catalogs'],
      document_directories: ['mounted/documents'],
      question_bank_directories: ['mounted/banks'],
      action_directories: ['mounted/actions'],
    },
  };
  const configService = {
    getHouseholdAppConfig: () => ({ catalog, ...(schoolcalc ? { schoolcalc } : {}) }),
    getDataDir: () => dataDirectory,
    getHouseholdAppPath: (app) => path.join(dataDirectory, 'households', 'apps', app),
    getHouseholdPath: (relative) => path.join(dataDirectory, 'households', relative),
    getHouseholdAuth: (service) => {
      if (service === 'schoolcalc') return actionKey ? { action_token_key: ACTION_KEY } : null;
      return auth ? { relays: { 'ticalc-relay-01': { api_token: TOKEN_A } } } : null;
    },
  };
  const schoolService = { importSchoolCalcAssessment: vi.fn(async () => ({ score: 1 })) };
  const learnerDirectory = {
    listLearners: vi.fn(() => [{ id: 'user_4', name: 'Alpha' }]),
    hasLearner: vi.fn((id) => id === 'user_4'),
  };
  const learningProgress = {
    execute: vi.fn(async ({ scopeId }) => ({
      generatedAt: '2026-08-01T12:00:00.000Z',
      scope: { type: 'learner', id: scopeId, label: 'Alpha', learnerIds: [scopeId] },
      summary: {
        evidenceCount: 0, engagementCount: 0, responseCount: 0, correctCount: 0,
        completionCount: 0, durationMs: 0, activityCount: 0, assessmentCount: 0,
        verifiedCount: 0, selfReportedCount: 0, pendingCount: 0,
        scorePercent: null, lastActivityAt: null,
      },
      recentScores: [], followUps: [],
    })),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const schoolCatalog = createSchoolCatalog({ configService, logger });
  const module = createSchoolCalc({
    configService,
    schoolService,
    learnerDirectory,
    learningProgress,
    logger,
    clock: () => new Date('2026-08-01T12:00:00.000Z'),
    randomBytesFactory: () => Buffer.from('a1b2c3d4e5f6', 'hex'),
    schoolCatalog,
  });
  return { dataDirectory, configService, schoolService, learnerDirectory, logger, module };
}

function responseDouble() {
  return {
    status: vi.fn(function status() { return this; }),
    json: vi.fn(function json() { return this; }),
  };
}

describe('SchoolCalc composition', () => {
  it('is inert unless School explicitly enables the product', async () => {
    const { module, configService } = await harness({ enabled: false });
    expect(module).toMatchObject({ wired: false, container: null, router: null, resultImporter: null });
    expect(module.reason).toMatch(/enabled/);
    expect(module.diagnostics).toEqual({
      platforms: [], relayIds: [], actionTokensConfigured: false,
    });
    expect(schoolCalcConfigurationView({ configService })).toEqual({
      enabled: false, relayIds: [], actionTokensConfigured: false,
    });
  });

  it('wires neutral use cases, TI-86 codec, persistence, authenticated API, and QR importer', async () => {
    const { module, dataDirectory } = await harness();
    expect(module.wired).toBe(true);
    expect(module.router).toBeTruthy();
    expect(module.resultImporter).toBe(module.container.importResult);
    expect(module.container.codecRegistry.listPlatformIds()).toEqual(['ti86']);
    expect(module.diagnostics).toEqual({
      platforms: ['ti86'],
      contentRoot: path.join(dataDirectory, 'content/school/learning-catalog'),
      catalogDirectories: [path.join(dataDirectory, 'mounted/catalogs')],
      documentDirectories: [path.join(dataDirectory, 'mounted/documents')],
      questionBankDirectories: [path.join(dataDirectory, 'mounted/banks')],
      actionDirectories: [path.join(dataDirectory, 'mounted/actions')],
      actionTokensConfigured: true,
      stateRoot: path.join(dataDirectory, 'runtime/schoolcalc'),
      relayIds: ['ticalc-relay-01'],
    });
    expect(JSON.stringify(module.diagnostics)).not.toContain(TOKEN_A);
    expect(JSON.stringify(module.diagnostics)).not.toContain(ACTION_KEY);
    expect(module.tokenRegistry).toBeTruthy();
    expect(module.actionTokens).toBeTruthy();

    const enrolled = await module.container.enrollDevice.execute({
      platformId: 'ti86', label: 'TI-86 A', catalogId: 'main',
    });
    expect(enrolled.device).toMatchObject({
      deviceId: 'SCA1B2C3D4E5F6', platformId: 'ti86',
      learnerBindings: [expect.objectContaining({ learnerKey: 1, learnerId: 'user_4' })],
    });
    expect(decodeTi86Envelope(enrolled.identityRecord, 'SCI1')).toEqual({
      deviceId: 'SCA1B2C3D4E5F6', schema: 'school.calc.device-identity/v1',
    });
    expect(decodeTi86LearnerRoster(enrolled.learnerRoster.record)).toMatchObject({
      deviceId: 'SCA1B2C3D4E5F6', profiles: [{ learnerKey: 1, label: 'Alpha' }],
    });
    const persisted = await readFile(path.join(
      dataDirectory, 'runtime/schoolcalc/devices/SCA1B2C3D4E5F6.yml',
    ), 'utf8');
    expect(persisted).toContain('deviceId: SCA1B2C3D4E5F6');
  });

  it('keeps the internal QR importer wired while refusing to mount HTTP without relay credentials', async () => {
    const { module, logger } = await harness({ ingress: false, auth: false });
    expect(module).toMatchObject({ wired: false, router: null });
    expect(module.container).toBeTruthy();
    expect(module.resultImporter).toBe(module.container.importResult);
    expect(logger.warn).toHaveBeenCalledWith('schoolcalc.ingress.unwired', expect.any(Object));
  });

  it('maps each bearer token to one server-owned relay identity', () => {
    const authenticate = createSchoolCalcIngressAuthenticator({
      credentialVerifier: new SchoolCalcRelayCredentialVerifier({ credentials: [
        { relayId: 'relay-a', apiToken: TOKEN_A },
        { relayId: 'relay-b', apiToken: TOKEN_B },
      ] }),
    });
    const req = { get: (name) => ({ Authorization: `Bearer ${TOKEN_B}` }[name]) };
    const res = responseDouble();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.schoolCalcIngress).toEqual({ id: 'relay-b' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects invalid credentials and a relay header that contradicts the credential', () => {
    const authenticate = createSchoolCalcIngressAuthenticator({
      credentialVerifier: new SchoolCalcRelayCredentialVerifier({
        credentials: [{ relayId: 'relay-a', apiToken: TOKEN_A }],
      }),
    });
    for (const headers of [
      { Authorization: 'Bearer wrong' },
      { Authorization: `Bearer ${TOKEN_A}`, 'X-SchoolCalc-Relay-Id': 'relay-b' },
    ]) {
      const req = { get: (name) => headers[name] };
      const res = responseDouble();
      const next = vi.fn();
      authenticate(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
      expect(req.schoolCalcIngress).toBeUndefined();
    }
  });

  it('rejects shared relay secrets because a credential must identify exactly one relay', () => {
    expect(() => new SchoolCalcRelayCredentialVerifier({ credentials: [
      { relayId: 'relay-a', apiToken: TOKEN_A },
      { relayId: 'relay-b', apiToken: TOKEN_A },
    ] })).toThrow(/distinct api_token/);
  });

  it('reports configuration without ever returning credential material', async () => {
    const { configService } = await harness();
    const view = schoolCalcConfigurationView({ configService });
    expect(view).toEqual({ enabled: true, relayIds: ['ticalc-relay-01'], actionTokensConfigured: true });
    expect(JSON.stringify(view)).not.toContain(TOKEN_A);
    expect(JSON.stringify(view)).not.toContain(ACTION_KEY);
  });

  it('keeps non-action lessons available but reports action issuance unavailable without a dedicated key', async () => {
    const { module, logger } = await harness({ actionKey: false });
    expect(module.container).toBeTruthy();
    expect(module.container.hydrateActions).toBe(null);
    expect(module.diagnostics.actionTokensConfigured).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('schoolcalc.actions.unwired', expect.any(Object));
  });
});
