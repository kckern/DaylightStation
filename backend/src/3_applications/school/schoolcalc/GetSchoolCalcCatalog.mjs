import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import {
  listCatalogInstallSets,
  listCatalogLessons,
  validateLearningCatalog,
} from '#domains/school/catalog/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Build one device-specific, offline-capable Catalog projection. */
export class GetSchoolCalcCatalog {
  #devices; #catalogs; #bundles; #codecs; #artifacts; #access;

  constructor({ devices, catalogs, bundles, codecs, artifacts, access } = {}) {
    if (!devices || !catalogs || !bundles || !codecs || !artifacts || !access) {
      throw new Error('GetSchoolCalcCatalog requires devices, catalogs, bundles, codecs, artifacts, and access');
    }
    this.#devices = devices;
    this.#catalogs = catalogs;
    this.#bundles = bundles;
    this.#codecs = codecs;
    this.#artifacts = artifacts;
    this.#access = access;
  }

  async execute({ deviceId } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    if (!device.capabilityReport) throw new Error(`SchoolCalc device '${deviceId}' must be observed before Catalog projection`);
    const codec = this.#codecs.get(device.platformId);
    const knownArtifacts = await this.#knownArtifacts(device);
    const artifactByAddress = new Map(knownArtifacts
      .filter(Boolean)
      .map((artifact) => [artifact.source?.address, artifact]));

    // A device owns exactly one Catalog assignment. The shared repository can
    // publish many Catalogs for other devices/surfaces; none of them become a
    // calculator-side choice.
    const assignedCatalogId = device.catalogId;
    const raw = await this.#catalogs.getCatalog(assignedCatalogId);
    if (!raw) throw new EntityNotFoundError('SchoolCalc catalog', assignedCatalogId);
    const validation = validateLearningCatalog(raw);
    if (validation.errors.length) {
      throw new Error(`SchoolCalc catalog '${assignedCatalogId}' is invalid: ${validation.errors.join('; ')}`);
    }
    if (validation.catalog.catalogId !== assignedCatalogId) {
      throw new Error(`SchoolCalc catalog '${assignedCatalogId}' declares catalogId '${validation.catalog.catalogId}'`);
    }
    const validatedCatalogs = [validation.catalog];
    const lessons = validatedCatalogs.flatMap((catalog) => listCatalogLessons(catalog)
      .map(({ address, context }) => ({ address, context })));
    const bindings = device.activeLearnerBindings.map((binding) => ({
      learnerId: binding.learnerId, learnerKey: binding.learnerKey,
    }));
    const access = await this.#access.resolve({
      learners: bindings.map(({ learnerId }) => ({ learnerId })), lessons,
    });
    const accessByAddress = buildAccessIndex({ access, bindings, lessons });
    const projectedCatalogs = [];
    for (const catalog of validatedCatalogs) {
      // eslint-disable-next-line no-await-in-loop
      projectedCatalogs.push(await this.#projectCatalog(
        catalog, device, codec, artifactByAddress, accessByAddress,
      ));
    }

    const limits = device.capabilityReport.limits ?? {};
    const withoutGeneration = {
      schema: 'school.calc.catalog-projection/v1',
      deviceId,
      platformId: device.platformId,
      storage: {
        freeBytes: limits.freeBytes ?? null,
        maxArtifactBytes: limits.maxArtifactBytes ?? null,
        artifactTargetBytes: limits.artifactTargetBytes ?? null,
        catalogStateTargetBytes: limits.catalogStateTargetBytes ?? null,
        catalogStateMaxBytes: limits.catalogStateMaxBytes ?? null,
        catalogRecordTargetBytes: limits.catalogRecordTargetBytes ?? null,
        catalogRecordMaxBytes: limits.catalogRecordMaxBytes ?? null,
        queueTargetBytes: limits.queueTargetBytes ?? null,
        queueMaxBytes: limits.queueMaxBytes ?? null,
        queueMaxRecords: limits.queueMaxRecords ?? null,
        deliveryRequestTargetBytes: limits.deliveryRequestTargetBytes ?? null,
        deliveryRequestMaxBytes: limits.deliveryRequestMaxBytes ?? null,
        deliveryRequestMaxRecords: limits.deliveryRequestMaxRecords ?? null,
        learnerRosterTargetBytes: limits.learnerRosterTargetBytes ?? null,
        learnerRosterMaxBytes: limits.learnerRosterMaxBytes ?? null,
        learnerRosterMaxRecords: limits.learnerRosterMaxRecords ?? null,
        progressProjectionTargetBytes: limits.progressProjectionTargetBytes ?? null,
        progressProjectionMaxBytes: limits.progressProjectionMaxBytes ?? null,
        acknowledgementMaxBytes: limits.acknowledgementMaxBytes ?? null,
        syncManifestMaxBytes: limits.syncManifestMaxBytes ?? null,
        reservedFreeBytes: limits.reservedFreeBytes ?? 0,
        variableOverheadBytes: limits.variableOverheadBytes ?? 0,
        localStateCommitBytes: limits.localStateCommitBytes ?? 0,
        catalogCommitCopyCount: limits.catalogCommitCopyCount ?? 0,
        manifestCommitCopyCount: limits.manifestCommitCopyCount ?? 0,
        queueCommitCopyCount: limits.queueCommitCopyCount ?? 0,
      },
      catalogs: projectedCatalogs,
    };
    const generation = `sha256:${stableRecordDigest(withoutGeneration)}`;
    const projection = { ...withoutGeneration, generation };
    return {
      ...projection,
      record: codec.encodeCatalog(projection),
    };
  }

  async #knownArtifacts(device) {
    const ids = [...new Set([...device.installedArtifactIds, ...device.desiredArtifactIds])];
    return Promise.all(ids.map((artifactId) => this.#artifacts.getArtifact(artifactId)));
  }

  async #projectCatalog(catalog, device, codec, artifactByAddress, accessByAddress) {
    const lessonState = new Map();
    const bundleDigests = new Map();
    for (const entry of listCatalogLessons(catalog)) {
      // Full bundle resolution is the publication/compatibility gate. It also
      // sees item-level capabilities that the shallow tree cannot derive.
      // eslint-disable-next-line no-await-in-loop
      const bundle = await this.#bundles.execute(entry.context);
      bundleDigests.set(entry.address, stableRecordDigest(bundle));
      const support = codec.supports(bundle, device.capabilityReport);
      const artifact = artifactByAddress.get(entry.address) ?? null;
      const installed = artifact && device.installedArtifactIds.includes(artifact.artifactId);
      const desired = artifact && device.desiredArtifactIds.includes(artifact.artifactId);
      const sourceCurrent = artifact?.sourceDigest === stableRecordDigest(bundle);
      let state = support.compatible ? 'available' : 'incompatible';
      if (support.compatible && installed) state = sourceCurrent ? 'installed' : 'update_available';
      else if (support.compatible && desired) state = 'requested';
      lessonState.set(entry.address, {
        compatible: support.compatible,
        reasons: [...support.reasons],
        state,
        requiredCapabilities: [...bundle.capabilities],
        artifactId: artifact?.artifactId ?? null,
        byteLength: artifact?.byteLength ?? null,
        access: structuredClone(accessByAddress.get(entry.address)),
      });
    }

    const installSets = listCatalogInstallSets(catalog)
      .map((definition) => projectInstallSet(definition, lessonState, bundleDigests));
    return annotateHierarchyAccess({
      ...nodeHeader(catalog, 'catalogId'),
      ...(installSets.length ? { installSets } : {}),
      subjects: catalog.subjects.map((subject) => ({
        ...nodeHeader(subject, 'subjectId'),
        courses: subject.courses.map((course) => ({
          ...nodeHeader(course, 'courseId'),
          units: course.units.map((unit) => ({
            ...nodeHeader(unit, 'unitId'),
            lessons: unit.lessons.map((lesson) => {
              const address = [catalog.catalogId, subject.subjectId, course.courseId, unit.unitId, lesson.lessonId].join('/');
              return { ...nodeHeader(lesson, 'lessonId'), address, ...lessonState.get(address) };
            }),
          })),
        })),
      })),
    });
  }
}

function annotateHierarchyAccess(catalog) {
  const subjects = catalog.subjects.map((subject) => {
    const courses = subject.courses.map((course) => {
      const units = course.units.map((unit) => ({
        ...unit,
        access: unionAccess(unit.lessons),
      }));
      return { ...course, access: unionAccess(units), units };
    });
    return { ...subject, access: unionAccess(courses), courses };
  });
  return { ...catalog, access: unionAccess(subjects), subjects };
}

function unionAccess(nodes) {
  const learnerKeys = [...new Set(nodes.flatMap((node) => node.access.learnerKeys))]
    .sort((left, right) => left - right);
  return {
    learnerKeys,
    guest: nodes.some((node) => node.access.guest === true),
  };
}

function projectInstallSet(definition, lessonState, bundleDigests) {
  const members = definition.lessonAddresses.map((address) => {
    const state = lessonState.get(address);
    if (!state) throw new Error(`SchoolCalc install set references unprojected lesson '${address}'`);
    return { address, ...state };
  });
  const compatible = members.every((member) => member.compatible);
  const reasons = [...new Set(members.flatMap((member) => (
    member.reasons.map((reason) => `${member.address}: ${reason}`)
  )))];
  const knownSizes = members.every((member) => Number.isSafeInteger(member.byteLength));
  const artifactIds = members.map((member) => member.artifactId).filter(Boolean);
  const requiredCapabilities = [...new Set(members.flatMap((member) => member.requiredCapabilities))].sort();
  const learnerKeySets = members.map((member) => new Set(member.access.learnerKeys));
  const learnerKeys = [...(learnerKeySets[0] ?? new Set())]
    .filter((key) => learnerKeySets.every((set) => set.has(key)));
  return {
    ...nodeHeader(definition, 'installSetId'),
    versionId: `sha256:${stableRecordDigest({
      installSetId: definition.installSetId,
      members: definition.lessonAddresses.map((address) => ({ address, sourceDigest: bundleDigests.get(address) })),
    })}`,
    lessonAddresses: [...definition.lessonAddresses],
    artifactCount: members.length,
    artifactIds,
    byteLength: knownSizes ? members.reduce((sum, member) => sum + member.byteLength, 0) : null,
    compatible,
    reasons,
    requiredCapabilities,
    access: {
      learnerKeys,
      guest: members.every((member) => member.access.guest === true),
    },
    state: installSetState(members, compatible),
    members: members.map((member) => ({
      address: member.address,
      state: member.state,
      artifactId: member.artifactId,
      byteLength: member.byteLength,
    })),
  };
}

function buildAccessIndex({ access, bindings, lessons }) {
  if (!access || !Array.isArray(access.learners) || !Array.isArray(access.guest?.lessonAddresses)) {
    throw new Error('SchoolCalc Catalog access policy returned an invalid projection');
  }
  const knownAddresses = new Set(lessons.map(({ address }) => address));
  const keyByLearner = new Map(bindings.map(({ learnerId, learnerKey }) => [learnerId, learnerKey]));
  if (new Set(access.learners.map(({ learnerId }) => learnerId)).size !== access.learners.length
      || access.learners.length !== bindings.length
      || access.learners.some(({ learnerId, lessonAddresses }) => (
        !keyByLearner.has(learnerId) || !validAddressList(lessonAddresses, knownAddresses)
      ))
      || !validAddressList(access.guest.lessonAddresses, knownAddresses)) {
    throw new Error('SchoolCalc Catalog access policy returned inconsistent learners or lessons');
  }
  const index = new Map(lessons.map(({ address }) => [address, { learnerKeys: [], guest: false }]));
  access.learners.forEach(({ learnerId, lessonAddresses }) => {
    const learnerKey = keyByLearner.get(learnerId);
    lessonAddresses.forEach((address) => index.get(address).learnerKeys.push(learnerKey));
  });
  access.guest.lessonAddresses.forEach((address) => { index.get(address).guest = true; });
  return new Map([...index].map(([address, entry]) => [address, Object.freeze({
    learnerKeys: Object.freeze(entry.learnerKeys.sort((left, right) => left - right)),
    guest: entry.guest,
  })]));
}

function validAddressList(addresses, known) {
  return Array.isArray(addresses)
    && new Set(addresses).size === addresses.length
    && addresses.every((address) => known.has(address));
}

function installSetState(members, compatible) {
  if (!compatible) return 'incompatible';
  if (members.every(({ state }) => state === 'installed')) return 'installed';
  if (members.some(({ state }) => state === 'update_available')) return 'update_available';
  if (members.every(({ state }) => state === 'installed' || state === 'requested')
    && members.some(({ state }) => state === 'requested')) return 'requested';
  return 'available';
}

function nodeHeader(node, idField) {
  return Object.fromEntries([idField, 'title', 'shortTitle', 'description', 'estimatedMinutes', 'tags']
    .filter((field) => node[field] !== undefined)
    .map((field) => [field, structuredClone(node[field])]));
}

export default GetSchoolCalcCatalog;
