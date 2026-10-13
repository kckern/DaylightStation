const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SCHOOLCALC_DELIVERY_ACTIONS = Object.freeze(['install', 'remove']);

/** Pure request-shape validation; adapter byte limits are checked outside. */
export function validateSchoolCalcDeliveryRequest(raw) {
  if (!isObject(raw)) return { errors: ['SchoolCalc delivery request must be a mapping'] };
  const errors = [];
  if (raw.schema !== 'school.calc.delivery-request/v1') errors.push('schema must be school.calc.delivery-request/v1');
  if (!isText(raw.deviceId)) errors.push('deviceId is required');
  if (!Number.isSafeInteger(raw.requestId) || raw.requestId < 0) errors.push('requestId must be a non-negative safe integer');
  if (!Number.isSafeInteger(raw.learnerKey) || raw.learnerKey < 0 || raw.learnerKey > 0xffff) {
    errors.push('learnerKey must be a 16-bit non-negative integer');
  }
  if (!SCHOOLCALC_DELIVERY_ACTIONS.includes(raw.action)) errors.push('action must be install|remove');

  if (raw.action === 'install') {
    const hasAddress = raw.address !== undefined;
    const hasInstallSet = raw.installSet !== undefined;
    if (hasAddress === hasInstallSet) {
      errors.push('install request must choose exactly one lesson address or installSet');
    } else if (hasAddress && (!isText(raw.address) || raw.address.split('/').length !== 5)) {
      errors.push('install address must contain catalog/subject/course/unit/lesson IDs');
    } else if (hasInstallSet && (!isObject(raw.installSet)
      || !ID.test(raw.installSet.catalogId || '')
      || !ID.test(raw.installSet.installSetId || ''))) {
      errors.push('installSet must contain lowercase catalogId and installSetId');
    }
    if (raw.artifactId !== undefined) errors.push('install request must not choose an artifactId');
    if (raw.artifactIds !== undefined) errors.push('install request must not choose artifactIds');
  }
  if (raw.action === 'remove') {
    const hasArtifact = raw.artifactId !== undefined;
    const hasArtifacts = raw.artifactIds !== undefined;
    if (hasArtifact === hasArtifacts) {
      errors.push('remove request must choose exactly one artifactId or artifactIds');
    } else if (hasArtifact && !isText(raw.artifactId)) {
      errors.push('remove artifactId is required');
    } else if (hasArtifacts && (!Array.isArray(raw.artifactIds)
      || raw.artifactIds.length === 0
      || !raw.artifactIds.every(isText)
      || new Set(raw.artifactIds).size !== raw.artifactIds.length)) {
      errors.push('remove artifactIds must contain unique non-empty IDs');
    }
    if (raw.address !== undefined) errors.push('remove request must not contain an address');
    if (raw.installSet !== undefined) errors.push('remove request must not contain an installSet');
  }

  if (errors.length) return { errors };
  return { errors, request: structuredClone(raw) };
}

/** Request replay decision parallels result replay without conflating them. */
export function classifySchoolCalcDeliveryClaim({ existingDigest = null, incomingDigest }) {
  if (!isText(incomingDigest)) throw new Error('incomingDigest is required');
  if (existingDigest === null || existingDigest === undefined) return 'new';
  return existingDigest === incomingDigest ? 'duplicate' : 'conflict';
}
