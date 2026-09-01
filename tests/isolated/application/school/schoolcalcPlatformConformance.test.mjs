import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
  TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
  decodeTi86Acknowledgements,
  decodeTi86Envelope,
  decodeTi86SyncManifest,
  encodeTi86DeliveryRequests,
  encodeTi86DeviceInfo,
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '#adapters/schoolcalc/ti86/index.mjs';
import { SchoolCalcContainer } from '#apps/school/schoolcalc/index.mjs';
import { stableRecordDigest, stableRecordText } from '#apps/common/stableRecord.mjs';

const ADDRESS = 'main/mixed/foundations/unit-one/first-lesson';
const DEVICE_ID = 'SCAABBCCDDEE';
const CAPABILITIES = Object.freeze(['quiz@1', 'reader@1', 'response.choice@1']);

const CATALOG = {
  schema: 'school.catalog/v1', catalogId: 'main', title: 'Main',
  subjects: [{ subjectId: 'mixed', title: 'Mixed', courses: [{
    courseId: 'foundations', title: 'Foundations', units: [{
      unitId: 'unit-one', title: 'Unit one', lessons: [{
        lessonId: 'first-lesson', title: 'First lesson',
        modules: [
          { moduleId: 'notes', type: 'lecture_notes', documentId: 'first-notes' },
          { moduleId: 'check', type: 'quiz', bankId: 'first-check' },
        ],
      }],
    }],
  }] }],
};

const DOCUMENT = {
  schema: 'school.learning-document/v1', documentId: 'first-notes', title: 'Notes',
  blocks: [{ blockId: 'intro', type: 'prose', text: 'Portable content.' }],
};

const BANK = {
  id: 'first-check', title: 'Check', audience: 'assigned',
  items: [{
    id: 'question-one', type: 'multiple_choice', prompt: 'Choose two.',
    choices: ['one', 'two', 'three'], answer: 'two',
  }],
};

describe.each([
  { name: 'TI-86', fixtureIndex: 0 },
  { name: 'simulated second family', fixtureIndex: 1 },
])('SchoolCalc application platform contract: $name', ({ fixtureIndex }) => {
  it('runs the complete device-neutral backend lifecycle without a family branch', async () => {
    const fixture = platformFixtures()[fixtureIndex];
    const harness = createHarness(fixture);
    const enrolled = await harness.container.enrollDevice.execute({
      platformId: fixture.platformId,
      label: `${fixture.name} A`,
      catalogId: CATALOG.catalogId,
    });
    expect(enrolled.device).toMatchObject({
      deviceId: DEVICE_ID,
      platformId: fixture.platformId,
      learnerBindings: [expect.objectContaining({ learnerKey: 1, learnerId: 'user_4', active: true })],
    });

    await expect(harness.container.identifyDevice.execute({ record: enrolled.identityRecord }))
      .resolves.toMatchObject({ deviceId: DEVICE_ID, platformId: fixture.platformId });

    const rawInfo = fixture.deviceInfo({ deviceId: DEVICE_ID, installedArtifactIds: [] });
    await expect(harness.container.observeDevice.execute({
      deviceId: DEVICE_ID, rawInfo, relayId: 'relay-a',
    })).resolves.toMatchObject({
      deviceId: DEVICE_ID,
      platformId: fixture.platformId,
      installedArtifactIds: [],
    });

    const initialCatalog = await harness.container.getCatalog.execute({ deviceId: DEVICE_ID });
    expect(firstLesson(initialCatalog)).toMatchObject({
      address: ADDRESS, compatible: true, state: 'available', artifactId: null,
    });

    const requestRecord = fixture.deliveryRequests({
      deviceId: DEVICE_ID,
      requests: [{ requestId: 1, learnerKey: 1, action: 'install', address: ADDRESS }],
    });
    const requested = await harness.container.requestDelivery.execute({
      deviceId: DEVICE_ID, record: requestRecord,
    });
    expect(requested.requests).toEqual([expect.objectContaining({
      requestId: 1, status: 'accepted', action: 'install',
    })]);
    const [artifactId] = requested.desiredArtifactIds;
    expect(artifactId).toMatch(new RegExp(`^sc:${fixture.platformId}:`));

    const stored = await harness.container.getArtifact.execute({ artifactId });
    expect(stored.platformId).toBe(fixture.platformId);
    expect(stored.byteLength).toBe(stored.bytes.length);
    expect(stored.interpretation.bundle.lesson.modules[1].bank.items[0].answer).toBe('two');
    expect(fixture.artifactProjection(stored.bytes)).not.toContain('"answer"');

    const requestedCatalog = await harness.container.getCatalog.execute({ deviceId: DEVICE_ID });
    expect(firstLesson(requestedCatalog)).toMatchObject({
      state: 'requested', compatible: true, artifactId, byteLength: stored.byteLength,
    });

    const assessment = fixture.resultRecords({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: DEVICE_ID, learnerKey: 1,
      sequence: 41, artifactId, moduleIndex: 1,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    await expect(harness.container.importResult.execute({
      record: assessment.qr, transport: 'qr',
    })).resolves.toMatchObject({ status: 'accepted', acknowledge: true, sequence: 41 });

    const progress = fixture.resultRecords({
      schema: 'school.calc.result/v1', kind: 'progress', deviceId: DEVICE_ID, learnerKey: 1,
      sequence: 42, artifactId, moduleIndex: 0,
      progress: { status: 'completed', position: 1, total: 1 },
    });
    const sync = await harness.container.syncDevice.execute({
      deviceId: DEVICE_ID,
      relayId: 'relay-a',
      rawInfo,
      resultQueue: fixture.resultQueue({
        deviceId: DEVICE_ID, records: [assessment.cable, progress.cable],
      }),
      requestRecord,
      catalogGeneration: null,
    });

    expect(sync.results).toMatchObject({ total: 2, accepted: 1, duplicate: 1, conflicts: 0 });
    expect(sync.deliveries.requests).toEqual([expect.objectContaining({ requestId: 1, status: 'duplicate' })]);
    expect(sync.plan).toMatchObject({
      schema: 'school.calc.sync-plan/v1', deviceId: DEVICE_ID,
      platformId: fixture.platformId, ready: true,
      acknowledgements: { sequences: [41, 42] },
      artifacts: [expect.objectContaining({ artifactId })],
    });
    expect(fixture.acknowledgements(sync.plan.acknowledgementRecord))
      .toMatchObject({ deviceId: DEVICE_ID, sequences: [41, 42] });
    expect(fixture.syncManifest(sync.plan.manifestRecord)).toMatchObject({
      deviceId: DEVICE_ID,
      installedArtifacts: [expect.objectContaining({ artifactId })],
      acknowledgedSequences: [41, 42],
    });

    expect(harness.grader.importSchoolCalcAssessment).toHaveBeenCalledTimes(1);
    expect(harness.grader.importSchoolCalcAssessment).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'user_4',
      receivedAt: '2026-08-01T12:00:00.000Z',
      submission: expect.objectContaining({
        deviceId: DEVICE_ID,
        lessonId: 'first-lesson',
        moduleId: 'check',
        responses: [{ itemId: 'question-one', given: 'two' }],
      }),
    }));
    expect(harness.progress.values).toHaveLength(1);
    expect(harness.progress.values[0]).toMatchObject({
      deviceId: DEVICE_ID, sequence: 42, lessonId: 'first-lesson', moduleId: 'notes',
      timeBasis: 'backend_received', recordedAt: '2026-08-01T12:00:00.000Z',
    });
    expect(harness.ledger.arrivals.map(({ sequence, transport }) => ({ sequence, transport })))
      .toEqual([
        { sequence: 41, transport: 'qr' },
        { sequence: 41, transport: 'relay' },
        { sequence: 42, transport: 'relay' },
      ]);
  });

  it('isolates three calculators sharing one relay and deduplicates QR-first cable uploads', async () => {
    const fixture = platformFixtures()[fixtureIndex];
    const deviceIds = ['SCAABBCCDDEE', 'SCBBCCDDEEFF', 'SCCCDDEEFFAA'];
    const learnerIds = ['user_4', 'user_2', 'user_5'];
    const harness = createHarness(fixture, { deviceIds, learnerIds });
    const fleet = [];

    for (let index = 0; index < deviceIds.length; index += 1) {
      const deviceId = deviceIds[index];
      const learnerId = learnerIds[index];
      // eslint-disable-next-line no-await-in-loop
      const enrolled = await harness.container.enrollDevice.execute({
        platformId: fixture.platformId,
        label: `${fixture.name} ${String.fromCharCode(65 + index)}`,
        catalogId: CATALOG.catalogId,
      });
      const learnerKey = enrolled.device.learnerBindings
        .find((binding) => binding.learnerId === learnerId)?.learnerKey;
      expect(learnerKey).toBe(index + 1);
      const rawInfo = fixture.deviceInfo({ deviceId, installedArtifactIds: [] });
      // All three calculators deliberately take turns on the same physical
      // relay. Relay identity is observational context, never device identity.
      // eslint-disable-next-line no-await-in-loop
      const observed = await harness.container.observeDevice.execute({
        deviceId, rawInfo, relayId: 'relay-shared',
      });
      expect(observed).toMatchObject({ deviceId, lastRelayId: 'relay-shared' });
      const requestRecord = fixture.deliveryRequests({
        deviceId,
        requests: [{ requestId: 1, learnerKey, action: 'install', address: ADDRESS }],
      });
      // eslint-disable-next-line no-await-in-loop
      const requested = await harness.container.requestDelivery.execute({ deviceId, record: requestRecord });
      expect(requested.requests).toEqual([expect.objectContaining({ status: 'accepted' })]);
      fleet.push({ deviceId, learnerId, learnerKey, rawInfo, artifactId: requested.desiredArtifactIds[0] });
    }

    // Identical content may share one immutable artifact blob, while desired
    // state, learner binding, queue sequence, and acknowledgement stay scoped
    // to each calculator identity.
    expect(new Set(fleet.map(({ artifactId }) => artifactId)).size).toBe(1);
    for (const member of fleet) {
      expect(harness.devices.values.get(member.deviceId)).toMatchObject({
        deviceId: member.deviceId,
        learnerBindings: expect.arrayContaining([
          expect.objectContaining({ learnerKey: member.learnerKey, learnerId: member.learnerId, active: true }),
        ]),
        lastRelayId: 'relay-shared',
        desiredArtifactIds: [member.artifactId],
      });
    }

    const resultRecords = fleet.map(({ deviceId, learnerKey, artifactId }) => fixture.resultRecords({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId, learnerKey,
      sequence: 7, artifactId, moduleIndex: 1,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    }));
    const historicalQrOnly = fixture.resultRecords({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: deviceIds[0], learnerKey: 1,
      sequence: 6, artifactId: fleet[0].artifactId, moduleIndex: 1,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    await expect(harness.container.importResult.execute({
      record: historicalQrOnly.qr, transport: 'qr',
    })).resolves.toMatchObject({ deviceId: deviceIds[0], sequence: 6, status: 'accepted' });
    await expect(harness.container.importResult.execute({
      record: resultRecords[0].qr, transport: 'qr',
    })).resolves.toMatchObject({ deviceId: deviceIds[0], sequence: 7, status: 'accepted' });

    const syncs = [];
    for (let index = 0; index < fleet.length; index += 1) {
      const member = fleet[index];
      // eslint-disable-next-line no-await-in-loop
      const sync = await harness.container.syncDevice.execute({
        deviceId: member.deviceId,
        relayId: 'relay-shared',
        rawInfo: member.rawInfo,
        resultQueue: fixture.resultQueue({
          deviceId: member.deviceId,
          records: [resultRecords[index].cable],
        }),
        catalogGeneration: null,
      });
      expect(sync.results).toMatchObject({
        total: 1,
        accepted: index === 0 ? 0 : 1,
        duplicate: index === 0 ? 1 : 0,
        conflicts: 0,
      });
      expect(fixture.acknowledgements(sync.plan.acknowledgementRecord))
        .toMatchObject({ deviceId: member.deviceId, sequences: [7] });
      expect(fixture.syncManifest(sync.plan.manifestRecord))
        .toMatchObject({ deviceId: member.deviceId, acknowledgedSequences: [7] });
      syncs.push(sync);
    }
    expect(syncs).toHaveLength(3);

    expect(harness.grader.importSchoolCalcAssessment).toHaveBeenCalledTimes(4);
    expect(harness.grader.importSchoolCalcAssessment.mock.calls
      .map(([call]) => call.learnerId)).toEqual([
      learnerIds[0], learnerIds[0], learnerIds[1], learnerIds[2],
    ]);
    expect([...harness.ledger.values.keys()].sort()).toEqual(
      [`${deviceIds[0]}:6`, ...deviceIds.map((deviceId) => `${deviceId}:7`)].sort(),
    );
    expect(harness.ledger.arrivals.map(({ deviceId, sequence, transport }) => ({
      deviceId, sequence, transport,
    }))).toEqual([
      { deviceId: deviceIds[0], sequence: 6, transport: 'qr' },
      { deviceId: deviceIds[0], sequence: 7, transport: 'qr' },
      { deviceId: deviceIds[0], sequence: 7, transport: 'relay' },
      { deviceId: deviceIds[1], sequence: 7, transport: 'relay' },
      { deviceId: deviceIds[2], sequence: 7, transport: 'relay' },
    ]);

    // A valid B-owned batch sent to A's endpoint must fail before even its
    // first record can claim a ledger slot or reach grading/progress code.
    const foreign = fixture.resultRecords({
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: deviceIds[1], learnerKey: 2,
      sequence: 8, artifactId: fleet[1].artifactId, moduleIndex: 1,
      responses: [{ itemIndex: 0, given: 2 }],
      localScore: { correct: 1, total: 1, percent: 100 },
    });
    const ledgerKeysBefore = [...harness.ledger.values.keys()];
    const arrivalsBefore = harness.ledger.arrivals.length;
    const gradeCallsBefore = harness.grader.importSchoolCalcAssessment.mock.calls.length;
    await expect(harness.container.importResultQueue.execute({
      deviceId: deviceIds[0],
      record: fixture.resultQueue({ deviceId: deviceIds[1], records: [foreign.cable] }),
    })).rejects.toThrow(/does not match endpoint/);
    expect([...harness.ledger.values.keys()]).toEqual(ledgerKeysBefore);
    expect(harness.ledger.arrivals).toHaveLength(arrivalsBefore);
    expect(harness.grader.importSchoolCalcAssessment).toHaveBeenCalledTimes(gradeCallsBefore);
  });
});

function platformFixtures() {
  // The production codec remains fail-closed to shell-core until the TI-86
  // runtime execution/fleet gate is approved. This conformance-only subclass
  // overlays the capabilities needed to exercise the complete neutral
  // application lifecycle while still using every real TI-86 wire codec.
  const ti86 = new Ti86ConformanceCodec();
  const simulated = new SimulatedSchoolCalcCodec();
  return [
    {
      name: 'TI-86', platformId: 'ti86', codec: ti86,
      deviceInfo: ({ deviceId, installedArtifactIds }) => encodeTi86DeviceInfo({
        deviceId, shellVersion: 'contract', capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
        installedArtifactIds, freeBytes: 90000, maxArtifactBytes: 12288,
        runtimeModuleMask: TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
      }),
      deliveryRequests: encodeTi86DeliveryRequests,
      resultRecords: (result) => ({
        cable: encodeTi86ResultRecord(result),
        qr: encodeTi86ResultRecord(result, { qrText: true }),
      }),
      resultQueue: encodeTi86ResultQueue,
      acknowledgements: decodeTi86Acknowledgements,
      syncManifest: decodeTi86SyncManifest,
      artifactProjection: (bytes) => JSON.stringify(decodeTi86Envelope(bytes, 'SCP1')),
    },
    {
      name: 'simulated second family', platformId: simulated.platformId, codec: simulated,
      deviceInfo: (value) => simulated.encodeDeviceInfo(value),
      deliveryRequests: (value) => simulated.encodeDeliveryRequestBatch(value),
      resultRecords: (value) => ({
        cable: simulated.encodeResult(value),
        qr: simulated.encodeResult(value, { qr: true }),
      }),
      resultQueue: (value) => simulated.encodeResultQueue(value),
      acknowledgements: (record) => simulated.decodeAcknowledgements(record),
      syncManifest: (record) => simulated.decodeSyncManifest(record),
      artifactProjection: (bytes) => bytes.toString('utf8'),
    },
  ];
}

class Ti86ConformanceCodec extends Ti86SchoolCalcCodec {
  describeCapabilities(rawInfo, rawState = null) {
    const report = super.describeCapabilities(rawInfo, rawState);
    return {
      ...report,
      capabilities: [...new Set([...report.capabilities, ...CAPABILITIES])].sort(),
    };
  }
}

function createHarness(fixture, {
  deviceIds = [DEVICE_ID],
  learnerIds = ['user_4'],
} = {}) {
  const devices = new MemoryDevices();
  const artifacts = new MemoryArtifacts();
  const ledger = new MemoryLedger();
  const progress = new MemoryProgress();
  const grader = {
    importSchoolCalcAssessment: vi.fn(async () => ({ imported: 1, correct: 1, total: 1 })),
  };
  const pendingDeviceIds = [...deviceIds];
  const learners = learnerIds.map((id, index) => ({ id, name: `Learner ${index + 1}` }));
  const container = new SchoolCalcContainer({
    codecs: [fixture.codec],
    catalogs: {
      listCatalogs: async () => [{ catalogId: CATALOG.catalogId, title: CATALOG.title }],
      getCatalog: async (catalogId) => catalogId === CATALOG.catalogId ? structuredClone(CATALOG) : null,
    },
    content: {
      getDocument: async (id) => id === DOCUMENT.documentId ? structuredClone(DOCUMENT) : null,
      getQuestionBank: async (id) => id === BANK.id ? structuredClone(BANK) : null,
    },
    artifacts,
    devices,
    resultLedger: ledger,
    progress,
    grader,
    learners: {
      listLearners: async () => structuredClone(learners),
      hasLearner: async (id) => learners.some((learner) => learner.id === id),
    },
    catalogAccess: {
      resolve: async ({ learners: requestedLearners, lessons }) => ({
        learners: requestedLearners.map(({ learnerId }) => ({
          learnerId,
          lessonAddresses: lessons.map(({ address }) => address),
        })),
        guest: { lessonAddresses: [] },
      }),
    },
    learningProgress: {
      execute: async () => ({
        summary: {
          evidenceCount: 0, engagementCount: 0, responseCount: 0, correctCount: 0,
          completionCount: 0, activityCount: 0, assessmentCount: 0,
          scorePercent: null, lastActivityAt: null,
        },
        recentScores: [],
        followUps: [],
      }),
    },
    deviceIdFactory: async () => {
      const deviceId = pendingDeviceIds.shift();
      if (!deviceId) throw new Error('fleet test exhausted device IDs');
      return deviceId;
    },
    clock: () => new Date('2026-08-01T12:00:00.000Z'),
  });
  return { container, devices, artifacts, ledger, progress, grader };
}

function firstLesson(catalog) {
  return catalog.catalogs[0].subjects[0].courses[0].units[0].lessons[0];
}

class MemoryDevices {
  values = new Map();
  async getDevice(id) { return this.values.get(id) ?? null; }
  async findByCompactId(id) { return this.getDevice(id); }
  async saveDevice(device, { expectedRevision = null } = {}) {
    const prior = this.values.get(device.deviceId);
    if (expectedRevision === null && prior) throw new Error('device already exists');
    if (expectedRevision !== null && expectedRevision !== undefined
      && prior?.revision !== expectedRevision) throw new Error('device revision conflict');
    this.values.set(device.deviceId, device);
    return device;
  }
}

class MemoryArtifacts {
  values = new Map();
  async getArtifact(id) { return this.values.get(id) ?? null; }
  async putArtifact(artifact) {
    const prior = this.values.get(artifact.artifactId);
    if (prior && (!prior.bytes.equals(artifact.bytes) || prior.sourceDigest !== artifact.sourceDigest)) {
      throw new Error('immutable artifact conflict');
    }
    if (!prior) this.values.set(artifact.artifactId, artifact);
    return prior ?? artifact;
  }
}

class MemoryLedger {
  values = new Map();
  arrivals = [];

  async claimResult({ deviceId, sequence, recordDigest }) {
    const key = `${deviceId}:${sequence}`;
    const prior = this.values.get(key);
    if (!prior) {
      const entry = { deviceId, sequence, recordDigest, state: null, arrivals: [] };
      this.values.set(key, entry);
      return { status: 'new', entry: structuredClone(entry) };
    }
    if (prior.recordDigest !== recordDigest) return { status: 'conflict', entry: structuredClone(prior) };
    return { status: prior.state?.status === 'complete' ? 'duplicate' : 'resume', entry: structuredClone(prior) };
  }

  async recordArrival(arrival) {
    const entry = this.values.get(`${arrival.deviceId}:${arrival.sequence}`);
    if (!entry) throw new Error('result was not claimed');
    entry.arrivals.push(structuredClone(arrival));
    this.arrivals.push(structuredClone(arrival));
  }

  async saveImportState({ deviceId, sequence, state }) {
    const entry = this.values.get(`${deviceId}:${sequence}`);
    if (!entry) throw new Error('result was not claimed');
    entry.state = structuredClone(state);
  }

  async listAcknowledgedSequences(deviceId) {
    return [...this.values.values()]
      .filter((entry) => entry.deviceId === deviceId && entry.state?.status === 'complete')
      .map((entry) => entry.sequence)
      .sort((left, right) => left - right);
  }
}

class MemoryProgress {
  values = [];
  async saveLatest(value) {
    this.values.push(structuredClone(value));
    return { status: 'accepted', progress: structuredClone(value) };
  }
  async getLatest() { return this.values.at(-1) ?? null; }
}

class SimulatedSchoolCalcCodec {
  get platformId() { return 'sim89'; }

  encodeDeviceInfo({ deviceId, installedArtifactIds = [] }) {
    return frame('SNF1', {
      deviceId, platformId: this.platformId, shellVersion: 'contract',
      capabilities: CAPABILITIES, installedArtifactIds,
    });
  }

  describeCapabilities(rawInfo) {
    const info = unframe(rawInfo, 'SNF1');
    if (info.platformId !== this.platformId) throw new Error('simulated info platform mismatch');
    return {
      ...info,
      limits: {
        freeBytes: 100000,
        maxArtifactBytes: 32000,
        artifactTargetBytes: 16000,
        catalogStateTargetBytes: 8000,
        catalogStateMaxBytes: 12000,
        catalogRecordTargetBytes: 8000,
        catalogRecordMaxBytes: 12000,
        queueTargetBytes: 8000,
        queueMaxBytes: 12000,
        queueMaxRecords: 512,
        acknowledgementMaxBytes: 4000,
        syncManifestMaxBytes: 12000,
        reservedFreeBytes: 4096,
        variableOverheadBytes: 8,
        localStateCommitBytes: 256,
        catalogCommitCopyCount: 1,
        manifestCommitCopyCount: 1,
        queueCommitCopyCount: 1,
      },
    };
  }

  encodeDeviceIdentity({ deviceId }) {
    return frame('SID1', { schema: 'school.calc.device-identity/v1', deviceId });
  }
  recognizesDeviceIdentity(record) { return hasMagic(record, 'SID1'); }
  decodeDeviceIdentity(record) {
    const value = unframe(record, 'SID1');
    return { ...value, platformId: this.platformId };
  }
  encodeLearnerRoster(value) { return frame('SUR1', value); }
  encodeProgressProjection(value) { return frame('SPG1', value); }
  projectFollowUpKey(action, learnerKey) {
    return Buffer.from(`${learnerKey}:${action.actionId}:${action.kind}:${action.target.type}:${action.target.id}`)
      .toString('base64url').slice(0, 24);
  }
  decodeInteractionRequest(value) { return unframe(value, 'SIQ1'); }
  encodeInteractionResponse(value) { return frame('SIR1', value); }
  encodeCatalog(value) { return frame('SCA2', value); }

  encodeDeliveryRequestBatch({ deviceId, requests }) {
    return frame('SDR1', { deviceId, requests });
  }
  decodeDeliveryRequests(record) {
    const { deviceId, requests } = unframe(record, 'SDR1');
    return {
      deviceId,
      requests: requests.map((request) => ({
        schema: 'school.calc.delivery-request/v1', deviceId, ...request,
      })),
    };
  }

  supports(bundle, report) {
    const available = new Set(report.capabilities);
    const reasons = bundle.capabilities.filter((capability) => !available.has(capability))
      .map((capability) => `missing capability ${capability}`);
    return { compatible: reasons.length === 0, reasons };
  }

  compile(bundle, report) {
    const support = this.supports(bundle, report);
    if (!support.compatible) throw new Error(support.reasons.join('; '));
    const sourceDigest = stableRecordDigest(bundle);
    const key = createHash('sha256').update(`${this.platformId}\n${stableRecordText(bundle)}`).digest('hex');
    const artifactId = `sc:${this.platformId}:${key.slice(0, 16)}`;
    const bytes = Buffer.from(stableRecordText({
      schema: 'school.calc.simulated-artifact/v1', artifactId,
      bundle: omitAuthorityAnswers(bundle),
    }), 'utf8');
    return {
      artifactId,
      platformId: this.platformId,
      codecVersion: 1,
      variableName: `L${key.slice(0, 7).toUpperCase()}`,
      mediaType: 'application/vnd.daylight.schoolcalc.simulated',
      bytes,
      byteLength: bytes.length,
      byteDigest: sha256(bytes),
      sourceDigest,
      source: {
        address: bundle.address,
        lessonId: bundle.lesson.lessonId,
        moduleIds: bundle.lesson.modules.map((module) => module.moduleId),
      },
    };
  }

  encodeResult(result, { qr = false } = {}) {
    const record = frame('SRS1', result);
    return qr ? `sim:r1:${record.toString('base64url')}` : record;
  }
  recognizesResult(record) {
    return typeof record === 'string' ? record.startsWith('sim:r1:') : hasMagic(record, 'SRS1');
  }
  decodeResult(record) {
    const bytes = typeof record === 'string'
      ? Buffer.from(record.slice('sim:r1:'.length), 'base64url')
      : record;
    const value = unframe(bytes, 'SRS1');
    const normalizedRecordText = stableRecordText(value);
    return {
      ...value,
      normalizedRecord: structuredClone(value),
      normalizedRecordText,
      recordDigest: sha256(normalizedRecordText),
    };
  }
  encodeResultQueue({ deviceId, records }) {
    return frame('SQU1', { deviceId, records: records.map((record) => Buffer.from(record).toString('base64url')) });
  }
  decodeResultQueue(record) {
    return unframe(record, 'SQU1').records.map((value) => Buffer.from(value, 'base64url'));
  }
  encodeAcknowledgements(value) { return frame('SAK1', value); }
  decodeAcknowledgements(record) { return unframe(record, 'SAK1'); }
  encodeSyncManifest(plan) { return frame('SMN1', plan); }
  decodeSyncManifest(record) {
    const plan = unframe(record, 'SMN1');
    return {
      ...plan,
      acknowledgedSequences: plan.acknowledgements.sequences,
    };
  }
}

function omitAuthorityAnswers(value) {
  if (Array.isArray(value)) return value.map(omitAuthorityAnswers);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'answer')
    .map(([key, entry]) => [key, omitAuthorityAnswers(entry)]));
}

function frame(magic, value) {
  return Buffer.concat([Buffer.from(magic, 'ascii'), Buffer.from(stableRecordText(value), 'utf8')]);
}

function unframe(record, magic) {
  if (!hasMagic(record, magic)) throw new Error(`simulated record is not ${magic}`);
  return JSON.parse(Buffer.from(record).subarray(4).toString('utf8'));
}

function hasMagic(record, magic) {
  return (Buffer.isBuffer(record) || record instanceof Uint8Array)
    && Buffer.from(record).subarray(0, 4).toString('ascii') === magic;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
