/**
 * Track extras a player shows beside the transport: a loudness waveform and the
 * words. Pure functions over what the media server hands back; the routes are
 * /api/v1/track/levels and /api/v1/track/lyrics (TrackExtrasService).
 */

/** The loudness range drawn: -40 dB is an empty bar, 0 dB a full one. */
export const LEVEL_FLOOR_DB = -40;

/**
 * Plex's per-window loudness (dB, from its loudness analysis) as bar heights 0..1,
 * rounded to three places. Non-numbers become 0.
 * @param {Array<number|string>} decibels
 * @returns {number[]}
 */
export function levelsFromDecibels(decibels) {
  return (decibels || []).map((v) => {
    const db = Number(v);
    if (!Number.isFinite(db)) return 0;
    const t = (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB;
    return Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;
  });
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(?:ar|al|ti|au|by|length|offset|re|ve|id|#):[^\]]*\]\s*$/i;
const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

function tagToMs(min, sec, frac) {
  let ms = 0;
  if (frac != null) {
    // .5 = 500 ms, .69 = 690 ms, .123 = 123 ms
    ms = Number(frac.padEnd(3, '0').slice(0, 3));
  }
  return Number(min) * 60_000 + Number(sec) * 1000 + ms;
}

/**
 * Lyrics text as display lines.
 *
 * LRC (time-synced): every `[mm:ss(.xx)]` tag on a line places that line at that
 * time (a chorus written once with three tags appears three times), header tags
 * ([ar:], [au:], [by:] ...) are dropped, an `[offset:+/-ms]` header shifts every
 * time, and a tagged line with no words stays as an empty line (it marks an
 * instrumental gap). Untagged lines inside an LRC file are dropped.
 *
 * Plain text: one line per text line, `ms: null`, runs of blank lines collapsed
 * to one, leading and trailing blanks removed.
 *
 * @param {string} text
 * @param {'lrc'|'txt'|string} [format] - a hint; text with time tags is LRC either way
 * @returns {{ synced: boolean, lines: Array<{ms: number|null, text: string}> } | null} null when empty
 */
export function parseLyrics(text, format) {
  const raw = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return null;
  const rows = raw.split('\n');
  const looksSynced = rows.some((r) => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(r));
  if (looksSynced || format === 'lrc') {
    let offset = 0;
    const lines = [];
    for (const row of rows) {
      const line = row.trim();
      const off = line.match(OFFSET_TAG);
      if (off) { offset = Number(off[1]); continue; }
      if (META_TAG.test(line)) continue;
      const times = [];
      let rest = line;
      // Leading tags only: "[00:01.00][00:30.00]words".
      for (;;) {
        const m = rest.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
        if (!m) break;
        times.push(tagToMs(m[1], m[2], m[3]));
        rest = rest.slice(m[0].length);
      }
      if (!times.length) continue;
      // Word-level timing (<mm:ss.xx>) inside the words is not shown.
      const words = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(TIME_TAG, '').trim();
      for (const t of times) lines.push({ ms: Math.max(0, t - offset), text: words });
    }
    if (lines.length) {
      lines.sort((a, b) => a.ms - b.ms);
      // A blank line straight after another blank, or at the very end, says nothing.
      const tidy = lines.filter((l, i) => l.text || (i > 0 && lines[i - 1].text));
      while (tidy.length && !tidy[tidy.length - 1].text) tidy.pop();
      if (tidy.some((l) => l.text)) return { synced: true, lines: tidy };
    }
    if (looksSynced) return null;
  }
  const lines = [];
  for (const row of rows) {
    const t = row.trim();
    if (META_TAG.test(t) || OFFSET_TAG.test(t)) continue;
    if (!t && (!lines.length || !lines[lines.length - 1].text)) continue;
    lines.push({ ms: null, text: t });
  }
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return lines.length ? { synced: false, lines } : null;
}

/**
 * A track's audio quality from Plex metadata (Media + its audio stream), with
 * unknown fields left out.
 * @returns {{codec?: string, bitrate?: number, sampleRate?: number, bitDepth?: number}|null}
 */
export function audioQuality(media, stream) {
  const q = {};
  const codec = stream?.codec || media?.audioCodec;
  if (codec) q.codec = String(codec).toLowerCase();
  const bitrate = Number(stream?.bitrate ?? media?.bitrate);
  if (Number.isFinite(bitrate) && bitrate > 0) q.bitrate = Math.round(bitrate);
  const sampleRate = Number(stream?.samplingRate);
  if (Number.isFinite(sampleRate) && sampleRate > 0) q.sampleRate = Math.round(sampleRate);
  const bitDepth = Number(stream?.bitDepth);
  if (Number.isFinite(bitDepth) && bitDepth > 0) q.bitDepth = Math.round(bitDepth);
  // Plex's loudness analysis: the track gain (dB) that brings it to its reference
  // loudness, and the album's, for players that level volume between tracks.
  const gain = Number(stream?.gain);
  if (stream?.gain != null && Number.isFinite(gain)) q.gainDb = Math.round(gain * 100) / 100;
  const albumGain = Number(stream?.albumGain);
  if (stream?.albumGain != null && Number.isFinite(albumGain)) q.albumGainDb = Math.round(albumGain * 100) / 100;
  return Object.keys(q).length ? q : null;
}
