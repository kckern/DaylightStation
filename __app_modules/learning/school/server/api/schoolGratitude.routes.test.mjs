// @vitest-environment node
import { it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolGratitudeRouter } from './schoolGratitude.mjs';
import { postRefusedUpload } from '../../../../../tests/_lib/refusedUpload.mjs';
it('refuses other-purpose grants before processing input and enforces persisted cooldown',async()=>{
  const capture=vi.fn();
  const service={assertCanTake:async()=>{const e=new Error('Wait');e.status=429;e.retryAt='2026-11-16T18:30:00Z';throw e;},take:capture};
  const grants={verify:token=>({ok:token==='good'})};
  const app=express();app.use('/gratitude',createSchoolGratitudeRouter({service,grants,teacherGate:{assert(){}}}));
  expect((await request(app).get('/gratitude/child/day/2026-02-30').set('X-School-Gratitude-Grant','good')).status).toBe(400);
  expect((await request(app).post('/gratitude/child/day/2026-11-16/submit').send({text:'Toys'})).status).toBe(403);
  const r=await request(app).post('/gratitude/child/day/2026-11-16/take').set('X-School-Gratitude-Grant','good').set('Content-Type','audio/webm').send(Buffer.alloc(1024));
  expect(r.status).toBe(429);expect(r.body.retryAt).toBe('2026-11-16T18:30:00Z');expect(capture).not.toHaveBeenCalled();
});
// "Verification precedes body parsing; cooldown checks precede take buffering"
// (gratitude.md). A 20 MB take proves neither refusal reads the upload.
it.each([
  ['a bad grant', 'bad', 403],
  ['a persisted cooldown', 'good', 429],
])('refuses %s before buffering a huge take', async (_name, grant, status) => {
  const take = vi.fn();
  const assertCanTake = vi.fn(async () => { const e = new Error('Wait'); e.status = 429; e.retryAt = '2026-11-16T18:30:00Z'; throw e; });
  const app = express(); app.use('/gratitude', createSchoolGratitudeRouter({ service: { assertCanTake, take }, grants: { verify: (token) => ({ ok: token === 'good' }) }, teacherGate: { assert() {} } }));
  const r = await postRefusedUpload(app, { path: '/gratitude/child/day/2026-11-16/take', headers: { 'X-School-Gratitude-Grant': grant, 'Content-Type': 'audio/webm' }, size: 20 * 1024 * 1024 });
  expect(r.refusedStatus).toBe(status);
  expect(r.refusal).toMatchObject({ status, bodyComplete: false, bodyParsed: false });
  expect(take).not.toHaveBeenCalled();
  expect(assertCanTake).toHaveBeenCalledTimes(grant === 'good' ? 1 : 0);
});
