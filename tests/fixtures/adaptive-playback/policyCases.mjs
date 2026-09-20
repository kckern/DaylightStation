export const client = Object.freeze({
  profileKey: 'living-room-browser', renderer: 'browser', evidenceVersion: 'renderer-1',
  supportedFormats: ['mp4', 'hls'], supportedCodecs: ['h264', 'aac'],
  supportedProfiles: { h264: ['high'] }, maxWidth: 3840, maxHeight: 2160,
  maxFrameRate: 60, supportedHdr: ['sdr'],
});

export const tracks = Object.freeze({ audioId: 'english-aac', subtitleId: null, subtitlesRequired: false });

export const original = Object.freeze({
  renditionId: 'original-h264', sourceRevision: 'revision-1', format: 'mp4',
  video: { codec: 'h264', profile: 'high', level: '4.2', bitDepth: 8, width: 1920, height: 1080, frameRate: 24, hdr: 'sdr' },
  audio: { codec: 'aac', channels: 2, layout: 'stereo', language: 'en' },
  subtitles: [{ id: 'english-subtitles', language: 'en', format: 'webvtt' }],
  trackSelection: { audioId: 'english-aac', subtitleId: null, subtitlesRequired: false },
  conversion: null, ready: true, resourceClass: 'none', estimatedUnits: 0,
});

export const admittedCapacity = Object.freeze({ availableUnits: 2, probeAvailable: true });
export const noProbeCapacity = Object.freeze({ availableUnits: 0, probeAvailable: false });

export const assessment = Object.freeze({ assessmentTriggered: true, readiness: 'unknown', negativeRenditionIds: [] });
