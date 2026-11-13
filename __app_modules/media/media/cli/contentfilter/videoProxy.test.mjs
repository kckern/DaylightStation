import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { ensureVideoProxy, proxyArgs, proxyFileName } from './videoProxy.mjs';

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

  it('a failed build leaves nothing behind and rejects', async () => {
    const d = dir();
    const run = async (args) => { writeFileSync(args.at(-1), 'half'); throw new Error('ffmpeg exit 1'); };
    await expect(ensureVideoProxy({ src: '/in.mkv', dir: d, ...part, run })).rejects.toThrow('ffmpeg exit 1');
    expect(readdirSync(d)).toEqual([]);
  });
});
