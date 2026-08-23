import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Reauthorize one SCE1 claim and issue an exact, device-bound SCSP transaction. */
export class ResolveSchoolCalcStudyEntry {
  #studies; #devices; #artifacts; #codec; #clock;

  constructor({ studies, devices, artifacts, codec, clock = () => new Date() } = {}) {
    if (!studies || !devices || !artifacts || !codec?.decodeStudyEntry
        || !codec?.encodeStudyPrescription || !codec?.encodeStudyAcknowledgement || !codec?.writeOrder) {
      throw new Error('ResolveSchoolCalcStudyEntry requires studies, devices, artifacts, and codec');
    }
    this.#studies = studies;
    this.#devices = devices;
    this.#artifacts = artifacts;
    this.#codec = codec;
    this.#clock = clock;
  }

  async execute({ deviceId = null, record } = {}) {
    const entry = this.#codec.decodeStudyEntry(record);
    if (deviceId !== null && entry.deviceId !== deviceId) return recovery('unauthorized', 'NOT AUTHORIZED');
    const device = await this.#devices.getDevice(entry.deviceId);
    if (!device || !device.capabilityReport) return recovery('unauthorized', 'NOT AUTHORIZED');
    const session = await this.#studies.getByCode(entry.sixDigitCode);
    if (!session) return recovery('unknown', 'CODE NOT FOUND');
    if (session.status !== 'open') return recovery('closed', 'SESSION CLOSED');
    const binding = device.activeLearnerBindings?.find(({ learnerId }) => learnerId === session.learnerId) ?? null;
    if (!binding) return recovery('unauthorized', 'NOT AUTHORIZED');
    const artifact = await this.#artifacts.getArtifact(session.artifact.artifactId);
    if (!artifact || !sameArtifact(artifact, session.artifact) || artifact.platformId !== device.platformId) {
      return recovery('incompatible', 'UPDATE SCHOOLCALC');
    }
    const base = {
      schema: 'school.calc.study-prescription/v1',
      deviceId: entry.deviceId,
      requestId: entry.requestId,
      sessionCode: entry.sixDigitCode,
      studySessionId: session.studySessionId,
      learnerKey: binding.learnerKey,
      artifactId: artifact.artifactId,
      artifactVariableName: artifact.variableName,
      artifactByteLength: artifact.byteLength,
      artifactDigest: artifact.byteDigest,
      requiredClientVersion: session.artifact.requiredClientVersion,
      cardCount: session.curation.policy.cardCount,
      itemCount: session.curation.policy.itemCount,
      maxExposuresPerCard: session.curation.policy.maxExposuresPerCard,
      passingPercent: session.curation.policy.passingPercent,
      bankRevision: session.curation.bankRevision,
    };
    const prescriptionId = stableRecordDigest(base).slice(0, 24);
    const prescription = { ...base, prescriptionId };
    const recordBytes = this.#codec.encodeStudyPrescription(prescription);
    const acknowledgement = {
      schema: 'school.calc.study-acknowledgement/v1',
      deviceId: entry.deviceId, requestId: entry.requestId, sessionCode: entry.sixDigitCode,
      prescriptionId, artifactId: artifact.artifactId,
      prescriptionDigest: stableRecordDigest([...recordBytes]),
    };
    const commitRecord = this.#codec.encodeStudyAcknowledgement(acknowledgement);
    const artifactInstalled = device.installedArtifactIds.includes(artifact.artifactId);
    if (!fitsResolution(device.capabilityReport, artifactInstalled ? 0 : artifact.byteLength, recordBytes.length)) {
      return recovery('memory_blocked', 'NOT ENOUGH MEMORY');
    }
    const resolution = {
      deviceId: entry.deviceId, requestId: entry.requestId, learnerKey: binding.learnerKey,
      prescriptionId, resolvedAt: readClock(this.#clock),
    };
    const bound = await this.#studies.bindResolution({ studySessionId: session.studySessionId, resolution });
    if (bound.status === 'unauthorized') return recovery('unauthorized', 'NOT AUTHORIZED');
    if (bound.status === 'closed') return recovery('closed', 'SESSION CLOSED');
    if (!['accepted', 'duplicate'].includes(bound.status)) return recovery('unknown', 'CODE NOT FOUND');
    return {
      status: bound.status === 'duplicate' ? 'duplicate' : 'resolved',
      message: 'STUDY READY',
      acknowledge: {
        deviceId: entry.deviceId, requestId: entry.requestId, sixDigitCode: entry.sixDigitCode,
        prescriptionId, artifactId: artifact.artifactId,
      },
      prescription,
      prescriptionRecord: recordBytes,
      commitRecord,
      artifact: artifactInstalled ? null : artifact,
      artifactInstalled,
      // Which calculator variables to write, and in what order, is family
      // wire-format knowledge — the codec's, not this use case's.
      writeOrder: this.#codec.writeOrder({ artifactInstalled, artifactVariableName: artifact.variableName }),
    };
  }
}

function fitsResolution(report, artifactBytes, prescriptionBytes) {
  const free = report?.limits?.freeBytes;
  if (free === undefined || free === null) return true;
  if (!Number.isSafeInteger(free) || free < 0) return false;
  const reserve = report.limits.reservedFreeBytes ?? 0;
  const overhead = report.limits.variableOverheadBytes ?? 0;
  return artifactBytes + prescriptionBytes + (overhead * (artifactBytes ? 3 : 2)) <= Math.max(0, free - reserve);
}

function recovery(status, message) {
  return { status, message, acknowledge: null, prescription: null, prescriptionRecord: null, commitRecord: null, artifact: null };
}
function sameArtifact(actual, pinned) {
  return actual.artifactId === pinned.artifactId && actual.variableName === pinned.variableName
    && actual.byteLength === pinned.byteLength && actual.byteDigest === pinned.byteDigest;
}
function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) throw new Error('SchoolCalc clock must return Date');
  return value.toISOString();
}

export default ResolveSchoolCalcStudyEntry;
