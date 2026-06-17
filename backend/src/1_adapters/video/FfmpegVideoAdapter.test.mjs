import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FfmpegVideoAdapter } from './FfmpegVideoAdapter.mjs';

const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0;
const silent = { debug() {}, warn() {}, info() {} };

test('extractFrame returns a JPEG buffer from a source video', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-'));
  const src = path.join(dir, 'src.mp4');
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', src]);
  const adapter = new FfmpegVideoAdapter({ logger: silent });
  const buf = await adapter.extractFrame({ source: src, offsetMs: 1000 });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8); // JPEG SOI
  fs.rmSync(dir, { recursive: true, force: true });
});

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

test('extractFrame rejects when source is missing', async () => {
  const adapter = new FfmpegVideoAdapter({ logger: silent });
  await assert.rejects(() => adapter.extractFrame({ offsetMs: 0 }), /source/);
});
