import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/** Compile on demand through the enrolled platform adapter, then persist once. */
export class BuildSchoolCalcArtifact {
  #devices; #codecs; #bundles; #artifacts; #actions;

  constructor({ devices, codecs, bundles, artifacts, actions = null } = {}) {
    if (!devices || !codecs || !bundles || !artifacts) {
      throw new Error('BuildSchoolCalcArtifact requires devices, codecs, bundles, and artifacts');
    }
    this.#devices = devices;
    this.#codecs = codecs;
    this.#bundles = bundles;
    this.#artifacts = artifacts;
    this.#actions = actions;
  }

  async execute({ deviceId, address } = {}) {
    const device = await this.#devices.getDevice(deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', deviceId);
    if (!device.capabilityReport) throw new Error(`SchoolCalc device '${deviceId}' must be observed before compilation`);
    const location = parseLessonAddress(address);
    const bundle = await this.#bundles.execute(location);
    const codec = this.#codecs.get(device.platformId);
    const support = codec.supports(bundle, device.capabilityReport);
    if (!support.compatible) {
      throw new Error(`SchoolCalc lesson is incompatible with '${deviceId}': ${support.reasons.join('; ')}`);
    }
    const needsActions = bundle.lesson.modules.some((module) => (
      module.type === 'lecture_notes'
      && module.document?.blocks?.some((block) => block.type === 'scan_action')
    ));
    if (needsActions && !this.#actions) {
      throw new Error('SchoolCalc lesson actions require a configured action-token issuer');
    }
    const runtimeBundle = needsActions
      ? (await this.#actions.execute({ deviceId, bundle })).bundle
      : bundle;
    const compiled = await codec.compile(runtimeBundle, device.capabilityReport, { sourceBundle: bundle });
    if (compiled.platformId !== device.platformId) {
      throw new Error(`SchoolCalc codec '${device.platformId}' emitted platform '${compiled.platformId}'`);
    }
    const artifact = {
      ...compiled,
      interpretation: {
        schema: 'school.calc.artifact-interpretation/v1',
        // Grading and current-source comparison use authored pedagogical
        // meaning, never the device-bound presentation token.
        bundle: structuredClone(bundle),
      },
    };
    const stored = await this.#artifacts.putArtifact(artifact);
    return stored ?? artifact;
  }
}

export function parseLessonAddress(address) {
  if (typeof address !== 'string') throw new Error('SchoolCalc lesson address is required');
  const parts = address.split('/');
  if (parts.length !== 5 || parts.some((part) => !part)) {
    throw new Error('SchoolCalc lesson address must contain catalog/subject/course/unit/lesson IDs');
  }
  const [catalogId, subjectId, courseId, unitId, lessonId] = parts;
  return { catalogId, subjectId, courseId, unitId, lessonId };
}

export default BuildSchoolCalcArtifact;
