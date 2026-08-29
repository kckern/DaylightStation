import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createCanvas, loadImage } from 'canvas';
import { createStaticApiRouter } from '#composition/modules/staticApi.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

async function serve(imgBasePath) {
  const app = express();
  app.use('/static', createStaticApiRouter({ imgBasePath, dataBasePath: imgBasePath, logger: silent }));
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}

function writePng(dir, name, w, h) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c00';
  ctx.fillRect(0, 0, w, h);
  fs.writeFileSync(path.join(dir, name), cv.toBuffer('image/png'));
}

test('?w= serves a resized variant with aspect preserved; no params serves the original', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
  writePng(dir, 'poster.png', 400, 600);
  const { srv, base } = await serve(dir);
  try {
    const r = await fetch(`${base}/static/img/poster.png?w=100`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    const img = await loadImage(Buffer.from(await r.arrayBuffer()));
    assert.equal(img.width, 100);
    assert.equal(img.height, 150); // aspect preserved

    const orig = await loadImage(Buffer.from(await (await fetch(`${base}/static/img/poster.png`)).arrayBuffer()));
    assert.equal(orig.width, 400);
  } finally { srv.close(); }
});

test('extensionless lookup (avatar style) resizes too, and never upscales', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-'));
  fs.mkdirSync(path.join(dir, 'users'));
  writePng(path.join(dir, 'users'), 'kc.png', 200, 300);
  const { srv, base } = await serve(dir);
  try {
    const r = await fetch(`${base}/static/img/users/kc?w=96`);
    assert.equal(r.status, 200);
    const img = await loadImage(Buffer.from(await r.arrayBuffer()));
    assert.equal(img.width, 96);

    const big = await fetch(`${base}/static/img/users/kc?w=800`);
    const bigImg = await loadImage(Buffer.from(await big.arrayBuffer()));
    assert.equal(bigImg.width, 200); // no upscaling past the source
  } finally { srv.close(); }
});
