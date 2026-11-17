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
  expect(r.refusal).toMatchObject({ status: 403, bodyComplete: false, bodyParsed: false });
});

// The positive control: a route that buffers the whole body before refusing
// must be visible to the caller, so a test built on this helper cannot pass.
it('records a refusal that came after parsing the body as complete and parsed', async () => {
  const app = express();
  app.post('/up', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => res.status(403).json({ error: 'no' }));
  const r = await postRefusedUpload(app, { path: '/up', headers: { 'Content-Type': 'audio/webm' }, size: SIZE });
  expect(r.refusal).toMatchObject({ status: 403, bodyComplete: true, bodyParsed: true });
});
