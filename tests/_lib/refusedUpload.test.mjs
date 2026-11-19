// @vitest-environment node
import { it, expect } from 'vitest';
import express from 'express';
import { postRefusedUpload } from './refusedUpload.mjs';

const SIZE = 20 * 1024 * 1024;

it('records an early refusal as unread and unparsed', async () => {
  const app = express();
  app.post('/up', (req, res) => res.status(403).json({ error: 'no' }), express.raw({ type: '*/*', limit: '30mb' }));
  const r = await postRefusedUpload(app, { path: '/up', headers: { 'Content-Type': 'audio/webm' }, size: SIZE });
  expect(r.refusedStatus).toBe(403);
  expect(r.refusal).toMatchObject({ status: 403, bodyComplete: false, bodyParsed: false, bodyRead: false });
});

// The positive control: a route that buffers the whole body before refusing
// must be visible to the caller, so a test built on this helper cannot pass.
it('records a refusal that came after parsing the body as complete and parsed', async () => {
  const app = express();
  app.post('/up', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => res.status(403).json({ error: 'no' }));
  const r = await postRefusedUpload(app, { path: '/up', headers: { 'Content-Type': 'audio/webm' }, size: SIZE });
  expect(r.refusal).toMatchObject({ status: 403, bodyComplete: true, bodyParsed: true, bodyRead: true });
});

// A small body can arrive whole in the first packet, so `bodyComplete` would be
// true even for a route that never read it; the helper only answers for large ones.
it('refuses a body too small to tell an early refusal from a full read', async () => {
  await expect(postRefusedUpload(express(), { path: '/up', size: 1024 })).rejects.toThrow(/at least 8 MB/);
});

it('records a route that only started reading as having read the body', async () => {
  const app = express();
  app.post('/up', (req, res) => { req.once('data', () => res.status(403).json({ error: 'no' })); });
  const r = await postRefusedUpload(app, { path: '/up', headers: { 'Content-Type': 'audio/webm' }, size: 20 * 1024 * 1024 });
  expect(r.refusal).toMatchObject({ status: 403, bodyRead: true });
});
