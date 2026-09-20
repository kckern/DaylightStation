// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { selectRendition } from './selectRendition.mjs';
import { admittedCapacity, assessment, client, noProbeCapacity, original, tracks } from '../../../../../tests/fixtures/adaptive-playback/policyCases.mjs';

describe('selectRendition', () => {
  it.each([
    ['keeps ordinary playback optimistic when bit depth is unknown', { ...original, video: { ...original.video, bitDepth: null } }, {}, admittedCapacity, { kind: 'selected', renditionId: 'original-h264' }],
    ['rejects an exact unsupported codec profile', { ...original, video: { ...original.video, profile: 'main' } }, {}, admittedCapacity, { kind: 'prepare', reason: 'no-compatible-rendition' }],
    ['permits 60fps passthrough when the client admits it', { ...original, video: { ...original.video, frameRate: 60 } }, {}, admittedCapacity, { kind: 'selected', renditionId: 'original-h264' }],
    ['keeps ordinary playback optimistic when AAC layout is unknown', { ...original, audio: { ...original.audio, layout: null } }, {}, admittedCapacity, { kind: 'selected', renditionId: 'original-h264' }],
    ['does not silently lose required subtitles', { ...original, subtitles: [], trackSelection: { ...tracks, subtitleId: 'english-subtitles', subtitlesRequired: true } }, {}, admittedCapacity, { kind: 'prepare', reason: 'required-tracks-unavailable' }],
    ['rejects incompatible HDR', { ...original, video: { ...original.video, hdr: 'pq' } }, {}, admittedCapacity, { kind: 'prepare', reason: 'no-compatible-rendition' }],
    ['rejects only the candidate named by explicit negative evidence', original, { negativeRenditionIds: ['original-h264'] }, admittedCapacity, { kind: 'prepare', reason: 'no-compatible-rendition' }],
    ['uses unavailable readiness only in the candidate source and client scope', original, { readiness: [{ renditionId: 'original-h264', sourceRevision: 'revision-1', profileKey: 'living-room-browser', status: 'unavailable', observedAt: 1000 }] }, admittedCapacity, { kind: 'prepare', reason: 'no-compatible-rendition' }],
    ['requires capacity for an unknown candidate after assessment triggers', original, assessment, noProbeCapacity, { kind: 'prepare', reason: 'assessment-capacity-unavailable' }],
  ])('%s', (_name, candidate, evidence, capacity, expected) => {
    expect(selectRendition({ candidates: [candidate], client, tracks: candidate.trackSelection || tracks, evidence, capacity })).toEqual(expected);
  });

  it('ranks a compatible original ahead of an equally compatible conversion', () => {
    const conversion = { ...original, renditionId: 'converted-h264', conversion: 'transcode', resourceClass: 'encoder', estimatedUnits: 1 };
    expect(selectRendition({ candidates: [conversion, original], client, tracks, evidence: {}, capacity: admittedCapacity }))
      .toEqual({ kind: 'selected', renditionId: 'original-h264' });
  });

  it('does not require probe capacity for an already validated assessed rendition', () => {
    expect(selectRendition({ candidates: [original], client, tracks,
      evidence: { assessmentTriggered: true, readiness: [{ renditionId: 'original-h264', sourceRevision: 'revision-1', profileKey: 'living-room-browser', status: 'validated', observedAt: 1000 }] }, capacity: noProbeCapacity }))
      .toEqual({ kind: 'selected', renditionId: 'original-h264' });
  });

  it('keeps mismatched readiness scope unknown and requires probe capacity after assessment', () => {
    expect(selectRendition({ candidates: [original], client, tracks,
      evidence: { assessmentTriggered: true, readiness: [{ renditionId: 'original-h264', sourceRevision: 'another-revision', profileKey: 'another-profile', status: 'validated', observedAt: 1000 }] }, capacity: noProbeCapacity }))
      .toEqual({ kind: 'prepare', reason: 'assessment-capacity-unavailable' });
  });

  it('does not select a candidate that cannot confirm the requested audio track', () => {
    expect(selectRendition({ candidates: [{ ...original, trackSelection: { ...original.trackSelection, audioId: null } }], client,
      tracks, evidence: {}, capacity: admittedCapacity })).toEqual({ kind: 'prepare', reason: 'required-tracks-unavailable' });
  });
});
