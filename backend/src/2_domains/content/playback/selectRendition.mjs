import { validateCapacity, validateClient, validateEvidence, validateRendition, validateTrackSelection } from './contracts.mjs';

const normalized = value => String(value || '').toLowerCase();
const exceeds = (value, limit) => Number.isFinite(value) && Number.isFinite(limit) && value > limit;
const has = (values, value) => !Array.isArray(values) || values.map(normalized).includes(normalized(value));

function capability(client, codec) {
  return client.supportedCodecs.find(item => normalized(item.codec) === normalized(codec));
}

function readinessFor(evidence, rendition, client) {
  return (evidence.readiness || [])
    .filter(item => item.renditionId === rendition.renditionId
      && item.sourceRevision === rendition.sourceRevision
      && item.profileKey === client.profileKey)
    .sort((left, right) => right.observedAt - left.observedAt)[0]?.status || 'unknown';
}

function incompatible(rendition, client, tracks, evidence) {
  if (rendition.ready === false || evidence.negativeRenditionIds?.includes(rendition.renditionId)) return 'format';
  if (readinessFor(evidence, rendition, client) === 'unavailable') return 'format';
  if (!has(client.supportedFormats, rendition.format)) return 'format';

  if (rendition.video) {
    const video = rendition.video;
    const supported = capability(client, video.codec);
    if (!supported) return 'format';
    if (video.profile && Array.isArray(supported.profiles) && !has(supported.profiles, video.profile)) return 'format';
    if (Number.isFinite(video.bitDepth) && Array.isArray(supported.bitDepths) && !supported.bitDepths.includes(video.bitDepth)) return 'format';
    if (video.hdr && Array.isArray(supported.hdr) && !has(supported.hdr, video.hdr)) return 'format';
    if (exceeds(video.width, client.maxWidth) || exceeds(video.height, client.maxHeight) || exceeds(video.frameRate, client.maxFrameRate)) return 'format';
  }

  if (rendition.audio) {
    const audio = rendition.audio;
    const supported = capability(client, audio.codec);
    if (!supported) return 'format';
    if (audio.layout && Array.isArray(supported.layouts) && !has(supported.layouts, audio.layout)) return 'format';
    if (Number.isFinite(audio.channels) && Number.isFinite(supported.maxChannels) && audio.channels > supported.maxChannels) return 'format';
  }

  if (tracks.audioId && rendition.trackSelection.audioId !== tracks.audioId) return 'tracks';
  if (tracks.subtitleId && (rendition.trackSelection.subtitleId !== tracks.subtitleId
    || !rendition.subtitles.some(subtitle => subtitle.id === tracks.subtitleId))) return 'tracks';
  if (tracks.subtitlesRequired && (!rendition.trackSelection.subtitleId
    || !rendition.subtitles.some(subtitle => subtitle.id === rendition.trackSelection.subtitleId))) return 'tracks';
  return null;
}

function compare(left, right) {
  const rank = rendition => [
    readinessFor(left.evidence, rendition, left.client) === 'validated' ? 0 : 1,
    rendition.conversion ? 1 : 0,
    rendition.estimatedUnits,
    rendition.renditionId,
  ];
  const first = rank(left.rendition);
  const second = rank(right.rendition);
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] < second[index]) return -1;
    if (first[index] > second[index]) return 1;
  }
  return 0;
}

/** Chooses a stable, compatible rendition from provider-neutral normalized facts. */
export function selectRendition({ candidates = [], client, tracks, evidence = {}, capacity }) {
  const profile = validateClient(client);
  const selection = validateTrackSelection(tracks);
  const assessed = validateEvidence(evidence);
  const admission = validateCapacity(capacity);
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');

  let sawTrackConflict = false;
  const compatible = candidates.map(validateRendition).filter(rendition => {
    const reason = incompatible(rendition, profile, selection, assessed);
    sawTrackConflict ||= reason === 'tracks';
    return reason === null;
  });
  if (!compatible.length) return { kind: 'prepare', reason: sawTrackConflict ? 'required-tracks-unavailable' : 'no-compatible-rendition' };

  const admitted = compatible.filter(rendition => rendition.estimatedUnits <= admission.availableUnits);
  if (!admitted.length) return { kind: 'prepare', reason: 'capacity-unavailable' };
  const selectable = admitted.filter(rendition => assessed.assessmentTriggered !== true
    || readinessFor(assessed, rendition, profile) === 'validated'
    || admission.probeAvailable);
  if (!selectable.length) return { kind: 'prepare', reason: 'assessment-capacity-unavailable' };
  return { kind: 'selected', renditionId: selectable.map(rendition => ({ rendition, evidence: assessed, client: profile })).sort(compare)[0].rendition.renditionId };
}

export default selectRendition;
