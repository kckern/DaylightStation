import { describe, expect, it, vi } from 'vitest';
import { Ti86SchoolCalcCodec, decodeTi86Envelope } from '#adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { encodeTi86SchoolActionQr } from '#adapters/schoolcalc/ti86/Ti86SchoolActionQr.mjs';
import { HmacSchoolActionTokenIssuer } from '#adapters/school/actions/HmacSchoolActionTokenIssuer.mjs';
import { SchoolLearningActionExecutor } from '#adapters/school/actions/SchoolLearningActionExecutor.mjs';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { BuildSchoolCalcArtifact } from '#apps/school/schoolcalc/BuildSchoolCalcArtifact.mjs';
import { BuildLearningLesson } from '#apps/school/catalog/BuildLearningLesson.mjs';
import { HydrateSchoolCalcActions } from '#apps/school/schoolcalc/HydrateSchoolCalcActions.mjs';
import { ResolveSchoolCalcAction } from '#apps/school/schoolcalc/ResolveSchoolCalcAction.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';

const ADDRESS = 'main/quantitative/physics/motion/velocity';
const ACTION_ID = 'worksheet:velocity-practice';

describe('SchoolCalc authored lesson-action QR vertical slice', () => {
  it('publishes, binds, compiles, scans without inferred learner attribution, and revokes one device action', async () => {
    const tokenRegistry = memoryTokenRegistry();
    const action = {
      schema: 'school.learning-action/v1',
      actionId: ACTION_ID,
      title: 'Print velocity practice',
      kind: 'print_document',
      tokenVersion: 1,
      policy: { replay: 'repeatable' },
      target: { printableId: 'velocity-practice', copies: 1 },
    };
    const content = {
      async getDocument(documentId) {
        return documentId === 'velocity-notes' ? {
          schema: 'school.learning-document/v1',
          documentId,
          title: 'Velocity notes',
          blocks: [
            { blockId: 'definition', type: 'prose', text: 'Velocity is displacement over time.' },
            {
              blockId: 'practice', type: 'scan_action', actionId: ACTION_ID,
              label: 'Print practice',
            },
          ],
        } : null;
      },
      async getQuestionBank() { return null; },
      async getLearningAction(actionId) { return actionId === ACTION_ID ? structuredClone(action) : null; },
    };
    const bundles = new BuildLearningLesson({
      catalogs: { getCatalog: async () => catalog() },
      content,
    });
    const issuer = new HmacSchoolActionTokenIssuer({
      key: 'schoolcalc action QR integration key',
      tokens: tokenRegistry,
      clock: () => new Date('2026-08-02T13:00:00.000Z'),
    });
    const codec = new Ti86SchoolCalcCodec();
    const devices = memoryDevices();
    const artifacts = memoryArtifacts();
    const build = new BuildSchoolCalcArtifact({
      devices,
      codecs: { get: (platformId) => {
        expect(platformId).toBe('ti86');
        return codec;
      } },
      bundles,
      artifacts,
      actions: new HydrateSchoolCalcActions({ content, issuer }),
    });

    const artifact = await build.execute({ deviceId: 'SC86A001', address: ADDRESS });
    const decoded = decodeTi86Envelope(artifact.bytes, 'SCP1');
    const page = decoded.lesson.modules[0].pages[1];
    expect(page).toMatchObject({
      kind: 'scan_action', text: 'Print practice',
    });
    expect(page.actionToken).toMatch(/^sch:[2-9A-HJ-NP-Z]{16}$/);
    expect(page.qrModules).toEqual(encodeTi86SchoolActionQr(page.actionToken));
    expect(artifact.interpretation.bundle.lesson.modules[0].document.blocks[1])
      .not.toHaveProperty('token');
    expect(JSON.stringify(decoded)).not.toContain(action.target.printableId);

    const tokenRecord = await tokenRegistry.get(page.actionToken);
    expect(tokenRecord).toMatchObject({
      tokenClass: 'learning_action',
      subject: {
        deviceId: 'SC86A001', address: ADDRESS, actionId: ACTION_ID, tokenVersion: 1,
      },
      expiresAt: null,
      revokedAt: null,
    });

    const requestPrint = vi.fn(async () => ({ decision: 'printed', pages: 2 }));
    const actionExecutor = new SchoolLearningActionExecutor().bind({
      printService: { requestPrint },
    });
    const actionResolver = new ResolveSchoolCalcAction({ devices, content, executor: actionExecutor });
    const receipts = { print: vi.fn(async () => ({ printed: true })) };
    const scan = scanResolver({
      tokens: tokenRegistry,
      receipts,
      actionResolver,
    });

    const first = await scan.execute({ code: page.actionToken, device: 'kitchen-scanner' });
    const replay = await scan.execute({ code: page.actionToken, device: 'kitchen-scanner' });
    expect(first).toMatchObject({
      status: 'unavailable', tokenClass: 'learning_action', physical: 'receipt', printed: true,
    });
    expect(replay).toMatchObject({ status: 'unavailable', physical: 'receipt', printed: true });
    expect(requestPrint).not.toHaveBeenCalled();
    expect(receipts.print).toHaveBeenCalledTimes(2);

    await tokenRegistry.revoke(page.actionToken, { at: '2026-08-02T14:00:00.000Z' });
    const revoked = await scan.execute({ code: page.actionToken, device: 'kitchen-scanner' });
    expect(revoked).toMatchObject({
      status: 'expired', tokenClass: 'learning_action', physical: 'receipt', printed: true,
    });
    expect(requestPrint).not.toHaveBeenCalled();
    expect(receipts.print).toHaveBeenCalledTimes(3);
  });
});

function catalog() {
  return {
    schema: 'school.catalog/v1', catalogId: 'main', title: 'Main Catalog',
    subjects: [{
      subjectId: 'quantitative', title: 'Quantitative Studies',
      courses: [{
        courseId: 'physics', title: 'Physics',
        units: [{
          unitId: 'motion', title: 'Motion',
          lessons: [{
            lessonId: 'velocity', title: 'Velocity', objectives: ['Relate displacement and time'],
            modules: [{ moduleId: 'notes', type: 'lecture_notes', documentId: 'velocity-notes' }],
          }],
        }],
      }],
    }],
  };
}

function memoryDevices() {
  const device = SchoolCalcDevice.enroll({
    deviceId: 'SC86A001', label: 'TI-86 A', platformId: 'ti86',
    // A calculator is enrolled AGAINST the one catalog projected to it —
    // `SchoolCalcDevice` requires it, and `EnrollSchoolCalcDevice` supplies it.
    catalogId: 'main',
    createdAt: '2026-08-02T12:00:00.000Z',
  }).observe({
    capabilityReport: {
      platformId: 'ti86', deviceId: 'SC86A001',
      capabilities: ['reader@1', 'scan-action@1'], installedArtifactIds: [],
      limits: { maxArtifactBytes: 12_288 },
    },
    observedAt: '2026-08-02T12:30:00.000Z', relayId: 'relay-a',
  });
  return { getDevice: async (deviceId) => (deviceId === device.deviceId ? device : null) };
}

function memoryArtifacts() {
  const records = new Map();
  return {
    async putArtifact(artifact) {
      if (!records.has(artifact.artifactId)) records.set(artifact.artifactId, structuredClone(artifact));
      return structuredClone(records.get(artifact.artifactId));
    },
    async getArtifact(artifactId) {
      return records.has(artifactId) ? structuredClone(records.get(artifactId)) : null;
    },
  };
}

function memoryTokenRegistry() {
  const records = new Map();
  return {
    async claim(record) {
      const current = records.get(record.token);
      if (current) {
        const same = current.tokenClass === record.tokenClass
          && JSON.stringify(current.subject) === JSON.stringify(record.subject);
        return { status: same ? 'duplicate' : 'conflict', record: structuredClone(current) };
      }
      records.set(record.token, structuredClone(record));
      return { status: 'accepted', record: structuredClone(record) };
    },
    async get(token) { return records.has(token) ? structuredClone(records.get(token)) : null; },
    async revoke(token, { at }) {
      const current = records.get(token);
      if (!current) return null;
      if (!current.revokedAt) records.set(token, { ...current, revokedAt: at });
      return structuredClone(records.get(token));
    },
  };
}

function scanResolver({ tokens, receipts, actionResolver }) {
  const unused = { execute: async () => ({ status: 'unused' }) };
  return new ResolveScanAction({
    tokens,
    sessions: { readEvents: async () => [] },
    curriculum: { getUnit: async () => null },
    resolvePersonalCard: unused,
    issueDocument: unused,
    dispatchMedia: unused,
    openRemediation: unused,
    receipts,
    resolveLearningAction: actionResolver,
    clock: () => new Date('2026-08-02T13:30:00.000Z'),
    logger: { info: vi.fn(), warn: vi.fn() },
  });
}
