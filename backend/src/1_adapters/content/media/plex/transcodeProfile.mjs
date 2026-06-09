/**
 * Pure transcode-profile helpers for PlexAdapter.
 *
 * The June 8 incident was a forced 1080p60 / 20 Mbit/s software libx264
 * transcode of an already-h264 source that fell behind realtime. These caps
 * keep the encoder ahead of realtime. The codec advertisement (h264,hevc) and
 * directPlay=0 default from the May 18 mitigation are preserved by the caller.
 */

export const DEFAULT_MAX_VIDEO_BITRATE = 8000; // kbps — was uncapped (~20000 from source)
export const DEFAULT_MAX_RESOLUTION = '1080';  // do not upscale beyond 1080p
export const DEFAULT_MAX_FRAME_RATE = 30;      // was 60 from source — halves encoder load

/**
 * Resolve the effective transcode caps. Explicit values lower the ceiling but
 * never raise it above the defaults (we only ever cap, never amplify).
 * @param {{maxVideoBitrate?:number, maxResolution?:string, maxFrameRate?:number}} opts
 */
export function resolveTranscodeCaps(opts = {}) {
  const reqBitrate = Number(opts.maxVideoBitrate);
  const maxVideoBitrate = Number.isFinite(reqBitrate)
    ? Math.min(reqBitrate, DEFAULT_MAX_VIDEO_BITRATE)
    : DEFAULT_MAX_VIDEO_BITRATE;

  const maxResolution = opts.maxResolution ? String(opts.maxResolution) : DEFAULT_MAX_RESOLUTION;

  const reqFps = Number(opts.maxFrameRate);
  const maxFrameRate = Number.isFinite(reqFps)
    ? Math.min(reqFps, DEFAULT_MAX_FRAME_RATE)
    : DEFAULT_MAX_FRAME_RATE;

  return { maxVideoBitrate, maxResolution, maxFrameRate };
}

const CODEC_ADVERT = 'append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=h264,hevc&audioCodec=aac&protocol=dash)';

/**
 * Build the X-Plex-Client-Profile-Extra value: the existing codec advertisement
 * plus an optional frame-rate upper-bound limitation, '+'-joined.
 * @param {{maxFrameRate?:number}} opts
 */
export function buildClientProfileExtra(opts = {}) {
  const clauses = [CODEC_ADVERT];
  const fps = Number(opts.maxFrameRate);
  if (Number.isFinite(fps) && fps > 0) {
    clauses.push(`add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.frameRate&value=${fps})`);
  }
  return clauses.join('+');
}

/**
 * Tight direct-play gate. Only h264 video + aac audio in an mp4 container both
 * at the Media and Part level qualify. Everything else (vp9, av1, hevc-in-mkv,
 * ac3 audio, …) stays on the forced-transcode path so the MSE/SourceBuffer
 * codec-mismatch crash (see 2026-05-18 audit) cannot recur.
 * @param {{Media?: Array}} metadata - the Plex item metadata
 */
export function canDirectPlayH264(metadata) {
  const media = metadata?.Media?.[0];
  if (!media) return false;
  const part = media.Part?.[0];
  const norm = (v) => String(v ?? '').toLowerCase();
  return norm(media.videoCodec) === 'h264'
    && norm(media.audioCodec) === 'aac'
    && norm(media.container) === 'mp4'
    && norm(part?.container || media.container) === 'mp4';
}
