import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountWordLadderRoutes } from './school.wordLadder.mjs';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notConfigured = (what) => Object.assign(new Error(`${what} not configured`), { status: 503 });
function app(extra = {}) {
  const live = { open: vi.fn(async () => ({ sittingId: 'p.live.1', item: { id: 'x' } })), respond: vi.fn(async () => ({ item: {} })), get: vi.fn(async () => ({})), close: vi.fn(async () => ({ closed: true })), fold: vi.fn(async () => ({})), saveRecording: vi.fn(async () => ({ take: 1 })), practice: vi.fn(async () => ({ item: { type: 'typed' } })), words: vi.fn(async () => ({ words: [] })) };
  const test = { ...live, open: vi.fn(async () => ({ sittingId: 'test.p.t.1' })), saveRecording: vi.fn(async () => ({ take: 1 })), practice: vi.fn(async () => ({ item: {} })), words: vi.fn(async () => ({ words: [] })), get: vi.fn(async () => ({ test: true })), close: vi.fn(async () => ({ closed: true })) };
  const a = express(); a.use(express.json()); const router = express.Router();
  mountWordLadderRoutes({ router, wrap, notConfigured, wordLadderStudy: live, wordLadderTest: test, stageScreen: 'portal', ...extra });
  a.use(router); a.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  return { a, live, test };
}

describe('word-ladder routes', () => {
  it('live open ignores a scenario; test open passes it', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/open').send({ userId: 'u', deckId: 'd', scenario: 'fresh' }).expect(200);
    expect(live.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd' });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd', scenario: 'fresh' }).expect(200);
    expect(test.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', scenario: 'fresh' });
  });
  it('responses are private no-store and the stage screen is served', async () => {
    const { a } = app();
    const res = await request(a).post('/word-ladder/sittings/p.live.1/items/x').send({ userId: 'u', response: { seen: true } }).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((await request(a).get('/word-ladder/stage').expect(200)).body).toEqual({ screen: 'portal' });
  });
  it('routes get, respond and close to the right service', async () => {
    const { a, live, test } = app();
    await request(a).get('/word-ladder/sittings/p.live.1?userId=u').expect(200);
    expect(live.get).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1' });
    await request(a).get('/word-ladder/test/sittings/test.p.t.1?userId=u').expect(200);
    expect(test.get).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1' });
    await request(a).post('/word-ladder/sittings/p.live.1/items/x').send({ userId: 'u', response: { typed: 'a' } }).expect(200);
    expect(live.respond).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', itemId: 'x', response: { typed: 'a' } });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/close').send({ userId: 'u' }).expect(200);
    expect(test.close).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', reason: 'leave' });
    expect(live.close).not.toHaveBeenCalled();
  });
  it('fold is live only; an unwired test service is not configured', async () => {
    const { a, live } = app({ wordLadderTest: null });
    await request(a).post('/word-ladder/fold').send({ learnerId: 'k', actorId: 'p' }).expect(200);
    expect(live.fold).toHaveBeenCalledWith({ learnerId: 'k', actorId: 'p', pin: null });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd' }).expect(503);
  });
  it('open passes capabilities on both mounts', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/open').send({ userId: 'u', deckId: 'd', capabilities: { microphone: true } }).expect(200);
    expect(live.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', capabilities: { microphone: true } });
    await request(a).post('/word-ladder/test/open').send({ userId: 'u', deckId: 'd', scenario: 'tricky', capabilities: { microphone: false } }).expect(200);
    expect(test.open).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', scenario: 'tricky', capabilities: { microphone: false } });
  });
  it('a raw audio take is posted to the mount\'s own service', async () => {
    const { a, live, test } = app();
    const res = await request(a).post('/word-ladder/sittings/p.live.1/recordings/d1:2?userId=u&ext=ogg')
      .set('Content-Type', 'audio/ogg').send(Buffer.from('take')).expect(200);
    expect(res.body).toEqual({ take: 1 });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(live.saveRecording).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', itemId: 'd1:2', buffer: Buffer.from('take'), ext: 'ogg' });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/recordings/d1:2?userId=u')
      .set('Content-Type', 'audio/webm').send(Buffer.from('x')).expect(200);
    expect(test.saveRecording).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', itemId: 'd1:2', buffer: Buffer.from('x'), ext: 'webm' });
    expect(live.saveRecording).toHaveBeenCalledTimes(1);
  });
  it('a take in an unaccepted content type reaches the service without a buffer', async () => {
    const { a, live } = app();
    await request(a).post('/word-ladder/sittings/p.live.1/recordings/d1:2?userId=u').set('Content-Type', 'text/plain').send('hello').expect(200);
    expect(live.saveRecording).toHaveBeenCalledWith(expect.objectContaining({ buffer: null }));
  });
  it('practice and My words route to the mount\'s service', async () => {
    const { a, live, test } = app();
    await request(a).post('/word-ladder/sittings/p.live.1/practice').send({ userId: 'u', mode: 'write', help: false, filter: 'tricky', chosen: ['a'], frontSide: 'gloss' }).expect(200);
    expect(live.practice).toHaveBeenCalledWith({ userId: 'u', sittingId: 'p.live.1', mode: 'write', help: false, filter: 'tricky', chosen: ['a'], frontSide: 'gloss' });
    await request(a).post('/word-ladder/test/sittings/test.p.t.1/practice').send({ userId: 'u', mode: 'match' }).expect(200);
    expect(test.practice).toHaveBeenCalledWith({ userId: 'u', sittingId: 'test.p.t.1', mode: 'match', help: true, filter: 'introduced', chosen: [], frontSide: 'term' });
    const res = await request(a).get('/word-ladder/words?userId=u&deckId=d').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(live.words).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', sittingId: null });
    await request(a).get('/word-ladder/test/words?userId=u&deckId=d&sittingId=test.p.t.1').expect(200);
    expect(test.words).toHaveBeenCalledWith({ userId: 'u', deckId: 'd', sittingId: 'test.p.t.1' });
  });
});
