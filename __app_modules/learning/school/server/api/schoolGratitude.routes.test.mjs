// @vitest-environment node
import { it,expect,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolGratitudeRouter } from './schoolGratitude.mjs';
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
