import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalFileResource, sendLocalFileResource } from './streamFile.mjs';

describe('opaque local-file Express delivery', () => {
  let directory;
  let resource;
  let app;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-send-file-'));
    const filePath = path.join(directory, 'sample.txt');
    fs.writeFileSync(filePath, '0123456789');
    resource = createLocalFileResource(filePath, { mimeType: 'text/plain' });
    app = express();
    app.get('/file', (req, res) => {
      res.type(resource.mimeType);
      sendLocalFileResource(req, res, resource);
    });
  });

  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('does not expose the backing path in the application-facing resource', () => {
    expect(Object.keys(resource)).toEqual(['size', 'mimeType', 'open']);
    expect(resource).toMatchObject({ size: 10, mimeType: 'text/plain' });
    expect(resource).not.toHaveProperty('path');
    expect(resource).not.toHaveProperty('filePath');
  });

  it('retains Express sendFile headers and byte-range behavior', async () => {
    const full = await request(app).get('/file').expect(200, '0123456789');
    expect(full.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-length': '10',
      'cache-control': 'public, max-age=0',
    });
    expect(full.headers.etag).toBeTruthy();
    expect(full.headers['last-modified']).toBeTruthy();

    const range = await request(app).get('/file').set('Range', 'bytes=2-5').expect(206, '2345');
    expect(range.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'content-range': 'bytes 2-5/10',
      'content-length': '4',
    });
  });

  it('retains conditional GET and HEAD behavior', async () => {
    const first = await request(app).get('/file').expect(200);
    const conditional = await request(app).get('/file').set('If-None-Match', first.headers.etag).expect(304);
    expect(conditional.text).toBe('');

    const head = await request(app).head('/file').expect(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.text).toBeUndefined();
  });
});
