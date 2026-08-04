import path from 'node:path';
import { ISchoolCalcDeviceRepository } from '#apps/school/ports/ISchoolCalcDeviceRepository.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import { SchoolCalcDevice } from '#domains/school/schoolcalc/index.mjs';
import { loadYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/** YAML-backed enrolled-device aggregate repository with optimistic revisions. */
export class YamlSchoolCalcDeviceRepository extends ISchoolCalcDeviceRepository {
  #directory; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) throw new Error('YamlSchoolCalcDeviceRepository requires directory');
    this.#directory = directory;
    this.#io = { load: io.load ?? loadYamlFromPath, save: io.save ?? saveYamlToPathAtomic };
  }

  async getDevice(deviceId) {
    if (!SAFE_ID.test(deviceId || '')) return null;
    const state = this.#io.load(this.#path(deviceId));
    return state ? SchoolCalcDevice.restore(state) : null;
  }

  async findByCompactId(compactId) { return this.getDevice(compactId); }

  async saveDevice(device, { expectedRevision = null } = {}) {
    const operation = this.#writeChain.then(async () => {
      if (!device || !SAFE_ID.test(device.deviceId || '')) throw new Error('SchoolCalc device has an unsafe deviceId');
      const current = await this.getDevice(device.deviceId);
      if (expectedRevision === null && current) {
        throw new DomainInvariantError(`SchoolCalc device '${device.deviceId}' already exists`, {
          code: 'SCHOOLCALC_DEVICE_ALREADY_EXISTS',
        });
      }
      if (expectedRevision !== null && current?.revision !== expectedRevision) {
        throw new DomainInvariantError(`SchoolCalc device '${device.deviceId}' revision conflict`, {
          code: 'SCHOOLCALC_DEVICE_REVISION_CONFLICT',
          details: { expectedRevision, actualRevision: current?.revision ?? null },
        });
      }
      this.#io.save(this.#path(device.deviceId), serializeDevice(device), { noRefs: true });
      return device;
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #path(deviceId) { return path.join(this.#directory, `${deviceId}.yml`); }
}

function serializeDevice(device) {
  return {
    deviceId: device.deviceId,
    label: device.label,
    platformId: device.platformId,
    catalogId: device.catalogId,
    createdAt: device.createdAt,
    lastObservedAt: device.lastObservedAt,
    lastRelayId: device.lastRelayId,
    capabilityReport: device.capabilityReport,
    installedArtifactIds: device.installedArtifactIds,
    desiredArtifactIds: device.desiredArtifactIds,
    deliveryRequests: device.deliveryRequests,
    learnerBindings: device.learnerBindings,
    revision: device.revision,
    hasObserved: device.hasObserved,
  };
}

export default YamlSchoolCalcDeviceRepository;
