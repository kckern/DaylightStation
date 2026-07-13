/**
 * pianoRollImage — render a wrapped piano-roll PNG from parsed MIDI notes.
 *
 * Pure geometry comes from the domain (`computePianoRollLayout`); this module
 * only paints it: dark background, alternating row bands, faint per-row time
 * ticks, and one filled bar per note segment coloured by pitch class with
 * brightness by velocity. Returns a PNG Buffer.
 *
 * Layer: RENDERING (1_rendering/pianoaudio). Depends on the domain layout + the
 * shared CanvasFactory; no filesystem or MIDI parsing here.
 * @module 1_rendering/pianoaudio/pianoRollImage
 */
import { initCanvas } from '#rendering/lib/CanvasFactory.mjs';
import { computePianoRollLayout } from '#domains/pianoaudio/pianoRollLayout.mjs';

const BG = '#0f1115';
const BAND = '#161a20';       // alternating row band
const TICK = 'rgba(255,255,255,0.28)';
const TITLE_COLOR = '#e8ecf1';
const META_COLOR = 'rgba(255,255,255,0.45)';
const HEADER_H = 46;

function mmss(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Human duration, e.g. "2h 22m" or "3m 57s". */
function humanDuration(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Colour a note bar by pitch class (hue) and velocity (lightness). */
function noteColor(pitch, velocity) {
  const hue = Math.round((pitch % 12) * 30); // 12 classes across the wheel
  const light = 42 + Math.round((Math.min(127, velocity) / 127) * 26); // 42–68%
  return `hsl(${hue}, 72%, ${light}%)`;
}

/**
 * @param {Array<{pitch:number,startSec:number,durSec:number,velocity:number}>} notes
 * @param {number} durationSeconds
 * @param {object} [opts] - forwarded to computePianoRollLayout
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderPianoRollPng(notes, durationSeconds, opts = {}) {
  const { title = '', ...layoutOpts } = opts;
  const layout = computePianoRollLayout(notes, durationSeconds, layoutOpts);
  const { width, height, rows, rowHeight, rowGap, secondsPerRow, segments } = layout;

  const headerH = title ? HEADER_H : 0;
  const { canvas, ctx } = await initCanvas({ width, height: height + headerH });

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height + headerH);

  // Header: title (date/time) left, duration + note count right.
  if (title) {
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TITLE_COLOR;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(title, 12, headerH / 2);
    const meta = `${humanDuration(durationSeconds)}  ·  ${notes.length.toLocaleString('en-US')} notes`;
    ctx.font = '14px sans-serif';
    ctx.fillStyle = META_COLOR;
    ctx.textAlign = 'right';
    ctx.fillText(meta, width - 12, headerH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  ctx.save();
  ctx.translate(0, headerH);

  // Alternating row bands + per-row time tick
  ctx.font = '11px sans-serif';
  for (let r = 0; r < rows; r++) {
    const top = r * (rowHeight + rowGap);
    if (r % 2 === 1) {
      ctx.fillStyle = BAND;
      ctx.fillRect(0, top, width, rowHeight);
    }
    ctx.fillStyle = TICK;
    ctx.fillText(mmss(r * secondsPerRow), 3, top + 1);
  }

  // Notes
  for (const seg of segments) {
    ctx.fillStyle = noteColor(seg.pitch, seg.velocity);
    ctx.fillRect(seg.x, seg.y, seg.w, Math.max(1, seg.h - 0.5));
  }

  ctx.restore();
  return canvas.toBuffer('image/png');
}

export default { renderPianoRollPng };
