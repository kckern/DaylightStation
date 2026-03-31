import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { makeThumbnail, addPageLabel, buildContactSheet, rotateImage } from './images.mjs';

// Create a test image: 800x1000 white JPG
async function makeTestJpg(width = 800, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg()
    .toBuffer();
}

describe('images', () => {
  let testJpg;

  before(async () => {
    testJpg = await makeTestJpg();
  });

  test('makeThumbnail resizes to target width', async () => {
    const thumb = await makeThumbnail(testJpg, 300);
    const meta = await sharp(thumb).metadata();
    assert.equal(meta.width, 300);
    assert.ok(meta.height > 0);
  });

  test('addPageLabel composites a number onto image', async () => {
    const thumb = await makeThumbnail(testJpg, 300);
    const labeled = await addPageLabel(thumb, 7);
    const meta = await sharp(labeled).metadata();
    assert.equal(meta.width, 300);
  });

  test('buildContactSheet creates grid from thumbnails', async () => {
    const thumbs = [];
    for (let i = 0; i < 8; i++) {
      const thumb = await makeThumbnail(testJpg, 300);
      thumbs.push(await addPageLabel(thumb, i + 1));
    }
    const sheet = await buildContactSheet(thumbs, { columns: 4 });
    const meta = await sharp(sheet).metadata();
    assert.ok(meta.width >= 1200);
    assert.ok(meta.height > 300);
  });

  test('rotateImage rotates by given degrees', async () => {
    const rotated = await rotateImage(testJpg, 90);
    const meta = await sharp(rotated).metadata();
    assert.equal(meta.width, 1000);
    assert.equal(meta.height, 800);
  });
});
