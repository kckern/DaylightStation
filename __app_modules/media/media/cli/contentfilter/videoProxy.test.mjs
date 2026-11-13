import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { ensureVideoProxy, proxyArgs, proxyFileName, proxyFit, pruneProxies } from './videoProxy.mjs';
import { utimesSync, statSync } from 'fs';

describe('proxyFileName', () => {
  it('is keyed by part, file size and height', () => {
    expect(proxyFileName({ partId: '765703', size: 6336062557, height: 480 })).toBe('765703-6336062557-480p.mkv');
    expect(proxyFileName({ partId: '1', height: 480 })).toBe('1-x-480p.mkv');
  });
});

describe('proxyArgs', () => {
  it('picture only, scaled, a keyframe every second, no B-frames, every frame at its own time', () => {
    const a = proxyArgs('/in.mkv', '/out.mkv.partial', { height: 480 });
    expect(a).toEqual(expect.arrayContaining(['-i', '/in.mkv', '-map', '0:v:0', '-an', '-c:v', 'libx264', '-bf', '0', '-fps_mode', 'passthrough', '-f', 'matroska']));
    expect(a.join(' ')).toContain('scale=-2:480');
    expect(a).toEqual(expect.arrayContaining(['-force_key_frames', 'expr:gte(t,n_forced*1)', '-sc_threshold', '0']));
    expect(a.at(-1)).toBe('/out.mkv.partial');
  });
});

describe('ensureVideoProxy', () => {
  const dir = () => mkdtempSync(path.join(os.tmpdir(), 'cf-proxy-test-'));
  const part = { partId: '7', size: 10, height: 480 };

  it('builds once, to a partial file then the final name', async () => {
    const d = dir();
    const run = vi.fn(async (args) => { writeFileSync(args.at(-1), 'video'); });
    const p = await ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run });
    expect(p).toBe(path.join(d, '7-10-480p.mkv'));
    expect(existsSync(p)).toBe(true);
    expect(readdirSync(d)).toEqual(['7-10-480p.mkv']);
    await ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('two builds of one film at once: one ffmpeg, the other waits and gets the same file (review 2026-11-12)', async () => {
    const d = dir(); let release;
    const run = vi.fn(async (args) => { await new Promise((r) => { release = r; }); writeFileSync(args.at(-1), 'video'); });
    const a = ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run, pollMs: 5 });
    const b = ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run, pollMs: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(run).toHaveBeenCalledTimes(1);
    release();
    const [pa, pb] = await Promise.all([a, b]);
    expect(pa).toBe(pb);
    expect(readdirSync(d)).toEqual(['7-10-480p.mkv']);
  });
  it('a lock left by a crashed build older than staleMs is taken over', async () => {
    const d = dir();
    writeFileSync(path.join(d, '7-10-480p.mkv.lock'), '999999');
    const run = vi.fn(async (args) => { writeFileSync(args.at(-1), 'video'); });
    await ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run, pollMs: 5, staleMs: 0 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a failed build leaves nothing behind and rejects', async () => {
    const d = dir();
    const run = async (args) => { writeFileSync(args.at(-1), 'half'); throw new Error('ffmpeg exit 1'); };
    await expect(ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run })).rejects.toThrow('ffmpeg exit 1');
    expect(readdirSync(d)).toEqual([]);
  });
});

describe('proxyFit (review 2026-11-12: a film starting at 1.4 s)', () => {
  const orig = { fps: '24000/1001', startTime: 1.4, duration: 8229.0, frames: 197294 };
  it('the copy starts at 0: offset is the original\'s start', () => {
    expect(proxyFit({ original: orig, proxy: { ...orig, startTime: 0, duration: 8228.9 } })).toEqual({ ok: true, offset: 1.4 });
    // A container that counts its duration from 0 (measured: a 20.02 s clip starting at 1.4 reports 21.42).
    expect(proxyFit({ original: { ...orig, duration: 21.42 }, proxy: { ...orig, startTime: 0, duration: 20.02 } })).toEqual({ ok: true, offset: 1.4 });
  });
  it('T2: both start at 0, offset 0', () => {
    expect(proxyFit({ original: { ...orig, startTime: 0 }, proxy: { ...orig, startTime: 0, duration: 8228.8 } })).toEqual({ ok: true, offset: 0 });
  });
  it('refuses a copy at another frame rate, a different length or frame count', () => {
    expect(proxyFit({ original: orig, proxy: { ...orig, fps: '25/1', startTime: 0 } })).toMatchObject({ ok: false, reason: 'fps' });
    expect(proxyFit({ original: orig, proxy: { ...orig, startTime: 0, duration: 4000 } })).toMatchObject({ ok: false, reason: 'duration' });
    expect(proxyFit({ original: orig, proxy: { ...orig, startTime: 0, frames: 197000 } })).toMatchObject({ ok: false, reason: 'frames' });
  });
  it('unknown frame counts do not block', () => {
    expect(proxyFit({ original: { ...orig, frames: null }, proxy: { ...orig, startTime: 0, frames: 5 } }).ok).toBe(true);
  });
});

describe('pruneProxies (review 2026-11-12: the copies grew without bound)', () => {
  it('drops the least recently used copies past maxBytes, never the one in use, never partials or locks', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'cf-prune-'));
    const mk = (name, bytes, ageS) => { const f = path.join(d, name); writeFileSync(f, Buffer.alloc(bytes)); const t = new Date(Date.now() - ageS * 1000); utimesSync(f, t, t); };
    mk('1-1-480p.mkv', 400, 300); mk('2-2-480p.mkv', 400, 200); mk('3-3-480p.mkv', 400, 100); mk('4-4-480p.mkv', 400, 400);
    mk('5-5-480p.mkv.99.partial', 900, 500); mk('6-6-480p.mkv.lock', 1, 500);
    const removed = pruneProxies({ dir: d, maxBytes: 900, keep: path.join(d, '4-4-480p.mkv') });
    expect(removed.sort()).toEqual(['1-1-480p.mkv', '2-2-480p.mkv']);
    expect(readdirSync(d).sort()).toEqual(['3-3-480p.mkv', '4-4-480p.mkv', '5-5-480p.mkv.99.partial', '6-6-480p.mkv.lock']);
  });
});

