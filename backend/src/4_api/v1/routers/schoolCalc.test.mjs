import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSchoolCalcRouter } from './schoolCalc.mjs';

function executable(value) { return { execute: vi.fn(async () => structuredClone(value)) }; }

function harness() {
  const bytes = Buffer.from('artifact-bytes');
  const learnerRoster = {
    schema: 'school.calc.learner-roster/v1', deviceId: '86A001', generation: 'sha256:profiles',
    profiles: [{ learnerKey: 1, learnerId: 'learner-a', label: 'Alpha' }],
    guest: { learnerKey: 0, label: 'Guest', persistent: false },
    deviceRevision: 1, record: Buffer.from('profiles'),
  };
  const progressProjection = {
    schema: 'school.calc.progress-projection/v1', deviceId: '86A001',
    generation: 'sha256:progress', profiles: [{ learnerKey: 1, summary: { scorePercent: 80 } }],
    deviceRevision: 1, record: Buffer.from('progress'),
  };
  const container = {
    enrollDevice: executable({
      device: { deviceId: '86A001' }, identityRecord: Buffer.from('identity'), learnerRoster,
    }),
    identifyDevice: executable({ deviceId: '86A001', platformId: 'ti86', label: 'Calculator A', revision: 0 }),
    observeDevice: executable({ deviceId: '86A001', revision: 1 }),
    getLearnerRoster: executable(learnerRoster),
    getProgressProjection: executable(progressProjection),
    resolveFollowUp: executable({
      status: 'ready', deviceId: '86A001', learnerKey: 1, actionKey: 'ABC234DEFG',
      launch: { type: 'adaptive_remediation', sessionId: 'REM_1' },
    }),
    getCatalog: executable({ generation: 'sha256:catalog', record: Buffer.from('catalog-record') }),
    requestDelivery: executable({ deviceId: '86A001', requests: [{ status: 'accepted' }] }),
    getArtifact: executable({
      artifactId: 'sc:ti86:ABC234DEFG', variableName: 'DPABC234',
      mediaType: 'application/vnd.daylight.schoolcalc.ti86', bytes,
      byteLength: bytes.length, byteDigest: 'digest-1',
    }),
    importResult: executable({ deviceId: '86A001', sequence: 1, status: 'accepted', acknowledge: true }),
    syncDevice: executable({
      profiles: learnerRoster,
      progress: progressProjection,
      observation: null, results: null, deliveries: null,
      interaction: {
        request: { requestId: 4 }, response: { status: 'complete' },
        record: Buffer.from('turn-response'),
      },
      plan: {
        schema: 'school.calc.sync-plan/v1', generation: 'sync-1',
        acknowledgementRecord: Buffer.from('acks'),
        manifestRecord: Buffer.from('manifest'),
      },
    }),
    remediationTutor: {
      listAvailable: vi.fn(async () => [{ sessionId: 'REM_1', status: 'offered' }]),
      get: vi.fn(async () => ({ sessionId: 'REM_1', turns: [], cursor: { latestServerSequence: 1 } })),
      act: vi.fn(async () => ({ status: 'complete', session: { sessionId: 'REM_1' } })),
    },
  };
  const authenticateIngress = (req, res, next) => {
    if (req.get('Authorization') !== 'Bearer valid') return res.status(401).json({ error: 'unauthorized' });
    req.schoolCalcIngress = { id: 'relay-a' };
    return next();
  };
  const app = express();
  app.use('/api/v1/school/calc', createSchoolCalcRouter({ container, authenticateIngress }));
  return { app, container, bytes };
}

const authorized = (operation) => operation.set('Authorization', 'Bearer valid');
const parseBinary = (response, done) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('SchoolCalc HTTP API', () => {
  let app; let container; let bytes;
  beforeEach(() => ({ app, container, bytes } = harness()));

  it('requires an injected ingress authenticator before every endpoint', async () => {
    await request(app).get('/api/v1/school/calc/devices/86A001/catalog').expect(401);
    expect(container.getCatalog.execute).not.toHaveBeenCalled();
  });

  it('enrolls without exposing binary representation choices to the application', async () => {
    const response = await authorized(request(app).post('/api/v1/school/calc/devices/enroll'))
    .send({ platformId: 'ti86', label: 'Calculator A', catalogId: 'main' })
      .expect(201);
    expect(container.enrollDevice.execute).toHaveBeenCalledWith({
      platformId: 'ti86', label: 'Calculator A', catalogId: 'main',
    });
    expect(response.body).toEqual({
      device: { deviceId: '86A001' },
      identity: { encoding: 'base64url', data: Buffer.from('identity').toString('base64url') },
      learnerRoster: {
        schema: 'school.calc.learner-roster/v1', deviceId: '86A001', generation: 'sha256:profiles',
        profiles: [{ learnerKey: 1, learnerId: 'learner-a', label: 'Alpha' }],
        guest: { learnerKey: 0, label: 'Guest', persistent: false }, deviceRevision: 1,
        record: { encoding: 'base64url', data: Buffer.from('profiles').toString('base64url') },
      },
    });
  });

  it('serves the config-filtered learner roster and its calculator record', async () => {
    const response = await authorized(request(app)
      .get('/api/v1/school/calc/devices/86A001/learners')).expect(200);
    expect(container.getLearnerRoster.execute).toHaveBeenCalledWith({ deviceId: '86A001' });
    expect(response.body).toMatchObject({
      profiles: [{ learnerKey: 1, learnerId: 'learner-a', label: 'Alpha' }],
      guest: { learnerKey: 0, persistent: false },
      record: { encoding: 'base64url' },
    });
  });

  it('serves the generic per-learner progress projection as a cacheable calculator record', async () => {
    const response = await authorized(request(app)
      .get('/api/v1/school/calc/devices/86A001/progress'))
      .buffer(true).parse(parseBinary).expect(200);
    expect(container.getProgressProjection.execute).toHaveBeenCalledWith({ deviceId: '86A001' });
    expect(response.body.equals(Buffer.from('progress'))).toBe(true);
    expect(response.headers.etag).toBe('"sha256:progress"');
    expect(response.headers['x-schoolcalc-progress-generation']).toBe('sha256:progress');
  });

  it('re-resolves an opaque follow-up key with an explicit learner key', async () => {
    const response = await authorized(request(app)
      .post('/api/v1/school/calc/devices/86A001/follow-ups/ABC234DEFG/resolve'))
      .send({ learnerKey: 1 })
      .expect(200);
    expect(container.resolveFollowUp.execute).toHaveBeenCalledWith({
      deviceId: '86A001', learnerKey: 1, actionKey: 'ABC234DEFG',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      status: 'ready', launch: { type: 'adaptive_remediation', sessionId: 'REM_1' },
    });
  });

  it('passes raw observation bytes and authenticated relay identity inward', async () => {
    await authorized(request(app).post('/api/v1/school/calc/devices/86A001/observe'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('device-info'))
      .expect(200);
    const call = container.observeDevice.execute.mock.calls[0][0];
    expect(call).toMatchObject({ deviceId: '86A001', relayId: 'relay-a' });
    expect(call.rawInfo.equals(Buffer.from('device-info'))).toBe(true);
  });

  it('resolves an opaque provisioned identity before the relay constructs a device URL', async () => {
    const response = await authorized(request(app).post('/api/v1/school/calc/devices/identify'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('identity-record'))
      .expect(200);
    expect(container.identifyDevice.execute.mock.calls[0][0].record.equals(Buffer.from('identity-record'))).toBe(true);
    expect(response.body).toEqual({
      deviceId: '86A001', platformId: 'ti86', label: 'Calculator A', revision: 0,
    });
  });

  it('serves a binary Catalog with validators and returns 304 without recompiling it', async () => {
    const first = await authorized(request(app).get('/api/v1/school/calc/devices/86A001/catalog'))
      .buffer(true).parse(parseBinary).expect(200);
    expect(first.body.equals(Buffer.from('catalog-record'))).toBe(true);
    expect(first.headers.etag).toBe('"sha256:catalog"');
    expect(first.headers['x-schoolcalc-catalog-generation']).toBe('sha256:catalog');

    const second = await authorized(request(app).get('/api/v1/school/calc/devices/86A001/catalog'))
      .set('If-None-Match', '"sha256:catalog"')
      .expect(304);
    expect(second.text).toBe('');
  });

  it('serves immutable artifact bytes and exact transfer metadata', async () => {
    const response = await authorized(request(app).get('/api/v1/school/calc/artifacts/sc:ti86:ABC234DEFG'))
      .buffer(true).parse(parseBinary).expect(200);
    expect(response.body.equals(bytes)).toBe(true);
    expect(response.headers).toMatchObject({
      etag: '"digest-1"',
      'x-schoolcalc-artifact-id': 'sc:ti86:ABC234DEFG',
      'x-schoolcalc-variable-name': 'DPABC234',
      'x-schoolcalc-byte-digest': 'digest-1',
      'x-schoolcalc-byte-length': String(bytes.length),
    });
  });

  it('uses one result handler for QR text and cable bytes', async () => {
    await authorized(request(app).post('/api/v1/school/calc/results/import'))
      .set('Content-Type', 'text/plain').send('sch:r1:ABC2').expect(200);
    await authorized(request(app).post('/api/v1/school/calc/results/import'))
      .set('Content-Type', 'application/octet-stream').send(Buffer.from('SCR1bytes')).expect(200);
    expect(container.importResult.execute.mock.calls[0][0]).toEqual({ record: 'sch:r1:ABC2', transport: 'qr' });
    expect(container.importResult.execute.mock.calls[1][0].transport).toBe('relay');
    expect(container.importResult.execute.mock.calls[1][0].record.equals(Buffer.from('SCR1bytes'))).toBe(true);
  });

  it('decodes sync record fields and serializes the adapter acknowledgement record', async () => {
    const encoded = (value) => ({ encoding: 'base64url', data: Buffer.from(value).toString('base64url') });
    const response = await authorized(request(app).post('/api/v1/school/calc/devices/86A001/sync'))
      .send({
        rawInfo: encoded('info'), installedState: encoded('installed'),
        resultQueue: encoded('queue'), requestRecord: encoded('requests'),
        interactionRecord: encoded('turn-request'),
        catalogGeneration: 'old',
      }).expect(200);
    const call = container.syncDevice.execute.mock.calls[0][0];
    expect(call).toMatchObject({ deviceId: '86A001', relayId: 'relay-a', catalogGeneration: 'old' });
    expect(call.rawInfo.toString()).toBe('info');
    expect(call.rawState.toString()).toBe('installed');
    expect(call.resultQueue.toString()).toBe('queue');
    expect(call.requestRecord.toString()).toBe('requests');
    expect(call.interactionRecord.toString()).toBe('turn-request');
    expect(response.body.plan).toEqual({
      schema: 'school.calc.sync-plan/v1', generation: 'sync-1',
      acknowledgement: encoded('acks'),
      manifest: encoded('manifest'),
    });
    expect(response.body.profiles).toMatchObject({
      generation: 'sha256:profiles', record: encoded('profiles'),
    });
    expect(response.body.progress).toMatchObject({
      generation: 'sha256:progress', record: encoded('progress'),
    });
    expect(response.body.interaction).toEqual({
      request: { requestId: 4 }, response: { status: 'complete' },
      record: encoded('turn-response'),
    });
  });

  it('exposes resumable remediation sessions and translates only HTTP cursors/actions', async () => {
    const listed = await authorized(request(app)
      .get('/api/v1/school/calc/devices/86A001/remediation')).expect(200);
    expect(listed.body.sessions).toEqual([{ sessionId: 'REM_1', status: 'offered' }]);
    expect(listed.body.hasMore).toBe(false);
    expect(container.remediationTutor.listAvailable).toHaveBeenCalledWith({
      surface: 'schoolcalc', endpointId: '86A001',
    });

    await authorized(request(app)
      .get('/api/v1/school/calc/devices/86A001/remediation/REM_1?after=1')).expect(200);
    expect(container.remediationTutor.get).toHaveBeenCalledWith({
      sessionId: 'REM_1', access: { surface: 'schoolcalc', endpointId: '86A001' }, afterServerSequence: 1,
      maxTurns: 20,
    });

    await authorized(request(app)
      .post('/api/v1/school/calc/devices/86A001/remediation/REM_1/actions'))
      .send({
        clientSequence: 2, lastServerSequence: 2,
        action: 'choice', turnId: 'TURN_2', choiceId: 'C',
      }).expect(200);
    expect(container.remediationTutor.act).toHaveBeenCalledWith({
      sessionId: 'REM_1', access: { surface: 'schoolcalc', endpointId: '86A001' }, clientSequence: 2,
      lastServerSequence: 2, action: 'choice', turnId: 'TURN_2', choiceId: 'C',
    });
  });

  it('returns 202 while an identical action is processing and 409 for sequence conflicts', async () => {
    container.remediationTutor.act.mockResolvedValueOnce({ status: 'processing', retryable: true });
    await authorized(request(app)
      .post('/api/v1/school/calc/devices/86A001/remediation/REM_1/actions'))
      .send({ clientSequence: 0, lastServerSequence: 0, action: 'start' })
      .expect(202);

    const collision = Object.assign(new Error('sequence reused'), {
      code: 'REMEDIATION_ACTION_CONFLICT',
    });
    container.remediationTutor.act.mockRejectedValueOnce(collision);
    const response = await authorized(request(app)
      .post('/api/v1/school/calc/devices/86A001/remediation/REM_1/actions'))
      .send({ clientSequence: 1, lastServerSequence: 1, action: 'cancel' })
      .expect(409);
    expect(response.body).toEqual({
      error: 'sequence reused', code: 'REMEDIATION_ACTION_CONFLICT',
    });
  });
});
