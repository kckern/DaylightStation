import { describe, expect, it, vi } from 'vitest';
import { PlanSchoolCalcSync } from './PlanSchoolCalcSync.mjs';

function artifact(artifactId, variableName, byteLength = 100) {
  return {
    artifactId,
    platformId: 'future',
    variableName,
    mediaType: 'application/x-future-schoolcalc',
    byteLength,
    byteDigest: `digest-${artifactId}`,
    bytes: Buffer.alloc(byteLength),
  };
}

function harness({
  installedArtifactIds = ['old'],
  desiredArtifactIds = ['new'],
  artifacts = [artifact('old', 'PACK0001', 80), artifact('new', 'PACK0002', 120)],
  freeBytes = 1024,
  reservedFreeBytes = 100,
  variableOverheadBytes = 10,
  queueMaxBytes = null,
  localStateCommitBytes = 0,
  catalogCommitCopyCount = 0,
  manifestCommitCopyCount = 0,
  queueCommitCopyCount = 0,
} = {}) {
  const records = new Map(artifacts.map((entry) => [entry.artifactId, entry]));
  const encodeAcknowledgements = vi.fn(({ deviceId, sequences }) => Buffer.from(`ACK:${deviceId}:${sequences.join(',')}`));
  const encodeSyncManifest = vi.fn((plan) => Buffer.from(`MANIFEST:${plan.generation}`));
  const listAcknowledgedSequences = vi.fn(async () => [9, 2, 9]);
  const catalog = { execute: vi.fn(async () => ({ generation: 'sha256:catalog-2', record: Buffer.from('catalog') })) };
  const planner = new PlanSchoolCalcSync({
    devices: {
      getDevice: async (id) => (id === 'DEVICE01' ? {
        deviceId: id,
        platformId: 'future',
        revision: 4,
        installedArtifactIds,
        desiredArtifactIds,
        capabilityReport: { limits: {
          freeBytes, reservedFreeBytes, variableOverheadBytes, queueMaxBytes,
          localStateCommitBytes, catalogCommitCopyCount,
          manifestCommitCopyCount, queueCommitCopyCount,
        } },
      } : null),
    },
    artifacts: { getArtifact: async (id) => records.get(id) ?? null },
    ledger: { listAcknowledgedSequences },
    catalog,
    codecs: { get: (platformId) => {
      expect(platformId).toBe('future'); return { encodeAcknowledgements, encodeSyncManifest };
    } },
  });
  return {
    planner, catalog, encodeAcknowledgements, encodeSyncManifest, listAcknowledgedSequences,
  };
}

describe('PlanSchoolCalcSync', () => {
  it('stages a distinct new variable before committing removals and emits ACK/manifest records', async () => {
    const { planner, encodeAcknowledgements, encodeSyncManifest } = harness();
    const plan = await planner.execute({ deviceId: 'DEVICE01', catalogGeneration: 'sha256:catalog-1' });

    expect(plan).toMatchObject({
      schema: 'school.calc.sync-plan/v1',
      deviceId: 'DEVICE01',
      platformId: 'future',
      catalog: { generation: 'sha256:catalog-2', changed: true },
      removals: [{ artifactId: 'old', variableName: 'PACK0001', byteLength: 80 }],
      artifacts: [{
        artifactId: 'new', variableName: 'PACK0002', byteLength: 120,
      }],
      installedArtifacts: [{
        artifactId: 'new', variableName: 'PACK0002', byteLength: 120,
      }],
      acknowledgements: { sequences: [2, 9] },
      storage: {
        freeBytes: 1024,
        reservedFreeBytes: 100,
        variableOverheadBytes: 10,
        catalogStagingBytes: 17,
        artifactStagingBytes: 130,
        acknowledgementStagingBytes: 26,
        manifestStagingBytes: 90,
        relayStagingBytes: 263,
        commitWorkspaceBytes: 0,
        peakAdditionalBytes: 263,
        bytesReleased: 80,
        bytesRequired: 120,
        availableBytesForStaging: 924,
        storageSufficient: true,
      },
      ready: true,
      blockers: [],
    });
    expect(plan.generation).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.acknowledgementRecord.toString()).toBe('ACK:DEVICE01:2,9');
    expect(plan.manifestRecord.toString()).toMatch(/^MANIFEST:sha256:/);
    expect(plan.artifacts[0]).not.toHaveProperty('bytes');
    expect(encodeAcknowledgements).toHaveBeenCalledTimes(1);
    expect(encodeSyncManifest).toHaveBeenCalledTimes(2);
  });

  it('does not count future removals as staging space for a replacement', async () => {
    const { planner } = harness({
      installedArtifactIds: ['old'],
      desiredArtifactIds: ['new'],
      artifacts: [artifact('old', 'PACK0001', 80), artifact('new', 'PACK0002', 120)],
      freeBytes: 100,
      reservedFreeBytes: 0,
      variableOverheadBytes: 0,
    });
    const plan = await planner.execute({ deviceId: 'DEVICE01', catalogGeneration: 'sha256:catalog-2' });
    expect(plan.catalog.changed).toBe(false);
    expect(plan.ready).toBe(false);
    expect(plan.installedArtifacts).toEqual([expect.objectContaining({ artifactId: 'old' })]);
    expect(plan.blockers).toEqual([{
      code: 'INSUFFICIENT_STAGING_STORAGE', requiredBytes: 216, availableBytesForStaging: 100,
    }]);
  });

  it('uses only transaction-scoped acknowledgement sequences when supplied', async () => {
    const { planner, encodeAcknowledgements, listAcknowledgedSequences } = harness();
    await planner.execute({
      deviceId: 'DEVICE01', acknowledgementSequences: [8, 7, 8],
    });
    expect(listAcknowledgedSequences).not.toHaveBeenCalled();
    expect(encodeAcknowledgements).toHaveBeenCalledWith({
      deviceId: 'DEVICE01', sequences: [7, 8],
    });
  });

  it('preserves a platform-neutral free-space reserve and includes changed Catalog bytes', async () => {
    const { planner } = harness({
      freeBytes: 280,
      reservedFreeBytes: 128,
      variableOverheadBytes: 16,
    });
    const plan = await planner.execute({ deviceId: 'DEVICE01', catalogGeneration: 'sha256:old' });
    expect(plan.storage).toMatchObject({
      catalogStagingBytes: 23,
      artifactStagingBytes: 136,
      acknowledgementStagingBytes: 32,
      manifestStagingBytes: 96,
      relayStagingBytes: 287,
      peakAdditionalBytes: 287,
      availableBytesForStaging: 152,
      bytesReleased: 80,
      storageSufficient: false,
    });
    expect(plan.blockers).toContainEqual({
      code: 'INSUFFICIENT_STAGING_STORAGE',
      requiredBytes: 287,
      availableBytesForStaging: 152,
    });
  });

  it('budgets relay staging and calculator copy-on-write workspace at peak occupancy', async () => {
    const { planner } = harness({
      freeBytes: 2000,
      queueMaxBytes: 600,
      localStateCommitBytes: 148,
      catalogCommitCopyCount: 1,
      manifestCommitCopyCount: 2,
      queueCommitCopyCount: 1,
    });
    const plan = await planner.execute({
      deviceId: 'DEVICE01', catalogGeneration: 'sha256:old', queueRecordBytes: 60,
    });
    expect(plan.storage).toMatchObject({
      relayStagingBytes: 263,
      catalogCommitCopyBytes: 17,
      manifestCommitCopyBytes: 180,
      queueCommitCopyBytes: 70,
      localStateCommitBytes: 148,
      commitWorkspaceBytes: 415,
      peakAdditionalBytes: 678,
      storageSufficient: true,
    });
  });

  it('blocks same-name replacement so the old artifact cannot be overwritten before validation', async () => {
    const { planner } = harness({
      artifacts: [artifact('old', 'PACK0001', 80), artifact('new', 'PACK0001', 120)],
      freeBytes: 1000,
    });
    const plan = await planner.execute({ deviceId: 'DEVICE01' });
    expect(plan.ready).toBe(false);
    expect(plan.blockers).toEqual([{
      code: 'VARIABLE_NAME_COLLISION', variableName: 'PACK0001',
      installedArtifactId: 'old', requestedArtifactId: 'new',
    }]);
  });

  it('fails closed rather than overwriting two desired artifacts with one variable name', async () => {
    const { planner } = harness({
      installedArtifactIds: [],
      desiredArtifactIds: ['one', 'two'],
      artifacts: [artifact('one', 'COLLIDE1'), artifact('two', 'COLLIDE1')],
    });
    await expect(planner.execute({ deviceId: 'DEVICE01' })).rejects.toMatchObject({
      code: 'SCHOOLCALC_DESIRED_VARIABLE_COLLISION',
    });
  });

  it('fails if the durable desired manifest references a missing immutable artifact', async () => {
    const { planner } = harness({ installedArtifactIds: [], desiredArtifactIds: ['missing'], artifacts: [] });
    await expect(planner.execute({ deviceId: 'DEVICE01' })).rejects.toThrow(/artifact not found: missing/);
  });
});
