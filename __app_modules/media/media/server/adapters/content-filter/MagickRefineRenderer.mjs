/**
 * MagickRefineRenderer - images for the decision model to look at.
 *
 * Contact sheets of labelled frames, frames with grid lines and cell labels,
 * per-cell crops, and spectrograms with lettered markers. Every output is a
 * PNG sized inside the decision model's 280-1568 px range.
 *
 * Requires ImageMagick 7 (`magick`) and ffmpeg (spectrograms).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir, deleteDir, readBinaryFromPath, writeBinary } from '#system/utils/FileIO.mjs';
import { tmpdir } from 'os';
import path from 'path';

const run = promisify(execFile);
const MAX_SIDE = 1568;
const MIN_SIDE = 280;
const MAX_BUFFER = 256 * 1024 * 1024;

export const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''); // no I/O: they read as 1/0

export class MagickRefineRenderer {
  constructor({ magick = 'magick', ffmpeg = 'ffmpeg', tmpRoot = tmpdir() } = {}) {
    this.magick = magick;
    this.ffmpeg = ffmpeg;
    this.tmpRoot = tmpRoot;
  }

  async #withDir(fn) {
    const dir = await createTempDir(path.join(this.tmpRoot, 'refine-render-'));
    try { return await fn(dir); } finally { deleteDir(dir); }
  }

  /**
   * Tile frames in a grid, each captioned (e.g. "A" or "#21950").
   * @param {Array<{ png: Buffer, label: string }>} tiles
   * @param {{ cols?: number, tileWidth?: number }} [opts]
   * @returns {Promise<Buffer>} PNG
   */
  async contactSheet(tiles, { cols = 4, tileWidth = 360 } = {}) {
    if (!tiles.length) throw new Error('contactSheet needs at least one tile');
    const c = Math.min(cols, tiles.length);
    const tw = Math.min(tileWidth, Math.floor((MAX_SIDE - c * 8) / c));
    return this.#withDir(async (dir) => {
      const labelled = [];
      for (const [i, t] of tiles.entries()) {
        const f = path.join(dir, `t${String(i).padStart(4, '0')}.png`);
        const lf = path.join(dir, `l${String(i).padStart(4, '0')}.png`);
        writeBinary(f, t.png);
        await run(this.magick, [f, '-resize', `${tw}x`, '-gravity', 'NorthWest', '-background', 'black', '-splice', '0x30',
          '-fill', 'yellow', '-pointsize', '24', '-annotate', '+6+2', t.label, lf], { maxBuffer: MAX_BUFFER });
        labelled.push(lf);
      }
      // Rows of `c` tiles, appended horizontally then vertically, 8 px gutters
      const rows = [];
      for (let r = 0; r * c < labelled.length; r++) {
        const rf = path.join(dir, `r${r}.png`);
        await run(this.magick, [...labelled.slice(r * c, r * c + c), '-background', 'white', '-splice', '8x0', '+append', rf]);
        rows.push(rf);
      }
      const out = path.join(dir, 'sheet.png');
      await run(this.magick, [...rows, '-background', 'white', '-splice', '0x8', '-append', ...fitArgs(), out]);
      return readBinaryFromPath(out);
    });
  }

  /**
   * Draw an n x n grid with numbered cells (0..n*n-1, row-major) on a frame.
   * @returns {Promise<Buffer>}
   */
  async gridOverlay(png, { grid = 3, width = 1200 } = {}) {
    return this.#withDir(async (dir) => {
      const src = path.join(dir, 'in.png');
      const out = path.join(dir, 'out.png');
      writeBinary(src, png);
      const { stdout } = await run(this.magick, [src, '-resize', `${width}x`, '-format', '%w %h', 'info:']);
      const [w, h] = stdout.trim().split(/\s+/).map(Number);
      const draw = [];
      for (let k = 1; k < grid; k++) {
        const x = Math.round((w * k) / grid); const y = Math.round((h * k) / grid);
        draw.push(`line ${x},0 ${x},${h}`, `line 0,${y} ${w},${y}`);
      }
      const labels = [];
      const ps = Math.max(18, Math.round(h / grid / 5));
      for (let r = 0; r < grid; r++) for (let col = 0; col < grid; col++) {
        const x = Math.round((w * col) / grid) + 6; const y = Math.round((h * r) / grid) + ps + 4;
        labels.push('-annotate', `+${x}+${y}`, String(r * grid + col));
      }
      await run(this.magick, [src, '-resize', `${width}x`, '-stroke', '#00ff66', '-strokewidth', '3', '-fill', 'none',
        '-draw', draw.join(' '), '-stroke', 'black', '-strokewidth', '1', '-fill', '#00ff66', '-pointsize', String(ps),
        '-gravity', 'NorthWest', ...labels, ...fitArgs(), out]);
      return readBinaryFromPath(out);
    });
  }

  /**
   * Crop cell `cell` of an n x n grid out of a frame (with `pad` fraction of a cell around it).
   * @returns {Promise<Buffer>}
   */
  async cellCrop(png, { grid = 3, cell, pad = 0.15 } = {}) {
    return this.#withDir(async (dir) => {
      const src = path.join(dir, 'in.png');
      const out = path.join(dir, 'out.png');
      writeBinary(src, png);
      const { stdout } = await run(this.magick, [src, '-format', '%w %h', 'info:']);
      const [w, h] = stdout.trim().split(/\s+/).map(Number);
      const r = Math.floor(cell / grid); const c = cell % grid;
      const cw = w / grid; const ch = h / grid;
      const x0 = Math.max(0, Math.round((c - pad) * cw)); const y0 = Math.max(0, Math.round((r - pad) * ch));
      const x1 = Math.min(w, Math.round((c + 1 + pad) * cw)); const y1 = Math.min(h, Math.round((r + 1 + pad) * ch));
      await run(this.magick, [src, '-crop', `${x1 - x0}x${y1 - y0}+${x0}+${y0}`, '+repage', ...fitArgs(), out]);
      return readBinaryFromPath(out);
    });
  }

  /**
   * Spectrogram (top) and waveform (bottom) of mono float samples, with
   * lettered vertical markers at the given times.
   *
   * Timing: the clip is trimmed to a whole number of samples per pixel column
   * (ffmpeg otherwise stretches time), and the spectrogram input is advanced
   * by half its FFT window so window smear is symmetric around the true time.
   * The waveform is exact.
   *
   * @param {{ samples: Float32Array, sampleRate: number, t0: number }} clip
   * @param {Array<{ t: number, label: string }>} markers - media times inside the clip
   * @param {{ width?: number, height?: number, maxHz?: number }} [opts]
   * @returns {Promise<Buffer>}
   */
  async spectrogram(clip, markers = [], { width = 1400, height = 520, maxHz = 8000 } = {}) {
    const usable = clip.samples.length - (clip.samples.length % width);
    if (usable < width) throw new Error(`clip too short for a ${width}px spectrogram`);
    const samples = clip.samples.subarray(0, usable);
    const specH = Math.round(height * 0.68);
    const waveH = height - specH;
    // showspectrumpic's window is ~2 x its height in samples and trails each column
    const half = Math.min(specH, samples.length);
    const advanced = new Float32Array(samples.length);
    advanced.set(samples.subarray(half));
    return this.#withDir(async (dir) => {
      const rawWave = path.join(dir, 'w.f32');
      const rawSpec = path.join(dir, 's.f32');
      writeBinary(rawWave, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      writeBinary(rawSpec, Buffer.from(advanced.buffer));
      const spec = path.join(dir, 'spec.png');
      const wave = path.join(dir, 'wave.png');
      const out = path.join(dir, 'out.png');
      const input = (f) => ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(clip.sampleRate), '-ac', '1', '-i', f];
      await run(this.ffmpeg, [...input(rawSpec),
        '-lavfi', `lowpass=f=${maxHz},showspectrumpic=s=${width}x${specH}:legend=0:scale=log:color=intensity:fscale=lin:stop=${maxHz}`, spec]);
      await run(this.ffmpeg, [...input(rawWave), '-lavfi', `showwavespic=s=${width}x${waveH}:colors=white:scale=sqrt`, wave]);
      const dur = samples.length / clip.sampleRate;
      const draw = []; const ann = [];
      for (const m of markers) {
        const x = Math.round(((m.t - clip.t0) / dur) * width);
        if (x < 0 || x > width) continue;
        draw.push(`line ${x},0 ${x},${height}`);
        ann.push('-annotate', `+${Math.max(0, x - 9)}+30`, m.label);
      }
      await run(this.magick, [spec, '(', wave, '-background', 'black', '-flatten', ')', '-append',
        '-stroke', '#ff3030', '-strokewidth', '2', '-fill', 'none', '-draw', draw.join(' ') || 'point 0,0',
        '-stroke', 'black', '-strokewidth', '1', '-fill', '#ffff00', '-pointsize', '30', '-gravity', 'NorthWest', ...ann,
        ...fitArgs(), out]);
      return readBinaryFromPath(out);
    });
  }
}

/** Keep each side inside the model's accepted range. */
function fitArgs() {
  return ['-resize', `${MAX_SIDE}x${MAX_SIDE}>`, '-background', 'white', '-gravity', 'center', '-extent', `%[fx:max(w,${MIN_SIDE})]x%[fx:max(h,${MIN_SIDE})]`];
}

export default MagickRefineRenderer;
