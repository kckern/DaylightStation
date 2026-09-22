/**
 * Pieces in, one recording out.
 *
 * A take said in pieces is still ONE recording to everything downstream —
 * review, playback on the shelf, credit — so the pieces are joined on the
 * tablet into a single file before upload. WebM chunks from separate
 * MediaRecorder sessions cannot simply be concatenated (each carries its own
 * header), so each piece is decoded, resampled to one rate and written out as
 * plain 16-bit WAV: no encoder needed, and every browser and the review shelf
 * play it. At 16kHz mono a 15s take is under 0.5MB.
 */

export const JOIN_RATE = 16000;
/** The breath between pieces. Long enough to hear the seam, short enough that
 *  the result still sounds like one sentence. */
export const GAP_MS = 250;

export function concatWithGaps(parts, sampleRate, gapMs = GAP_MS) {
  const gap = Math.round((sampleRate * gapMs) / 1000);
  const length = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const out = new Float32Array(length);
  let at = 0;
  parts.forEach((p, i) => {
    if (i > 0) at += gap;
    out.set(p, at);
    at += p.length;
  });
  return out;
}

export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);              // PCM
  v.setUint16(22, 1, true);              // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);              // block align
  v.setUint16(34, 16, true);             // bits per sample
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Decode one piece and resample it to mono at `sampleRate`. Throws when the
 *  browser has no Web Audio or cannot decode the piece. */
export async function decodeToMono(blob, sampleRate = JOIN_RATE) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new Error('no-web-audio');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const offline = new Offline(1, Math.max(1, Math.ceil(decoded.duration * sampleRate)), sampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

export async function joinTake(blobs, { decode = decodeToMono } = {}) {
  const parts = [];
  for (const blob of blobs) parts.push(await decode(blob, JOIN_RATE));
  return new Blob([encodeWav(concatWithGaps(parts, JOIN_RATE), JOIN_RATE)], { type: 'audio/wav' });
}
