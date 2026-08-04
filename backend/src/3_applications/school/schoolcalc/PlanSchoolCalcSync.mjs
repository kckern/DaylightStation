import { DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/**
 * Reconcile one observed calculator with its durable desired state.
 *
 * This use case returns metadata only: immutable artifact bytes remain behind
 * GetSchoolCalcArtifact, so retries cannot accidentally compile or mutate
 * content. New artifacts must fit while old variables remain present; deletion
 * is a calculator-side commit action after every staged artifact validates.
 */
export class PlanSchoolCalcSync {
  #devices; #artifacts; #ledger; #catalog; #codecs;

  constructor({ devices, artifacts, ledger, catalog, codecs } = {}) {
    if (!devices || !artifacts || !ledger || !catalog || !codecs) {
      throw new Error('PlanSchoolCalcSync requires devices, artifacts, ledger, catalog, and codecs');
    }
    this.#devices = devices;
    this.#artifacts = artifacts;
    this.#ledger = ledger;
    this.#catalog = catalog;
    this.#codecs = codecs;
  }

  async execute({
    deviceId,
    catalogGeneration = null,
    acknowledgementSequences = null,
    deliveryAcknowledgementIds = null,
    queueRecordBytes = null,
    profileRecordBytes = null,
    progressRecordBytes = null,
    interactionResponseBytes = null,
  } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    if (!device.capabilityReport) {
      throw new DomainInvariantError(`SchoolCalc device '${deviceId}' must be observed before sync`, {
        code: 'SCHOOLCALC_DEVICE_NOT_OBSERVED',
      });
    }

    const installedIds = unique(device.installedArtifactIds);
    const desiredIds = unique(device.desiredArtifactIds);
    const allIds = unique([...installedIds, ...desiredIds]);
    const loaded = await Promise.all(allIds.map(async (artifactId) => {
      const artifact = await this.#artifacts.getArtifact(artifactId);
      if (!artifact) throw new EntityNotFoundError('SchoolCalc artifact', artifactId);
      if (artifact.platformId !== device.platformId) {
        throw new DomainInvariantError(`Artifact '${artifactId}' does not match device platform`, {
          code: 'SCHOOLCALC_ARTIFACT_PLATFORM_MISMATCH',
        });
      }
      validateArtifactMetadata(artifact);
      return artifact;
    }));
    const byId = new Map(loaded.map((artifact) => [artifact.artifactId, artifact]));

    assertUniqueInstalledVariables(installedIds.map((id) => byId.get(id)));
    assertUniqueDesiredVariables(desiredIds.map((id) => byId.get(id)));

    const removalArtifacts = installedIds
      .filter((artifactId) => !desiredIds.includes(artifactId))
      .map((artifactId) => byId.get(artifactId));
    const installArtifacts = desiredIds
      .filter((artifactId) => !installedIds.includes(artifactId))
      .map((artifactId) => byId.get(artifactId));
    const removals = removalArtifacts.map(projectRemoval);
    const installs = installArtifacts.map(projectArtifact);

    const catalog = await this.#catalog.execute({ deviceId });
    const sequences = uniqueNumbers(acknowledgementSequences === null
      ? await this.#ledger.listAcknowledgedSequences(deviceId)
      : acknowledgementSequences);
    const requestIds = uniqueNumbers(deliveryAcknowledgementIds ?? []);
    const codec = this.#codecs.get(device.platformId);
    const acknowledgementRecord = codec.encodeAcknowledgements({ deviceId, sequences });
    const limits = device.capabilityReport.limits ?? {};
    const freeBytes = optionalLimit(limits.freeBytes, 'freeBytes');
    const reservedFreeBytes = optionalLimit(limits.reservedFreeBytes, 'reservedFreeBytes') ?? 0;
    const variableOverheadBytes = optionalLimit(limits.variableOverheadBytes, 'variableOverheadBytes') ?? 0;
    const localStateCommitBytes = optionalLimit(limits.localStateCommitBytes, 'localStateCommitBytes') ?? 0;
    const catalogCommitCopyCount = optionalLimit(limits.catalogCommitCopyCount, 'catalogCommitCopyCount') ?? 0;
    const manifestCommitCopyCount = optionalLimit(limits.manifestCommitCopyCount, 'manifestCommitCopyCount') ?? 0;
    const queueCommitCopyCount = optionalLimit(limits.queueCommitCopyCount, 'queueCommitCopyCount') ?? 0;
    const interactionResponseCommitCopyCount = optionalLimit(
      limits.interactionResponseCommitCopyCount, 'interactionResponseCommitCopyCount',
    ) ?? 0;
    const observedQueueBytes = optionalLimit(queueRecordBytes, 'queueRecordBytes');
    const observedProfileBytes = optionalLimit(profileRecordBytes, 'profileRecordBytes');
    const observedProgressBytes = optionalLimit(progressRecordBytes, 'progressRecordBytes');
    const observedInteractionResponseBytes = optionalLimit(
      interactionResponseBytes, 'interactionResponseBytes',
    );
    const bytesReleased = removals.reduce((sum, entry) => sum + entry.byteLength, 0);
    const bytesRequired = installs.reduce((sum, entry) => sum + entry.byteLength, 0);
    const catalogChanged = catalogGeneration !== catalog.generation;
    const blockers = [];
    const installedByVariable = new Map(installedIds.map((id) => {
      const artifact = byId.get(id);
      return [artifact.variableName, artifact.artifactId];
    }));
    for (const artifact of installArtifacts) {
      const installedArtifactId = installedByVariable.get(artifact.variableName);
      if (installedArtifactId && installedArtifactId !== artifact.artifactId) {
        blockers.push({
          code: 'VARIABLE_NAME_COLLISION',
          variableName: artifact.variableName,
          installedArtifactId,
          requestedArtifactId: artifact.artifactId,
        });
      }
    }
    const semanticallyReady = blockers.length === 0;
    const candidateInstalledArtifacts = (semanticallyReady ? desiredIds : installedIds)
      .map((artifactId) => projectArtifact(byId.get(artifactId)));
    // A family codec may use a fixed-width generation key. Encoding a
    // placeholder therefore yields the exact record length before the final
    // plan digest exists without exposing that representation to this use case.
    const manifestProbe = codec.encodeSyncManifest({
      schema: 'school.calc.sync-plan/v1',
      deviceId,
      platformId: device.platformId,
      generation: `sha256:${'0'.repeat(64)}`,
      catalog: { generation: catalog.generation, changed: catalogChanged },
      removals,
      artifacts: installs,
      installedArtifacts: candidateInstalledArtifacts,
      acknowledgements: { sequences },
      deliveryAcknowledgements: { requestIds },
      storage: {},
      ready: semanticallyReady,
      blockers,
    });
    const catalogRecordBytes = recordByteLength(catalog.record, 'Catalog record');
    const acknowledgementRecordBytes = recordByteLength(acknowledgementRecord, 'Acknowledgement record');
    const manifestRecordBytes = recordByteLength(manifestProbe, 'Sync manifest record');
    const catalogStagingBytes = semanticallyReady && catalogChanged
      ? catalogRecordBytes + variableOverheadBytes
      : 0;
    const artifactStagingBytes = semanticallyReady
      ? bytesRequired + (installs.length * variableOverheadBytes)
      : 0;
    const acknowledgementStagingBytes = acknowledgementRecordBytes + variableOverheadBytes;
    const manifestStagingBytes = manifestRecordBytes + variableOverheadBytes;
    const profileStagingBytes = observedProfileBytes === null
      ? 0 : observedProfileBytes + variableOverheadBytes;
    const progressStagingBytes = observedProgressBytes === null
      ? 0 : observedProgressBytes + variableOverheadBytes;
    const interactionResponseStagingBytes = observedInteractionResponseBytes === null
      ? 0 : observedInteractionResponseBytes + variableOverheadBytes;
    const relayStagingBytes = profileStagingBytes + progressStagingBytes
      + interactionResponseStagingBytes
      + catalogStagingBytes + artifactStagingBytes
      + acknowledgementStagingBytes + manifestStagingBytes;
    const catalogCommitCopyBytes = semanticallyReady && catalogChanged
      ? catalogCommitCopyCount * (catalogRecordBytes + variableOverheadBytes)
      : 0;
    const manifestCommitCopyBytes = semanticallyReady
      ? manifestCommitCopyCount * (manifestRecordBytes + variableOverheadBytes)
      : 0;
    const queueBytesForCommit = sequences.length === 0
      ? 0
      : observedQueueBytes ?? optionalLimit(limits.queueMaxBytes, 'queueMaxBytes') ?? 0;
    const queueCommitCopyBytes = semanticallyReady && queueBytesForCommit > 0
      ? queueCommitCopyCount * (queueBytesForCommit + variableOverheadBytes)
      : 0;
    const interactionResponseCommitCopyBytes = observedInteractionResponseBytes === null
      ? 0
      : interactionResponseCommitCopyCount
        * (observedInteractionResponseBytes + variableOverheadBytes);
    const localStateWorkspaceBytes = semanticallyReady ? localStateCommitBytes : 0;
    const commitWorkspaceBytes = catalogCommitCopyBytes + manifestCommitCopyBytes
      + queueCommitCopyBytes + localStateWorkspaceBytes;
    const totalCommitWorkspaceBytes = commitWorkspaceBytes + interactionResponseCommitCopyBytes;
    const peakAdditionalBytes = relayStagingBytes + totalCommitWorkspaceBytes;
    const availableBytesForStaging = freeBytes === null
      ? null
      : Math.max(0, freeBytes - reservedFreeBytes);
    const storageSufficient = availableBytesForStaging === null
      || peakAdditionalBytes <= availableBytesForStaging;
    if (!storageSufficient) blockers.push({
      code: 'INSUFFICIENT_STAGING_STORAGE',
      requiredBytes: peakAdditionalBytes,
      availableBytesForStaging,
    });
    const ready = blockers.length === 0;
    const installedArtifacts = (ready ? desiredIds : installedIds)
      .map((artifactId) => projectArtifact(byId.get(artifactId)));

    const withoutGeneration = {
      schema: 'school.calc.sync-plan/v1',
      deviceId,
      platformId: device.platformId,
      deviceRevision: device.revision,
      catalog: {
        generation: catalog.generation,
        changed: catalogChanged,
      },
      removals,
      artifacts: installs,
      // This is the complete post-commit set, not another delta. A calculator
      // can therefore reconstruct authoritative installed state after restart
      // without retaining an unbounded history of sync manifests.
      installedArtifacts,
      acknowledgements: { sequences },
      deliveryAcknowledgements: { requestIds },
      storage: {
        freeBytes,
        reservedFreeBytes,
        variableOverheadBytes,
        catalogRecordBytes,
        acknowledgementRecordBytes,
        manifestRecordBytes,
        queueRecordBytes: observedQueueBytes,
        profileRecordBytes: observedProfileBytes,
        progressRecordBytes: observedProgressBytes,
        interactionResponseBytes: observedInteractionResponseBytes,
        profileStagingBytes,
        progressStagingBytes,
        interactionResponseStagingBytes,
        catalogStagingBytes,
        artifactStagingBytes,
        acknowledgementStagingBytes,
        manifestStagingBytes,
        relayStagingBytes,
        catalogCommitCopyBytes,
        manifestCommitCopyBytes,
        queueCommitCopyBytes,
        interactionResponseCommitCopyBytes,
        localStateCommitBytes: localStateWorkspaceBytes,
        commitWorkspaceBytes: totalCommitWorkspaceBytes,
        peakAdditionalBytes,
        bytesReleased,
        bytesRequired,
        availableBytesForStaging,
        storageSufficient,
      },
      ready,
      blockers,
    };
    const plan = {
      ...withoutGeneration,
      generation: `sha256:${stableRecordDigest(withoutGeneration)}`,
    };
    const manifestRecord = codec.encodeSyncManifest(plan);
    return {
      ...plan,
      acknowledgementRecord,
      manifestRecord,
    };
  }
}

function projectArtifact(artifact) {
  return Object.fromEntries([
    'artifactId', 'variableName', 'mediaType', 'byteLength', 'byteDigest',
  ].map((field) => [field, artifact[field]]));
}

function projectRemoval(artifact) {
  return Object.fromEntries(['artifactId', 'variableName', 'byteLength']
    .map((field) => [field, artifact[field]]));
}

function validateArtifactMetadata(artifact) {
  if (typeof artifact.artifactId !== 'string' || !artifact.artifactId
    || typeof artifact.variableName !== 'string' || !artifact.variableName
    || typeof artifact.mediaType !== 'string' || !artifact.mediaType
    || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0
    || typeof artifact.byteDigest !== 'string' || !artifact.byteDigest) {
    throw new DomainInvariantError('SchoolCalc artifact has incomplete sync metadata', {
      code: 'INVALID_SCHOOLCALC_ARTIFACT_METADATA',
      details: { artifactId: artifact.artifactId ?? null },
    });
  }
}

function assertUniqueInstalledVariables(artifacts) {
  const collision = findVariableCollision(artifacts);
  if (collision) {
    throw new DomainInvariantError(`Installed artifacts claim the same variable '${collision.variableName}'`, {
      code: 'SCHOOLCALC_INSTALLED_VARIABLE_COLLISION',
      details: collision,
    });
  }
}

function assertUniqueDesiredVariables(artifacts) {
  const collision = findVariableCollision(artifacts);
  if (collision) {
    throw new DomainInvariantError(`Desired artifacts claim the same variable '${collision.variableName}'`, {
      code: 'SCHOOLCALC_DESIRED_VARIABLE_COLLISION',
      details: collision,
    });
  }
}

function findVariableCollision(artifacts) {
  const byVariable = new Map();
  for (const artifact of artifacts) {
    const prior = byVariable.get(artifact.variableName);
    if (prior && prior !== artifact.artifactId) {
      return { variableName: artifact.variableName, artifactIds: [prior, artifact.artifactId] };
    }
    byVariable.set(artifact.variableName, artifact.artifactId);
  }
  return null;
}

function unique(values) { return [...new Set(values)]; }

function uniqueNumbers(values) {
  if (!Array.isArray(values) || !values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new DomainInvariantError('SchoolCalc result ledger returned invalid acknowledgement sequences', {
      code: 'INVALID_SCHOOLCALC_ACKNOWLEDGEMENTS',
    });
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function optionalLimit(value, field) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainInvariantError(`SchoolCalc capability report has invalid ${field}`, {
      code: 'INVALID_SCHOOLCALC_RESOURCE_LIMIT',
      details: { field, value },
    });
  }
  return value;
}

function recordByteLength(record, label) {
  if (Buffer.isBuffer(record) || record instanceof Uint8Array) return record.byteLength;
  throw new DomainInvariantError(`${label} must be a byte record`, {
    code: 'INVALID_SCHOOLCALC_CATALOG_RECORD',
  });
}

export default PlanSchoolCalcSync;
