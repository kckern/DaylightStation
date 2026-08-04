import { EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/**
 * Project generic School progress for every active learner binding on a device.
 *
 * The projection deliberately contains all configured learners instead of a
 * single "current user". A calculator may be shared and switched while
 * offline; the local profile key selects one of these snapshots without ever
 * becoming a permanent device assignment. Guest has no durable learner record
 * and is therefore intentionally absent.
 */
export class GetSchoolCalcProgressProjection {
  #devices; #progress; #codecs; #followUps; #logger;

  constructor({ devices, progress, codecs, followUpSources = [], logger = console } = {}) {
    if (!devices || !progress || typeof progress.execute !== 'function' || !codecs) {
      throw new Error('GetSchoolCalcProgressProjection requires devices, progress, and codecs');
    }
    if (!Array.isArray(followUpSources)) {
      throw new Error('GetSchoolCalcProgressProjection followUpSources must be an array');
    }
    this.#devices = devices;
    this.#progress = progress;
    this.#codecs = codecs;
    this.#followUps = followUpSources.filter(Boolean);
    this.#logger = logger;
  }

  async execute({ deviceId } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);

    const profiles = await Promise.all(device.activeLearnerBindings.map(async (binding) => {
      const report = await this.#progress.execute({
        scopeType: 'learner',
        scopeId: binding.learnerId,
        // The application projection remains surface-neutral. A family codec
        // may retain fewer rows to honor its own physical memory contract.
        recentLimit: 5,
        followUpContext: { surface: 'schoolcalc', endpointId: device.deviceId },
      });
      const supplemental = (await Promise.all(this.#followUps.map(async (source) => {
        try {
          const actions = await source.listFollowUps({
            scope: {
              type: 'learner', id: binding.learnerId, label: binding.label,
              learnerIds: [binding.learnerId],
            },
            deliveryContext: { surface: 'schoolcalc', endpointId: device.deviceId },
          });
          return Array.isArray(actions) ? actions : [];
        } catch (error) {
          this.#logger?.error?.('schoolcalc.progress.follow-up-source-failed', {
            deviceId: device.deviceId, learnerId: binding.learnerId,
            error: error.message,
          });
          return [];
        }
      }))).flat();
      return {
        learnerKey: binding.learnerKey,
        learnerId: binding.learnerId,
        label: binding.label,
        summary: structuredClone(report.summary),
        curriculumHistory: structuredClone(report.curriculumHistory),
        recentScores: structuredClone(report.recentScores),
        followUps: mergeFollowUps(report.followUps, supplemental),
      };
    }));

    const withoutGeneration = {
      schema: 'school.calc.progress-projection/v1',
      deviceId: device.deviceId,
      profiles,
    };
    // GetLearningProgress reports its query time, but a refresh with no new
    // evidence must not rewrite calculator flash/RAM. The projection includes
    // only durable learning state in its generation.
    const generation = `sha256:${stableRecordDigest(withoutGeneration)}`;
    const projection = { ...withoutGeneration, generation };
    return {
      ...projection,
      record: this.#codecs.get(device.platformId).encodeProgressProjection(projection),
      deviceRevision: device.revision,
    };
  }
}

function mergeFollowUps(base = [], supplemental = []) {
  const byId = new Map();
  for (const action of [...base, ...supplemental]) {
    if (!action || typeof action.actionId !== 'string' || !action.actionId) continue;
    if (!byId.has(action.actionId)) byId.set(action.actionId, structuredClone(action));
  }
  return [...byId.values()].sort((left, right) => (
    (left.priority ?? 100) - (right.priority ?? 100)
    || left.actionId.localeCompare(right.actionId)
  ));
}

export default GetSchoolCalcProgressProjection;
