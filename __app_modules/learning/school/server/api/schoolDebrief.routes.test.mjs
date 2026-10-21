// S/api/schoolDebrief.routes.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolDebriefRouter } from "./schoolDebrief.mjs";

const grants = { verify: (t, { learnerId, day }) => (t === 'good' && learnerId === 'test-learner' && day === '2026-10-21' ? { ok: true } : { ok: false, reason: 'day' }) };
function app({ gateThrows = false } = {}) {
  const service = {
    day: vi.fn(async () => ({ phase: 'not-started' })), open: vi.fn(async () => ({ phase: 'entry' })),
    entry: vi.fn(async () => ({ phase: 'entry' })), answer: vi.fn(async () => ({ correct: true })),
    take: vi.fn(async () => ({ audioRef: 'a', text: 't' })), history: vi.fn(async () => []),
    excuse: vi.fn(async () => ({ phase: 'excused' })),
    submit: vi.fn(async () => { const e = new Error('Please answer: learned'); e.status = 400; throw e; }),
  };
  const teacherGate = { assert: vi.fn(() => { if (gateThrows) { const e = new Error('no'); e.name = 'GuestForbiddenError'; throw e; } }) };
  const a = express(); a.use('/debrief', createSchoolDebriefRouter({ service, grants, teacherGate, logger: { warn() {}, error() {} } }));
  return { a, service, teacherGate };
}

describe('school debrief router', () => {
  it('refuses a missing or wrong-day grant with 403', async () => {
    const { a } = app();
    expect((await request(a).get('/debrief/test-learner/day/2026-10-21')).status).toBe(403);
    expect((await request(a).get('/debrief/test-learner/day/2026-10-19').set('X-School-Debrief-Grant', 'good')).status).toBe(403);
  });
  it('serves the day with a good grant', async () => {
    const { a } = app();
    const r = await request(a).get('/debrief/test-learner/day/2026-10-21').set('X-School-Debrief-Grant', 'good');
    expect(r.status).toBe(200); expect(r.body.phase).toBe('not-started');
  });
  it('passes JSON bodies through', async () => {
    const { a, service } = app();
    await request(a).post('/debrief/test-learner/day/2026-10-21/entry').set('X-School-Debrief-Grant', 'good').send({ promptId: 'classes', text: 'math', via: 'typed' });
    expect(service.entry).toHaveBeenCalledWith('test-learner', '2026-10-21', { promptId: 'classes', text: 'math', via: 'typed', audioRef: null });
  });
  it('maps service errors to their status', async () => {
    const { a } = app();
    const r = await request(a).post('/debrief/test-learner/day/2026-10-21/submit').set('X-School-Debrief-Grant', 'good');
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/learned/);
  });
  it('accepts raw audio for take', async () => {
    const { a, service } = app();
    const r = await request(a).post('/debrief/test-learner/day/2026-10-21/take').set('X-School-Debrief-Grant', 'good').set('Content-Type', 'audio/webm').send(Buffer.alloc(2000));
    expect(r.status).toBe(200);
    expect(Buffer.isBuffer(service.take.mock.calls[0][2].buffer)).toBe(true);
  });
  it('teacher audio refuses a path-traversal file name', async () => {
    const { a } = app();
    expect((await request(a).get('/debrief/teacher/test-learner/audio/..%2F..%2Fsecrets.yml')).status).toBe(404);
  });
  it('teacher routes go through the gate', async () => {
    const ok = app();
    expect((await request(ok.a).post('/debrief/teacher/test-learner/day/2026-10-21/excuse').send({ by: 'parent', pin: '1', reason: 'sick' })).status).toBe(200);
    expect(ok.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ action: 'school.debrief.excuse' }));
    const denied = app({ gateThrows: true });
    expect((await request(denied.a).post('/debrief/teacher/test-learner/day/2026-10-21/excuse').send({ by: 'x' })).status).toBe(403);
  });
  it('teacher audio serves a valid file from the store and refuses traversal even with a store', async () => {
    const read = vi.fn((l, f) => (f === '2026-10-21-1.webm' ? { buffer: Buffer.from('x'), mimeType: 'audio/webm' } : null));
    const a = express(); a.use('/debrief', createSchoolDebriefRouter({ service: {}, grants, teacherGate: { assert() {} }, audioStore: { read }, logger: {} }));
    const ok = await request(a).get('/debrief/teacher/test-learner/audio/2026-10-21-1.webm?by=parent');
    expect(ok.status).toBe(200); expect(ok.headers['content-type']).toMatch(/audio\/webm/);
    expect((await request(a).get('/debrief/teacher/test-learner/audio/..%2Fx.webm')).status).toBe(404);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('refuses a bad grant before parsing a huge body (403, not 413)', async () => {
    const { a } = app();
    const r = await request(a).post('/debrief/test-learner/day/2026-10-21/take').set('X-School-Debrief-Grant', 'bad').set('Content-Type', 'audio/webm').send(Buffer.alloc(20 * 1024 * 1024));
    expect(r.status).toBe(403);
  });
  it('answers malformed JSON with a JSON 400, and an oversize take with a JSON 413', async () => {
    const { a } = app();
    const bad = await request(a).post('/debrief/test-learner/day/2026-10-21/entry').set('X-School-Debrief-Grant', 'good').set('Content-Type', 'application/json').send('{nope');
    expect(bad.status).toBe(400); expect(bad.headers['content-type']).toMatch(/json/); expect(bad.body.error).toBeTruthy();
    const big = await request(a).post('/debrief/test-learner/day/2026-10-21/take').set('X-School-Debrief-Grant', 'good').set('Content-Type', 'audio/webm').send(Buffer.alloc(11 * 1024 * 1024));
    expect(big.status).toBe(413); expect(big.body.error).toMatch(/too large/);
  });
  it('does not surface upstream AI errors (429) verbatim', async () => {
    const { a, service } = app();
    service.complete = vi.fn(async () => { throw Object.assign(new Error('openai rate limit sk-secret'), { status: 429 }); });
    const r = await request(a).post('/debrief/test-learner/day/2026-10-21/complete').set('X-School-Debrief-Grant', 'good');
    expect(r.status).toBe(500); expect(JSON.stringify(r.body)).not.toMatch(/openai|secret/);
  });
  it('teacher day actions refuse a malformed day with 400 (never a store error)', async () => {
    const { a, service } = app();
    const r = await request(a).post('/debrief/teacher/test-learner/day/yesterday/excuse').send({ by: 'parent', pin: '1' });
    expect(r.status).toBe(400);
    expect(service.excuse).not.toHaveBeenCalled();
  });
  it('teacher history goes through the gate with ?by= and the read action', async () => {
    const { a, service, teacherGate } = app();
    const r = await request(a).get('/debrief/teacher/test-learner/history?by=parent&from=2026-10-01&to=2026-10-21');
    expect(r.status).toBe(200); expect(r.body).toEqual({ days: [] });
    expect(teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'parent', action: 'school.debrief.read', context: { learnerId: 'test-learner' } }));
    expect(service.history).toHaveBeenCalledWith('test-learner', { from: '2026-10-01', to: '2026-10-21' });
    expect((await request(a).get('/debrief/teacher/test-learner/history?by=parent&from=junk')).status).toBe(400);
    const denied = app({ gateThrows: true });
    expect((await request(denied.a).get('/debrief/teacher/test-learner/history?by=x')).status).toBe(403);
    expect(denied.service.history).not.toHaveBeenCalled();
  });
  it('teacher audio: a gate refusal is 403 and never reads the store', async () => {
    const read = vi.fn(() => ({ buffer: Buffer.from('x'), mimeType: 'audio/webm' }));
    const assert = vi.fn(() => { const e = new Error('no'); e.name = 'GuestForbiddenError'; throw e; });
    const a = express(); a.use('/debrief', createSchoolDebriefRouter({ service: {}, grants, teacherGate: { assert }, audioStore: { read }, logger: {} }));
    expect((await request(a).get('/debrief/teacher/test-learner/audio/2026-10-21-1.webm?by=stranger')).status).toBe(403);
    expect(assert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'stranger', action: 'school.debrief.read' }));
    expect(read).not.toHaveBeenCalled();
  });
});
