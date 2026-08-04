import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { validateSchoolCalcDeliveryRequest } from '#domains/school/schoolcalc/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Decode and apply durable install/remove requests from one calculator. */
export class RequestSchoolCalcDelivery {
  #devices; #codecs; #catalog; #buildArtifact; #buildInstallSet; #clock;

  constructor({ devices, codecs, catalog, buildArtifact, buildInstallSet = null, clock = () => new Date() } = {}) {
    if (!devices || !codecs || !catalog || !buildArtifact) {
      throw new Error('RequestSchoolCalcDelivery requires devices, codecs, catalog, and buildArtifact');
    }
    this.#devices = devices;
    this.#codecs = codecs;
    this.#catalog = catalog;
    this.#buildArtifact = buildArtifact;
    this.#buildInstallSet = buildInstallSet;
    this.#clock = clock;
  }

  async execute({ deviceId, record } = {}) {
    const original = await this.#devices.getDevice(deviceId);
    if (!original) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const codec = this.#codecs.get(original.platformId);
    const decoded = codec.decodeDeliveryRequests(record);
    if (decoded.deviceId !== deviceId) throw new Error('SchoolCalc delivery batch device identity does not match endpoint');
    if (!Array.isArray(decoded.requests) || decoded.requests.length === 0) {
      throw new Error('SchoolCalc delivery batch has no requests');
    }

    const claims = preflightClaims(original, decoded.requests);
    let catalogProjection = null;
    for (const claim of claims) {
      if (claim.kind !== 'new') continue;
      assertCurrentLearner(original, claim.request.learnerKey);
      if (claim.request.action !== 'install') continue;
      if (!catalogProjection) {
        // eslint-disable-next-line no-await-in-loop
        catalogProjection = await this.#catalog.execute({ deviceId });
      }
      const target = findInstallTarget(catalogProjection, claim.request);
      assertCatalogAccess(target, claim.request.learnerKey);
    }

    let current = original;
    const outcomes = [];
    const requestedAt = this.#clock().toISOString();
    for (const { request, recordDigest } of claims) {
      const prior = current.deliveryRequests.find((entry) => entry.requestId === request.requestId);
      let resolvedArtifactIds = prior?.artifactIds ?? (prior?.artifactId ? [prior.artifactId] : []);
      if (!prior && request.action === 'install') {
        if (request.installSet) {
          if (!this.#buildInstallSet) throw new Error('SchoolCalc install-set delivery is not configured');
          // eslint-disable-next-line no-await-in-loop
          const set = await this.#buildInstallSet.execute({ deviceId, ...request.installSet });
          resolvedArtifactIds = set.artifactIds;
        } else {
          // Compilation occurs only for a new authorized install intent, never for replay.
          // eslint-disable-next-line no-await-in-loop
          const artifact = await this.#buildArtifact.execute({ deviceId, address: request.address });
          resolvedArtifactIds = [artifact.artifactId];
        }
      }
      const applied = current.requestDelivery({ request, recordDigest, resolvedArtifactIds, requestedAt });
      current = applied.device;
      outcomes.push({
        requestId: request.requestId,
        status: applied.outcome,
        acknowledge: true,
        learnerKey: applied.entry.learnerKey,
        action: request.action,
        artifactIds: applied.entry.artifactIds,
        ...(applied.entry.artifactId ? { artifactId: applied.entry.artifactId } : {}),
      });
    }

    if (current !== original) {
      await this.#devices.saveDevice(current, { expectedRevision: original.revision });
    }
    return {
      deviceId,
      requests: outcomes,
      desiredArtifactIds: current.desiredArtifactIds,
      revision: current.revision,
    };
  }
}

function preflightClaims(device, requests) {
  const persisted = new Map(device.deliveryRequests.map((entry) => [entry.requestId, entry.recordDigest]));
  const batch = new Map();
  return requests.map((request) => {
    const validation = validateSchoolCalcDeliveryRequest(request);
    if (validation.errors.length) {
      throw new Error(`SchoolCalc delivery request is invalid: ${validation.errors.join('; ')}`);
    }
    const recordDigest = stableRecordDigest(validation.request);
    const persistedDigest = persisted.get(validation.request.requestId);
    if (persistedDigest !== undefined) {
      if (persistedDigest !== recordDigest) {
        throw new Error(`SchoolCalc delivery request ${validation.request.requestId} conflicts with accepted content`);
      }
      return { request: validation.request, recordDigest, kind: 'persisted-replay' };
    }
    const batchDigest = batch.get(validation.request.requestId);
    if (batchDigest !== undefined) {
      if (batchDigest !== recordDigest) {
        throw new Error(`SchoolCalc delivery request ${validation.request.requestId} is reused with different batch content`);
      }
      return { request: validation.request, recordDigest, kind: 'batch-replay' };
    }
    batch.set(validation.request.requestId, recordDigest);
    return { request: validation.request, recordDigest, kind: 'new' };
  });
}

function assertCurrentLearner(device, learnerKey) {
  if (learnerKey === 0) return;
  if (!device.resolveLearnerKey(learnerKey, { activeOnly: true })) {
    throw new Error(`SchoolCalc delivery learnerKey ${learnerKey} is not active on device '${device.deviceId}'`);
  }
}

function findInstallTarget(projection, request) {
  if (!projection || !Array.isArray(projection.catalogs)) {
    throw new Error('SchoolCalc Catalog returned an invalid projection');
  }
  if (request.installSet) {
    const catalog = projection.catalogs.find(({ catalogId }) => catalogId === request.installSet.catalogId);
    const installSet = catalog?.installSets?.find(
      ({ installSetId }) => installSetId === request.installSet.installSetId,
    );
    if (!installSet) {
      throw new EntityNotFoundError(
        'SchoolCalc Catalog install set',
        `${request.installSet.catalogId}/${request.installSet.installSetId}`,
      );
    }
    return installSet;
  }
  for (const catalog of projection.catalogs) {
    for (const subject of catalog.subjects ?? []) {
      for (const course of subject.courses ?? []) {
        for (const unit of course.units ?? []) {
          const lesson = unit.lessons?.find(({ address }) => address === request.address);
          if (lesson) return lesson;
        }
      }
    }
  }
  throw new EntityNotFoundError('SchoolCalc Catalog lesson', request.address);
}

function assertCatalogAccess(target, learnerKey) {
  const access = target?.access;
  if (!access || !Array.isArray(access.learnerKeys) || typeof access.guest !== 'boolean') {
    throw new Error('SchoolCalc Catalog target has an invalid access projection');
  }
  const allowed = learnerKey === 0 ? access.guest : access.learnerKeys.includes(learnerKey);
  if (!allowed) {
    const claimant = learnerKey === 0 ? 'Guest' : `learnerKey ${learnerKey}`;
    throw new Error(`SchoolCalc Catalog target is not available to ${claimant}`);
  }
}

export default RequestSchoolCalcDelivery;
