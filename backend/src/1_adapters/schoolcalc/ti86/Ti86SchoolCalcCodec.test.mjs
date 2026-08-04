import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
  TI86_SCHOOLCALC_CODEC_CAPABILITIES,
  TI86_SCHOOLCALC_RUNTIME_MODULE_BITS,
  TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
  TI86_SCHOOLCALC_RUNTIME_PROMOTION_ENABLED,
  decodeTi86Acknowledgements,
  decodeTi86Envelope,
  decodeTi86InstalledState,
  decodeTi86InteractionRequest,
  decodeTi86InteractionResponse,
  decodeTi86LearnerRoster,
  decodeTi86ProgressProjection,
  decodeTi86SyncManifest,
  encodeTi86Envelope,
  encodeTi86DeliveryRequests,
  encodeTi86DeviceInfo,
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
  encodeTi86InteractionRequest,
  ti86GenerationKey,
} from './Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from './Ti86SchoolCalcLimits.mjs';

// Exported for cross-task reuse (spec §12.2 acceptance parity test), following
// the same pattern as PaperCertification.test.mjs's exported fixtures.
export const bundle = {
  schema: 'school.learning-lesson/v1',
  address: 'main/markets/finance/interest/compound-growth',
  context: {
    catalog: { catalogId: 'main', title: 'Main Catalog' },
    subject: { subjectId: 'markets', title: 'Markets' },
    course: { courseId: 'finance', title: 'Finance' },
    unit: { unitId: 'interest', title: 'Interest' },
  },
  lesson: {
    lessonId: 'compound-growth',
    title: 'Compound growth',
    shortTitle: 'Growth',
    objectives: ['Compare growth'],
    modules: [{
      moduleId: 'quiz',
      type: 'quiz',
      bankId: 'finance:compound-check',
      passingPercent: 80,
      bank: {
        id: 'finance:compound-check',
        title: 'Check',
        items: [{
          id: 'q1', type: 'multiple_choice', prompt: 'Which grows?',
          choices: ['Principal', 'Principal plus interest'], answer: 'Principal plus interest',
        }],
      },
    }],
  },
  capabilities: ['quiz@1', 'response.choice@1'],
};

describe('Ti86SchoolCalcCodec', () => {
  it('separates projectable formats from capabilities the current client advertises', () => {
    expect(TI86_SCHOOLCALC_CLIENT_CAPABILITIES).toEqual(['shell-core@1']);
    expect(TI86_SCHOOLCALC_CODEC_CAPABILITIES).toContain('reader@1');
    expect(TI86_SCHOOLCALC_CODEC_CAPABILITIES).toContain('quiz@1');
    expect(TI86_SCHOOLCALC_CODEC_CAPABILITIES).toContain('learning-probe@1');
    expect(TI86_SCHOOLCALC_CODEC_CAPABILITIES).not.toContain('response.text@1');
    expect(TI86_SCHOOLCALC_CODEC_CAPABILITIES).toContain('scan-action@1');
    expect(TI86_SCHOOLCALC_CLIENT_CAPABILITIES).not.toContain('reader@1');
    expect(TI86_SCHOOLCALC_RUNTIME_MODULE_BITS).toEqual({
      standardLearning: 1, resultQr: 2, catalogBrowser: 4,
      deliveryRequest: 8, resultQueue: 16, foregroundSync: 32,
      nativeHandoff: 64, learnerProfile: 128, realtimeTutor: 256,
    });
    expect(TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK).toBe(511);
    expect(TI86_SCHOOLCALC_RUNTIME_PROMOTION_ENABLED).toBe(false);
  });

  it('decodes DSINFO into a neutral capability report', () => {
    const codec = new Ti86SchoolCalcCodec();
    const report = codec.describeCapabilities(encodeTi86DeviceInfo({
      shellVersion: '0.1.0',
      deviceId: '86A001',
      capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
      installedArtifactIds: ['sc:ti86:ABC234DEFG'],
      freeBytes: 42000,
      maxArtifactBytes: 32000,
      runtimeModuleMask: TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
    }));
    expect(report).toMatchObject({
      platformId: 'ti86', deviceId: '86A001', shellVersion: '0.1.0',
      capabilities: ['shell-core@1'],
      installationGeneration: null,
      limits: {
        screenWidth: 128,
        screenHeight: 64,
        maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
        artifactTargetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
        catalogStateTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogStateTargetBytes,
        catalogStateMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogStateMaxBytes,
        catalogRecordTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordTargetBytes,
        catalogRecordMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes,
        queueTargetBytes: TI86_SCHOOLCALC_LIMITS.queueTargetBytes,
        queueMaxBytes: TI86_SCHOOLCALC_LIMITS.queueMaxBytes,
        queueMaxRecords: TI86_SCHOOLCALC_LIMITS.queueMaxRecords,
        acknowledgementMaxBytes: TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes,
        syncManifestMaxBytes: TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes,
        nativeHandoffWorkspaceBytes: TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes,
        reservedFreeBytes: TI86_SCHOOLCALC_LIMITS.freeReserveBytes,
        variableOverheadBytes: TI86_SCHOOLCALC_LIMITS.variableOverheadBytes,
        localStateCommitBytes: TI86_SCHOOLCALC_LIMITS.localStateCommitBytes,
        catalogCommitCopyCount: TI86_SCHOOLCALC_LIMITS.catalogCommitCopyCount,
        manifestCommitCopyCount: TI86_SCHOOLCALC_LIMITS.manifestCommitCopyCount,
        queueCommitCopyCount: TI86_SCHOOLCALC_LIMITS.queueCommitCopyCount,
      },
    });
  });

  it('clamps install capacity so the free-space reserve cannot be consumed', () => {
    const codec = new Ti86SchoolCalcCodec();
    const report = codec.describeCapabilities(encodeTi86DeviceInfo({
      shellVersion: '0.1.0',
      capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
      installedArtifactIds: [],
      freeBytes: TI86_SCHOOLCALC_LIMITS.freeReserveBytes,
      maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
      runtimeModuleMask: 0,
    }));
    expect(report.limits.maxArtifactBytes).toBe(0);
  });

  it('encodes provisioned identity and Catalog records as bounded binary documents', () => {
    const codec = new Ti86SchoolCalcCodec();
    const identity = codec.encodeDeviceIdentity({ deviceId: '86A001' });
    expect(decodeTi86Envelope(identity, 'SCI1')).toEqual({
      schema: 'school.calc.device-identity/v1', deviceId: '86A001',
    });
    expect(codec.recognizesDeviceIdentity(identity)).toBe(true);
    expect(codec.decodeDeviceIdentity(identity)).toEqual({
      schema: 'school.calc.device-identity/v1', deviceId: '86A001', platformId: 'ti86',
    });
    expect(codec.recognizesDeviceIdentity(Buffer.from('SCP1'))).toBe(false);
    const catalog = {
      schema: 'school.calc.catalog-projection/v1',
      platformId: 'ti86',
      deviceId: '86A001',
      generation: 'sha256:catalog',
      catalogs: [{ catalogId: 'main', title: 'Main', subjects: [] }],
    };
    const record = codec.encodeCatalog(catalog);
    expect(record.toString('ascii', 0, 4)).toBe('SCC1');
    expect(record[7]).not.toBe('{'.charCodeAt(0));
    expect(decodeTi86Envelope(record, 'SCC1')).toEqual({
      ...catalog,
      generationKey: ti86GenerationKey(catalog.generation),
    });
    expect(() => codec.encodeCatalog({ ...catalog, catalogs: [] }))
      .toThrow('TI-86 Catalog projection is invalid');
    expect(() => codec.encodeCatalog({ ...catalog, catalogs: [...catalog.catalogs, catalog.catalogs[0]] }))
      .toThrow('TI-86 Catalog projection is invalid');
  });

  it('encodes a bounded active learner roster with stable keys and synthetic Guest omitted', () => {
    const codec = new Ti86SchoolCalcCodec();
    const record = codec.encodeLearnerRoster({
      schema: 'school.calc.learner-roster/v1', deviceId: '86A001', generation: 'sha256:profiles',
      profiles: [
        { learnerKey: 4, learnerId: 'kid-a', label: 'Álpha Student' },
        { learnerKey: 9, learnerId: 'kid-b', label: 'Beta' },
      ],
      guest: { learnerKey: 0, label: 'Guest', persistent: false },
    });
    expect(decodeTi86LearnerRoster(record)).toEqual({
      schema: 'school.calc.learner-roster/v1', deviceId: '86A001',
      generationKey: ti86GenerationKey('sha256:profiles'),
      profiles: [{ learnerKey: 4, label: 'Alpha Student' }, { learnerKey: 9, label: 'Beta' }],
    });
    expect(record.length).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes);
  });

  it('encodes a bounded all-learner progress projection without backend learner IDs', () => {
    const codec = new Ti86SchoolCalcCodec();
    const followUp = {
      actionId: 'review:kid-a:quiz-1', kind: 'review', label: 'Review this quiz',
      availability: 'ready', target: { type: 'bank', id: 'quiz-1' }, priority: 30,
    };
    const record = codec.encodeProgressProjection({
      schema: 'school.calc.progress-projection/v1',
      deviceId: '86A001', generation: 'sha256:progress',
      profiles: [{
        learnerKey: 4, learnerId: 'kid-a', label: 'Alpha',
        summary: {
          evidenceCount: 7, engagementCount: 7, responseCount: 10, correctCount: 8,
          completionCount: 3, activityCount: 4, assessmentCount: 2,
          scorePercent: 80, lastActivityAt: '2026-08-01T18:00:00.000Z',
        },
        recentScores: [{
          activityKind: 'quiz', occurredAt: '2026-08-01T18:00:00.000Z',
          verification: 'verified', score: { correct: 4, total: 5, percent: 80 },
        }],
        followUps: [followUp],
        curriculumHistory: {
          roots: [{
            key: 'subject=math', kind: 'subject', id: 'math',
            summary: { activityCount: 4, completionCount: 3, pendingCount: 0, scorePercent: 80 },
            children: [{
              key: 'subject=math|course=fractions', kind: 'course', id: 'fractions-course',
              summary: { activityCount: 2, completionCount: 1, pendingCount: 1, scorePercent: 75 },
              children: [],
            }],
          }],
        },
      }],
    });
    expect(record.toString('ascii', 0, 4)).toBe('SCG1');
    expect(record.length).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes);
    expect(record.toString('ascii')).not.toContain('kid-a');
    expect(codec.projectFollowUpKey(followUp, 4)).toMatch(/^[A-Z2-7]{10}$/);
    expect(decodeTi86ProgressProjection(record)).toEqual({
      schema: 'school.calc.progress-projection/v1', deviceId: '86A001',
      generationKey: ti86GenerationKey('sha256:progress'),
      profiles: [{
        learnerKey: 4,
        summary: {
          evidenceCount: 7, engagementCount: 7, responseCount: 10, correctCount: 8,
          completionCount: 3, activityCount: 4, assessmentCount: 2,
          scorePercent: 80, lastActivityOn: '2026-08-01',
        },
        recentScores: [{
          correct: 4, total: 5, percent: 80, verification: 'verified',
          occurredOn: '2026-08-01', activityKind: 'quiz',
        }],
        followUps: [{
          actionKey: codec.projectFollowUpKey(followUp, 4), kind: 'review',
          availability: 'ready', priority: 30, label: 'Review this quiz',
        }],
        curriculumHistory: { nodes: [
          {
            parentIndex: null, kind: 'subject', label: 'math', pending: false,
            activityCount: 4, completionCount: 3, scorePercent: 80,
          },
          {
            parentIndex: 0, kind: 'course', label: 'fractions course', pending: true,
            activityCount: 2, completionCount: 1, scorePercent: 75,
          },
        ] },
      }],
    });
  });

  it('round-trips one durable tutor turn without exposing the answer key', () => {
    const codec = new Ti86SchoolCalcCodec();
    const requestRecord = encodeTi86InteractionRequest({
      schema: 'school.calc.interaction-request/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 23, action: 'choice', sessionId: 'REM_ABC123',
      clientSequence: 1, lastServerSequence: 1, turnId: 'TURN_1', choiceId: 'A',
    });
    expect(codec.decodeInteractionRequest(requestRecord)).toEqual({
      schema: 'school.calc.interaction-request/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 23, action: 'choice', sessionId: 'REM_ABC123',
      clientSequence: 1, lastServerSequence: 1, turnId: 'TURN_1', choiceId: 'A',
    });
    const responseRecord = codec.encodeInteractionResponse({
      schema: 'school.calc.interaction-response/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 23, status: 'complete', acknowledgeRequest: true, retryable: false,
      message: 'Keep going.',
      answer: { choiceId: 'A', correct: false, rationale: 'Divide total by units.' },
      session: {
        sessionId: 'REM_ABC123', status: 'active', masteryPercent: 50, targetPercent: 80,
        learnerControls: ['stop', 'skip', 'explain', 'challenge'],
        currentTurnId: 'TURN_2',
        cursor: { nextClientSequence: 2, latestServerSequence: 2 },
        turns: [{
          turnId: 'TURN_2', serverSequence: 2,
          body: 'Try a different representation.\nUse equal groups.',
          prompt: '24 pages in 4 days?',
          choices: [
            { id: 'A', label: '6', functionKey: 'F1' },
            { id: 'B', label: '8', functionKey: 'F2' },
          ],
        }],
      },
    });
    expect(responseRecord.length).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes);
    expect(decodeTi86InteractionResponse(responseRecord)).toEqual({
      schema: 'school.calc.interaction-response/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 23, status: 'complete', acknowledgeRequest: true, retryable: false,
      message: 'Keep going.',
      session: {
        sessionId: 'REM_ABC123', status: 'active', masteryPercent: 50, targetPercent: 80,
        learnerControls: ['stop', 'skip', 'explain', 'challenge'],
        cursor: { nextClientSequence: 2, latestServerSequence: 2 },
        answer: { choiceId: 'A', correct: false, rationale: 'Divide total by units.' },
        currentTurn: {
          turnId: 'TURN_2', serverSequence: 2,
          body: 'Try a different representation.\nUse equal groups.',
          prompt: '24 pages in 4 days?',
          choices: [
            { id: 'A', label: '6', functionKey: 'F1' },
            { id: 'B', label: '8', functionKey: 'F2' },
          ],
        },
      },
    });
    expect(responseRecord.toString('ascii')).not.toContain('correctChoiceId');
  });

  it.each(['skip', 'explain', 'challenge'])('round-trips a %s learner-control request without a choice', (action) => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 24, action, sessionId: 'REM_ABC123',
      clientSequence: 2, lastServerSequence: 2, turnId: 'TURN_2',
    };
    expect(decodeTi86InteractionRequest(encodeTi86InteractionRequest(request))).toEqual(request);
  });

  it('round-trips cancellation without pretending it answers a turn', () => {
    const request = {
      schema: 'school.calc.interaction-request/v1', deviceId: '86A001', learnerKey: 4,
      requestId: 25, action: 'cancel', sessionId: 'REM_ABC123',
      clientSequence: 2, lastServerSequence: 2,
    };
    expect(decodeTi86InteractionRequest(encodeTi86InteractionRequest(request))).toEqual(request);
    expect(() => encodeTi86InteractionRequest({ ...request, turnId: 'TURN_2', choiceId: 'A' }))
      .toThrow(/must not include choiceId/);
  });

  it('rejects a Catalog record outside the calculator Catalog/state ceiling', () => {
    const codec = new Ti86SchoolCalcCodec();
    expect(() => codec.encodeCatalog({
      schema: 'school.calc.catalog-projection/v1',
      platformId: 'ti86',
      deviceId: '86A001',
      generation: 'sha256:catalog',
      catalogs: [{ catalogId: 'main', title: 'Main', description: 'x'.repeat(7000), subjects: [] }],
    })).toThrow(`Catalog exceeds ${TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes}-byte`);
  });

  it('decodes durable install/remove requests to neutral validated requests', () => {
    const codec = new Ti86SchoolCalcCodec();
    const decoded = codec.decodeDeliveryRequests(encodeTi86DeliveryRequests({
      deviceId: '86A001',
      requests: [
        { requestId: 3, learnerKey: 4, action: 'install', address: 'main/math/algebra/linear/intro' },
        { requestId: 4, learnerKey: 9, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG' },
      ],
    }));
    expect(decoded).toEqual({
      deviceId: '86A001',
      requests: [
        {
          schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 3,
          learnerKey: 4, action: 'install', address: 'main/math/algebra/linear/intro',
        },
        {
          schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 4,
          learnerKey: 9, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG',
        },
      ],
    });
    const record = encodeTi86DeliveryRequests({
      deviceId: '86A001',
      requests: [{ requestId: 8, learnerKey: 4, action: 'install', address: 'main/math/algebra/linear/intro' }],
    });
    expect(record.toString('ascii', 0, 4)).toBe('SCD1');
    expect(record[7]).toBe(6); // fixed-layout deviceId length, not a typed-document string table
  });

  it('rejects noncanonical or oversized delivery-request queues', () => {
    expect(() => encodeTi86DeliveryRequests({
      deviceId: '86A001',
      requests: [
        { requestId: 4, learnerKey: 4, action: 'install', address: 'main/math/a/b/one' },
        { requestId: 3, learnerKey: 4, action: 'install', address: 'main/math/a/b/two' },
      ],
    })).toThrow(/canonical increasing/);
    expect(() => encodeTi86DeliveryRequests({
      deviceId: '86A001',
      requests: Array.from({ length: 33 }, (_, requestId) => ({
        requestId, learnerKey: 4, action: 'install', address: `main/math/a/b/${requestId}`,
      })),
    })).toThrow(/exceeds 32-record/);
  });

  it('reports unsupported capabilities as Catalog compatibility reasons', () => {
    const codec = new Ti86SchoolCalcCodec();
    expect(codec.supports({ ...bundle, capabilities: [...bundle.capabilities, 'periodic-table@1'] }, {
      capabilities: ['quiz@1', 'response.choice@1'],
    })).toEqual({ compatible: false, reasons: ['missing capability periodic-table@1'] });
  });

  it('rejects an unimplemented runtime shape even if a capability report claims it', () => {
    const codec = new Ti86SchoolCalcCodec();
    const activity = {
      ...bundle,
      lesson: {
        ...bundle.lesson,
        modules: [{
          moduleId: 'match', type: 'activity', mechanic: 'matching',
          config: { pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }] },
        }],
      },
      capabilities: ['activity.matching@1'],
    };
    expect(codec.supports(activity, { capabilities: ['activity.matching@1'] })).toEqual({
      compatible: false,
      reasons: ["module 0 type 'activity' has no TI-86 v0 runtime"],
    });
    expect(() => codec.compile(activity, { capabilities: ['activity.matching@1'], limits: {} }))
      .toThrow(/no TI-86 v0 runtime/);
  });

  it('compiles deterministic SCP1 bytes with a hidden local-scoring key', () => {
    const codec = new Ti86SchoolCalcCodec();
    const first = codec.compile(bundle);
    const second = codec.compile(structuredClone(bundle));
    expect(first.artifactId).toBe(second.artifactId);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.variableName).toMatch(/^DP[A-Z2-7]{6}$/);
    expect(first.variableName).toBe(`DP${first.artifactId.slice(-10, -4)}`);
    const payload = decodeTi86Envelope(first.bytes, 'SCP1');
    expect(payload.lesson).toMatchObject({ title: 'Compound growth', shortTitle: 'Growth' });
    const item = payload.lesson.modules[0].bank.items[0];
    expect(item.promptPages).toEqual(['Which grows?']);
    expect(item.choices).toEqual(['Principal', 'Principal plus interest']);
    expect(item).not.toHaveProperty('prompt');
    expect(item).not.toHaveProperty('answer');
    expect(item.correctChoice).toBe(2);
    expect(first.bytes[7]).not.toBe('{'.charCodeAt(0));
    // Golden digest catches accidental changes to the on-calculator byte contract.
    expect(first.byteDigest).toBe('ed289e1d86dc70e9eb6c92e9113564a536c0c45fe069ef6757e386df69333567');
  });

  it('projects reader content into complete bounded pages without truncation', () => {
    const codec = new Ti86SchoolCalcCodec();
    const prose = 'A durable offline reader keeps every authored word while fitting each page to the calculator viewport. '
      + 'The next page resumes at a word boundary and remains part of the same immutable artifact.';
    const readerBundle = {
      schema: 'school.learning-lesson/v1',
      address: 'main/general/reading/unit/lesson',
      context: bundle.context,
      lesson: {
        lessonId: 'reader', title: 'Reader', objectives: [],
        modules: [{
          moduleId: 'notes', type: 'lecture_notes', documentId: 'reader-notes',
          document: {
            schema: 'school.learning-document/v1', documentId: 'reader-notes', title: 'Reader notes',
            blocks: [{ blockId: 'prose', type: 'prose', text: prose }],
          },
        }],
      },
      capabilities: ['reader@1'],
    };
    const artifact = codec.compile(readerBundle, {
      capabilities: ['reader@1'], limits: { maxArtifactBytes: 12288 },
    });
    const payload = decodeTi86Envelope(artifact.bytes, 'SCP1');
    expect(payload.schema).toBe('school.calc.ti86-package/v2');
    expect(artifact.codecVersion).toBe(5);
    const pages = payload.lesson.modules[0].pages;
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => Buffer.byteLength(page.text, 'ascii') <= 119)).toBe(true);
    expect(pages.every((page) => page.text.split('\n').length <= 5)).toBe(true);
    expect(pages.every((page) => page.text.split('\n').every((line) => line.length <= 23))).toBe(true);
    expect(pages.every((page) => page.sourceIndex === 0 && page.segmentIndex === 0)).toBe(true);
    expect(pages.map((page) => page.text).join(' ').replace(/\s+/g, ' ').trim()).toBe(prose);
  });

  it('projects a hydrated scan action as one text page plus exact compact QR modules', () => {
    const neutral = {
      schema: 'school.learning-lesson/v1',
      address: 'main/physics/mechanics/motion/velocity',
      context: {
        catalog: { catalogId: 'main', title: 'Main' },
        subject: { subjectId: 'physics', title: 'Physics' },
        course: { courseId: 'mechanics', title: 'Mechanics' },
        unit: { unitId: 'motion', title: 'Motion' },
      },
      lesson: {
        lessonId: 'velocity', title: 'Velocity', objectives: [], modules: [{
          moduleId: 'notes', type: 'lecture_notes', documentId: 'velocity-notes',
          document: {
            schema: 'school.learning-document/v1', documentId: 'velocity-notes', title: 'Velocity',
            blocks: [{
              blockId: 'worksheet', type: 'scan_action', actionId: 'worksheet:velocity', label: 'Print practice',
            }],
          },
        }],
      },
      capabilities: ['reader@1', 'scan-action@1'],
    };
    const codec = new Ti86SchoolCalcCodec();
    const first = structuredClone(neutral);
    first.lesson.modules[0].document.blocks[0].token = 'sch:23456789ABCDEFGH';
    const second = structuredClone(neutral);
    second.lesson.modules[0].document.blocks[0].token = 'sch:HGFEDCBA98765432';
    const builtA = codec.compile(first, undefined, { sourceBundle: neutral });
    const builtB = codec.compile(second, undefined, { sourceBundle: neutral });
    const page = decodeTi86Envelope(builtA.bytes, 'SCP1').lesson.modules[0].pages[0];
    expect(page).toMatchObject({
      kind: 'scan_action', text: 'Print practice', actionToken: 'sch:23456789ABCDEFGH',
    });
    expect(Buffer.isBuffer(page.qrModules)).toBe(true);
    expect(page.qrModules).toHaveLength(63);
    expect(builtA.sourceDigest).toBe(builtB.sourceDigest);
    expect(builtA.artifactId).not.toBe(builtB.artifactId);
    expect(() => codec.compile(neutral)).toThrow(/server-issued token/);
  });

  it('reports reader text and block shapes that the TI-86 cannot faithfully project', () => {
    const codec = new Ti86SchoolCalcCodec();
    const unsupported = {
      schema: 'school.learning-lesson/v1',
      lesson: {
        modules: [{
          type: 'lecture_notes',
          document: { blocks: [
            { type: 'prose', text: 'Unicode pi: π' },
            { type: 'table', columns: ['A'], rows: [['B']] },
          ] },
        }],
      },
      capabilities: ['reader@1'],
    };
    const support = codec.supports(unsupported, { capabilities: ['reader@1'] });
    expect(support.compatible).toBe(false);
    expect(support.reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/unsupported TI-86 character U\+03C0/),
      expect.stringMatching(/type 'table' has no TI-86 reader projection/),
    ]));
    expect(() => codec.compile(unsupported, { capabilities: ['reader@1'] }))
      .toThrow(/cannot compile lesson/);
  });

  it('retains local-reveal answers only for bounded multiple-choice flashcards', () => {
    const codec = new Ti86SchoolCalcCodec();
    const flashcardBundle = structuredClone(bundle);
    flashcardBundle.lesson.modules[0].type = 'flashcards';
    flashcardBundle.capabilities = ['flashcards@1', 'response.choice@1'];
    const artifact = codec.compile(flashcardBundle, {
      capabilities: flashcardBundle.capabilities,
      limits: { maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes },
    });
    const card = decodeTi86Envelope(artifact.bytes, 'SCP1').lesson.modules[0].bank.items[0];
    expect(card.answerPages).toEqual(['Principal plus interest']);
    expect(card.promptPages).toEqual(['Which grows?']);

    const tooMany = structuredClone(flashcardBundle);
    tooMany.lesson.modules[0].bank.items[0].choices = ['A', 'B', 'C', 'D', 'E', 'F'];
    tooMany.lesson.modules[0].bank.items[0].answer = 'A';
    expect(codec.supports(tooMany, { capabilities: tooMany.capabilities }).reasons)
      .toContain('module 0 item 0 must contain 2..5 choices for TI-86 F1-F5 input');

    const clipped = structuredClone(flashcardBundle);
    clipped.lesson.modules[0].bank.items[0].choices[0] = 'x'.repeat(24);
    expect(codec.supports(clipped, { capabilities: clipped.capabilities }).reasons)
      .toContain('module 0 item 0 choice 0 exceeds the 23-character visible TI-86 choice bound');
  });

  it('projects a bounded learning probe with immediate feedback and a hidden local score key', () => {
    const codec = new Ti86SchoolCalcCodec();
    const probeBundle = structuredClone(bundle);
    probeBundle.lesson.modules = [{
      moduleId: 'probe', type: 'learning_probe', bankId: 'rates-probe',
      phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
      feedback: {
        timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2,
      },
      bank: {
        id: 'rates-probe', title: 'Rate check', items: [{
          id: 'p1', type: 'multiple_choice', prompt: 'How do you find a unit rate?',
          choices: ['Divide', 'Add'], answer: 'Divide',
          feedback: { explanation: 'Divide both quantities by the second quantity.' },
        }],
      },
    }];
    probeBundle.capabilities = ['learning-probe@1', 'response.choice@1'];
    const artifact = codec.compile(probeBundle, {
      capabilities: probeBundle.capabilities,
      limits: { maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes },
    });
    const module = decodeTi86Envelope(artifact.bytes, 'SCP1').lesson.modules[0];
    expect(module).toMatchObject({
      type: 'learning_probe', phase: 'check', difficulty: 2,
      conceptIds: ['unit-rate'],
      feedback: { timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2 },
      bank: { items: [{ correctChoice: 1 }] },
    });
    expect(module.bank.items[0].feedbackPages.join(' ')).toContain('Divide both quantities');

    const tooLong = structuredClone(probeBundle);
    tooLong.lesson.modules[0].bank.items = Array.from({ length: 13 }, (_, index) => ({
      ...structuredClone(probeBundle.lesson.modules[0].bank.items[0]), id: `p${index}`,
    }));
    expect(codec.supports(tooLong, { capabilities: tooLong.capabilities }).reasons)
      .toContain('module 0 has 13 items; TI-86 learning probes support at most 12');
  });

  it('warns above the ordinary lesson target and rejects the hard ceiling', () => {
    const codec = new Ti86SchoolCalcCodec();
    const aboveTarget = structuredClone(bundle);
    aboveTarget.lesson.objectives = ['x'.repeat(8500)];
    const artifact = codec.compile(aboveTarget);
    expect(artifact.byteLength).toBeGreaterThan(TI86_SCHOOLCALC_LIMITS.lessonTargetBytes);
    expect(artifact.byteLength).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.lessonMaxBytes);
    expect(artifact.resource).toEqual({
      targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
      hardCeilingBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
      effectiveCeilingBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
      aboveTarget: true,
    });
    expect(artifact.warnings).toEqual([{
      code: 'TI86_ARTIFACT_ABOVE_TARGET',
      byteLength: artifact.byteLength,
      targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
    }]);

    const oversized = structuredClone(bundle);
    oversized.lesson.objectives = ['x'.repeat(13000)];
    expect(() => codec.compile(oversized)).toThrow(/device limit is 12288/);
  });

  it('decodes the same immutable result from cable bytes or QR text', () => {
    const codec = new Ti86SchoolCalcCodec();
    const result = {
      schema: 'school.calc.result/v1',
      kind: 'responses',
      deviceId: '86A001',
      sequence: 17,
      learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG',
      moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100, basis: 'embedded_answer_key' },
    };
    const fromCable = codec.decodeResult(encodeTi86ResultRecord(result));
    const fromQr = codec.decodeResult(encodeTi86ResultRecord(result, { qrText: true }));
    expect(fromQr).toEqual(fromCable);
    expect(encodeTi86ResultRecord(result, { qrText: true })).toMatch(/^sch:r1:[A-Z2-7]+$/);
    expect(fromCable).toMatchObject({
      deviceId: '86A001', sequence: 17, learnerKey: 4, moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
  });

  it('round-trips compact probe attempts while scoring only the first response', () => {
    const codec = new Ti86SchoolCalcCodec();
    const result = {
      schema: 'school.calc.result/v1', kind: 'responses',
      deviceId: '86A001', sequence: 19, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 2,
      responses: [
        { itemIndex: 0, given: 2, probe: { attempts: [2, 1], feedbackViewed: true, continued: true } },
        { itemIndex: 1, given: 1, probe: { attempts: [1], feedbackViewed: true, continued: true } },
      ],
      localScore: { correct: 1, total: 2, percent: 50, basis: 'embedded_answer_key' },
    };
    const bytes = encodeTi86ResultRecord(result);
    expect(bytes.length).toBeLessThanOrEqual(80);
    expect(codec.decodeResult(bytes)).toMatchObject(result);
    expect(codec.decodeResult(encodeTi86ResultRecord(result, { qrText: true }))).toEqual(codec.decodeResult(bytes));
  });

  it('refuses to silently discard probe telemetry when item indexes are not compactly ordered', () => {
    expect(() => encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'responses',
      deviceId: '86A001', sequence: 20, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 2,
      responses: [{
        itemIndex: 1, given: 2,
        probe: { attempts: [2], feedbackViewed: true, continued: true },
      }],
      localScore: { correct: 1, total: 1, percent: 100, basis: 'embedded_answer_key' },
    })).toThrow(/must be ordered by itemIndex/);
  });

  it('rejects a corrupt result before returning application data', () => {
    const codec = new Ti86SchoolCalcCodec();
    const bytes = encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001', sequence: 17, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    bytes[10] ^= 0xff;
    expect(() => codec.decodeResult(bytes)).toThrow(/checksum failed/);
  });

  it('rejects wall-clock claims because TI-86 SCR1 has no RTC evidence', () => {
    expect(() => encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001', sequence: 17, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
      occurredAt: '2026-08-01T15:00:00.000Z',
    })).toThrow(/has no RTC/);
  });

  it('round-trips progress records through the same cable/QR codec', () => {
    const codec = new Ti86SchoolCalcCodec();
    const result = {
      schema: 'school.calc.result/v1',
      kind: 'progress',
      deviceId: '86A001',
      sequence: 18,
      learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG',
      moduleIndex: 2,
      progress: { status: 'viewed', position: 7, total: 12 },
    };
    expect(codec.decodeResult(encodeTi86ResultRecord(result, { qrText: true }))).toMatchObject(result);
  });

  it('recognizes and extracts exact SCR1 bytes from a device-bound result queue', () => {
    const codec = new Ti86SchoolCalcCodec();
    const first = encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001', sequence: 17, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 0,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    const second = encodeTi86ResultRecord({
      schema: 'school.calc.result/v1', kind: 'progress', deviceId: '86A001', sequence: 18, learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 1,
      progress: { status: 'completed', position: 4, total: 4 },
    });
    const records = codec.decodeResultQueue(encodeTi86ResultQueue({ deviceId: '86A001', records: [first, second] }));
    expect(records).toHaveLength(2);
    expect(records[0].equals(first)).toBe(true);
    expect(records[1].equals(second)).toBe(true);
    expect(codec.recognizesResult(first)).toBe(true);
    expect(codec.recognizesResult('sch:r1:AAAA')).toBe(true);
    expect(codec.recognizesResult(Buffer.from('SCP1'))).toBe(false);
  });

  it('rejects an oversized SCQ1 before decoding its fixed envelope', () => {
    const codec = new Ti86SchoolCalcCodec();
    const oversized = encodeTi86Envelope('SCQ1', { padding: Buffer.alloc(7000) });
    expect(() => codec.decodeResultQueue(oversized)).toThrow(/queue exceeds 6144-byte/);
  });

  it('sorts and deduplicates acknowledgement sequences', () => {
    const codec = new Ti86SchoolCalcCodec();
    const payload = decodeTi86Acknowledgements(codec.encodeAcknowledgements({
      deviceId: '86A001', sequences: [9, 3, 9],
    }));
    expect(payload).toEqual({
      schema: 'school.calc.acknowledgements/v1', deviceId: '86A001', sequences: [3, 9],
    });
  });

  it('rejects acknowledgement records outside the calculator queue cardinality', () => {
    const codec = new Ti86SchoolCalcCodec();
    expect(() => codec.encodeAcknowledgements({
      deviceId: '86A001', sequences: Array.from({ length: 171 }, (_, index) => index),
    })).toThrow(/exceeds 170-sequence/);
  });

  it('encodes a calculator commit manifest separately from API-only sync metadata', () => {
    const codec = new Ti86SchoolCalcCodec();
    const digest = 'a'.repeat(64);
    const manifest = codec.encodeSyncManifest({
      schema: 'school.calc.sync-plan/v1',
      deviceId: '86A001',
      platformId: 'ti86',
      generation: 'sha256:plan',
      catalog: { generation: 'sha256:catalog', changed: true },
      ready: true,
      blockers: [],
      removals: [{ artifactId: 'sc:ti86:OLD234DEFG', variableName: 'DPOLD234', byteLength: 80 }],
      artifacts: [{
        artifactId: 'sc:ti86:ABC234DEFG', variableName: 'DPABC234', byteLength: 120,
        byteDigest: digest, mediaType: 'application/vnd.daylight.schoolcalc.ti86',
      }],
      installedArtifacts: [{
        artifactId: 'sc:ti86:ABC234DEFG', variableName: 'DPABC234', byteLength: 120,
        byteDigest: digest, mediaType: 'application/vnd.daylight.schoolcalc.ti86',
      }],
      acknowledgements: { sequences: [9, 3, 9] },
      deliveryAcknowledgements: { requestIds: [6, 4, 6] },
    });
    const payload = decodeTi86SyncManifest(manifest);
    expect(payload).toEqual({
      schema: 'school.calc.sync-manifest/v1',
      deviceId: '86A001',
      generationKey: ti86GenerationKey('sha256:plan'),
      catalogGenerationKey: ti86GenerationKey('sha256:catalog'),
      catalogChanged: true,
      ready: true,
      blockerMask: 0,
      blockers: [],
      removals: [{ artifactId: 'sc:ti86:OLD234DEFG', variableName: 'DPOLD234' }],
      installedArtifacts: [{
        artifactId: 'sc:ti86:ABC234DEFG', variableName: 'DPABC234', byteLength: 120,
        byteDigest: digest,
      }],
      acknowledgedSequences: [3, 9],
      acknowledgedRequestIds: [4, 6],
    });
    expect(decodeTi86InstalledState(manifest)).toEqual({
      deviceId: '86A001',
      generationKey: ti86GenerationKey('sha256:plan'),
      catalogGenerationKey: ti86GenerationKey('sha256:catalog'),
      installedArtifacts: [{
        artifactId: 'sc:ti86:ABC234DEFG', variableName: 'DPABC234', byteLength: 120,
        byteDigest: digest,
      }],
    });

    const report = codec.describeCapabilities(encodeTi86DeviceInfo({
      shellVersion: '0.1.0', capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
      installedArtifactIds: [], freeBytes: 42000, maxArtifactBytes: 12288,
      runtimeModuleMask: 0,
    }), manifest);
    expect(report.installedArtifactIds).toEqual(['sc:ti86:ABC234DEFG']);
    expect(report.installationGeneration).toBe(ti86GenerationKey('sha256:plan'));
  });

  it('rejects direct runtime capability claims and malformed discovery masks', () => {
    const codec = new Ti86SchoolCalcCodec();
    const info = (patch = {}) => encodeTi86DeviceInfo({
      shellVersion: '0.1.0', capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
      installedArtifactIds: [], freeBytes: 42000, maxArtifactBytes: 12288,
      runtimeModuleMask: 0, ...patch,
    });
    expect(() => codec.describeCapabilities(info({ capabilities: ['reader@1'] })))
      .toThrow(/unapproved capabilities/);
    expect(() => codec.describeCapabilities(info({ runtimeModuleMask: 512 })))
      .toThrow(/runtimeModuleMask/);
    expect(() => codec.describeCapabilities(info({ runtimeModuleMask: -1 })))
      .toThrow(/runtimeModuleMask/);
  });
});
