/**
 * Pure transcode-profile helpers for PlexAdapter.
 *
 * The June 8 incident was a forced 1080p60 / 20 Mbit/s software libx264
 * transcode of an already-h264 source that fell behind realtime. These caps
 * keep the encoder ahead of realtime. The codec advertisement (h264,hevc) and
 * directPlay=0 default from the May 18 mitigation are preserved by the caller.
 *
 * directStream vs directPlay distinction (June 13):
 * - directPlay=1: serve the original file as-is (no processing at all)
 * - directStream=1: copy streams that match the client profile, transcode those that don't
 * - directStream=0: re-encode everything, even streams that already match
 *
 * The May 18 fix forced directStream=0 to prevent AV1/VP9 sources from being
 * direct-streamed as AV1/VP9 (which MSE cannot append). But the codec
 * advertisement (h264,hevc only) already prevents that: Plex won't
 * direct-stream a codec the client doesn't advertise. So directStream=1 is safe
 * for h264/hevc sources — Plex copies the video track and only transcodes audio,
 * which is far cheaper than re-encoding a matching h264 source.
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
  // Callers pass null for "no preference" and Number(null) === 0, which would
  // send maxVideoBitrate=0 to Plex (= uncapped → CRF16/20Mbit encodes). Only a
  // positive finite value can lower the ceiling.
  const reqBitrate = Number(opts.maxVideoBitrate);
  const maxVideoBitrate = Number.isFinite(reqBitrate) && reqBitrate > 0
    ? Math.min(reqBitrate, DEFAULT_MAX_VIDEO_BITRATE)
    : DEFAULT_MAX_VIDEO_BITRATE;

  const maxResolution = opts.maxResolution ? String(opts.maxResolution) : DEFAULT_MAX_RESOLUTION;

  const reqFps = Number(opts.maxFrameRate);
  const maxFrameRate = Number.isFinite(reqFps) && reqFps > 0
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

/**
 * Video-only direct-stream gate. True when the video codec is h264 or hevc —
 * meaning Plex can copy the video track without re-encoding. Audio and
 * container mismatches are handled separately (audio is transcoded, container
 * is remuxed). The codec advertisement (h264,hevc only) already prevents
 * AV1/VP9 sources from being direct-streamed regardless of this flag.
 * @param {{Media?: Array}} metadata - the Plex item metadata
 */
export function canDirectStreamVideo(metadata) {
  const media = metadata?.Media?.[0];
  if (!media) return false;
  const codec = String(media.videoCodec ?? '').toLowerCase();
  return codec === 'h264' || codec === 'hevc';
}
