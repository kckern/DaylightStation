import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FfmpegVideoAdapter, metadataArgs } from './FfmpegVideoAdapter.mjs';

const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0;
const silent = { debug() {}, warn() {}, info() {} };

test('encodeSequence stitches frames into an mp4', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  for (let i = 0; i < 5; i++) {
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:size=320x240', '-frames:v', '1', path.join(dir, `frame_${String(i).padStart(5, '0')}.jpg`)]);
  }
  const out = path.join(dir, 'out.mp4');
  const adapter = new FfmpegVideoAdapter({ logger: silent });
  const res = await adapter.encodeSequence({ framesDir: dir, pattern: 'frame_%05d.jpg', fps: 10, outputPath: out, crf: 23 });
  assert.equal(res.outputPath, out);
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('encodeSequence rejects when args are missing', async () => {
  const adapter = new FfmpegVideoAdapter({ logger: silent });
  await assert.rejects(() => adapter.encodeSequence({ framesDir: '/x' }), /missing/i);
});

test('metadataArgs expands a tag map and skips blanks', () => {
  assert.deepEqual(metadataArgs({ title: 'X', genre: 'Fitness', comment: '' }),
    ['-metadata', 'title=X', '-metadata', 'genre=Fitness']);
  assert.deepEqual(metadataArgs(null), []);
});

test('encodeSequence embeds metadata tags (probe)', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  for (let i = 0; i < 3; i++) {
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:size=160x120', '-frames:v', '1', path.join(dir, `frame_${String(i).padStart(5, '0')}.jpg`)]);
  }
  const out = path.join(dir, 'out.mp4');
  const adapter = new FfmpegVideoAdapter({ logger: silent });
  await adapter.encodeSequence({ framesDir: dir, pattern: 'frame_%05d.jpg', fps: 10, outputPath: out, metadata: { title: 'Family Fitness - S2026E0101', genre: 'Fitness' } });
  const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_format', out]).stdout?.toString() || '';
  assert.match(probe, /title=Family Fitness/);
  assert.match(probe, /genre=Fitness/);
  fs.rmSync(dir, { recursive: true, force: true });
});
