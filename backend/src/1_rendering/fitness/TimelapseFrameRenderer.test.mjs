import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from 'canvas';
import { createTimelapseFrameRenderer } from './TimelapseFrameRenderer.mjs';
import { FrameDescriptor } from '#domains/fitness/value-objects/FrameDescriptor.mjs';

function solidJpeg(w, h, color) {
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
  return c.toBuffer('image/jpeg');
}

test('renders a 1920x1080 composite JPEG', async () => {
  const renderer = createTimelapseFrameRenderer({ resolution: [1920, 1080], pip: { enabled: true, size: [480, 270] } });
  const out = await renderer.renderFrame({
    cameraBuffer: solidJpeg(640, 480, '#0a0'),
    playerBuffer: solidJpeg(640, 360, '#00a'),
    avatarBuffers: {},
    descriptor: new FrameDescriptor({
      frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0,
      title: 'Daytona USA', zone: 'hot', rpm: 86,
      participants: [{ id: 'kc', displayName: 'KC', hr: 142, color: '#f00', avatarRef: null }]
    })
  });
  assert.ok(Buffer.isBuffer(out) && out.length > 1000);
  const img = await loadImage(out);
  assert.equal(img.width, 1920);
  assert.equal(img.height, 1080);
});

test('renders without a player buffer (PiP gracefully skipped)', async () => {
  const renderer = createTimelapseFrameRenderer({ resolution: [1280, 720], pip: { enabled: true, size: [320, 180] } });
  const out = await renderer.renderFrame({
    cameraBuffer: solidJpeg(640, 480, '#0a0'),
    playerBuffer: null, avatarBuffers: {},
    descriptor: new FrameDescriptor({ frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0, participants: [] })
  });
  const img = await loadImage(out);
  assert.equal(img.width, 1280);
});
