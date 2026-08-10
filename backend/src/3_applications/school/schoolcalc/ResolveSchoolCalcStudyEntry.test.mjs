import { describe, expect, it, vi } from 'vitest';
import {
  Ti86SchoolCalcCodec, decodeTi86StudyAcknowledgement, decodeTi86StudyPrescription, encodeTi86StudyEntry,
} from '#adapters/schoolcalc/ti86/index.mjs';
import { ResolveSchoolCalcStudyEntry } from './ResolveSchoolCalcStudyEntry.mjs';

const artifact = {
  artifactId: 'sc:ti86:ABCDEF2345', platformId: 'ti86', variableName: 'DPABC234',
  byteLength: 500, byteDigest: 'ab'.repeat(32), bytes: Buffer.alloc(500),
};
const study = {
  studySessionId: 'study-one', learnerId: 'learner-one', code: '001234', status: 'open',
  artifact: { ...artifact, requiredClientVersion: 1 },
  curation: {
    bankRevision: '123456789abc',
    policy: { cardCount: 12, itemCount: 10, maxExposuresPerCard: 4, passingPercent: 80 },
  },
};

function harness({ installed = false, found = study, bindStatus = 'accepted' } = {}) {
  const codec = new Ti86SchoolCalcCodec();
  const studies = {
    getByCode: vi.fn(async () => found),
    bindResolution: vi.fn(async () => ({ status: bindStatus, session: found })),
  };
  const devices = { getDevice: vi.fn(async () => ({
    deviceId: '86A001', platformId: 'ti86', capabilityReport: { shellVersion: '1' },
    activeLearnerBindings: [{ learnerId: 'learner-one', learnerKey: 7 }],
    installedArtifactIds: installed ? [artifact.artifactId] : [],
  })) };
  return {
    codec, studies,
    resolver: new ResolveSchoolCalcStudyEntry({
      studies, devices, artifacts: { getArtifact: async () => artifact }, codec,
      clock: () => new Date('2026-08-10T12:00:00.000Z'),
    }),
  };
}

describe('ResolveSchoolCalcStudyEntry', () => {
  it('returns artifact -> staged prescription -> acknowledgement order when missing', async () => {
    const { resolver, studies } = harness();
    const result = await resolver.execute({ record: encodeTi86StudyEntry({
      deviceId: '86A001', requestId: 42, sixDigitCode: '001234',
    }) });
    expect(result).toMatchObject({ status: 'resolved', artifactInstalled: false, writeOrder: ['DPABC234', 'DSSTDNEW', 'DSSYNC'] });
    expect(decodeTi86StudyPrescription(result.prescriptionRecord)).toMatchObject({
      deviceId: '86A001', requestId: 42, sessionCode: '001234', learnerKey: 7,
      artifactId: artifact.artifactId, cardCount: 12, itemCount: 10,
    });
    expect(decodeTi86StudyAcknowledgement(result.commitRecord)).toMatchObject({
      deviceId: '86A001', requestId: 42, sessionCode: '001234', artifactId: artifact.artifactId,
    });
    expect(studies.bindResolution).toHaveBeenCalledWith(expect.objectContaining({
      studySessionId: 'study-one', resolution: expect.objectContaining({ deviceId: '86A001', requestId: 42 }),
    }));
  });

  it('uses prescription-only transfer for an installed artifact', async () => {
    const { resolver } = harness({ installed: true });
    await expect(resolver.execute({ record: encodeTi86StudyEntry({
      deviceId: '86A001', requestId: 43, sixDigitCode: '001234',
    }) })).resolves.toMatchObject({ artifactInstalled: true, artifact: null, writeOrder: ['DSSTDNEW', 'DSSYNC'] });
  });

  it('returns plain non-acknowledging recovery for unknown and closed codes', async () => {
    const unknown = harness({ found: null });
    await expect(unknown.resolver.execute({ record: encodeTi86StudyEntry({
      deviceId: '86A001', requestId: 1, sixDigitCode: '999999',
    }) })).resolves.toMatchObject({ status: 'unknown', message: 'CODE NOT FOUND', acknowledge: null });
    const closed = harness({ found: { ...study, status: 'closed' } });
    await expect(closed.resolver.execute({ record: encodeTi86StudyEntry({
      deviceId: '86A001', requestId: 1, sixDigitCode: '001234',
    }) })).resolves.toMatchObject({ status: 'closed', message: 'SESSION CLOSED', acknowledge: null });
  });
});
