import { validateCapacity, validateClient, validateEvidence, validateRendition, validateTrackSelection } from './contracts.mjs';

const normalized = value => String(value || '').toLowerCase();
const includes = (values, value) => !Array.isArray(values) || values.map(normalized).includes(normalized(value));
const exceeds = (value, limit) => Number.isFinite(value) && Number.isFinite(limit) && value > limit;

function explicitlyIncompatible(rendition, client, tracks, evidence) {
  if (rendition.ready === false || evidence.negativeRenditionIds?.includes(rendition.renditionId)) return 'format';
  if ((evidence.readinessByRendition?.[rendition.renditionId] || evidence.readiness) === 'unavailable') return 'format';
  if (!includes(client.supportedFormats, rendition.format)) return 'format';

  const video = rendition.video;
  if (video) {
    if (!includes(client.supportedCodecs, video.codec)) return 'format';
    const profiles = client.supportedProfiles?.[normalized(video.codec)] || client.supportedProfiles?.[video.codec];
    if (video.profile && Array.isArray(profiles) && !includes(profiles, video.profile)) return 'format';
    const bitDepths = client.supportedBitDepths?.[normalized(video.codec)] || client.supportedBitDepths?.[video.codec];
    if (Number.isFinite(video.bitDepth) && Array.isArray(bitDepths) && !bitDepths.includes(video.bitDepth)) return 'format';
    if (exceeds(video.width, client.maxWidth) || exceeds(video.height, client.maxHeight) || exceeds(video.frameRate, client.maxFrameRate)) return 'format';
    if (video.hdr && normalized(video.hdr) !== 'sdr' && Array.isArray(client.supportedHdr) && !includes(client.supportedHdr, video.hdr)) return 'format';
  }

  const audio = rendition.audio;
  if (audio) {
    if (!includes(client.supportedCodecs, audio.codec)) return 'format';
    if (audio.layout && Array.isArray(client.supportedAudioLayouts) && !includes(client.supportedAudioLayouts, audio.layout)) return 'format';
    if (Number.isFinite(audio.channels) && Number.isFinite(client.maxAudioChannels) && audio.channels > client.maxAudioChannels) return 'format';
  }

  if (tracks.audioId && rendition.trackSelection?.audioId && tracks.audioId !== rendition.trackSelection.audioId) return 'tracks';
  const requestedSubtitle = tracks.subtitleId;
  const hasSubtitle = !requestedSubtitle || rendition.subtitles.some(subtitle => subtitle?.id === requestedSubtitle);
  if ((tracks.subtitlesRequired || requestedSubtitle) && !hasSubtitle) return 'tracks';
  return null;
}

function score(rendition, evidence) {
  const readiness = evidence.readinessByRendition?.[rendition.renditionId] || evidence.readiness;
  const validated = readiness === 'validated' ? 0 : 1;
  const conversion = rendition.conversion ? 1 : 0;
  return [validated, conversion, rendition.estimatedUnits, rendition.renditionId];
}

function compare(left, right) {
  const a = score(left.rendition, left.evidence);
  const b = score(right.rendition, right.evidence);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

/**
 * Chooses only among normalized facts. Unknown ordinary-playback facts remain
 * eligible; after assessment, an unknown candidate needs an admitted probe.
 */
export function selectRendition({ candidates = [], client, tracks = {}, evidence = {}, capacity = {} }) {
  const profile = validateClient(client);
  const selection = validateTrackSelection(tracks);
  const assessed = validateEvidence(evidence);
  const admission = validateCapacity(capacity);
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');

  let sawTrackConflict = false;
  const compatible = candidates.map(validateRendition).filter(rendition => {
    const conflict = explicitlyIncompatible(rendition, profile, selection, assessed);
    sawTrackConflict ||= conflict === 'tracks';
    return conflict == null;
  });
  if (!compatible.length) return { kind: 'prepare', reason: sawTrackConflict ? 'required-tracks-unavailable' : 'no-compatible-rendition' };

  const admitted = compatible.filter(rendition => rendition.estimatedUnits <= (admission.availableUnits ?? Infinity));
  if (!admitted.length) return { kind: 'prepare', reason: 'capacity-unavailable' };
  const selectable = admitted.filter(rendition => {
    const readiness = assessed.readinessByRendition?.[rendition.renditionId] || assessed.readiness;
    return assessed.assessmentTriggered !== true || readiness === 'validated' || admission.probeAvailable === true;
  });
  if (!selectable.length) {
    return { kind: 'prepare', reason: 'assessment-capacity-unavailable' };
  }
  return { kind: 'selected', renditionId: selectable.map(rendition => ({ rendition, evidence: assessed })).sort(compare)[0].rendition.renditionId };
}

export default selectRendition;
