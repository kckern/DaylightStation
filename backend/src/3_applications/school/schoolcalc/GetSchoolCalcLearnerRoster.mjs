import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/**
 * Reconcile and project the configured School learner roster for one device.
 * Device-local numeric keys are durable identity bindings, never roster slots.
 */
export class GetSchoolCalcLearnerRoster {
  #devices; #learners; #codecs; #clock;

  constructor({ devices, learners, codecs, clock = () => new Date() } = {}) {
    if (!devices || !learners || typeof learners.listLearners !== 'function' || !codecs) {
      throw new Error('GetSchoolCalcLearnerRoster requires devices, learners, and codecs');
    }
    this.#devices = devices;
    this.#learners = learners;
    this.#codecs = codecs;
    this.#clock = clock;
  }

  async execute({ deviceId } = {}) {
    const current = await this.#devices.getDevice(deviceId);
    if (!current) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    const learners = await this.#learners.listLearners();
    const synchronizedAt = readClock(this.#clock);
    const reconciliation = current.synchronizeLearners({ learners, synchronizedAt });
    const device = reconciliation.device;
    if (reconciliation.changed) {
      await this.#devices.saveDevice(device, { expectedRevision: current.revision });
    }
    return schoolCalcLearnerRosterView(device, this.#codecs.get(device.platformId));
  }
}

export function schoolCalcLearnerRosterView(device, codec) {
  const profiles = device.activeLearnerBindings.map((binding) => ({
    learnerKey: binding.learnerKey,
    learnerId: binding.learnerId,
    label: binding.label,
  }));
  const withoutGeneration = {
    schema: 'school.calc.learner-roster/v1',
    deviceId: device.deviceId,
    profiles,
    guest: { learnerKey: 0, label: 'Guest', persistent: false },
  };
  const generation = `sha256:${stableRecordDigest(withoutGeneration)}`;
  const roster = { ...withoutGeneration, generation };
  return {
    ...roster,
    record: codec.encodeLearnerRoster(roster),
    deviceRevision: device.revision,
  };
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('SchoolCalc learner-roster clock must return a valid Date');
  }
  return value.toISOString();
}

export default GetSchoolCalcLearnerRoster;
