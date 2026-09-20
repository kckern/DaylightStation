const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNullableNumber = value => value == null || Number.isFinite(value);
const copy = value => Array.isArray(value)
  ? value.map(copy)
  : isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
}

function requireObject(value, field) {
  if (!isObject(value)) throw new TypeError(`${field} must be an object`);
}

function optionalMeasurement(object, fields) {
  for (const field of fields) {
    if (!isNullableNumber(object[field])) throw new TypeError(`${field} must be a finite number or null`);
  }
}

/** Validates and defensively copies normalized renderer facts. */
export function validateClient(client) {
  requireObject(client, 'client');
  requireText(client.profileKey, 'profileKey');
  for (const field of ['supportedFormats', 'supportedCodecs']) {
    if (!Array.isArray(client[field])) throw new TypeError(`${field} must be an array`);
  }
  optionalMeasurement(client, ['maxWidth', 'maxHeight', 'maxFrameRate']);
  return copy(client);
}

/** Validates and defensively copies a provider-neutral rendition description. */
export function validateRendition(rendition) {
  requireObject(rendition, 'rendition');
  requireText(rendition.renditionId, 'renditionId');
  requireText(rendition.sourceRevision, 'sourceRevision');
  requireText(rendition.format, 'format');
  if (rendition.video != null) {
    requireObject(rendition.video, 'video');
    requireText(rendition.video.codec, 'video.codec');
    optionalMeasurement(rendition.video, ['bitDepth', 'width', 'height', 'frameRate']);
  }
  if (rendition.audio != null) {
    requireObject(rendition.audio, 'audio');
    requireText(rendition.audio.codec, 'audio.codec');
    optionalMeasurement(rendition.audio, ['channels']);
  }
  if (!Array.isArray(rendition.subtitles)) throw new TypeError('subtitles must be an array');
  if (!Number.isFinite(rendition.estimatedUnits) || rendition.estimatedUnits < 0) throw new TypeError('estimatedUnits must be a non-negative finite number');
  return copy(rendition);
}

export function validateTrackSelection(tracks = {}) {
  requireObject(tracks, 'tracks');
  if (tracks.subtitlesRequired !== undefined && typeof tracks.subtitlesRequired !== 'boolean') throw new TypeError('subtitlesRequired must be boolean');
  return copy(tracks);
}

export function validateEvidence(evidence = {}) {
  requireObject(evidence, 'evidence');
  if (evidence.negativeRenditionIds !== undefined && !Array.isArray(evidence.negativeRenditionIds)) throw new TypeError('negativeRenditionIds must be an array');
  return copy(evidence);
}

export function validateCapacity(capacity = {}) {
  requireObject(capacity, 'capacity');
  if (capacity.availableUnits !== undefined && (!Number.isFinite(capacity.availableUnits) || capacity.availableUnits < 0)) throw new TypeError('availableUnits must be a non-negative finite number');
  return copy(capacity);
}

/** Validates and defensively copies persisted, provider-neutral recovery state. */
export function validateRecoveryLedger(ledger) {
  requireObject(ledger, 'ledger');
  if (!Number.isInteger(ledger.incidentCount) || ledger.incidentCount < 0) throw new TypeError('incidentCount must be a non-negative integer');
  if (!Array.isArray(ledger.replacementTimes) || ledger.replacementTimes.some(at => !Number.isFinite(at))) throw new TypeError('replacementTimes must be finite timestamps');
  for (const field of ['healthySince', 'lastReplacementAt']) {
    if (!isNullableNumber(ledger[field])) throw new TypeError(`${field} must be a finite timestamp or null`);
  }
  return copy(ledger);
}
