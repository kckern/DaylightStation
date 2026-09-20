const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nullableNumber = value => value == null || Number.isFinite(value);
const nullableText = value => value == null || (typeof value === 'string' && value.trim());
const copy = value => Array.isArray(value)
  ? value.map(copy)
  : isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;

function requireObject(value, field) {
  if (!isObject(value)) throw new TypeError(`${field} must be an object`);
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
}

function exactKeys(value, keys, field) {
  requireObject(value, field);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`${field} has unsupported field ${key}`);
}

function required(value, keys, field) {
  exactKeys(value, keys, field);
  for (const key of keys) if (!(key in value) || value[key] === undefined) throw new TypeError(`${field}.${key} is required`);
}

function nullableMeasurements(value, keys, field) {
  for (const key of keys) if (!nullableNumber(value[key])) throw new TypeError(`${field}.${key} must be a finite number or null`);
}

function nullableTexts(value, keys, field) {
  for (const key of keys) if (!nullableText(value[key])) throw new TypeError(`${field}.${key} must be a non-empty string or null`);
}

function validateCapability(capability) {
  exactKeys(capability, ['codec', 'profiles', 'bitDepths', 'hdr', 'layouts', 'maxChannels'], 'supportedCodecs[]');
  requireText(capability.codec, 'supportedCodecs[].codec');
  for (const key of ['profiles', 'hdr', 'layouts']) {
    if (capability[key] !== undefined && (!Array.isArray(capability[key]) || capability[key].some(value => !nullableText(value) || value == null))) throw new TypeError(`supportedCodecs[].${key} must be text`);
  }
  if (capability.bitDepths !== undefined && (!Array.isArray(capability.bitDepths) || capability.bitDepths.some(value => !Number.isFinite(value)))) throw new TypeError('supportedCodecs[].bitDepths must be numbers');
  if (capability.maxChannels !== undefined && (!Number.isFinite(capability.maxChannels) || capability.maxChannels < 0)) throw new TypeError('supportedCodecs[].maxChannels must be non-negative');
}

/** Validates and defensively copies normalized renderer facts. */
export function validateClient(client) {
  required(client, ['profileKey', 'renderer', 'evidenceVersion', 'supportedFormats', 'supportedCodecs', 'maxWidth', 'maxHeight', 'maxFrameRate'], 'client');
  for (const field of ['profileKey', 'renderer', 'evidenceVersion']) requireText(client[field], field);
  if (!Array.isArray(client.supportedFormats) || client.supportedFormats.some(format => !nullableText(format) || format == null)) throw new TypeError('supportedFormats must be text');
  if (!Array.isArray(client.supportedCodecs)) throw new TypeError('supportedCodecs must be an array');
  client.supportedCodecs.forEach(validateCapability);
  nullableMeasurements(client, ['maxWidth', 'maxHeight', 'maxFrameRate'], 'client');
  return copy(client);
}

export function validateTrackSelection(tracks) {
  required(tracks, ['audioId', 'subtitleId', 'subtitlesRequired'], 'tracks');
  nullableTexts(tracks, ['audioId', 'subtitleId'], 'tracks');
  if (typeof tracks.subtitlesRequired !== 'boolean') throw new TypeError('tracks.subtitlesRequired must be boolean');
  return copy(tracks);
}

function validateVideo(video) {
  if (video === null) return;
  required(video, ['codec', 'profile', 'level', 'bitDepth', 'width', 'height', 'frameRate', 'hdr'], 'video');
  requireText(video.codec, 'video.codec');
  nullableTexts(video, ['profile', 'level', 'hdr'], 'video');
  nullableMeasurements(video, ['bitDepth', 'width', 'height', 'frameRate'], 'video');
}

function validateAudio(audio) {
  if (audio === null) return;
  required(audio, ['codec', 'channels', 'layout', 'language'], 'audio');
  requireText(audio.codec, 'audio.codec');
  nullableTexts(audio, ['layout', 'language'], 'audio');
  nullableMeasurements(audio, ['channels'], 'audio');
}

/** Validates and defensively copies a provider-neutral rendition description. */
export function validateRendition(rendition) {
  required(rendition, ['renditionId', 'sourceRevision', 'format', 'video', 'audio', 'subtitles', 'trackSelection', 'conversion', 'ready', 'resourceClass', 'estimatedUnits'], 'rendition');
  for (const field of ['renditionId', 'sourceRevision', 'format', 'resourceClass']) requireText(rendition[field], field);
  validateVideo(rendition.video);
  validateAudio(rendition.audio);
  if (!Array.isArray(rendition.subtitles)) throw new TypeError('subtitles must be an array');
  rendition.subtitles.forEach(subtitle => {
    required(subtitle, ['id', 'language', 'format'], 'subtitles[]');
    for (const field of ['id', 'language', 'format']) requireText(subtitle[field], `subtitles[].${field}`);
  });
  validateTrackSelection(rendition.trackSelection);
  if (rendition.conversion !== null && !['remux', 'transcode'].includes(rendition.conversion)) throw new TypeError('conversion must be null, remux, or transcode');
  if (typeof rendition.ready !== 'boolean') throw new TypeError('ready must be boolean');
  if (!Number.isFinite(rendition.estimatedUnits) || rendition.estimatedUnits < 0) throw new TypeError('estimatedUnits must be a non-negative finite number');
  return copy(rendition);
}

function validateReadiness(readiness) {
  required(readiness, ['renditionId', 'sourceRevision', 'profileKey', 'status', 'observedAt'], 'readiness[]');
  for (const field of ['renditionId', 'sourceRevision', 'profileKey']) requireText(readiness[field], `readiness[].${field}`);
  if (!['unknown', 'preparing', 'validated', 'unavailable'].includes(readiness.status)) throw new TypeError('readiness[].status is invalid');
  if (!Number.isFinite(readiness.observedAt)) throw new TypeError('readiness[].observedAt must be a finite timestamp');
}

export function validateEvidence(evidence = {}) {
  exactKeys(evidence, ['assessmentTriggered', 'negativeRenditionIds', 'readiness'], 'evidence');
  if (evidence.assessmentTriggered !== undefined && typeof evidence.assessmentTriggered !== 'boolean') throw new TypeError('assessmentTriggered must be boolean');
  if (evidence.negativeRenditionIds !== undefined && (!Array.isArray(evidence.negativeRenditionIds) || evidence.negativeRenditionIds.some(id => !nullableText(id) || id == null))) throw new TypeError('negativeRenditionIds must be text');
  if (evidence.readiness !== undefined) {
    if (!Array.isArray(evidence.readiness)) throw new TypeError('readiness must be an array');
    evidence.readiness.forEach(validateReadiness);
  }
  return copy(evidence);
}

export function validateCapacity(capacity) {
  required(capacity, ['availableUnits', 'probeAvailable'], 'capacity');
  if (!Number.isFinite(capacity.availableUnits) || capacity.availableUnits < 0) throw new TypeError('availableUnits must be a non-negative finite number');
  if (typeof capacity.probeAvailable !== 'boolean') throw new TypeError('probeAvailable must be boolean');
  return copy(capacity);
}

/** A missing or malformed active rendition is deliberately not replacement-safe. */
export function normalizeActiveRenditionId(activeRenditionId) {
  return typeof activeRenditionId === 'string' && activeRenditionId.trim() ? activeRenditionId : null;
}

export function validateObservation(observation) {
  required(observation, ['intentId', 'attemptId', 'generation', 'sequence', 'observedAt', 'positionMs', 'paused', 'seeking', 'visible', 'decodedFrames', 'bufferSeconds', 'productionRate', 'deliveryRate', 'failure'], 'observation');
  for (const field of ['intentId', 'attemptId']) requireText(observation[field], field);
  for (const field of ['generation', 'sequence']) if (!Number.isInteger(observation[field]) || observation[field] < 0) throw new TypeError(`${field} must be a non-negative integer`);
  if (!Number.isFinite(observation.observedAt)) throw new TypeError('observedAt must be a finite timestamp');
  nullableMeasurements(observation, ['positionMs', 'decodedFrames', 'bufferSeconds', 'productionRate', 'deliveryRate'], 'observation');
  for (const field of ['paused', 'seeking', 'visible']) if (typeof observation[field] !== 'boolean') throw new TypeError(`${field} must be boolean`);
  if (observation.failure !== null) {
    required(observation.failure, ['kind'], 'failure');
    if (!['access-expired', 'decoder', 'network', 'provider', 'unknown'].includes(observation.failure.kind)) throw new TypeError('failure.kind is invalid');
  }
  return copy(observation);
}

/** Validates and defensively copies persisted, provider-neutral recovery state. */
export function validateRecoveryLedger(ledger) {
  required(ledger, ['incidentCount', 'replacementTimes', 'healthySince', 'lastReplacementAt'], 'ledger');
  if (!Number.isInteger(ledger.incidentCount) || ledger.incidentCount < 0) throw new TypeError('incidentCount must be a non-negative integer');
  if (!Array.isArray(ledger.replacementTimes) || ledger.replacementTimes.some(at => !Number.isFinite(at))) throw new TypeError('replacementTimes must be finite timestamps');
  nullableMeasurements(ledger, ['healthySince', 'lastReplacementAt'], 'ledger');
  return copy(ledger);
}
