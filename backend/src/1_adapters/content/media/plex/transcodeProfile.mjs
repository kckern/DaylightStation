/**
 * Pure transcode-profile helpers for PlexAdapter.
 *
 * The June 8 incident was a forced 1080p60 / 20 Mbit/s software libx264
 * transcode of an already-h264 source that fell behind realtime. These caps
 * bound encoder work; they do not guarantee realtime throughput under the
 * server's available CPU quota. The codec advertisement (h264,hevc) and
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
 * Plex's audio-in-video limitation. `videoAudioCodec` is the scope that reaches an
 * audio track inside a video session — `audioCodec` is read by nothing there, and
 * Plex went on copying the track (verified against the decision endpoint).
 */
const AUDIO_DOWNMIX_LIMITATION = 'add-limitation(scope=videoAudioCodec&scopeName=aac&type=upperBound&name=audio.channels&value=2)';

/**
 * Build the X-Plex-Client-Profile-Extra value: the existing codec advertisement
 * plus optional limitations, '+'-joined.
 * @param {{maxFrameRate?:number, downmixAudio?:boolean, protocol?:'dash'|'hls'}} opts
 */
export function buildClientProfileExtra(opts = {}) {
  const clauses = [opts.protocol === 'hls'
    ? CODEC_ADVERT.replace('protocol=dash', 'protocol=hls') : CODEC_ADVERT];
  const fps = Number(opts.maxFrameRate);
  if (Number.isFinite(fps) && fps > 0) {
    clauses.push(`add-limitation(scope=videoCodec&scopeName=*&type=upperBound&name=video.frameRate&value=${fps})`);
  }
  if (opts.downmixAudio) clauses.push(AUDIO_DOWNMIX_LIMITATION);
  return clauses.join('+');
}

/**
 * True when the source's audio is multichannel AAC with no standard channel
 * layout — `channel_configuration 0`, the layout carried in a program config
 * element instead of a channel code. Chromium's MP4 parser refuses it, so a
 * stream-COPY of that track fails on the first appended audio segment with
 * `CHUNK_DEMUXER_ERROR_APPEND_FAILED: RunSegmentParserLoop: stream parsing
 * failed` and the video never starts (2026-09-14, plex:697368 — AAC-LC, 6
 * channels, ffprobe `channel_layout=unknown`, Plex "Unknown (AAC 5.1)" with no
 * `audioChannelLayout`). Plex reports the layout for every AAC track it can name,
 * so its absence on a >2-channel track is the signal.
 *
 * Only that track is re-encoded (to stereo AAC, which is cheap); the video is
 * still copied. Multichannel AAC with a named layout is left alone.
 * @param {{Media?: Array}} metadata - the Plex item metadata
 */
export function needsAudioDownmix(metadata) {
  const media = metadata?.Media?.[0];
  const audio = (media?.Part ?? [])
    .flatMap((part) => part?.Stream ?? [])
    .find((stream) => Number(stream?.streamType) === 2 && (stream?.selected ?? true));
  if (!audio) return false;
  if (String(audio.codec ?? '').toLowerCase() !== 'aac') return false;
  if (!(Number(audio.channels) > 2)) return false;
  return !audio.audioChannelLayout;
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
    && norm(part?.container || media.container) === 'mp4'
    && !isHighBitDepthVideo(media)
    && !needsAudioDownmix(metadata);
}

/**
 * True when the source video is >8-bit (HEVC Main 10, H.264 Hi10P). Prefers the
 * video stream's numeric bitDepth and falls back to the profile string, which
 * carries the depth as a trailing token ("main 10", "high 10").
 * @param {object} media - a Plex Media entry
 */
export function isHighBitDepthVideo(media) {
  const videoStream = (media?.Part ?? [])
    .flatMap((part) => part?.Stream ?? [])
    .find((stream) => Number(stream?.streamType) === 1);

  const depth = Number(videoStream?.bitDepth);
  if (Number.isFinite(depth) && depth > 0) return depth > 8;

  const profile = String(media?.videoProfile ?? videoStream?.profile ?? '').toLowerCase();
  return /\b(10|12)\b/.test(profile);
}

/**
 * Video-only direct-stream gate. True when Plex will actually COPY the video
 * track rather than re-encode it. Audio and container mismatches are handled
 * separately (audio is transcoded, container is remuxed). The codec
 * advertisement (h264,hevc only) already prevents AV1/VP9 sources from being
 * direct-streamed regardless of this flag.
 *
 * 10-bit sources are excluded (2026-09-12 incident, Tuttle Twins S03E02
 * plex:663511 — HEVC Main 10, 1080p24, 1972 kbps). We advertise h264,hevc but
 * NOT a 10-bit profile, so Plex cannot copy a Main 10 track to an 8-bit client:
 * it inserts `format=pix_fmts=yuv420p` and re-encodes. Returning true here made
 * the caller DROP the bitrate/resolution/frame-rate caps (they would disqualify
 * a copy) — so the re-encode Plex actually performed ran uncapped at CRF 16 with
 * a 20 Mbps ceiling, ~0.5x realtime in software libx264. Buffer drained 31s -> 0
 * in ~110s, then a 3s-play / 1.7s-stall sawtooth for the rest of the episode.
 * Predicting a copy that will not happen is worse than predicting a transcode:
 * it removes the guardrails AND keeps the cost.
 * @param {{Media?: Array}} metadata - the Plex item metadata
 */
export function canDirectStreamVideo(metadata) {
  const media = metadata?.Media?.[0];
  if (!media) return false;
  const codec = String(media.videoCodec ?? '').toLowerCase();
  if (codec !== 'h264' && codec !== 'hevc') return false;
  // >8-bit cannot be copied to our 8-bit client profile — Plex re-encodes it,
  // so the caps must stay on.
  return !isHighBitDepthVideo(media);
}
