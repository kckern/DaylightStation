import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { FsSchoolCalcArtifactRepository } from './FsSchoolCalcArtifactRepository.mjs';
import { YamlLearningCatalogRepository } from '#adapters/school/catalog/YamlLearningCatalogRepository.mjs';
import { YamlLearningContentRepository } from '#adapters/school/catalog/YamlLearningContentRepository.mjs';
import { YamlSchoolCalcDeviceRepository } from './YamlSchoolCalcDeviceRepository.mjs';
import { YamlSchoolCalcProgressRepository } from './YamlSchoolCalcProgressRepository.mjs';
import { YamlSchoolCalcResultLedger } from './YamlSchoolCalcResultLedger.mjs';
import { YamlSchoolCalcStudySessionRepository } from './YamlSchoolCalcStudySessionRepository.mjs';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'schoolcalc-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('School mounted content persistence', () => {
  it('discovers IDs from authored YAML data rather than encoding subject knowledge or IDs into paths', async () => {
    const root = await temporaryDirectory();
    const catalogs = path.join(root, 'catalogs');
    const documents = path.join(root, 'documents');
    const banks = path.join(root, 'banks');
    const actions = path.join(root, 'actions');
    await Promise.all([mkdir(path.join(catalogs, 'published'), { recursive: true }), mkdir(documents), mkdir(banks), mkdir(actions)]);
    await writeFile(path.join(catalogs, 'published', 'anything.yml'), 'schema: school.catalog/v1\ncatalogId: open\ntitle: Open Catalog\nsubjects: []\n');
    await writeFile(path.join(documents, 'lesson-copy.yml'), 'schema: school.learning-document/v1\ndocumentId: doc:interest\ntitle: Interest\nblocks: []\n');
    await writeFile(path.join(banks, 'questions.yml'), 'id: bank:interest\ntitle: Interest check\nitems:\n  - id: q1\n    type: short_answer\n    prompt: Value?\n    answer: 4\n');
    await writeFile(path.join(actions, 'worksheet.yml'), 'schema: school.learning-action/v1\nactionId: worksheet:interest\ntitle: Print practice\nkind: print_document\ntokenVersion: 1\npolicy:\n  replay: repeatable\ntarget:\n  printableId: interest-practice\n');

    const catalogRepository = new YamlLearningCatalogRepository({ directories: [catalogs] });
    const contentRepository = new YamlLearningContentRepository({
      documentDirectories: [documents], bankDirectories: [banks], actionDirectories: [actions],
    });
    await expect(catalogRepository.listCatalogs()).resolves.toEqual([{ catalogId: 'open', title: 'Open Catalog' }]);
    await expect(catalogRepository.getCatalog('open')).resolves.toMatchObject({ catalogId: 'open' });
    await expect(contentRepository.getDocument('doc:interest')).resolves.toMatchObject({ title: 'Interest' });
    await expect(contentRepository.getQuestionBank('bank:interest')).resolves.toMatchObject({ title: 'Interest check' });
    await expect(contentRepository.getLearningAction('worksheet:interest')).resolves.toMatchObject({ kind: 'print_document' });
  });
});

describe('SchoolCalc operational persistence', () => {
  it('permanently indexes study codes, reuses work-session issuance, and closes idempotently', async () => {
    const directory = await temporaryDirectory();
    const repository = new YamlSchoolCalcStudySessionRepository({ directory });
    const study = {
      schema: 'school.calc.adaptive-study-session/v1', studySessionId: 'study-one',
      workSessionId: 'session-one', learnerId: 'learner-one', code: '001234',
      unitId: 'unit-one', subject: 'math', topicId: 'unit-one', status: 'open',
      createdAt: '2026-08-10T12:00:00.000Z', curation: { bankRevision: 'revision-one' },
      artifact: { artifactId: 'artifact-one', byteDigest: 'ab'.repeat(32) },
    };
    await expect(repository.create(study)).resolves.toMatchObject({ code: '001234' });
    await expect(repository.create({ ...study, studySessionId: 'different', code: '999999' }))
      .resolves.toMatchObject({ studySessionId: 'study-one', code: '001234' });
    await expect(repository.create({
      ...study, studySessionId: 'study-two', workSessionId: 'session-two', code: '001234',
    })).rejects.toMatchObject({ code: 'SCHOOLCALC_CODE_ALREADY_ALLOCATED' });

    const resolution = {
      deviceId: 'DEVICE01', requestId: 3, learnerKey: 1, prescriptionId: 'prescription-one',
      resolvedAt: '2026-08-10T12:30:00.000Z',
    };
    await expect(repository.bindResolution({ studySessionId: 'study-one', resolution }))
      .resolves.toMatchObject({ status: 'accepted' });
    await expect(repository.bindResolution({ studySessionId: 'study-one', resolution }))
      .resolves.toMatchObject({ status: 'duplicate' });
    await expect(repository.bindResolution({ studySessionId: 'study-one', resolution: {
      ...resolution, deviceId: 'DEVICE02',
    } })).resolves.toMatchObject({ status: 'unauthorized' });

    const close = { studySessionId: 'study-one', resultDigest: 'digest-a', outcome: 'passed', closedAt: '2026-08-10T13:00:00.000Z' };
    await expect(repository.close(close)).resolves.toMatchObject({ status: 'accepted' });
    await expect(repository.close(close)).resolves.toMatchObject({ status: 'duplicate' });
    await expect(repository.close({ ...close, resultDigest: 'digest-b' })).resolves.toMatchObject({ status: 'conflict' });
    await expect(repository.getByCode('001234')).resolves.toMatchObject({ status: 'closed' });
  });

  it('round-trips device aggregates and enforces optimistic revisions', async () => {
    const directory = await temporaryDirectory();
    const repository = new YamlSchoolCalcDeviceRepository({ directory });
    const enrolled = SchoolCalcDevice.enroll({
      deviceId: 'DEVICE01', label: 'Calculator A', platformId: 'future', catalogId: 'main', createdAt: '2026-08-01T00:00:00.000Z',
    });
    await repository.saveDevice(enrolled, { expectedRevision: null });
    const restored = await repository.getDevice('DEVICE01');
    expect(restored).toBeInstanceOf(SchoolCalcDevice);
    expect(restored).toMatchObject({ deviceId: 'DEVICE01', catalogId: 'main', revision: 0 });

    const observed = restored.observe({
      capabilityReport: { platformId: 'future', deviceId: 'DEVICE01', installedArtifactIds: [] },
      relayId: 'relay-a', observedAt: '2026-08-01T01:00:00.000Z',
    });
    await repository.saveDevice(observed, { expectedRevision: 0 });
    await expect(repository.saveDevice(observed, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'SCHOOLCALC_DEVICE_REVISION_CONFLICT',
    });
  });

  it('stores artifacts first-write-wins and verifies bytes on every read', async () => {
    const directory = await temporaryDirectory();
    const repository = new FsSchoolCalcArtifactRepository({ directory });
    const bytes = Buffer.from('immutable lesson bytes');
    const value = {
      artifactId: 'sc:future:ARTIFACT01',
      platformId: 'future',
      variableName: 'PACK0001',
      mediaType: 'application/x-schoolcalc',
      bytes,
      byteLength: bytes.length,
      byteDigest: createHash('sha256').update(bytes).digest('hex'),
      sourceDigest: 'source-one',
      interpretation: { schema: 'school.calc.artifact-interpretation/v1', bundle: { lesson: { lessonId: 'one' } } },
    };
    await repository.putArtifact(value);
    await expect(repository.putArtifact(value)).resolves.toMatchObject({ artifactId: value.artifactId });
    const restored = await repository.getArtifact(value.artifactId);
    expect(restored.bytes.equals(bytes)).toBe(true);

    await expect(repository.putArtifact({ ...value, sourceDigest: 'source-two' })).rejects.toMatchObject({
      code: 'SCHOOLCALC_ARTIFACT_IMMUTABLE_CONFLICT',
    });
  });

  it('atomically classifies result claims, retains every arrival, and acknowledges only completion', async () => {
    const directory = await temporaryDirectory();
    const ledger = new YamlSchoolCalcResultLedger({ directory });
    const claim = { deviceId: 'DEVICE01', sequence: 4, recordDigest: 'digest-a' };
    const claims = await Promise.all([ledger.claimResult(claim), ledger.claimResult(claim)]);
    expect(claims.map((entry) => entry.status).sort()).toEqual(['new', 'resume']);
    await ledger.recordArrival({ ...claim, transport: 'qr', receivedAt: '2026-08-01T01:00:00.000Z' });
    await ledger.saveImportState({ deviceId: 'DEVICE01', sequence: 4, state: { status: 'importing' } });
    await expect(ledger.listAcknowledgedSequences('DEVICE01')).resolves.toEqual([]);
    await ledger.saveImportState({ deviceId: 'DEVICE01', sequence: 4, state: { status: 'complete' } });
    await ledger.recordArrival({ ...claim, transport: 'relay', receivedAt: '2026-08-02T02:00:00.000Z' });
    await expect(ledger.claimResult(claim)).resolves.toMatchObject({
      status: 'duplicate',
      entry: {
        arrivals: [
          expect.objectContaining({ transport: 'qr', receivedAt: '2026-08-01T01:00:00.000Z' }),
          expect.objectContaining({ transport: 'relay', receivedAt: '2026-08-02T02:00:00.000Z' }),
        ],
      },
    });
    await expect(ledger.claimResult({ ...claim, recordDigest: 'digest-b' })).resolves.toMatchObject({ status: 'conflict' });
    await expect(ledger.listAcknowledgedSequences('DEVICE01')).resolves.toEqual([4]);
  });

  it('rejects non-canonical arrival timestamps at the persistence boundary', async () => {
    const directory = await temporaryDirectory();
    const ledger = new YamlSchoolCalcResultLedger({ directory });
    const claim = { deviceId: 'DEVICE01', sequence: 5, recordDigest: 'digest-a' };
    await ledger.claimResult(claim);
    await expect(ledger.recordArrival({ ...claim, transport: 'qr', receivedAt: 'yesterday' }))
      .rejects.toThrow(/canonical ISO-8601/);
  });

  it('keeps only the newest progress and rejects equal-sequence collisions', async () => {
    const directory = await temporaryDirectory();
    const repository = new YamlSchoolCalcProgressRepository({ directory });
    const base = { deviceId: 'DEVICE01', artifactId: 'artifact-a', sequence: 10, recordDigest: 'digest-a', progress: { position: 2 } };
    await expect(repository.saveLatest(base)).resolves.toMatchObject({ status: 'accepted' });
    await expect(repository.saveLatest(base)).resolves.toMatchObject({ status: 'duplicate' });
    await expect(repository.saveLatest({ ...base, sequence: 9, recordDigest: 'old' })).resolves.toMatchObject({ status: 'stale' });
    await expect(repository.saveLatest({ ...base, recordDigest: 'changed' })).rejects.toMatchObject({
      code: 'SCHOOLCALC_PROGRESS_CONFLICT',
    });
    await expect(repository.getLatest({ deviceId: 'DEVICE01', artifactId: 'artifact-a' }))
      .resolves.toMatchObject({ sequence: 10, recordDigest: 'digest-a' });
  });
});
